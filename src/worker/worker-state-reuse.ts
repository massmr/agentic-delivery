import type { DeliveryRunStateRecord, DeliveryTicket } from '../domain/index.js';
import type { TicketPort } from '../ports/index.js';
import { findLatestRunState, getNextActionForState } from '../status/index.js';

export interface WorkerStateReuseDecision {
  readonly ticketKey: string;
  readonly runId: string;
  readonly state: DeliveryRunStateRecord['state'];
  readonly nextAction: string;
}

export interface StateAwareTicketPortResult {
  readonly ticketPort: TicketPort;
  readonly skippedTickets: readonly WorkerStateReuseDecision[];
}

export function createStateAwareTicketPort(input: { readonly rootPath: string; readonly ticketPort: TicketPort }): StateAwareTicketPortResult {
  const skippedTickets: WorkerStateReuseDecision[] = [];

  return {
    skippedTickets,
    ticketPort: {
      async listBacklog(): Promise<readonly DeliveryTicket[]> {
        const backlog = await input.ticketPort.listBacklog();
        const processable: DeliveryTicket[] = [];

        for (const ticket of backlog) {
          const latest = await findLatestRunStateIfPresent(input.rootPath, ticket.ref.key);

          if (latest === undefined) {
            processable.push(ticket);
            continue;
          }

          skippedTickets.push({
            ticketKey: ticket.ref.key,
            runId: latest.state.runId,
            state: latest.state.state,
            nextAction: getNextActionForState(latest.state)
          });
        }

        return processable;
      },
      getTicket(key) {
        return input.ticketPort.getTicket(key);
      },
      comment(key, body) {
        return input.ticketPort.comment(key, body);
      }
    }
  };
}

async function findLatestRunStateIfPresent(
  rootPath: string,
  ticketKey: string
): Promise<Awaited<ReturnType<typeof findLatestRunState>> | undefined> {
  try {
    return await findLatestRunState(rootPath, ticketKey);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`No runs found for ${ticketKey}.`)) {
      return undefined;
    }

    throw error;
  }
}
