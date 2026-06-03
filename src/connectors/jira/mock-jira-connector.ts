import type { WorkspaceConfig } from '../../config/workspace-config.js';
import type { DeliveryTicket } from '../../domain/ticket.js';
import type { JiraConnector } from './jira-connector.js';

export class MockJiraConnector implements JiraConnector {
  private readonly tickets: readonly DeliveryTicket[];

  constructor(config: WorkspaceConfig, tickets?: readonly DeliveryTicket[]) {
    this.tickets = tickets ?? createMockTickets(config);
  }

  async listBacklog(): Promise<readonly DeliveryTicket[]> {
    return this.tickets;
  }

  async getTicket(key: string): Promise<DeliveryTicket> {
    const ticket = this.tickets.find((candidate) => candidate.ref.key === key);

    if (ticket === undefined) {
      throw new Error(`Mock Jira ticket not found: ${key}`);
    }

    return ticket;
  }

  async comment(_key: string, _body: string): Promise<void> {
    return undefined;
  }
}

function createMockTickets(config: WorkspaceConfig): readonly DeliveryTicket[] {
  const projectKey = config.jira.projectKeys[0] ?? 'AD';
  const baseUrl = config.jira.baseUrl.replace(/\/$/u, '');

  return [
    {
      ref: {
        provider: 'jira',
        key: `${projectKey}-101`,
        url: `${baseUrl}/browse/${projectKey}-101`
      },
      summary: 'Improve frontend onboarding empty state',
      description: 'Users need a clearer frontend onboarding empty state on the web app.',
      status: 'To Do',
      priority: 'medium',
      labels: ['frontend', 'ui', 'web'],
      createdAt: '2026-06-03T08:00:00.000Z',
      updatedAt: '2026-06-03T08:00:00.000Z'
    },
    {
      ref: {
        provider: 'jira',
        key: `${projectKey}-102`,
        url: `${baseUrl}/browse/${projectKey}-102`
      },
      summary: 'Add API health check coverage',
      description: 'The backend API should expose and test a reliable health check for Railway smoke verification.',
      status: 'To Do',
      priority: 'high',
      labels: ['api', 'backend', 'server'],
      createdAt: '2026-06-03T08:05:00.000Z',
      updatedAt: '2026-06-03T08:05:00.000Z'
    }
  ];
}
