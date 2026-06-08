import type { JsonValue } from './json.js';

export function sanitizeMcpJsonValue(value: JsonValue, path: readonly string[] = []): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeMcpJsonValue(item, [...path, String(index)]));
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, JsonValue | undefined> = {};

    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) {
        sanitized[key] = sanitizeMcpJsonValue(child, [...path, key]);
      }
    }

    return sanitized;
  }

  if (shouldRedactPrimitive(value, path)) {
    return '[redacted]';
  }

  return value;
}

function shouldRedactPrimitive(value: JsonValue, path: readonly string[]): boolean {
  const currentKey = path[path.length - 1] ?? '';
  const parentKey = path[path.length - 2] ?? '';
  const parentPath = path.slice(0, -1);
  const hasSensitiveParent = parentPath.some((segment) => isSensitiveName(segment));
  const hasSecretValueContainer = path.some((segment) => isSecretValueName(segment));

  if (hasSensitiveParent && hasSecretValueContainer) {
    return true;
  }

  if (isSensitiveName(currentKey)) {
    return true;
  }

  if (value === null || typeof value === 'boolean') {
    return false;
  }

  return typeof value === 'string' && (isSecretValueName(currentKey) || isSecretValueName(parentKey)) && looksCredentialLike(value);
}

function isSensitiveName(value: string): boolean {
  const normalized = value.replace(/[-_\s]/gu, '').toLowerCase();
  return normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('apikey')
    || normalized.includes('clientsecret')
    || normalized.includes('accesstoken')
    || normalized.includes('refreshtoken');
}

function isSecretValueName(value: string): boolean {
  return value === 'default' || value === 'example' || value === 'examples' || value === 'const' || value === 'enum';
}

function looksCredentialLike(value: string): boolean {
  return /^(bearer\s+)?(gh[pousr]_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|xox[a-z]-[a-z0-9-]{20,}|[a-z0-9_+./=-]{32,})$/iu.test(value.trim());
}
