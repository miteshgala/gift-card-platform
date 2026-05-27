import winston from 'winston';
import { env } from './env';

// Redact sensitive fields from log output
const REDACTED_FIELDS = ['password', 'passwordHash', 'pinHash', 'cardNumber', 'pin', 'token', 'secret', 'key'];

const redactSensitive = winston.format((info) => {
  const redact = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (REDACTED_FIELDS.some((f) => k.toLowerCase().includes(f))) {
        result[k] = '[REDACTED]';
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        result[k] = redact(v as Record<string, unknown>);
      } else {
        result[k] = v;
      }
    }
    return result;
  };

  if (info.message && typeof info.message === 'object') {
    info.message = redact(info.message as Record<string, unknown>);
  }
  return info;
});

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    redactSensitive(),
    winston.format.timestamp(),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...rest }) => {
            const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
            return `${timestamp} [${level}]: ${message}${extra}`;
          })
        )
  ),
  transports: [
    new winston.transports.Console(),
    ...(env.NODE_ENV === 'production'
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});
