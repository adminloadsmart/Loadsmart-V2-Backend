import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class ConflictError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}
