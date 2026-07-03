import prisma from './services/db';
import { acquireHold } from './services/slotLock';

async function verifyConcurrency() {
  console.log('========================================================================');
  console.log('[CONCURRENCY TEST] Initializing parallel slot locking evaluation...');
  console.log('========================================================================');

  // 1. Identify or create a test doctor profile
  let doctor = await prisma.doctorProfile.findFirst({
    include: { user: true }
  });

  if (!doctor) {
    console.log('[CONCURRENCY TEST] Seed database first using: npm run prisma:seed');
    process.exit(1);
  }

  const doctorId = doctor.id;
  const startTime = new Date();
  startTime.setDate(startTime.getDate() + 10); // 10 days in the future
  startTime.setHours(9, 0, 0, 0); // 9:00 AM

  const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 9:30 AM

  console.log(`[CONCURRENCY TEST] Selected Doctor: Dr. ${doctor.user.firstName} ${doctor.user.lastName}`);
  console.log(`[CONCURRENCY TEST] Target Time Slot: ${startTime.toISOString()} to ${endTime.toISOString()}`);

  // Get test patient IDs or create mock ones
  const patients = await prisma.user.findMany({
    where: { role: 'PATIENT' },
    take: 10
  });

  if (patients.length < 2) {
    console.log('[CONCURRENCY TEST] Seed database first. Need at least 2 patients in database.');
    process.exit(1);
  }

  console.log(`[CONCURRENCY TEST] Simulating holds for ${patients.length} concurrent patients...`);

  // Clear any existing slot holds for this doctor at this slot first
  await prisma.slotHold.deleteMany({
    where: {
      doctorId,
      startTime
    }
  });

  // 2. Fire 10 concurrent requests at the exact same time
  const lockPromises = patients.map((patient, index) => {
    console.log(`[CONCURRENCY TEST] Dispatching request for Patient ${index + 1}: ${patient.firstName} (User ID: ${patient.id})`);
    return acquireHold(doctorId, startTime, endTime, patient.id)
      .then((success) => ({
        patientIndex: index + 1,
        patientName: patient.firstName,
        success
      }));
  });

  const results = await Promise.all(lockPromises);

  console.log('\n=========================================');
  console.log('              TEST RESULTS               ');
  console.log('=========================================');

  let successCount = 0;
  let failureCount = 0;

  results.forEach((res) => {
    if (res.success) {
      console.log(`✅ [SUCCESS] Patient ${res.patientIndex} (${res.patientName}) successfully held the slot!`);
      successCount++;
    } else {
      console.log(`❌ [BLOCKED] Patient ${res.patientIndex} (${res.patientName}) was rejected due to lock concurrency.`);
      failureCount++;
    }
  });

  console.log('=========================================');
  console.log(`Total Successes: ${successCount}`);
  console.log(`Total Failures (Blocked): ${failureCount}`);
  console.log('=========================================');

  if (successCount === 1) {
    console.log('🎉 TEST PASSED! Concurrency safety locks resolved exactly 1 hold and blocked all other overlaps.');
  } else {
    console.log('⚠️ TEST FAILED! Expected exactly 1 successful hold.');
  }

  // Cleanup the test slot hold
  await prisma.slotHold.deleteMany({
    where: {
      doctorId,
      startTime
    }
  });
  console.log('[CONCURRENCY TEST] Cleanup complete.');
  
  await prisma.$disconnect();
}

verifyConcurrency().catch(async (e) => {
  console.error('[CONCURRENCY TEST] Critical error during execution:', e);
  await prisma.$disconnect();
  process.exit(1);
});
