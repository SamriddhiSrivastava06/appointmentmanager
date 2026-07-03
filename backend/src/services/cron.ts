import cron from 'node-cron';
import prisma from './db';
import { cleanupExpiredHolds } from './slotLock';
import { retryNotification, sendMedicationReminder, sendBookingReminder } from './email';
import { callLLMJson } from './llm';

/**
 * Initializes and schedules all background cron jobs.
 */
export function startCronJobs() {
  console.log('[CRON] Starting background job scheduler...');

  // 1. Clean up expired slot holds: Every minute
  cron.schedule('* * * * *', async () => {
    try {
      const cleaned = await cleanupExpiredHolds();
      if (cleaned > 0) {
        console.log(`[CRON] Cleaned up ${cleaned} expired slot holds.`);
      }
    } catch (err) {
      console.error('[CRON] Error cleaning up expired holds:', err);
    }
  });

  // 2. Email failure retries: Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const failedEmails = await prisma.notification.findMany({
        where: {
          status: 'FAILED',
          retryCount: { lt: 3 }
        }
      });

      if (failedEmails.length > 0) {
        console.log(`[CRON] Retrying ${failedEmails.length} failed notifications...`);
        for (const email of failedEmails) {
          await retryNotification(email.id);
        }
      }
    } catch (err) {
      console.error('[CRON] Error retrying failed emails:', err);
    }
  });

  // 3. 24-hour appointment reminders: Every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const targetMin = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const targetMax = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      // Find booked appointments in 24 hours
      const upcoming = await prisma.appointment.findMany({
        where: {
          startTime: { gte: targetMin, lte: targetMax },
          status: 'BOOKED'
        },
        include: {
          patient: true,
          doctor: { include: { user: true } }
        }
      });

      for (const appt of upcoming) {
        // Check if reminder was already sent
        const alreadySent = await prisma.notification.findFirst({
          where: {
            userId: appt.patientId,
            subject: 'Appointment Reminder - 24 Hours Notice',
            recipient: appt.patient.email,
            createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) } // sent within last 48h
          }
        });

        if (!alreadySent) {
          console.log(`[CRON] Sending 24h reminder for appointment ${appt.id}`);
          const docName = `${appt.doctor.user.firstName} ${appt.doctor.user.lastName}`;
          await sendBookingReminder(
            {
              id: appt.patientId,
              email: appt.patient.email,
              firstName: appt.patient.firstName,
              lastName: appt.patient.lastName
            },
            docName,
            appt.startTime
          );
        }
      }
    } catch (err) {
      console.error('[CRON] Error sending appointment reminders:', err);
    }
  });

  // 4. Medication Reminders: Every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      
      // Get all booked/completed appointments that have prescriptions
      const activePrescriptions = await prisma.prescription.findMany({
        include: {
          appointment: {
            include: {
              patient: true
            }
          }
        }
      });

      for (const rx of activePrescriptions) {
        // Check if prescription duration is active
        const daysDuration = parseDurationDays(rx.duration);
        const startDate = rx.createdAt;
        const endDate = new Date(startDate.getTime() + daysDuration * 24 * 60 * 60 * 1000);

        if (now > endDate) {
          // Prescription is completed
          continue;
        }

        const intervalHours = parseFrequencyHours(rx.frequency);
        if (intervalHours === 0) continue;

        // Check the last sent reminder for this prescription
        const lastSent = await prisma.medicationReminderLog.findFirst({
          where: { prescriptionId: rx.id },
          orderBy: { scheduledTime: 'desc' }
        });

        let nextScheduledTime = startDate;
        if (lastSent) {
          nextScheduledTime = new Date(lastSent.scheduledTime.getTime() + intervalHours * 60 * 60 * 1000);
        }

        if (now >= nextScheduledTime) {
          // Send reminder
          console.log(`[CRON] Sending medication reminder for Rx ID ${rx.id}: ${rx.medication}`);
          const patient = rx.appointment.patient;
          
          const success = await sendMedicationReminder(
            {
              id: patient.id,
              email: patient.email,
              firstName: patient.firstName,
              lastName: patient.lastName
            },
            rx.medication,
            rx.dosage,
            rx.frequency
          );

          await prisma.medicationReminderLog.create({
            data: {
              prescriptionId: rx.id,
              scheduledTime: nextScheduledTime,
              status: success ? 'SENT' : 'FAILED',
              error: success ? null : 'SMTP sending failed',
              retryCount: 0
            }
          });

          // Update prescription reminder counter
          await prisma.prescription.update({
            where: { id: rx.id },
            data: { remindersSent: { increment: 1 } }
          });
        }
      }
    } catch (err) {
      console.error('[CRON] Error processing medication reminders:', err);
    }
  });

  // 5. Asynchronous LLM retries: Every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      // Retry symptom summaries
      const pendingSymptomSummaries = await prisma.symptomSummary.findMany({
        where: {
          status: 'PENDING',
          retryCount: { lt: 3 }
        },
        include: {
          appointment: true
        }
      });

      for (const summary of pendingSymptomSummaries) {
        console.log(`[CRON] Retrying symptom summary for appointment ${summary.appointmentId}`);
        try {
          const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${summary.appointment.symptoms}`;
          
          const result = await callLLMJson<{
            urgency: 'Low' | 'Medium' | 'High';
            chiefComplaint: string;
            questions: string[];
          }>(prompt, ['urgency', 'chiefComplaint', 'questions']);

          await prisma.symptomSummary.update({
            where: { id: summary.id },
            data: {
              urgency: result.urgency.toUpperCase() as any,
              chiefComplaint: result.chiefComplaint,
              questions: JSON.stringify(result.questions),
              status: 'COMPLETED'
            }
          });
        } catch (error: any) {
          console.error(`[CRON] Symptom summary retry failed for ID ${summary.id}:`, error.message);
          await prisma.symptomSummary.update({
            where: { id: summary.id },
            data: {
              retryCount: { increment: 1 },
              status: summary.retryCount + 1 >= 3 ? 'FAILED' : 'PENDING'
            }
          });
        }
      }

      // Retry post-visit notes
      const pendingVisitNotes = await prisma.visitNote.findMany({
        where: {
          status: 'PENDING',
          retryCount: { lt: 3 }
        }
      });

      for (const note of pendingVisitNotes) {
        console.log(`[CRON] Retrying visit note summary for appointment ${note.appointmentId}`);
        try {
          const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${note.clinicalNotes}`;
          const result = await callLLMJson<{
            patientFriendlySummary: string;
          }>(prompt, ['patientFriendlySummary']);

          await prisma.visitNote.update({
            where: { id: note.id },
            data: {
              patientFriendlySummary: result.patientFriendlySummary,
              status: 'COMPLETED'
            }
          });
        } catch (error: any) {
          console.error(`[CRON] Visit note retry failed for ID ${note.id}:`, error.message);
          await prisma.visitNote.update({
            where: { id: note.id },
            data: {
              retryCount: { increment: 1 },
              status: note.retryCount + 1 >= 3 ? 'FAILED' : 'PENDING'
            }
          });
        }
      }
    } catch (err) {
      console.error('[CRON] Error retrying LLM jobs:', err);
    }
  });
}

function parseDurationDays(duration: string): number {
  const match = duration.match(/(\d+)\s*day/i);
  if (match && match[1]) {
    return parseInt(match[1]);
  }
  return 7; // default duration
}

function parseFrequencyHours(frequency: string): number {
  const fLower = frequency.toLowerCase();
  if (fLower.includes('8 hour') || fLower.includes('three times')) {
    return 8;
  }
  if (fLower.includes('12 hour') || fLower.includes('twice')) {
    return 12;
  }
  if (fLower.includes('6 hour') || fLower.includes('four times')) {
    return 6;
  }
  if (fLower.includes('daily') || fLower.includes('once')) {
    return 24;
  }
  return 24; // default daily
}
