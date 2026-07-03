import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('[SEED] Clearing existing data...');
  
  await prisma.medicationReminderLog.deleteMany({});
  await prisma.prescription.deleteMany({});
  await prisma.visitNote.deleteMany({});
  await prisma.symptomSummary.deleteMany({});
  await prisma.slotHold.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.waitlist.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.googleToken.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.leaveDay.deleteMany({});
  await prisma.doctorProfile.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('[SEED] Creating role-based users...');

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Admin
  const admin = await prisma.user.create({
    data: {
      email: 'admin@clinic.com',
      passwordHash,
      firstName: 'Chief',
      lastName: 'Administrator',
      role: 'ADMIN'
    }
  });
  console.log('Created Admin:', admin.email);

  // 2. Doctors
  const doc1 = await prisma.user.create({
    data: {
      email: 'sarah.jenkins@clinic.com',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Jenkins',
      role: 'DOCTOR'
    }
  });
  const docProfile1 = await prisma.doctorProfile.create({
    data: {
      userId: doc1.id,
      specialization: 'Cardiology',
      workingHours: JSON.stringify({ start: '09:00', end: '17:00' }),
      slotDuration: 30
    }
  });

  const doc2 = await prisma.user.create({
    data: {
      email: 'robert.chen@clinic.com',
      passwordHash,
      firstName: 'Robert',
      lastName: 'Chen',
      role: 'DOCTOR'
    }
  });
  const docProfile2 = await prisma.doctorProfile.create({
    data: {
      userId: doc2.id,
      specialization: 'Pediatrics',
      workingHours: JSON.stringify({ start: '10:00', end: '16:00' }),
      slotDuration: 30
    }
  });

  const doc3 = await prisma.user.create({
    data: {
      email: 'emily.taylor@clinic.com',
      passwordHash,
      firstName: 'Emily',
      lastName: 'Taylor',
      role: 'DOCTOR'
    }
  });
  const docProfile3 = await prisma.doctorProfile.create({
    data: {
      userId: doc3.id,
      specialization: 'Dermatology',
      workingHours: JSON.stringify({ start: '09:00', end: '15:00' }),
      slotDuration: 30
    }
  });

  console.log('Created Doctors: Sarah Jenkins (Cardiology), Robert Chen (Pediatrics), Emily Taylor (Dermatology)');

  // 3. Patients
  const patient1 = await prisma.user.create({
    data: {
      email: 'alice.smith@gmail.com',
      passwordHash,
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'PATIENT'
    }
  });

  const patient2 = await prisma.user.create({
    data: {
      email: 'bob.johnson@gmail.com',
      passwordHash,
      firstName: 'Bob',
      lastName: 'Johnson',
      role: 'PATIENT'
    }
  });
  console.log('Created Patients: Alice Smith, Bob Johnson');

  // 4. Historical / Past Appointments (Completed with AI summaries and prescriptions for timeline demo)
  console.log('[SEED] Generating historical visits and timeline details...');

  const pastDate1 = new Date();
  pastDate1.setDate(pastDate1.getDate() - 14); // 2 weeks ago
  pastDate1.setHours(10, 0, 0, 0);

  const pastDate2 = new Date();
  pastDate2.setDate(pastDate2.getDate() - 30); // 1 month ago
  pastDate2.setHours(14, 30, 0, 0);

  // Alice's completed checkup with Sarah Jenkins (Cardiology)
  const apptCompleted1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: docProfile1.id,
      startTime: pastDate1,
      endTime: new Date(pastDate1.getTime() + 30 * 60 * 1000),
      status: 'COMPLETED',
      symptoms: 'Mild chest tightness after running, shortness of breath.'
    }
  });

  await prisma.symptomSummary.create({
    data: {
      appointmentId: apptCompleted1.id,
      urgency: 'MEDIUM',
      chiefComplaint: 'Mild chest tightness',
      questions: JSON.stringify([
        'Does the tightness occur only during strenuous activities?',
        'Have you noticed any swelling in your ankles or feet?',
        'Do you have a family history of heart conditions?'
      ]),
      status: 'COMPLETED'
    }
  });

  await prisma.visitNote.create({
    data: {
      appointmentId: apptCompleted1.id,
      clinicalNotes: 'Patient complains of exertion-related chest tightness. ECG shows normal sinus rhythm. Advised stress test.',
      patientFriendlySummary: 'Your visit today focused on chest tightness during exercise. Your heart rhythm test (ECG) was normal. We recommend getting a stress test to evaluate further. Take medication as prescribed.',
      status: 'COMPLETED'
    }
  });

  await prisma.prescription.create({
    data: {
      appointmentId: apptCompleted1.id,
      medication: 'Aspirin',
      dosage: '81mg',
      frequency: 'Daily',
      duration: '30 days'
    }
  });

  // Bob's completed visit with Emily Taylor (Dermatology)
  const apptCompleted2 = await prisma.appointment.create({
    data: {
      patientId: patient2.id,
      doctorId: docProfile3.id,
      startTime: pastDate2,
      endTime: new Date(pastDate2.getTime() + 30 * 60 * 1000),
      status: 'COMPLETED',
      symptoms: 'Itchy red rash on both forearms.'
    }
  });

  await prisma.symptomSummary.create({
    data: {
      appointmentId: apptCompleted2.id,
      urgency: 'LOW',
      chiefComplaint: 'Itchy rash on forearms',
      questions: JSON.stringify([
        'Have you recently used a new soap or laundry detergent?',
        'Does the rash itch more at night?',
        'Have you been outdoors or in contact with unusual plants?'
      ]),
      status: 'COMPLETED'
    }
  });

  await prisma.visitNote.create({
    data: {
      appointmentId: apptCompleted2.id,
      clinicalNotes: 'Contact dermatitis likely from detergent swap. Prescribed topical steroid cream twice daily.',
      patientFriendlySummary: 'You have a skin rash likely caused by an allergy to a new soap or detergent. Use the prescribed cream on your arms twice a day until it clears up.',
      status: 'COMPLETED'
    }
  });

  await prisma.prescription.create({
    data: {
      appointmentId: apptCompleted2.id,
      medication: 'Hydrocortisone 1% Cream',
      dosage: 'Apply thin layer',
      frequency: 'Twice a day',
      duration: '7 days'
    }
  });

  // 5. Booked appointments (Upcoming)
  console.log('[SEED] Creating upcoming bookings...');
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const tomorrow2 = new Date();
  tomorrow2.setDate(tomorrow2.getDate() + 1);
  tomorrow2.setHours(11, 0, 0, 0);

  // Alice's booking with Dr. Chen tomorrow
  const apptUpcoming1 = await prisma.appointment.create({
    data: {
      patientId: patient1.id,
      doctorId: docProfile2.id,
      startTime: tomorrow,
      endTime: new Date(tomorrow.getTime() + 30 * 60 * 1000),
      status: 'BOOKED',
      symptoms: 'Child having seasonal allergy symptoms, runny nose, sneezing.'
    }
  });

  await prisma.symptomSummary.create({
    data: {
      appointmentId: apptUpcoming1.id,
      urgency: 'LOW',
      chiefComplaint: 'Child seasonal allergies',
      questions: JSON.stringify([
        'How long has the runny nose lasted?',
        'Is there any history of asthma?',
        'Do allergy symptoms worsen outdoors?'
      ]),
      status: 'COMPLETED'
    }
  });

  // Bob's booking with Dr. Jenkins tomorrow
  const apptUpcoming2 = await prisma.appointment.create({
    data: {
      patientId: patient2.id,
      doctorId: docProfile1.id,
      startTime: tomorrow2,
      endTime: new Date(tomorrow2.getTime() + 30 * 60 * 1000),
      status: 'BOOKED',
      symptoms: 'Sudden chest pressure, sweating, dizziness.'
    }
  });

  // High urgency trigger
  await prisma.symptomSummary.create({
    data: {
      appointmentId: apptUpcoming2.id,
      urgency: 'HIGH',
      chiefComplaint: 'Sudden chest pressure with dizziness',
      questions: JSON.stringify([
        'Are you experiencing radiation of pain to your left arm or jaw?',
        'Have you taken any Nitroglycerin?',
        'Are you accompanied by someone right now?'
      ]),
      status: 'COMPLETED'
    }
  });

  // Add leave day for Dr. Emily Taylor next week for rebook testing
  const leaveDate = new Date();
  leaveDate.setDate(leaveDate.getDate() + 5);
  leaveDate.setHours(0, 0, 0, 0);
  
  await prisma.leaveDay.create({
    data: {
      doctorProfileId: docProfile3.id,
      date: leaveDate
    }
  });

  console.log('[SEED] Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
