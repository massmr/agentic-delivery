import type { DeliveryTicket } from '../domain/ticket.js';

export interface TicketPort {
  listBacklog(): Promise<readonly DeliveryTicket[]>;
  getTicket(key: string): Promise<DeliveryTicket>;
  comment(key: string, body: string): Promise<void>;
}
