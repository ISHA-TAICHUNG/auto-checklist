const SECRET_PATTERNS = [
  /password\s*[:=]\s*[^,\s}]+/gi,
  /passwd\s*[:=]\s*[^,\s}]+/gi,
  /token\s*[:=]\s*[^,\s}]+/gi,
  /cookie\s*[:=]\s*[^,\s}]+/gi,
  /authorization\s*[:=]\s*[^,\s}]+/gi,
  /bearer\s+[a-z0-9._-]+/gi,
];

export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, match => {
      const separator = match.indexOf(':') >= 0 ? ':' : '=';
      const [key] = match.split(separator);
      return `${key}${separator}[REDACTED]`;
    });
  }
  return text;
}

export function redactError(error) {
  if (!error) return '';
  return redact(error.stack || error.message || String(error));
}
