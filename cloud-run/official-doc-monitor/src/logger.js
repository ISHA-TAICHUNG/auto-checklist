import { redact, redactError } from './redact.js';

function write(level, message, meta) {
  const entry = {
    severity: level,
    message,
    time: new Date().toISOString(),
  };
  if (meta !== undefined) {
    const redacted = redact(meta);
    try {
      entry.meta = JSON.parse(redacted);
    } catch (_) {
      entry.meta = redacted;
    }
  }
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  info(message, meta) {
    write('INFO', message, meta);
  },
  warn(message, meta) {
    write('WARNING', message, meta);
  },
  error(message, errorOrMeta) {
    if (errorOrMeta instanceof Error) {
      write('ERROR', message, { error: redactError(errorOrMeta) });
      return;
    }
    write('ERROR', message, errorOrMeta);
  },
};
