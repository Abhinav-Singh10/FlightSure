import { processExpiredHolds, processWaitlists } from './allocations.ts';
import { processDuePayments } from './payments.ts';

export async function processWorkerPass() {
  await processExpiredHolds();
  await processDuePayments();
  await processWaitlists();
}

export function startWorker() {
  let running: Promise<void> | null = null;
  function run() {
    if (running) return;
    running = processWorkerPass()
      .catch((error: unknown) => console.error('Background processing failed:', error))
      .finally(() => { running = null; });
  }
  run();
  const timer = setInterval(run, 5000);
  return async function stopWorker() {
    clearInterval(timer);
    await running;
  };
}
