import type {
  CoreSafetyForbiddenFileFinding,
  CoreSafetyHumanReviewCategory,
  CoreSafetyHumanReviewFinding,
  CoreSafetyLimitFinding,
  CoreSafetyLimits,
  CoreSafetyReport,
  CoreSafetySecretFinding
} from '../domain/index.js';

export interface CoreSafetyDiffAddition {
  readonly filePath: string;
  readonly lineNumber?: number | undefined;
  readonly content: string;
}

export interface EvaluateCoreSafetyInput {
  readonly changedFiles: readonly string[];
  readonly additions: readonly CoreSafetyDiffAddition[];
  readonly limits?: Partial<CoreSafetyLimits> | undefined;
}

export const defaultCoreSafetyLimits: CoreSafetyLimits = {
  maxChangedFiles: 25,
  maxAddedLines: 500
};

export function evaluateCoreSafety(input: EvaluateCoreSafetyInput): CoreSafetyReport {
  const changedFiles = uniqueNormalizedPaths(input.changedFiles);
  const limits = { ...defaultCoreSafetyLimits, ...input.limits };
  const forbiddenFiles = changedFiles.flatMap(findForbiddenFile);
  const secretFindings = input.additions.flatMap(findSecretLikeAddition);
  const limitFindings = findLimitFindings(changedFiles, input.additions, limits);
  const humanReviewFindings = changedFiles.flatMap(findHumanReviewCategory);
  const decision = forbiddenFiles.length > 0 || secretFindings.length > 0 ? 'fail' : limitFindings.length > 0 || humanReviewFindings.length > 0 ? 'needs_human' : 'pass';

  return {
    decision,
    reason: buildReason({ decision, forbiddenFiles, secretFindings, limitFindings, humanReviewFindings }),
    changedFiles,
    changedFileCount: changedFiles.length,
    addedLineCount: input.additions.length,
    limits,
    forbiddenFiles,
    secretFindings,
    limitFindings,
    humanReviewFindings
  };
}

function findForbiddenFile(filePath: string): readonly CoreSafetyForbiddenFileFinding[] {
  const normalizedPath = normalizePath(filePath);
  const fileName = normalizedPath.split('/').at(-1) ?? normalizedPath;
  const lowerPath = normalizedPath.toLowerCase();
  const lowerName = fileName.toLowerCase();
  const findings: CoreSafetyForbiddenFileFinding[] = [];

  if (lowerName === '.env' || lowerName.startsWith('.env.')) {
    findings.push({ filePath: normalizedPath, reason: 'Environment files must not be changed by an agent.' });
  }

  if (isPrivateKeyPath(lowerName)) {
    findings.push({ filePath: normalizedPath, reason: 'Private key material must not be changed by an agent.' });
  }

  if (isCredentialLikePath(lowerPath, lowerName)) {
    findings.push({ filePath: normalizedPath, reason: 'Credential, secret, or token files must not be changed by an agent.' });
  }

  if (isEwokbotAuthOrConfigPath(lowerPath, lowerName)) {
    findings.push({ filePath: normalizedPath, reason: 'Ewokbot auth/config files must not be changed by an agent.' });
  }

  return findings;
}

function isPrivateKeyPath(lowerName: string): boolean {
  return lowerName === 'id_rsa' ||
    lowerName === 'id_dsa' ||
    lowerName === 'id_ecdsa' ||
    lowerName === 'id_ed25519' ||
    lowerName.endsWith('.pem') ||
    lowerName.endsWith('.key') ||
    lowerName.endsWith('.p12') ||
    lowerName.endsWith('.pfx');
}

function isCredentialLikePath(lowerPath: string, lowerName: string): boolean {
  if (lowerName === '.env.example') {
    return false;
  }

  return /(^|[._-])(credential|credentials|secret|secrets|token|tokens)([._-]|$)/u.test(lowerName) ||
    /(^|\/)(credential|credentials|secret|secrets|token|tokens)(\/|$)/u.test(lowerPath);
}

function isEwokbotAuthOrConfigPath(lowerPath: string, lowerName: string): boolean {
  if (!lowerPath.startsWith('.ewokbot/')) {
    return false;
  }

  return lowerName === '.env' ||
    lowerName.startsWith('.env.') ||
    lowerName === 'workspace.yml' ||
    lowerName === 'workspace.yaml' ||
    lowerName.includes('auth') ||
    lowerName.includes('config');
}

function findSecretLikeAddition(addition: CoreSafetyDiffAddition): readonly CoreSafetySecretFinding[] {
  const detectors = secretDetectors
    .filter((detector) => detector.pattern.test(addition.content))
    .map((detector) => detector.name);

  return detectors.map((detector) => ({
    filePath: normalizePath(addition.filePath),
    lineNumber: addition.lineNumber,
    detector
  }));
}

const secretDetectors: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'secret_assignment', pattern: /\b(?:api[_-]?key|token|secret|password|passwd|credential|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*['"]?[^'"\s]{12,}/iu },
  { name: 'bearer_token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/u },
  { name: 'private_key_marker', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { name: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u },
  { name: 'slack_token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
  { name: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/u }
];

function findLimitFindings(changedFiles: readonly string[], additions: readonly CoreSafetyDiffAddition[], limits: CoreSafetyLimits): readonly CoreSafetyLimitFinding[] {
  const findings: CoreSafetyLimitFinding[] = [];

  if (changedFiles.length > limits.maxChangedFiles) {
    findings.push({
      limit: 'maxChangedFiles',
      actual: changedFiles.length,
      maximum: limits.maxChangedFiles,
      reason: `Changed file count ${changedFiles.length} exceeds the autonomous limit ${limits.maxChangedFiles}.`
    });
  }

  if (additions.length > limits.maxAddedLines) {
    findings.push({
      limit: 'maxAddedLines',
      actual: additions.length,
      maximum: limits.maxAddedLines,
      reason: `Added line count ${additions.length} exceeds the autonomous limit ${limits.maxAddedLines}.`
    });
  }

  return findings;
}

function findHumanReviewCategory(filePath: string): readonly CoreSafetyHumanReviewFinding[] {
  const normalizedPath = normalizePath(filePath);
  const lowerPath = normalizedPath.toLowerCase();
  const findings: CoreSafetyHumanReviewFinding[] = [];

  addCategory(findings, normalizedPath, lowerPath, 'dependency_lockfile', isDependencyLockfile(lowerPath), 'Dependency lockfile changes require human review.');
  addCategory(findings, normalizedPath, lowerPath, 'db_migration', isDatabaseMigrationPath(lowerPath), 'Database migration changes require human review.');
  addCategory(findings, normalizedPath, lowerPath, 'auth_path', isAuthPath(lowerPath), 'Authentication or authorization path changes require human review.');
  addCategory(findings, normalizedPath, lowerPath, 'payment_billing_path', isPaymentBillingPath(lowerPath), 'Payment or billing path changes require human review.');
  addCategory(findings, normalizedPath, lowerPath, 'infra_deployment_config', isInfraDeploymentPath(lowerPath), 'Infrastructure or deployment config changes require human review.');

  return findings;
}

function addCategory(
  findings: CoreSafetyHumanReviewFinding[],
  filePath: string,
  _lowerPath: string,
  category: CoreSafetyHumanReviewCategory,
  matches: boolean,
  reason: string
): void {
  if (matches) {
    findings.push({ filePath, category, reason });
  }
}

function isDependencyLockfile(lowerPath: string): boolean {
  return [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'cargo.lock',
    'gemfile.lock',
    'poetry.lock',
    'uv.lock',
    'composer.lock',
    'go.sum'
  ].includes(lowerPath.split('/').at(-1) ?? lowerPath);
}

function isDatabaseMigrationPath(lowerPath: string): boolean {
  return /(^|\/)(migrations?|schema|prisma\/migrations|db\/migrations|database\/migrations|supabase\/migrations)(\/|$)/u.test(lowerPath) || lowerPath.endsWith('.sql');
}

function isAuthPath(lowerPath: string): boolean {
  return /(^|\/)(auth|authentication|authorization|oauth|login|session|sessions)(\/|$)/u.test(lowerPath);
}

function isPaymentBillingPath(lowerPath: string): boolean {
  return /(^|\/)(payment|payments|billing|stripe|checkout|subscription|subscriptions|invoice|invoices)(\/|$)/u.test(lowerPath);
}

function isInfraDeploymentPath(lowerPath: string): boolean {
  const fileName = lowerPath.split('/').at(-1) ?? lowerPath;

  return fileName === 'dockerfile' ||
    fileName.startsWith('dockerfile.') ||
    fileName.startsWith('docker-compose') ||
    fileName === 'railway.json' ||
    fileName === 'vercel.json' ||
    fileName === 'fly.toml' ||
    fileName === 'render.yaml' ||
    fileName === 'render.yml' ||
    fileName === '.gitlab-ci.yml' ||
    fileName === '.gitlab-ci.yaml' ||
    /(^|\/)(\.github\/workflows|infra|infrastructure|deploy|deployment|deployments|k8s|kubernetes|helm|terraform)(\/|$)/u.test(lowerPath) ||
    lowerPath.endsWith('.tf');
}

function buildReason(input: Pick<CoreSafetyReport, 'decision' | 'forbiddenFiles' | 'secretFindings' | 'limitFindings' | 'humanReviewFindings'>): string {
  if (input.decision === 'fail') {
    const reasons = [
      input.forbiddenFiles.length === 0 ? undefined : `${input.forbiddenFiles.length} forbidden file change${input.forbiddenFiles.length === 1 ? '' : 's'}`,
      input.secretFindings.length === 0 ? undefined : `${input.secretFindings.length} secret-like added line${input.secretFindings.length === 1 ? '' : 's'}`
    ].filter((value): value is string => value !== undefined);

    return `Core safety failed: ${reasons.join(' and ')} detected.`;
  }

  if (input.decision === 'needs_human') {
    const categories = [...new Set(input.humanReviewFindings.map((finding) => finding.category.replace(/_/gu, ' ')))];
    const reasons = [
      input.limitFindings.length === 0 ? undefined : `${input.limitFindings.length} diff-size limit finding${input.limitFindings.length === 1 ? '' : 's'}`,
      input.humanReviewFindings.length === 0 ? undefined : `${input.humanReviewFindings.length} human-review path finding${input.humanReviewFindings.length === 1 ? '' : 's'}${categories.length === 0 ? '' : ` (${categories.join(', ')})`}`
    ].filter((value): value is string => value !== undefined);

    return `Core safety requires human review: ${reasons.join(' and ')} detected.`;
  }

  return 'Core safety passed: no forbidden files, secret-like additions, diff-size violations, or human-review path categories were detected.';
}

function uniqueNormalizedPaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map(normalizePath).filter((path) => path.length > 0))];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
