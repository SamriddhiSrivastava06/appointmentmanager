import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { authenticateJWT, requireRole } from './middleware/auth';
import {
  register,
  login,
  getMe,
  getGoogleUrl,
  googleCallback
} from './controllers/auth';
import {
  createDoctor,
  updateDoctor,
  deleteDoctor,
  getDoctorsList,
  setDoctorLeave,
  getDoctorLeaves,
  getDoctorHeatmap,
  getAuditLogs
} from './controllers/admin';
import {
  getDoctors,
  getSpecializations,
  getAvailableSlots
} from './controllers/doctors';
import {
  holdSlot,
  releaseSlot,
  bookAppointment,
  getTodayAppointments,
  submitVisitNotes,
  cancelAppointment,
  rebookAppointment,
  getPatientAppointments,
  getPatientVisitTimeline,
  joinWaitlist,
  getPatientWaitlist,
  leaveWaitlist
} from './controllers/appointments';
import { startCronJobs } from './services/cron';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Public Auth Routes ---
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.get('/api/auth/google/callback', googleCallback); // callback URL for Google redirection

// --- Authenticated Auth Routes ---
app.get('/api/auth/me', authenticateJWT, getMe);
app.get('/api/auth/google/url', authenticateJWT, getGoogleUrl);

// --- Admin Panel Routes (ADMIN only) ---
app.post('/api/admin/doctors', authenticateJWT, requireRole(['ADMIN']), createDoctor);
app.get('/api/admin/doctors', authenticateJWT, requireRole(['ADMIN', 'PATIENT']), getDoctorsList); // patients also can read list of doctors
app.put('/api/admin/doctors/:id', authenticateJWT, requireRole(['ADMIN']), updateDoctor);
app.delete('/api/admin/doctors/:id', authenticateJWT, requireRole(['ADMIN']), deleteDoctor);
app.post('/api/admin/doctors/:id/leave', authenticateJWT, requireRole(['ADMIN']), setDoctorLeave);
app.get('/api/admin/doctors/:id/leave', authenticateJWT, requireRole(['ADMIN']), getDoctorLeaves);
app.get('/api/admin/doctors/:id/heatmap', authenticateJWT, requireRole(['ADMIN']), getDoctorHeatmap);
app.get('/api/admin/audit-logs', authenticateJWT, requireRole(['ADMIN']), getAuditLogs);

// --- Public / General Doctor Routes ---
app.get('/api/doctors', authenticateJWT, getDoctors);
app.get('/api/doctors/specializations', authenticateJWT, getSpecializations);
app.get('/api/doctors/:id/available-slots', authenticateJWT, getAvailableSlots);

// --- Appointment Booking Routes ---
app.post('/api/appointments/hold', authenticateJWT, requireRole(['PATIENT']), holdSlot);
app.post('/api/appointments/release', authenticateJWT, requireRole(['PATIENT']), releaseSlot);
app.post('/api/appointments', authenticateJWT, requireRole(['PATIENT']), bookAppointment);
app.get('/api/appointments/my-appointments', authenticateJWT, requireRole(['PATIENT']), getPatientAppointments);
app.post('/api/appointments/rebook', authenticateJWT, rebookAppointment); // one-click rebook doesn't strictly need login since it's token verified

// --- Doctor Portal Routes (DOCTOR only) ---
app.get('/api/appointments/today', authenticateJWT, requireRole(['DOCTOR']), getTodayAppointments);
app.post('/api/appointments/:id/notes', authenticateJWT, requireRole(['DOCTOR']), submitVisitNotes);

// --- Mutual / Multi-role Appointment Routes ---
app.delete('/api/appointments/:id', authenticateJWT, requireRole(['PATIENT', 'DOCTOR', 'ADMIN']), cancelAppointment);
app.get('/api/appointments/patient-history/:patientId', authenticateJWT, requireRole(['DOCTOR', 'PATIENT', 'ADMIN']), getPatientVisitTimeline);

// --- Waitlist Routes ---
app.post('/api/waitlist', authenticateJWT, requireRole(['PATIENT']), joinWaitlist);
app.get('/api/waitlist', authenticateJWT, requireRole(['PATIENT']), getPatientWaitlist);
app.delete('/api/waitlist/:id', authenticateJWT, requireRole(['PATIENT']), leaveWaitlist);

// --- Start Background Job Cron Schedule ---
startCronJobs();

// Start Express Server
app.listen(PORT, () => {
  console.log(`[SERVER] Healthcare Appointment Manager running on port ${PORT}`);
});
