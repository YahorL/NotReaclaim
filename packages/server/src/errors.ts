import { ZodError } from 'zod';
import { NotFoundError, ConflictError } from '@notreclaim/db';
import { SettingsRequiredError } from '@notreclaim/core';
import { GoogleNotConnectedError, GoogleApiError } from '@notreclaim/google';

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

/** Map any thrown value to an HTTP status + safe code/message. */
export function mapDomainError(error: unknown): MappedError {
  if (error instanceof ZodError) {
    return { status: 400, code: 'validation_error', message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'not_found', message: error.message };
  }
  if (error instanceof ConflictError) {
    return { status: 409, code: 'conflict', message: error.message };
  }
  if (error instanceof SettingsRequiredError) {
    return { status: 409, code: 'settings_required', message: error.message };
  }
  if (error instanceof GoogleNotConnectedError) {
    return { status: 409, code: 'google_not_connected', message: error.message };
  }
  if (error instanceof GoogleApiError) {
    return { status: 502, code: 'google_api_error', message: error.message };
  }
  return { status: 500, code: 'internal_error', message: 'Internal Server Error' };
}
