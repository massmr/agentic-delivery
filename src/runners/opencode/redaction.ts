const secretNamePattern = '(?:api[_-]?key|token|secret|password|credential|access[_-]?token|refresh[_-]?token|client[_-]?secret|accessToken|refreshToken|clientSecret|authorization)';
const secretKeyPattern = new RegExp(`^(?:-+)?${secretNamePattern}$`, 'iu');
const secretAssignmentPattern = new RegExp(`((${secretNamePattern})\\s*[:=]\\s*)\\S+`, 'giu');

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, '[redacted]')
    .replace(/(authorization\s*[:=]\s*)(?:Bearer\s+)?\S+/giu, '$1[redacted]')
    .replace(secretAssignmentPattern, '$1[redacted]');
}

export function redactCommand(executable: string, args: readonly string[]): string {
  const redactedArgs: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      redactedArgs.push('[redacted]');
      redactNext = false;
      continue;
    }

    redactedArgs.push(redactSensitiveText(arg));

    if (secretKeyPattern.test(arg)) {
      redactNext = true;
    }
  }

  return [redactSensitiveText(executable), ...redactedArgs].join(' ');
}
