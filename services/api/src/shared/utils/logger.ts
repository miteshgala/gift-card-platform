import winston from 'winston';
import { env } from './env';

// PAN redaction: replace 13-19 digit sequences (card numbers) with [REDACTED]
const PAN_REGEX = /\b\d{13,19}\b/g;

function redactPans(message: string): string {
  return message.replace(PAN_REGEX, '[REDACTED]');
}

const redactTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format((info) => {
      // Redact PANs from message and any string fields
      if (typeof info['message'] === 'string') {
        info['message'] = redactPans(info['message'] as string);
      }
      return info;
    })(),
    env.NODE_ENV === 'development'
      ? winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${message}${metaStr}`;
          }),
        )
      : winston.format.json(),
  ),
});

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: {
    service: 'api',
    version: process.env['npm_package_version'] ?? '1.0.0',
  },
  transports: [redactTransport],
});

// Create a child logger with additional context
export function childLogger(meta: Record<string, unknown>) {
  return logger.child(meta);
}
