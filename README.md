# CareSync: Healthcare Appointment & Follow-up Manager

CareSync is a production-quality, end-to-end web application for scheduling clinical consultations, securing time slots against race-condition bookings, automatically managing doctor leave cancellations with waitlists, and compiling AI diagnostics and visit summaries using Claude.

---

## System Design (Core Architectures)

### 1. Concurrency Safety & Double-Booking Prevention
Slot double-booking is prevented using a **two-tier reservation process** consisting of a database level `@@unique([doctorId, startTime])` index constraint on the `SlotHold` table and a database transaction block:
* **Short-Lived Lock (Slot Hold):** Before booking, a patient acquires a 5-minute hold on a slot. If another user attempts to lock or hold the same slot, the transaction queries active holds (where `expiresAt > now` and `resolved == false`). If found, the request is immediately rejected.
* **Race Condition Isolation:** If two requests arrive in the exact same millisecond, the database's unique constraint prevents concurrent duplicate rows. One transaction commits successfully, while the other fails with a unique constraint violation error (`P2002`). The failed transaction is logged to `AuditLog` as a `HOLD_CONFLICT`.

```
   Patient A Request -----\
                           +---> DB Transaction ---> Success (Row Created)
   Patient B Request -----/                           Conflict Error (P2002)
```

### 2. Doctor Leave Conflict Handling & Rebookings
When an administrator registers a doctor leave day, the system executes an automated conflict resolution pipeline:
* **Cascading Cancellation:** All active appointments matching the leave date are updated to `CANCELLED` status.
* **One-Click Rebooking Token:** The system computes the **nearest open slot** on subsequent working days (Mon-Fri) that matches the patient's original slot hour. It signs a JWT token containing this proposed slot parameter and sends it to the patient. By clicking the link, the patient accepts the new slot with one click without manually searching.
* **FIFO Waitlist Notification:** If a slot opens up due to cancellation, the system queries the `Waitlist` queue for that date, selecting the oldest record (`createdAt` ASC). The patient is notified via email with exclusive priority.

### 3. Notification & LLM Failure Resilience
CareSync uses a **non-blocking write-ahead queue design** for external network API calls (Nodemailer SMTP and Claude LLM API):
* **Email Buffering:** Every email is inserted as a `Notification` row in the database with a `PENDING` state. The background worker attempts to send it. If SMTP crashes, the state changes to `FAILED`. A `node-cron` background worker retries failed logs up to 3 times with exponential backoff.
* **LLM Fallback Wrapper:** Symptom summaries and clinical note processing attempt a fast execution within 3.5 seconds. If the API key is missing or the external Anthropic API times out, the flow is **never blocked**; the database registers the summary as `PENDING` with placeholder content ("Summary pending — will retry"). The user completes their booking or note submission instantly, and the background job retries processing in the background.

---

## Tech Stack
* **Backend:** Node.js + Express, TypeScript, Prisma ORM (PostgreSQL)
* **Frontend:** React, TypeScript, Tailwind CSS, Vite
* **Background Jobs:** Node-Cron
* **Integrations:** Google Calendar API (OAuth 2.0), Anthropic Claude Messages API, Nodemailer

---

## Environment Variables (.env.example)

### Backend (`/backend/.env`)
```env
PORT=5000
DATABASE_URL="postgresql://postgres:password@localhost:5432/healthcare_db?schema=public"
JWT_SECRET="your-signing-secret"
ANTHROPIC_API_KEY="your-claude-api-key"

# Email Configuration
SMTP_HOST="smtp.ethereal.email"
SMTP_PORT=587
SMTP_USER="your-smtp-username"
SMTP_PASS="your-smtp-password"
SMTP_FROM="Clinic Support <no-reply@clinic.com>"

# Google Calendar credentials
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:5000/api/auth/google/callback"

# Frontend CORS Origin
FRONTEND_URL="http://localhost:5173"
```

---

## Google Calendar OAuth 2.0 Setup Instructions

To enable synchronization with Google Calendars:
1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and navigate to **API & Services** > **Library**. Search for **Google Calendar API** and click **Enable**.
3. Go to **OAuth Consent Screen**:
   * Choose **External**.
   * Add required developer email parameters.
   * Under **Scopes**, add `.../auth/calendar.events` (read/write calendar events).
   * Under **Test Users**, add the Google accounts you intend to test with.
4. Navigate to **Credentials** > **Create Credentials** > **OAuth Client ID**:
   * Select application type **Web Application**.
   * Add **Authorized JavaScript Origins**: `http://localhost:5000` and `http://localhost:5173`.
   * Add **Authorized Redirect URIs**: `http://localhost:5000/api/auth/google/callback`.
5. Copy the generated **Client ID** and **Client Secret** into your backend `/backend/.env`.

*Note: If no Google credentials are provided, CareSync falls back gracefully to a mock calendar sync logger, so core features remain fully testable.*

---

## Database Schema Model Description

```
  +--------------+          +-------------------+          +-------------+
  |    User      | 1 ---- * |   Appointment     | * ---- 1 |DoctorProfile|
  | (Role-based) |          | (BOOKED/COMPLETED)|          | (WorkingHrs)|
  +--------------+          +-------------------+          +-------------+
         1                            1                           1
         |                            |                           |
         1                            1                           *
  +--------------+          +-------------------+          +-------------+
  | GoogleToken  |          |  SymptomSummary   |          |  LeaveDay   |
  |  (OAuth Cred)|          |  (Urgency badge)  |          | (Date block)|
  +--------------+          +-------------------+          +-------------+
```

* **User**: Handles JWT auth. `role` enum contains: `PATIENT`, `DOCTOR`, `ADMIN`.
* **DoctorProfile**: Links to a User. Contains specialization, slotDuration, and workingHours (JSON start/end times).
* **LeaveDay**: Connects to doctor. Represents leave date blocks.
* **Appointment**: Central ledger link. Connects doctor, patient, slot hours, and status.
* **SlotHold**: Unique index model for 5-minute concurrency control locks.
* **SymptomSummary**: Pre-visit AI clinical assessment (Urgency, questions, chief complaint).
* **VisitNote**: Doctor's clinical notes and AI patient-friendly summary.
* **Prescription**: Multi-item medication list with scheduling details.
* **Waitlist**: Patient queue tracker for fully booked days.
* **Notification**: Outgoing email queue audit buffer.
* **GoogleToken**: OAuth access and refresh credentials.

---

## Exact LLM Prompts Used

### 1. Pre-Visit Summary Prompt
```
Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: <symptoms>
```
*System Instruction:* "Return ONLY a raw JSON object matching these keys: `["urgency", "chiefComplaint", "questions"]`. Do not add any conversational text or markdown formatting."

### 2. Post-Visit Summary Prompt
```
Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: <notes>
```
*System Instruction:* "Return ONLY a raw JSON object matching these keys: `["patientFriendlySummary"]`."

---

## API Documentation

### Auth Module
* `POST /api/auth/register` - Registers a new patient. (Body: `email`, `password`, `firstName`, `lastName`)
* `POST /api/auth/login` - Authenticates user. Returns JWT and user payload.
* `GET /api/auth/me` - Resolves authenticated user state.
* `GET /api/auth/google/url` - Returns the Google OAuth 2.0 authentication URL.

### Admin Module (Admin Only)
* `POST /api/admin/doctors` - Registers a new doctor.
* `PUT /api/admin/doctors/:id` - Updates doctor profile configurations.
* `DELETE /api/admin/doctors/:id` - Deletes a doctor user.
* `POST /api/admin/doctors/:id/leave` - Adds leave day, cancels bookings, triggers rebooks.
* `GET /api/admin/doctors/:id/heatmap` - Returns weekly hourly slots utilization list.
* `GET /api/admin/audit-logs` - Fetches logging audit history.

### Doctors Module
* `GET /api/doctors` - Lists doctor directory (Optional query: `specialization`).
* `GET /api/doctors/:id/available-slots?date=YYYY-MM-DD` - Evaluates slot availability.

### Appointments Module
* `POST /api/appointments/hold` - Secures a 5-minute hold lock on a slot. (Body: `doctorId`, `startTime`, `endTime`)
* `POST /api/appointments/release` - Releases slot hold.
* `POST /api/appointments` - Confirms a booking with symptom inputs.
* `GET /api/appointments/today` - Queue list for doctor portal.
* `POST /api/appointments/:id/notes` - Submits clinical notes and prescriptions.
* `DELETE /api/appointments/:id` - Cancels booking, triggers waitlist auto-fill.
* `GET /api/appointments/patient-history/:patientId` - Longitudinal visit history.

### Waitlist Module
* `POST /api/waitlist` - Joins waitlist queue for a doctor date.
* `GET /api/waitlist` - Lists current patient waitlists.
* `DELETE /api/waitlist/:id` - Leaves waitlist.

---

## Setup & Running Guide

### 1. Database Setup
1. Start a local PostgreSQL instance.
2. Create a database named `healthcare_db`.
3. Set your connection string in `/backend/.env` under `DATABASE_URL`.

### 2. Backend Setup
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed # seeds doctors, admins, patient history, and demo appointments
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5180](http://localhost:5180) in your browser.

### 4. Running Verification Checks
* **API Diagnostics Check:** `npm run test` (checks API accessibility, health checks, route protections)
* **Concurrency Safety Test:** `npx ts-node src/verify-concurrency.ts` (simulates 10 concurrent requests booking the same slot)
