import { processExpiredHolds } from './allocations.ts';

export function startWorker() {
  let running: Promise<void> | null = null;
  function run() {
    if (running) return;
    running = processExpiredHolds()
      .catch((error: unknown) => console.error('Hold expiry failed:', error))
      .finally(() => { running = null; });
  }
  run();
  const timer = setInterval(run, 5000);
  return async function stopWorker() {
    clearInterval(timer);
    await running;
  };
}
