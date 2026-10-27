import { app } from './app.ts';
import { pool } from './db.ts';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port)) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

// main server
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`backend runnin on: http://127.0.0.1:${port}`);
});

// PORT error check
server.on('error', () => {
  console.error(
    'The backend could not start. Check whether PORT is already in use.',
  );
  process.exitCode = 1;
});

function stopServer() {
  server.close(() => {
    pool.end().catch(() => {
      console.error('The database connections could not close cleanly.');
      process.exitCode = 1;
    });
  });
}

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
