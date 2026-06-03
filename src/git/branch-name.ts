export interface BuildWorkingBranchNameInput {
  readonly ticketKey: string;
  readonly summary: string;
  readonly prefix?: string;
  readonly maxSlugLength?: number;
}

const defaultBranchPrefix = 'agent';
const defaultMaxSlugLength = 40;

export function buildWorkingBranchName(input: BuildWorkingBranchNameInput): string {
  const prefix = normalizeBranchPathSegment(input.prefix ?? defaultBranchPrefix, 'branch prefix');
  const ticketKey = normalizeTicketKey(input.ticketKey);
  const slug = buildShortSlug(input.summary, input.maxSlugLength ?? defaultMaxSlugLength);

  return `${prefix}/${ticketKey}-${slug}`;
}

function normalizeTicketKey(ticketKey: string): string {
  const normalized = ticketKey.trim().toUpperCase().replace(/[^A-Z0-9-]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');

  if (normalized.length === 0) {
    throw new Error('Ticket key must contain at least one branch-safe character.');
  }

  return normalized;
}

function buildShortSlug(summary: string, maxSlugLength: number): string {
  if (!Number.isInteger(maxSlugLength) || maxSlugLength < 1) {
    throw new Error('Maximum slug length must be a positive integer.');
  }

  const slug = summary.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  const truncated = slug.slice(0, maxSlugLength).replace(/-$/u, '');

  return truncated.length === 0 ? 'work' : truncated;
}

function normalizeBranchPathSegment(segment: string, label: string): string {
  const normalized = segment.trim().replace(/^\/+|\/+$/gu, '');

  if (normalized.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  if (normalized.startsWith('-') || normalized.includes('..') || /\s/u.test(normalized)) {
    throw new Error(`${label} is not branch-safe: ${segment}`);
  }

  return normalized;
}
