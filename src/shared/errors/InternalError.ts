import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class InternalError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 500, 'INTERNAL_ERROR', details, false);
  }
}
