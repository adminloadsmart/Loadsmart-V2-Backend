import { DEFAULT_LOCALE } from '../i18n/locales';
import { MessageKey, MessageParams, MessageRef, t } from '../i18n/translate';

export abstract class AppError extends Error {
  // Set when the error was raised with a catalog key instead of literal text. error-handler
  // translates it per request; `message` then holds the English rendering for logs/fallback.
  readonly messageKey?: MessageKey;
  readonly params?: MessageParams;

  constructor(
    message: string | MessageRef,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
    readonly isOperational: boolean = true,
  ) {
    super(typeof message === 'string' ? message : t(DEFAULT_LOCALE, message.key, message.params));
    if (typeof message !== 'string') {
      this.messageKey = message.key;
      this.params = message.params;
    }
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}
