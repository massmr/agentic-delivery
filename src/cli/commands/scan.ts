import { resolve } from 'node:path';

import { loadWorkspaceConfig } from '../../config/workspace-config.js';
import type { DeliveryTicket } from '../../domain/ticket.js';
import { createRuntimeTicketPort } from '../../providers/index.js';
import { loadWorkspaceEnvironment } from '../../setup/index.js';
import { ewokbotWorkspaceConfigPath } from '../../workspace-layout.js';
import type { TicketPort } from '../../ports/ticket-port.js';
import type { CliProgramIO, CliRuntimeMcpOptions } from '../program.js';

export interface ScanCommandOptions {
  readonly args?: readonly string[] | undefined;
  readonly configPath?: string;
  readonly cwd?: string;
  readonly io: CliProgramIO;
  readonly runtimeMcp?: CliRuntimeMcpOptions | undefined;
}

export async function runScanCommand(options: ScanCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveScanConfigPath(cwd, options.configPath);
  const environment = loadWorkspaceEnvironment(cwd);
  const config = await loadWorkspaceConfig(configPath, { workspaceRoot: cwd });
  const jira = await createRuntimeTicketPort({
    config,
    environment,
    requiredJiraMcpActions: ['listBacklog', 'getTicket'],
    ...options.runtimeMcp
  });
  const command = parseScanCommandArgs(options.args ?? []);

  switch (command.kind) {
    case 'backlog': {
      const tickets = await jira.listBacklog();
      printTicketList(options.io, `Found ${tickets.length} Jira backlog tickets:`, tickets);
      return 0;
    }
    case 'jql': {
      const tickets = await jira.searchByJql(command.jql);
      printTicketList(options.io, `Found ${tickets.length} Jira tickets for JQL: ${command.jql}`, tickets);
      return 0;
    }
    case 'epic': {
      const tickets = await collectRelatedChildren(jira, command.ticketKey);
      printTicketList(options.io, `Found ${tickets.length} child Jira tickets for ${command.ticketKey}:`, tickets);
      return 0;
    }
    case 'ticket': {
      const root = await jira.getTicket(command.ticketKey);
      const children = await collectRelatedChildren(jira, command.ticketKey);
      const blockers = await collectBlockingTickets(jira, command.ticketKey);

      options.io.stdout(`Jira ticket: ${root.ref.key} [${root.priority}] ${root.summary}\n`);
      options.io.stdout(`Status: ${root.status}\n`);
      options.io.stdout(`URL: ${root.ref.url}\n\n`);
      printTicketList(options.io, `Children (${children.length}):`, children);
      options.io.stdout('\n');
      printTicketList(options.io, `Potential blockers (${blockers.length}):`, blockers);
      return 0;
    }
  }
}

type ParsedScanCommand =
  | { readonly kind: 'backlog' }
  | { readonly kind: 'jql'; readonly jql: string }
  | { readonly kind: 'epic'; readonly ticketKey: string }
  | { readonly kind: 'ticket'; readonly ticketKey: string };

function parseScanCommandArgs(args: readonly string[]): ParsedScanCommand {
  if (args.length === 0) {
    return { kind: 'backlog' };
  }

  if (args[0] === 'jql') {
    const jql = args.slice(1).join(' ').trim();
    if (jql.length === 0) {
      throw new Error('Missing JQL. Usage: ewokbot scan jql "<query>"');
    }
    return { kind: 'jql', jql };
  }

  if (args[0] === 'epic') {
    const ticketKey = args[1]?.trim();
    if (ticketKey === undefined || ticketKey.length === 0) {
      throw new Error('Missing epic key. Usage: ewokbot scan epic <ticket-key>');
    }
    return { kind: 'epic', ticketKey };
  }

  if (args[0] === 'ticket') {
    const ticketKey = args[1]?.trim();
    if (ticketKey === undefined || ticketKey.length === 0) {
      throw new Error('Missing ticket key. Usage: ewokbot scan ticket <ticket-key>');
    }
    return { kind: 'ticket', ticketKey };
  }

  throw new Error(`Unknown scan subcommand: ${args[0]}`);
}

async function collectRelatedChildren(ticketPort: TicketPort, ticketKey: string): Promise<readonly DeliveryTicket[]> {
  const candidateQueries = [
    `"Epic Link" = ${ticketKey} ORDER BY Rank ASC`,
    `parent = ${ticketKey} ORDER BY Rank ASC`,
    `"Parent Link" = ${ticketKey} ORDER BY Rank ASC`
  ];

  return collectUnion(ticketPort, candidateQueries);
}

async function collectBlockingTickets(ticketPort: TicketPort, ticketKey: string): Promise<readonly DeliveryTicket[]> {
  const candidateQueries = [
    `issue in linkedIssues("${ticketKey}", "is blocked by") ORDER BY updated DESC`,
    `issue in linkedIssues("${ticketKey}", "blocks") ORDER BY updated DESC`,
    `issue in linkedIssues("${ticketKey}") ORDER BY updated DESC`
  ];

  return collectUnion(ticketPort, candidateQueries);
}

async function collectUnion(ticketPort: TicketPort, queries: readonly string[]): Promise<readonly DeliveryTicket[]> {
  const ticketsByKey = new Map<string, DeliveryTicket>();
  const errors: Error[] = [];

  for (const query of queries) {
    try {
      const tickets = await ticketPort.searchByJql(query);
      for (const ticket of tickets) {
        ticketsByKey.set(ticket.ref.key, ticket);
      }
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error);
      }
    }
  }

  if (ticketsByKey.size === 0 && errors.length === queries.length) {
    throw errors[0];
  }

  return [...ticketsByKey.values()];
}

function printTicketList(io: CliProgramIO, header: string, tickets: readonly DeliveryTicket[]): void {
  io.stdout(`${header}\n`);

  for (const ticket of tickets) {
    io.stdout(`- ${ticket.ref.key} [${ticket.priority}] ${ticket.summary}\n`);
  }
}

function resolveScanConfigPath(cwd: string, configPath: string | undefined): string {
  if (configPath !== undefined) {
    return resolve(cwd, configPath);
  }

  return resolve(cwd, ewokbotWorkspaceConfigPath);
}
