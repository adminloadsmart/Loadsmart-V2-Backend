import { AppError } from './AppError';
import { MessageRef } from '../i18n/translate';

export class RateLimitError extends AppError {
  constructor(message: string | MessageRef, details?: unknown) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
  }
}
