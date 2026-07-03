import { google } from 'googleapis';
import prisma from './db';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',
  process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET',
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback'
);

/**
 * Checks if Google Client ID is configured.
 */
function isGoogleConfigured(): boolean {
  const cid = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  return !!(cid && secret && !cid.startsWith('YOUR_') && !secret.startsWith('YOUR_'));
}

/**
 * Generates OAuth url to authorize Google Calendar access.
 */
export function getAuthUrl(userId: string): string {
  if (!isGoogleConfigured()) {
    console.warn('[CALENDAR] Google OAuth is not configured in .env. Returning fake callback url.');
    return `${process.env.FRONTEND_URL || 'http://localhost:5173'}/google-callback?state=${userId}&code=mock_code`;
  }
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: userId,
    prompt: 'consent'
  });
}

/**
 * Exchanges auth code for credentials and saves it to GoogleToken table.
 */
export async function exchangeCodeAndSave(userId: string, code: string): Promise<void> {
  if (!isGoogleConfigured() || code === 'mock_code') {
    console.log(`[CALENDAR] Saved mock Google Token for user ${userId}`);
    await prisma.googleToken.upsert({
      where: { userId },
      update: {
        accessToken: 'mock_access_token',
        refreshToken: 'mock_refresh_token',
        expiryDate: new Date(Date.now() + 3600 * 1000)
      },
      create: {
        userId,
        accessToken: 'mock_access_token',
        refreshToken: 'mock_refresh_token',
        expiryDate: new Date(Date.now() + 3600 * 1000)
      }
    });
    return;
  }

  const { tokens } = await oauth2Client.getToken(code);
  
  await prisma.googleToken.upsert({
    where: { userId },
    update: {
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
    },
    create: {
      userId,
      accessToken: tokens.access_token || '',
      refreshToken: tokens.refresh_token || undefined,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
    }
  });
  console.log(`[CALENDAR] Tokens successfully saved for user ${userId}`);
}

/**
 * Returns OAuth2 client authorized for a specific user.
 */
async function getAuthorizedClient(userId: string): Promise<any | null> {
  if (!isGoogleConfigured()) return null;

  const dbToken = await prisma.googleToken.findUnique({
    where: { userId }
  });

  if (!dbToken) return null;
  if (dbToken.accessToken === 'mock_access_token') return null;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  client.setCredentials({
    access_token: dbToken.accessToken,
    refresh_token: dbToken.refreshToken || undefined,
    expiry_date: dbToken.expiryDate ? dbToken.expiryDate.getTime() : undefined
  });

  // Handle token refreshing automatically if expired
  client.on('tokens', async (tokens) => {
    await prisma.googleToken.update({
      where: { userId },
      data: {
        accessToken: tokens.access_token || '',
        refreshToken: tokens.refresh_token || undefined,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined
      }
    });
    console.log(`[CALENDAR] Tokens auto-refreshed and saved for user ${userId}`);
  });

  return client;
}

/**
 * Creates a Google Calendar event for an appointment.
 * Tries both doctor and patient's calendars.
 */
export async function createCalendarEvent(appointmentId: string): Promise<string | null> {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: { include: { user: true } }
      }
    });

    if (!appointment) return null;

    const summary = `Appointment: ${appointment.patient.firstName} <> Dr. ${appointment.doctor.user.firstName}`;
    const description = `Healthcare Appointment\nDoctor: Dr. ${appointment.doctor.user.firstName} ${appointment.doctor.user.lastName}\nSpecialization: ${appointment.doctor.specialization}\nPatient: ${appointment.patient.firstName} ${appointment.patient.lastName}`;

    const eventPayload = {
      summary,
      description,
      start: { dateTime: appointment.startTime.toISOString() },
      end: { dateTime: appointment.endTime.toISOString() },
      attendees: [
        { email: appointment.patient.email },
        { email: appointment.doctor.user.email }
      ]
    };

    // Try to create on patient's calendar if they authorized Google Calendar
    const patientClient = await getAuthorizedClient(appointment.patientId);
    if (patientClient) {
      const calendar = google.calendar({ version: 'v3', auth: patientClient });
      const eventRes = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventPayload
      });
      console.log(`[CALENDAR] Event created on patient's calendar: ${eventRes.data.id}`);
      return eventRes.data.id || null;
    }

    // Try doctor's calendar if patient didn't authorize
    const doctorClient = await getAuthorizedClient(appointment.doctor.userId);
    if (doctorClient) {
      const calendar = google.calendar({ version: 'v3', auth: doctorClient });
      const eventRes = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventPayload
      });
      console.log(`[CALENDAR] Event created on doctor's calendar: ${eventRes.data.id}`);
      return eventRes.data.id || null;
    }

    console.log('[CALENDAR] No Google Tokens available for patient or doctor. Skipping real API call.');
    return 'mock_event_id';
  } catch (error: any) {
    console.error('[CALENDAR] Failed to create event:', error.message || error);
    return null; // Graceful return
  }
}

/**
 * Updates a Google Calendar event.
 */
export async function updateCalendarEvent(appointmentId: string): Promise<void> {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: true,
        doctor: { include: { user: true } }
      }
    });

    if (!appointment || !appointment.googleEventId || appointment.googleEventId === 'mock_event_id') return;

    const summary = `Appointment: ${appointment.patient.firstName} <> Dr. ${appointment.doctor.user.firstName}`;
    const description = `Healthcare Appointment\nDoctor: Dr. ${appointment.doctor.user.firstName} ${appointment.doctor.user.lastName}\nSpecialization: ${appointment.doctor.specialization}\nPatient: ${appointment.patient.firstName} ${appointment.patient.lastName}`;

    const eventPayload = {
      summary,
      description,
      start: { dateTime: appointment.startTime.toISOString() },
      end: { dateTime: appointment.endTime.toISOString() },
      attendees: [
        { email: appointment.patient.email },
        { email: appointment.doctor.user.email }
      ]
    };

    // Try patient first
    const patientClient = await getAuthorizedClient(appointment.patientId);
    if (patientClient) {
      const calendar = google.calendar({ version: 'v3', auth: patientClient });
      await calendar.events.update({
        calendarId: 'primary',
        eventId: appointment.googleEventId,
        requestBody: eventPayload
      });
      console.log(`[CALENDAR] Event updated via patient API`);
      return;
    }

    // Try doctor
    const doctorClient = await getAuthorizedClient(appointment.doctor.userId);
    if (doctorClient) {
      const calendar = google.calendar({ version: 'v3', auth: doctorClient });
      await calendar.events.update({
        calendarId: 'primary',
        eventId: appointment.googleEventId,
        requestBody: eventPayload
      });
      console.log(`[CALENDAR] Event updated via doctor API`);
      return;
    }
  } catch (error: any) {
    console.error('[CALENDAR] Failed to update event:', error.message || error);
  }
}

/**
 * Deletes a Google Calendar event.
 */
export async function deleteCalendarEvent(
  googleEventId: string,
  patientId: string,
  doctorUserId: string
): Promise<void> {
  if (!googleEventId || googleEventId === 'mock_event_id') return;

  try {
    const patientClient = await getAuthorizedClient(patientId);
    if (patientClient) {
      const calendar = google.calendar({ version: 'v3', auth: patientClient });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: googleEventId
      });
      console.log(`[CALENDAR] Event deleted via patient API`);
      return;
    }

    const doctorClient = await getAuthorizedClient(doctorUserId);
    if (doctorClient) {
      const calendar = google.calendar({ version: 'v3', auth: doctorClient });
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: googleEventId
      });
      console.log(`[CALENDAR] Event deleted via doctor API`);
      return;
    }
  } catch (error: any) {
    console.error('[CALENDAR] Failed to delete event:', error.message || error);
  }
}
