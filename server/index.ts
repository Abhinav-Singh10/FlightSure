import { app } from './app.ts';
import { pool } from './db.ts';
import { startWorker } from './worker.ts';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port)) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// main server
let stopWorker: (() => Promise<void>) | undefined;
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`backend runnin on: http://127.0.0.1:${port}`);
  stopWorker = startWorker();
});

// PORT error check
server.on('error', () => {
  console.error(
    'The backend could not start. Check whether PORT is already in use.',
  );
  process.exitCode = 1;
});

let stopping = false;
function stopServer() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    try {
      await stopWorker?.();
      await pool.end();
    } catch (error) {
      console.error('Unable to close the backend:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
