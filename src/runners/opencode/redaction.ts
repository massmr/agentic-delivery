const secretKeyPattern = /^(?:-+)?(?:api[_-]?key|token|secret|password)$/iu;
const secretAssignmentPattern = /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)\S+/giu;

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/gu, '[redacted]')
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
