import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class ValidationError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}
