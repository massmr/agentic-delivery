import type { WorkspaceConfig, WorkspaceRepositoryConfig } from '../config/workspace-config.js';
import type { RepositoryMatch, RepositoryRef } from '../domain/repository.js';
import type { DeliveryTicket, TicketAnalysis } from '../domain/ticket.js';

export interface TicketPlan {
  readonly ticket: DeliveryTicket;
  readonly analysis: TicketAnalysis;
  readonly repositoryMatches: readonly RepositoryMatch[];
  readonly selectedRepositories: readonly RepositoryRef[];
  readonly needsHuman: boolean;
  readonly humanReason?: string;
}

export function createTicketPlan(ticket: DeliveryTicket, config: WorkspaceConfig): TicketPlan {
  const analysis = analyzeTicket(ticket);
  const repositoryMatches = resolveRepositoriesForTicket(ticket, config);
  const confidentMatches = repositoryMatches.filter((match) => match.confidence >= 0.4);
  const selectedRepositories = confidentMatches.map((match) => match.repository);

  if (selectedRepositories.length === 0) {
    return {
      ticket,
      analysis,
      repositoryMatches,
      selectedRepositories: [],
      needsHuman: true,
      humanReason: 'No repository matched the ticket labels, summary, or description with enough confidence.'
    };
  }

  return {
    ticket,
    analysis,
    repositoryMatches,
    selectedRepositories,
    needsHuman: false
  };
}

export function analyzeTicket(ticket: DeliveryTicket): TicketAnalysis {
  return {
    ticketKey: ticket.ref.key,
    goal: ticket.summary,
    requirements: splitDescription(ticket.description),
    constraints: ['Use TDD where a behavioral change is required.', 'Keep production merge behind human approval.'],
    risks: ticket.priority === 'high' || ticket.priority === 'highest' ? ['High priority ticket; verify staging carefully.'] : []
  };
}

export function resolveRepositoriesForTicket(ticket: DeliveryTicket, config: WorkspaceConfig): readonly RepositoryMatch[] {
  const haystack = normalize([ticket.summary, ticket.description, ...ticket.labels].join(' '));

  return config.repos
    .map((repository) => {
      const matchedHints = repository.hints.filter((hint) => haystack.includes(normalize(hint)));
      const confidence = matchedHints.length === 0 ? 0 : Math.min(1, matchedHints.length / Math.max(repository.hints.length, 1) + 0.2);

      return {
        repository: toRepositoryRef(repository, config.github.organization),
        confidence,
        reasoning:
          matchedHints.length === 0
            ? `No configured hints matched for ${repository.name}.`
            : `Matched hints for ${repository.name}: ${matchedHints.join(', ')}.`
      } satisfies RepositoryMatch;
    })
    .sort((left, right) => right.confidence - left.confidence);
}

export function toRepositoryRef(repository: WorkspaceRepositoryConfig, fallbackOwner?: string | undefined): RepositoryRef {
  return {
    provider: 'github',
    owner: resolveRepositoryOwner(repository, fallbackOwner),
    name: repository.name,
    defaultBranch: repository.defaultBranch,
    url: repository.url
  };
}

export function resolveRepositoryOwner(repository: WorkspaceRepositoryConfig, fallbackOwner?: string | undefined): string {
  return parseGitHubOwnerFromRemoteUrl(repository.url) ?? fallbackOwner ?? 'local';
}

function parseGitHubOwnerFromRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const sshMatch = /^git@github\.com:([^/]+)\/[^/]+(?:\.git)?$/u.exec(trimmed);
  if (sshMatch !== null) {
    return sshMatch[1];
  }

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/[^/]+(?:\.git)?$/u.exec(trimmed);
  if (httpsMatch !== null) {
    return httpsMatch[1];
  }

  return undefined;
}

function splitDescription(description: string): readonly string[] {
  const lines = description
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.length === 0 ? [description] : lines;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('en-US');
}
