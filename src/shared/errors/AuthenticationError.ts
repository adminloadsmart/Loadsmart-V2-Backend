import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class AuthenticationError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 401, 'AUTHENTICATION_ERROR', details);
  }
}
