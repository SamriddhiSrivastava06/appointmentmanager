import axios from 'axios';

async function runDiagnostics() {
  console.log('========================================================================');
  console.log('[API DIAGNOSTICS] Launching route checks...');
  console.log('========================================================================');

  const serverUrl = 'http://localhost:5000';

  try {
    const health = await axios.get(`${serverUrl}/health`);
    console.log(`✅ [HEALTH] Reachable! Status: ${health.data.status}, Time: ${health.data.timestamp}`);
  } catch (err: any) {
    console.log(`❌ [HEALTH] Server is offline or unreachable on ${serverUrl}/health: ${err.message}`);
    console.log('\nMake sure to start the server with "npm run dev" before running diagnostics.');
    process.exit(1);
  }

  try {
    const doctors = await axios.get(`${serverUrl}/api/doctors`);
    console.log(`❌ [DOCTORS] Expected unauthorized redirect, but got:`, doctors.status);
  } catch (err: any) {
    if (err.response?.status === 401) {
      console.log('✅ [DOCTORS] Protected route returned 401 Unauthorized as expected.');
    } else {
      console.log('❌ [DOCTORS] Protected route check failed with status:', err.response?.status);
    }
  }

  console.log('\n=========================================');
  console.log('🎉 Diagnostic test checks completed!');
  console.log('=========================================');
}

runDiagnostics();
