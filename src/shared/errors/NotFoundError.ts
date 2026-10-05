import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class NotFoundError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
  }
}
