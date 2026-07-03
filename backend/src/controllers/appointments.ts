import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middleware/auth';
import prisma from '../services/db';
import { acquireHold, releaseHold, resolveHold } from '../services/slotLock';
import { callLLMJson } from '../services/llm';
import {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendWaitlistNotification
} from '../services/email';
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '../services/calendar';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

/**
 * Patient Portal: Request a short-lived 5-minute hold on a slot.
 */
export async function holdSlot(req: AuthenticatedRequest, res: Response) {
  const { doctorId, startTime, endTime } = req.body;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (!doctorId || !startTime || !endTime) {
    return res.status(400).json({ error: 'Doctor ID, start time, and end time are required' });
  }

  const success = await acquireHold(doctorId, new Date(startTime), new Date(endTime), req.user.id);
  
  if (success) {
    return res.json({ message: 'Slot hold secured', success: true });
  } else {
    return res.status(400).json({ error: 'Slot is unavailable or currently held by another user', success: false });
  }
}

/**
 * Patient Portal: Manually release a held slot.
 */
export async function releaseSlot(req: AuthenticatedRequest, res: Response) {
  const { doctorId, startTime } = req.body;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const success = await releaseHold(doctorId, new Date(startTime), req.user.id);
  return res.json({ success });
}

/**
 * Patient Portal: Confirm booking of an appointment.
 */
export async function bookAppointment(req: AuthenticatedRequest, res: Response) {
  const { doctorId, startTime, endTime, symptoms } = req.body;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (!doctorId || !startTime || !endTime) {
    return res.status(400).json({ error: 'Doctor ID, start time, and end time are required' });
  }

  const startDt = new Date(startTime);
  const endDt = new Date(endTime);

  try {
    // 1. Ensure the patient holds the slot. If not, attempt to acquire the lock.
    const activeHold = await prisma.slotHold.findFirst({
      where: {
        doctorId,
        startTime: startDt,
        heldById: req.user.id,
        expiresAt: { gt: new Date() },
        resolved: false
      }
    });

    if (!activeHold) {
      const lockAcquired = await acquireHold(doctorId, startDt, endDt, req.user.id);
      if (!lockAcquired) {
        return res.status(400).json({ error: 'Slot is no longer available. Please choose another time.' });
      }
    }

    // 2. Create the booked appointment
    const appointment = await prisma.appointment.create({
      data: {
        patientId: req.user.id,
        doctorId,
        startTime: startDt,
        endTime: endDt,
        status: 'BOOKED',
        symptoms
      },
      include: {
        patient: true,
        doctor: { include: { user: true } }
      }
    });

    // 3. Resolve the slot hold in DB
    await resolveHold(doctorId, startDt, req.user.id);

    // 4. Trigger Pre-visit LLM Summary (Attempt fast sync, fallback async)
    let urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let chiefComplaint = 'General assessment';
    let questions: string[] = [];
    let llmStatus = 'PENDING';
    let suggestedEarlierSlot: any = null;

    try {
      const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms || 'None specified'}`;
      
      // Perform LLM call with a tight 3.5s timeout. If it fails, error is caught and handled.
      const llmResult = await Promise.race([
        callLLMJson<{ urgency: string; chiefComplaint: string; questions: string[] }>(prompt, ['urgency', 'chiefComplaint', 'questions']),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('LLM Timeout')), 3500))
      ]);

      if (llmResult) {
        urgency = llmResult.urgency.toUpperCase() as any;
        chiefComplaint = llmResult.chiefComplaint;
        questions = llmResult.questions;
        llmStatus = 'COMPLETED';

        // If high urgency, look for an earlier open slot on the same day to suggest
        if (urgency === 'HIGH') {
          suggestedEarlierSlot = await findEarlierOpenSlotSameDay(doctorId, startDt);
        }
      }
    } catch (llmErr) {
      console.warn('[APPOINTMENTS] Fast LLM summary failed/timed out. Registering as PENDING for cron retry.');
    }

    // Store Symptom Summary
    await prisma.symptomSummary.create({
      data: {
        appointmentId: appointment.id,
        urgency,
        chiefComplaint,
        questions: JSON.stringify(questions.length > 0 ? questions : ['General query 1', 'General query 2', 'General query 3']),
        status: llmStatus,
        rawResponse: llmStatus === 'COMPLETED' ? 'Successful pre-visit analysis' : null
      }
    });

    // 5. Google Calendar (Async fire-and-forget)
    createCalendarEvent(appointment.id).then(async (eventId) => {
      if (eventId) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { googleEventId: eventId }
        });
      }
    });

    // 6. Send email confirmation (Async fire-and-forget)
    const docName = `${appointment.doctor.user.firstName} ${appointment.doctor.user.lastName}`;
    sendBookingConfirmation(
      {
        id: appointment.patientId,
        email: appointment.patient.email,
        firstName: appointment.patient.firstName,
        lastName: appointment.patient.lastName
      },
      docName,
      startDt
    );

    return res.status(201).json({
      message: 'Appointment booked successfully',
      appointmentId: appointment.id,
      urgency,
      suggestedEarlierSlot
    });
  } catch (error: any) {
    console.error('[APPOINTMENTS] Booking error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Doctor Portal: Retrieve today's appointments.
 */
export async function getTodayAppointments(req: AuthenticatedRequest, res: Response) {
  const doctorProfileId = req.user?.doctorProfileId;
  if (!doctorProfileId) {
    return res.status(403).json({ error: 'Only doctors can access this endpoint' });
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: doctorProfileId,
        startTime: { gte: todayStart, lt: todayEnd },
        status: 'BOOKED'
      },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        symptomSummary: true
      },
      orderBy: { startTime: 'asc' }
    });

    // Add suggested earlier slots for High urgency cases who aren't in the earliest slot already
    const formatted = [];
    for (const appt of appointments) {
      let suggestions = null;
      if (appt.symptomSummary?.urgency === 'HIGH') {
        suggestions = await findEarlierOpenSlotSameDay(doctorProfileId, appt.startTime);
      }
      formatted.push({
        ...appt,
        symptomSummary: appt.symptomSummary ? {
          ...appt.symptomSummary,
          questions: typeof appt.symptomSummary.questions === 'string' ? JSON.parse(appt.symptomSummary.questions) : appt.symptomSummary.questions
        } : null,
        earlierSlotSuggestion: suggestions
      });
    }

    return res.json(formatted);
  } catch (error: any) {
    console.error('[APPOINTMENTS] Get today appointments error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Doctor Portal: Submit post-visit notes and prescriptions.
 */
export async function submitVisitNotes(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // appointmentId
  const { clinicalNotes, prescriptions } = req.body;
  const doctorProfileId = req.user?.doctorProfileId;

  if (!doctorProfileId) {
    return res.status(403).json({ error: 'Only doctors can access this endpoint' });
  }

  if (!clinicalNotes) {
    return res.status(400).json({ error: 'Clinical notes are required' });
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: { patient: true }
    });

    if (!appointment || appointment.doctorId !== doctorProfileId) {
      return res.status(404).json({ error: 'Appointment not found or not assigned to you' });
    }

    // 1. Create Visit Note and trigger async LLM Post-visit Summary
    let summaryText = 'Summary pending — will retry';
    let summaryStatus = 'PENDING';

    try {
      const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${clinicalNotes}`;
      
      const llmResult = await Promise.race([
        callLLMJson<{ patientFriendlySummary: string }>(prompt, ['patientFriendlySummary']),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('LLM Timeout')), 3500))
      ]);

      if (llmResult) {
        summaryText = llmResult.patientFriendlySummary;
        summaryStatus = 'COMPLETED';
      }
    } catch (llmErr) {
      console.warn('[APPOINTMENTS] Fast visit note summary failed. Registered as PENDING for cron.');
    }

    await prisma.visitNote.create({
      data: {
        appointmentId: id,
        clinicalNotes,
        patientFriendlySummary: summaryText,
        status: summaryStatus
      }
    });

    // 2. Create prescriptions
    if (prescriptions && Array.isArray(prescriptions)) {
      for (const rx of prescriptions) {
        await prisma.prescription.create({
          data: {
            appointmentId: id,
            medication: rx.medication,
            dosage: rx.dosage,
            frequency: rx.frequency,
            duration: rx.duration
          }
        });
      }
    }

    // 3. Mark appointment COMPLETED
    await prisma.appointment.update({
      where: { id },
      data: { status: 'COMPLETED' }
    });

    return res.json({
      message: 'Visit notes and prescriptions submitted successfully',
      patientFriendlySummary: summaryText
    });
  } catch (error: any) {
    console.error('[APPOINTMENTS] Submit notes error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Cancel an appointment.
 * Automatically notifies patient/doctor and handles waitlist filling.
 */
export async function cancelAppointment(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // appointmentId
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: { include: { user: true } }
      }
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Permissions: Patient can cancel their own, Doctor/Admin can cancel any
    if (req.user.role === 'PATIENT' && appointment.patientId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Mark cancelled
    await prisma.appointment.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    // 1. Delete calendar event (Async)
    if (appointment.googleEventId) {
      deleteCalendarEvent(appointment.googleEventId, appointment.patientId, appointment.doctor.userId);
    }

    // 2. Email cancellation notice (Async)
    const docName = `${appointment.doctor.user.firstName} ${appointment.doctor.user.lastName}`;
    sendBookingCancellation(
      {
        id: appointment.patientId,
        email: appointment.patient.email,
        firstName: appointment.patient.firstName,
        lastName: appointment.patient.lastName
      },
      docName,
      appointment.startTime,
      'Cancelled by user/provider request'
    );

    // 3. Concurrency / Waitlist: Auto-fill nearest waitlisted patient
    const dateStr = appointment.startTime.toISOString().split('T')[0];
    const preferredDate = new Date(dateStr);
    preferredDate.setHours(0,0,0,0);

    const waitlisted = await prisma.waitlist.findFirst({
      where: {
        doctorProfileId: appointment.doctorId,
        preferredDate: preferredDate
      },
      include: { patient: true },
      orderBy: { createdAt: 'asc' } // First come first served
    });

    if (waitlisted) {
      console.log(`[WAITLIST] Slot opened on ${dateStr}. Notifying patient ${waitlisted.patient.firstName}`);
      await sendWaitlistNotification(
        {
          id: waitlisted.patientId,
          email: waitlisted.patient.email,
          firstName: waitlisted.patient.firstName,
          lastName: waitlisted.patient.lastName
        },
        docName,
        appointment.startTime
      );

      // Remove waitlist entry since notified
      await prisma.waitlist.delete({
        where: { id: waitlisted.id }
      });
    }

    return res.json({ message: 'Appointment successfully cancelled' });
  } catch (error: any) {
    console.error('[APPOINTMENTS] Cancellation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Rebook a cancelled slot using a rebook token.
 */
export async function rebookAppointment(req: AuthenticatedRequest, res: Response) {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      appointmentId: string;
      doctorId: string;
      startTime: string;
      endTime: string;
      patientId: string;
    };

    const startDt = new Date(decoded.startTime);
    const endDt = new Date(decoded.endTime);

    // 1. Acquire hold
    const holdAcquired = await acquireHold(decoded.doctorId, startDt, endDt, decoded.patientId);
    if (!holdAcquired) {
      return res.status(400).json({ error: 'Suggested rebook slot is no longer available. Please select another slot.' });
    }

    // 2. Update appointment
    const updatedAppt = await prisma.appointment.update({
      where: { id: decoded.appointmentId },
      data: {
        startTime: startDt,
        endTime: endDt,
        status: 'BOOKED'
      },
      include: {
        patient: true,
        doctor: { include: { user: true } }
      }
    });

    // 3. Resolve hold
    await resolveHold(decoded.doctorId, startDt, decoded.patientId);

    // 4. Sync calendar
    if (updatedAppt.googleEventId) {
      updateCalendarEvent(updatedAppt.id);
    } else {
      createCalendarEvent(updatedAppt.id).then(async (eventId) => {
        if (eventId) {
          await prisma.appointment.update({
            where: { id: updatedAppt.id },
            data: { googleEventId: eventId }
          });
        }
      });
    }

    // 5. Email confirmation
    const docName = `${updatedAppt.doctor.user.firstName} ${updatedAppt.doctor.user.lastName}`;
    sendBookingConfirmation(
      {
        id: updatedAppt.patientId,
        email: updatedAppt.patient.email,
        firstName: updatedAppt.patient.firstName,
        lastName: updatedAppt.patient.lastName
      },
      docName,
      startDt
    );

    return res.json({ message: 'Appointment rebooked successfully', appointment: updatedAppt });
  } catch (error: any) {
    console.error('[APPOINTMENTS] Rebook error:', error);
    return res.status(400).json({ error: 'Invalid or expired rebooking token' });
  }
}

/**
 * Patient Dashboard: Retrieve patient's appointments.
 */
export async function getPatientAppointments(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const appointments = await prisma.appointment.findMany({
      where: {
        patientId: req.user.id
      },
      include: {
        doctor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        symptomSummary: true,
        visitNote: true,
        prescriptions: true
      },
      orderBy: { startTime: 'desc' }
    });

    const formatted = appointments.map((appt) => ({
      ...appt,
      symptomSummary: appt.symptomSummary ? {
        ...appt.symptomSummary,
        questions: typeof appt.symptomSummary.questions === 'string' ? JSON.parse(appt.symptomSummary.questions) : appt.symptomSummary.questions
      } : null
    }));

    return res.json(formatted);
  } catch (error: any) {
    console.error('[APPOINTMENTS] Get patient appointments error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Longitudinal Medical History / Visit Timeline for a patient.
 */
export async function getPatientVisitTimeline(req: AuthenticatedRequest, res: Response) {
  const { patientId } = req.params;

  try {
    // Permission check: Patients can only view their own. Doctors/Admins can view any.
    if (req.user?.role === 'PATIENT' && req.user.id !== patientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const timeline = await prisma.appointment.findMany({
      where: {
        patientId,
        status: 'COMPLETED'
      },
      include: {
        doctor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        },
        symptomSummary: true,
        visitNote: true,
        prescriptions: true
      },
      orderBy: { startTime: 'desc' }
    });

    const formatted = timeline.map((visit) => ({
      ...visit,
      symptomSummary: visit.symptomSummary ? {
        ...visit.symptomSummary,
        questions: typeof visit.symptomSummary.questions === 'string' ? JSON.parse(visit.symptomSummary.questions) : visit.symptomSummary.questions
      } : null
    }));

    return res.json(formatted);
  } catch (error: any) {
    console.error('[APPOINTMENTS] Longitudinal timeline error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Waitlist Support

export async function joinWaitlist(req: AuthenticatedRequest, res: Response) {
  const { doctorId, date } = req.body;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  if (!doctorId || !date) {
    return res.status(400).json({ error: 'Doctor profile ID and date are required' });
  }

  const preferredDate = new Date(date);
  preferredDate.setHours(0, 0, 0, 0);

  try {
    const entry = await prisma.waitlist.upsert({
      where: {
        patientId_doctorProfileId_preferredDate: {
          patientId: req.user.id,
          doctorProfileId: doctorId,
          preferredDate
        }
      },
      update: {},
      create: {
        patientId: req.user.id,
        doctorProfileId: doctorId,
        preferredDate
      }
    });

    await prisma.auditLog.create({
      data: {
        action: 'WAITLIST_JOIN',
        details: `Patient ${req.user.id} joined waitlist for doctor ${doctorId} on date ${preferredDate.toDateString()}`,
        userId: req.user.id
      }
    });

    return res.status(201).json({ message: 'Successfully joined waitlist', entry });
  } catch (error: any) {
    console.error('[WAITLIST] Join error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getPatientWaitlist(req: AuthenticatedRequest, res: Response) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const list = await prisma.waitlist.findMany({
      where: { patientId: req.user.id },
      include: {
        doctorProfile: {
          include: {
            user: { select: { firstName: true, lastName: true } }
          }
        }
      },
      orderBy: { preferredDate: 'asc' }
    });
    return res.json(list);
  } catch (error: any) {
    console.error('[WAITLIST] Get error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function leaveWaitlist(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const entry = await prisma.waitlist.findUnique({ where: { id } });
    if (!entry || entry.patientId !== req.user.id) {
      return res.status(404).json({ error: 'Waitlist entry not found' });
    }

    await prisma.waitlist.delete({ where: { id } });
    return res.json({ message: 'Left waitlist' });
  } catch (error: any) {
    console.error('[WAITLIST] Leave error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Help algorithms

/**
 * Searches for any earlier free slot on the same day for high-urgency patient suggestions.
 */
async function findEarlierOpenSlotSameDay(
  doctorId: string,
  bookedStartTime: Date
): Promise<{ start: Date; end: Date } | null> {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId }
  });

  if (!doctor) return null;

  const workingHours = typeof doctor.workingHours === 'string' ? JSON.parse(doctor.workingHours) : (doctor.workingHours || { start: '09:00', end: '17:00' });
  const slotDuration = doctor.slotDuration;

  const [startH, startM] = workingHours.start.split(':').map(Number);

  const dayStart = new Date(bookedStartTime);
  dayStart.setHours(startH, startM, 0, 0);

  const bookings = await prisma.appointment.findMany({
    where: {
      doctorId,
      startTime: { gte: dayStart, lt: bookedStartTime },
      status: 'BOOKED'
    }
  });

  const holds = await prisma.slotHold.findMany({
    where: {
      doctorId,
      startTime: { gte: dayStart, lt: bookedStartTime },
      expiresAt: { gt: new Date() },
      resolved: false
    }
  });

  let current = new Date(dayStart);

  while (current < bookedStartTime) {
    const slotEnd = new Date(current.getTime() + slotDuration * 60 * 1000);
    
    const isBooked = bookings.some((b) => b.startTime.getTime() === current.getTime());
    const isHeld = holds.some((h) => h.startTime.getTime() === current.getTime());
    const isPast = current.getTime() < Date.now();

    if (!isBooked && !isHeld && !isPast) {
      return { start: current, end: slotEnd };
    }

    current = slotEnd;
  }

  return null;
}
