import { createHushServer } from './src/app.js';

const hush = await createHushServer();

try {
  const address = await hush.start();
  const host = !address.address || address.address === '0.0.0.0' ? 'localhost' : address.address;
  console.log(`\n  Hush is running at http://${host}:${address.port}\n`);
  console.log('  Text, voice, video, and screen sharing in one room.');
  console.log('  Press Ctrl+C to stop.\n');
} catch (error) {
  console.error('Could not start Hush:', error);
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, closing rooms…`);
  try {
    await hush.stop();
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
