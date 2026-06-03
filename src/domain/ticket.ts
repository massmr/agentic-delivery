export type TicketProvider = 'jira';

export type TicketPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest';

export interface TicketRef {
  readonly provider: TicketProvider;
  readonly key: string;
  readonly url: string;
}

export interface DeliveryTicket {
  readonly ref: TicketRef;
  readonly summary: string;
  readonly description: string;
  readonly status: string;
  readonly priority: TicketPriority;
  readonly labels: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TicketAnalysis {
  readonly ticketKey: string;
  readonly goal: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly risks: readonly string[];
}
