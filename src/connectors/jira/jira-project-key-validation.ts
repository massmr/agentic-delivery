const jiraProjectKeyPattern = /^[A-Z][A-Z0-9_]*$/u;

export interface JiraProjectKeyValidationIssue {
  readonly index: number;
  readonly message: string;
  readonly action: string;
}

export class JiraProjectKeyValidationError extends Error {
  readonly issues: readonly JiraProjectKeyValidationIssue[];

  constructor(issues: readonly JiraProjectKeyValidationIssue[]) {
    super(formatJiraProjectKeyValidationError(issues));
    this.name = 'JiraProjectKeyValidationError';
    this.issues = issues;
  }
}

export function validateJiraProjectKeys(projectKeys: readonly string[]): readonly JiraProjectKeyValidationIssue[] {
  const issues: JiraProjectKeyValidationIssue[] = [];

  for (const [index, projectKey] of projectKeys.entries()) {
    if (!jiraProjectKeyPattern.test(projectKey)) {
      issues.push({
        index,
        message: 'Jira project keys must start with an uppercase letter and contain only uppercase letters, digits, or underscores.',
        action: 'Use keys like LK, LK2, or LK_API. Remove spaces, punctuation, lowercase letters, and leading digits.'
      });
    }
  }

  return issues;
}

export function assertValidJiraProjectKeys(projectKeys: readonly string[]): void {
  const issues = validateJiraProjectKeys(projectKeys);

  if (issues.length > 0) {
    throw new JiraProjectKeyValidationError(issues);
  }
}

export function formatJiraProjectKeyValidationError(issues: readonly JiraProjectKeyValidationIssue[]): string {
  if (issues.length === 0) {
    return 'Invalid Jira MCP project keys.';
  }

  const indexes = issues.map((issue) => issue.index).join(', ');
  return `Invalid Jira MCP project keys at indexes: ${indexes}. Jira project keys must start with an uppercase letter and contain only uppercase letters, digits, or underscores.`;
}
