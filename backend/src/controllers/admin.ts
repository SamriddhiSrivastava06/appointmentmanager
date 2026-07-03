import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middleware/auth';
import prisma from '../services/db';
import { sendLeaveCancellationWithRebook } from '../services/email';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

/**
 * Admin portal: Create a new doctor user and matching doctor profile.
 */
export async function createDoctor(req: AuthenticatedRequest, res: Response) {
  const { email, password, firstName, lastName, specialization, workingHours, slotDuration } = req.body;

  if (!email || !password || !firstName || !lastName || !specialization || !workingHours || !slotDuration) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'DOCTOR'
        }
      });

      const profile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          specialization,
          workingHours: JSON.stringify(workingHours || { start: '09:00', end: '17:00' }),
          slotDuration: parseInt(slotDuration) || 30
        }
      });

      return { user, profile };
    });

    return res.status(201).json({
      message: 'Doctor created successfully',
      doctor: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        profileId: result.profile.id,
        specialization: result.profile.specialization,
        workingHours: result.profile.workingHours,
        slotDuration: result.profile.slotDuration
      }
    });
  } catch (error: any) {
    console.error('[ADMIN] Create doctor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin portal: Update a doctor's profile details.
 */
export async function updateDoctor(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId
  const { firstName, lastName, specialization, workingHours, slotDuration } = req.body;

  try {
    const profile = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!profile) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    const updatedProfile = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: profile.userId },
        data: {
          firstName: firstName !== undefined ? firstName : profile.user.firstName,
          lastName: lastName !== undefined ? lastName : profile.user.lastName
        }
      });

      const updated = await tx.doctorProfile.update({
        where: { id },
        data: {
          specialization: specialization !== undefined ? specialization : profile.specialization,
          workingHours: workingHours !== undefined ? JSON.stringify(workingHours) : profile.workingHours,
          slotDuration: slotDuration !== undefined ? parseInt(slotDuration) : profile.slotDuration
        },
        include: { user: true }
      });

      return updated;
    });

    return res.json({
      message: 'Doctor profile updated successfully',
      doctor: {
        id: updatedProfile.user.id,
        email: updatedProfile.user.email,
        firstName: updatedProfile.user.firstName,
        lastName: updatedProfile.user.lastName,
        profileId: updatedProfile.id,
        specialization: updatedProfile.specialization,
        workingHours: updatedProfile.workingHours,
        slotDuration: updatedProfile.slotDuration
      }
    });
  } catch (error: any) {
    console.error('[ADMIN] Update doctor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin portal: Delete a doctor user.
 */
export async function deleteDoctor(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId

  try {
    const profile = await prisma.doctorProfile.findUnique({ where: { id } });
    if (!profile) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // Cascade delete on User table deletes profile and associated records
    await prisma.user.delete({ where: { id: profile.userId } });

    return res.json({ message: 'Doctor deleted successfully' });
  } catch (error: any) {
    console.error('[ADMIN] Delete doctor error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin portal: Get list of all doctors.
 */
export async function getDoctorsList(req: AuthenticatedRequest, res: Response) {
  try {
    const doctors = await prisma.doctorProfile.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const formatted = doctors.map((d) => ({
      profileId: d.id,
      userId: d.user.id,
      email: d.user.email,
      firstName: d.user.firstName,
      lastName: d.user.lastName,
      specialization: d.specialization,
      workingHours: typeof d.workingHours === 'string' ? JSON.parse(d.workingHours) : d.workingHours,
      slotDuration: d.slotDuration
    }));

    return res.json(formatted);
  } catch (error: any) {
    console.error('[ADMIN] Get doctors list error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin portal: Set leave day for a doctor and resolve conflicts.
 */
export async function setDoctorLeave(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId
  const { date } = req.body; // format: YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ error: 'Leave date is required' });
  }

  const leaveDate = new Date(date);
  leaveDate.setHours(0, 0, 0, 0);

  try {
    const doctor = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // 1. Create leave day record
    const existingLeave = await prisma.leaveDay.findUnique({
      where: {
        doctorProfileId_date: {
          doctorProfileId: id,
          date: leaveDate
        }
      }
    });

    if (existingLeave) {
      return res.status(400).json({ error: 'Doctor is already marked on leave for this date' });
    }

    await prisma.leaveDay.create({
      data: {
        doctorProfileId: id,
        date: leaveDate
      }
    });

    // 2. Resolve conflicts: Find all active bookings on this date for the doctor
    const nextDay = new Date(leaveDate.getTime() + 24 * 60 * 60 * 1000);
    const conflictedAppointments = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        startTime: {
          gte: leaveDate,
          lt: nextDay
        },
        status: 'BOOKED'
      },
      include: {
        patient: true
      }
    });

    console.log(`[LEAVE] Found ${conflictedAppointments.length} conflicted appointments on leave date: ${leaveDate.toDateString()}`);

    const cancellationDetails: any[] = [];

    for (const appt of conflictedAppointments) {
      // Mark cancelled
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { status: 'CANCELLED' }
      });

      // Find nearest equivalent open slot starting from D+1
      const nearestSlot = await findNearestOpenSlot(id, appt.startTime);

      if (nearestSlot) {
        // Generate a 48h rebook token
        const tokenPayload = {
          appointmentId: appt.id,
          doctorId: id,
          startTime: nearestSlot.start.toISOString(),
          endTime: nearestSlot.end.toISOString(),
          patientId: appt.patientId
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '48h' });

        // Email the patient with one-click rebook link
        await sendLeaveCancellationWithRebook(
          {
            id: appt.patientId,
            email: appt.patient.email,
            firstName: appt.patient.firstName,
            lastName: appt.patient.lastName
          },
          doctor,
          appt.startTime,
          nearestSlot.start,
          token
        );

        cancellationDetails.push({
          appointmentId: appt.id,
          patientName: `${appt.patient.firstName} ${appt.patient.lastName}`,
          originalTime: appt.startTime,
          suggestedTime: nearestSlot.start,
          rebookToken: token
        });
      } else {
        // Fallback: Notify they can join the waitlist
        await sendLeaveCancellationWithRebook(
          {
            id: appt.patientId,
            email: appt.patient.email,
            firstName: appt.patient.firstName,
            lastName: appt.patient.lastName
          },
          doctor,
          appt.startTime,
          new Date(appt.startTime.getTime() + 24 * 60 * 60 * 1000), // generic slot fallback
          ''
        );

        cancellationDetails.push({
          appointmentId: appt.id,
          patientName: `${appt.patient.firstName} ${appt.patient.lastName}`,
          originalTime: appt.startTime,
          suggestedTime: null,
          message: 'No near available slots found. Waitlist suggested.'
        });
      }

      // Log in AuditLog
      await prisma.auditLog.create({
        data: {
          action: 'LEAVE_CANCEL',
          details: `Appointment ${appt.id} cancelled due to Dr. ${doctor.user.firstName} leave on ${leaveDate.toDateString()}`,
          userId: appt.patientId
        }
      });
    }

    return res.json({
      message: 'Leave day added successfully. Conflicting appointments processed.',
      cancelledCount: conflictedAppointments.length,
      details: cancellationDetails
    });
  } catch (error: any) {
    console.error('[ADMIN] Set leave error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get leave days for a doctor.
 */
export async function getDoctorLeaves(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId
  try {
    const leaves = await prisma.leaveDay.findMany({
      where: { doctorProfileId: id },
      orderBy: { date: 'asc' }
    });
    return res.json(leaves);
  } catch (error: any) {
    console.error('[ADMIN] Get leaves error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get slot utilization heatmap for a doctor for a given week.
 * Query parameters: startDate (Monday of the week, YYYY-MM-DD)
 */
export async function getDoctorHeatmap(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId
  const { startDate } = req.query;

  if (!startDate) {
    return res.status(400).json({ error: 'startDate query parameter is required' });
  }

  try {
    const startOfWeek = new Date(startDate as string);
    startOfWeek.setHours(0, 0, 0, 0);

    const doctor = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { leaveDays: true }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const workingHours = typeof doctor.workingHours === 'string' ? JSON.parse(doctor.workingHours) : (doctor.workingHours || { start: '09:00', end: '17:00' });
    const slotDuration = doctor.slotDuration;

    const heatmapDays: any[] = [];

    // Loop through Monday (day 0) to Sunday (day 6)
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDay = new Date(startOfWeek.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      currentDay.setHours(0, 0, 0, 0);
      
      const dateStr = currentDay.toISOString().split('T')[0];

      // Check if on leave
      const isOnLeave = doctor.leaveDays.some(
        (ld) => ld.date.toDateString() === currentDay.toDateString()
      );

      // Check if weekend (Saturday or Sunday) - default weekends as non-working
      const dayOfWeek = currentDay.getDay(); // 0 is Sunday, 6 is Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      if (isOnLeave) {
        heatmapDays.push({
          date: dateStr,
          dayName: currentDay.toLocaleDateString('en-US', { weekday: 'long' }),
          status: 'leave',
          utilization: 0,
          totalSlots: 0,
          bookedSlots: 0,
          slots: []
        });
        continue;
      }

      if (isWeekend) {
        heatmapDays.push({
          date: dateStr,
          dayName: currentDay.toLocaleDateString('en-US', { weekday: 'long' }),
          status: 'weekend',
          utilization: 0,
          totalSlots: 0,
          bookedSlots: 0,
          slots: []
        });
        continue;
      }

      // Generate all slots for this day
      const slots: any[] = [];
      const [startH, startM] = workingHours.start.split(':').map(Number);
      const [endH, endM] = workingHours.end.split(':').map(Number);

      const dayStart = new Date(currentDay);
      dayStart.setHours(startH, startM, 0, 0);

      const dayEnd = new Date(currentDay);
      dayEnd.setHours(endH, endM, 0, 0);

      let currentSlotStart = new Date(dayStart);

      // Query active bookings and holds on this day
      const dayBookings = await prisma.appointment.findMany({
        where: {
          doctorId: id,
          startTime: { gte: dayStart, lt: dayEnd },
          status: 'BOOKED'
        }
      });

      const dayHolds = await prisma.slotHold.findMany({
        where: {
          doctorId: id,
          startTime: { gte: dayStart, lt: dayEnd },
          expiresAt: { gt: new Date() },
          resolved: false
        }
      });

      while (currentSlotStart < dayEnd) {
        const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDuration * 60 * 1000);
        
        const isBooked = dayBookings.some((b) => b.startTime.getTime() === currentSlotStart.getTime());
        const isHeld = dayHolds.some((h) => h.startTime.getTime() === currentSlotStart.getTime());

        slots.push({
          time: currentSlotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
          startTime: currentSlotStart.toISOString(),
          endTime: currentSlotEnd.toISOString(),
          status: isBooked ? 'booked' : isHeld ? 'held' : 'available'
        });

        currentSlotStart = currentSlotEnd;
      }

      const totalSlots = slots.length;
      const bookedSlots = slots.filter((s) => s.status === 'booked').length;
      const heldSlots = slots.filter((s) => s.status === 'held').length;
      const utilization = totalSlots > 0 ? Math.round(((bookedSlots + heldSlots) / totalSlots) * 100) : 0;

      heatmapDays.push({
        date: dateStr,
        dayName: currentDay.toLocaleDateString('en-US', { weekday: 'long' }),
        status: 'working',
        utilization,
        totalSlots,
        bookedSlots,
        slots
      });
    }

    return res.json(heatmapDays);
  } catch (error: any) {
    console.error('[ADMIN] Get heatmap error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get audit logs for administrative review.
 */
export async function getAuditLogs(req: AuthenticatedRequest, res: Response) {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200 // Cap at latest 200 logs
    });
    return res.json(logs);
  } catch (error: any) {
    console.error('[ADMIN] Get audit logs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Help algorithms

/**
 * Finds the nearest open slot for a doctor starting from D+1
 */
async function findNearestOpenSlot(
  doctorId: string,
  originalStartTime: Date
): Promise<{ start: Date; end: Date } | null> {
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    include: { leaveDays: true }
  });

  if (!doctor) return null;

  const workingHours = typeof doctor.workingHours === 'string' ? JSON.parse(doctor.workingHours) : (doctor.workingHours || { start: '09:00', end: '17:00' });
  const slotDuration = doctor.slotDuration;

  const [startH, startM] = workingHours.start.split(':').map(Number);
  const [endH, endM] = workingHours.end.split(':').map(Number);

  // Search forward up to 14 days
  for (let d = 1; d <= 14; d++) {
    const checkDate = new Date(originalStartTime);
    checkDate.setDate(checkDate.getDate() + d);
    checkDate.setHours(0, 0, 0, 0);

    // 1. Check if weekend (default closed)
    const day = checkDate.getDay();
    if (day === 0 || day === 6) continue;

    // 2. Check if doctor is on leave
    const onLeave = doctor.leaveDays.some(
      (ld) => ld.date.toDateString() === checkDate.toDateString()
    );
    if (onLeave) continue;

    // 3. Generate slots for checkDate
    const dayStart = new Date(checkDate);
    dayStart.setHours(startH, startM, 0, 0);

    const dayEnd = new Date(checkDate);
    dayEnd.setHours(endH, endM, 0, 0);

    // Get bookings and holds
    const bookings = await prisma.appointment.findMany({
      where: {
        doctorId,
        startTime: { gte: dayStart, lt: dayEnd },
        status: 'BOOKED'
      }
    });

    const holds = await prisma.slotHold.findMany({
      where: {
        doctorId,
        startTime: { gte: dayStart, lt: dayEnd },
        expiresAt: { gt: new Date() },
        resolved: false
      }
    });

    // Check if the original slot time is available on this day
    const targetStart = new Date(checkDate);
    targetStart.setHours(originalStartTime.getHours(), originalStartTime.getMinutes(), 0, 0);
    const targetEnd = new Date(targetStart.getTime() + slotDuration * 60 * 1000);

    const isTargetBooked = bookings.some((b) => b.startTime.getTime() === targetStart.getTime());
    const isTargetHeld = holds.some((h) => h.startTime.getTime() === targetStart.getTime());

    if (!isTargetBooked && !isTargetHeld && targetStart >= dayStart && targetEnd <= dayEnd) {
      return { start: targetStart, end: targetEnd };
    }

    // Otherwise, search for any free slot on this day, closest to the original slot time
    let current = new Date(dayStart);
    let bestSlot: { start: Date; end: Date; diff: number } | null = null;

    while (current < dayEnd) {
      const slotEnd = new Date(current.getTime() + slotDuration * 60 * 1000);
      
      const isBooked = bookings.some((b) => b.startTime.getTime() === current.getTime());
      const isHeld = holds.some((h) => h.startTime.getTime() === current.getTime());

      if (!isBooked && !isHeld) {
        // Calculate difference in hours/minutes from original time
        const originalTimeOfDay = originalStartTime.getHours() * 60 + originalStartTime.getMinutes();
        const currentTimeOfDay = current.getHours() * 60 + current.getMinutes();
        const diff = Math.abs(originalTimeOfDay - currentTimeOfDay);

        if (!bestSlot || diff < bestSlot.diff) {
          bestSlot = { start: new Date(current), end: slotEnd, diff };
        }
      }
      current = slotEnd;
    }

    if (bestSlot) {
      return { start: bestSlot.start, end: bestSlot.end };
    }
  }

  return null;
}
