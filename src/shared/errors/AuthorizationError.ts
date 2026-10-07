import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class AuthorizationError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 403, 'AUTHORIZATION_ERROR', details);
  }
}
