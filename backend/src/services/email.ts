import nodemailer from 'nodemailer';
import prisma from './db';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.ethereal.email';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // If credentials are empty, we will use a test Ethereal account dynamically, or console logger
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined
  });

  return transporter;
}

/**
 * Core function to send an email. It creates a Notification row first, then attempts delivery.
 */
export async function sendEmail({
  userId,
  recipient,
  subject,
  body
}: {
  userId: string;
  recipient: string;
  subject: string;
  body: string;
}): Promise<boolean> {
  // Create PENDING notification row
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: 'EMAIL',
      subject,
      body,
      recipient,
      status: 'PENDING'
    }
  });

  try {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      // Development mode console logger fallback if SMTP credentials not specified
      console.log('========================================================================');
      console.log(`[EMAIL SIMULATOR] TO: ${recipient}`);
      console.log(`[EMAIL SIMULATOR] SUBJECT: ${subject}`);
      console.log(`[EMAIL SIMULATOR] BODY:\n${body}`);
      console.log('========================================================================');
      
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', updatedAt: new Date() }
      });
      return true;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || 'Healthcare Clinic <no-reply@clinic.com>',
      to: recipient,
      subject: subject,
      text: body
    };

    const client = getTransporter();
    await client.sendMail(mailOptions);

    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', updatedAt: new Date() }
    });

    console.log(`[EMAIL] Email sent successfully to ${recipient}`);
    return true;
  } catch (error: any) {
    console.error(`[EMAIL] Failed to send email to ${recipient}:`, error.message || error);
    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        error: error.message || String(error),
        updatedAt: new Date()
      }
    });
    return false;
  }
}

/**
 * Retries a failed notification.
 */
export async function retryNotification(notificationId: string): Promise<boolean> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId }
  });

  if (!notification || notification.status === 'SENT') return false;

  const currentRetry = notification.retryCount;
  if (currentRetry >= 3) {
    console.warn(`[EMAIL] Notification ${notificationId} exceeded max retry limit.`);
    return false;
  }

  try {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      console.log(`[EMAIL SIMULATOR RETRY ${currentRetry + 1}] TO: ${notification.recipient}`);
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'SENT',
          retryCount: currentRetry + 1,
          updatedAt: new Date()
        }
      });
      return true;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || 'Healthcare Clinic <no-reply@clinic.com>',
      to: notification.recipient,
      subject: notification.subject,
      text: notification.body
    };

    const client = getTransporter();
    await client.sendMail(mailOptions);

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'SENT',
        retryCount: currentRetry + 1,
        updatedAt: new Date()
      }
    });
    return true;
  } catch (error: any) {
    console.error(`[EMAIL RETRY FAILED] Attempt ${currentRetry + 1}:`, error.message || error);
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'FAILED',
        retryCount: currentRetry + 1,
        error: error.message || String(error),
        updatedAt: new Date()
      }
    });
    return false;
  }
}

// Emails Templates

export async function sendBookingConfirmation(
  patient: { id: string; email: string; firstName: string; lastName: string },
  doctorName: string,
  startTime: Date
): Promise<boolean> {
  const formattedTime = startTime.toLocaleString();
  
  // To Patient
  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: 'Appointment Booking Confirmed',
    body: `Hello ${patient.firstName},\n\nYour appointment with Dr. ${doctorName} has been confirmed for ${formattedTime}.\n\nThank you!`
  });
}

export async function sendBookingReminder(
  patient: { id: string; email: string; firstName: string; lastName: string },
  doctorName: string,
  startTime: Date
): Promise<boolean> {
  const formattedTime = startTime.toLocaleString();
  
  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: 'Appointment Reminder - 24 Hours Notice',
    body: `Hello ${patient.firstName},\n\nThis is a friendly reminder that you have an upcoming appointment with Dr. ${doctorName} tomorrow at ${formattedTime}.\n\nIf you need to reschedule or cancel, please visit your portal.`
  });
}

export async function sendBookingCancellation(
  patient: { id: string; email: string; firstName: string; lastName: string },
  doctorName: string,
  startTime: Date,
  reason: string
): Promise<boolean> {
  const formattedTime = startTime.toLocaleString();
  
  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: 'Appointment Cancelled',
    body: `Hello ${patient.firstName},\n\nYour appointment with Dr. ${doctorName} scheduled for ${formattedTime} has been cancelled.\n\nReason: ${reason}\n\nWe apologize for the inconvenience.`
  });
}

export async function sendLeaveCancellationWithRebook(
  patient: { id: string; email: string; firstName: string; lastName: string },
  doctor: { id: string; user: { firstName: string; lastName: string } },
  originalTime: Date,
  suggestedTime: Date,
  rebookToken: string
): Promise<boolean> {
  const docName = `${doctor.user.firstName} ${doctor.user.lastName}`;
  const originalStr = originalTime.toLocaleString();
  const suggestedStr = suggestedTime.toLocaleString();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  const rebookLink = `${frontendUrl}/rebook?token=${rebookToken}`;
  const waitlistLink = `${frontendUrl}/patient/doctors`;

  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: 'ACTION REQUIRED: Appointment Cancelled due to Doctor Leave',
    body: `Hello ${patient.firstName},\n\nWe regret to inform you that Dr. ${docName} is on leave on ${originalTime.toDateString()}. Consequently, your appointment scheduled for ${originalStr} has been cancelled.\n\nWe have reserved the nearest available slot for you on ${suggestedStr}.\n\n👉 Click the link below to confirm this new slot with one click:\n${rebookLink}\n\nIf that time does not work for you, you can search for other slots or join the waitlist for openings:\n${waitlistLink}\n\nWe apologize for the inconvenience.`
  });
}

export async function sendWaitlistNotification(
  patient: { id: string; email: string; firstName: string; lastName: string },
  doctorName: string,
  date: Date
): Promise<boolean> {
  const dateStr = date.toDateString();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const bookingLink = `${frontendUrl}/patient/doctors`;

  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: 'A slot has opened up!',
    body: `Hello ${patient.firstName},\n\nGood news! A booking slot with Dr. ${doctorName} on ${dateStr} has opened up due to a cancellation.\n\nSince you are on the waitlist, you have been notified first. Please click here to claim the slot before anyone else:\n${bookingLink}\n\nBest regards,\nHealthcare Team`
  });
}

export async function sendMedicationReminder(
  patient: { id: string; email: string; firstName: string; lastName: string },
  medication: string,
  dosage: string,
  frequency: string
): Promise<boolean> {
  return await sendEmail({
    userId: patient.id,
    recipient: patient.email,
    subject: `Medication Reminder: ${medication}`,
    body: `Hello ${patient.firstName},\n\nThis is your scheduled reminder to take your medication:\n\n- Medication: ${medication}\n- Dosage: ${dosage}\n- Frequency: ${frequency}\n\nPlease take it as directed by your physician.`
  });
}
