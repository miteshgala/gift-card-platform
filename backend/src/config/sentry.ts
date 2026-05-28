/**
 * Sentry Error Tracking
 *
 * Initialised before anything else in index.ts so it captures
 * startup errors. DSN is optional — omit SENTRY_DSN in dev to disable.
 */
import * as Sentry from '@sentry/node';
import { logger } from './logger';

export function initSentry(): void {
  const dsn = process.env['SENTRY_DSN'];
  if (!dsn) {
    logger.info('Sentry DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    // Capture unhandled promise rejections
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: 'strict' })],
  });

  logger.info('Sentry initialised', { environment: process.env['NODE_ENV'] });
}

/** Capture an exception manually (use in catch blocks) */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}
