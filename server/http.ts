import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { formatIst } from './time.ts';

export function meta() {
  return { requestId: randomUUID(), serverTime: formatIst(new Date()) };
}

export function fail(
  response: Response,
  status: number,
  code: string,
  message: string,
  fieldErrors: { field: string; message: string }[] = [],
) {
  return response.status(status).json({
    error: { code, message, fieldErrors, existingResourceId: null },
    meta: meta(),
  });
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    const fieldErrors = error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message,
    }));
    fail(response, 400, 'VALIDATION_ERROR', 'Check your input.', fieldErrors);
    return;
  }
  if (error instanceof SyntaxError) {
    fail(response, 400, 'VALIDATION_ERROR', 'Send a valid JSON body.');
    return;
  }
  console.error(error);
  fail(
    response,
    500,
    'INTERNAL_ERROR',
    'Something went wrong. Please try again.',
  );
};
