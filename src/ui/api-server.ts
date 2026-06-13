import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import {
  applyInvocationControlConfigPatch,
  applyInvocationControlStagingMappingPatch,
  buildInvocationControlSummary,
  inspectInvocationControlRun,
  InvocationControlUpdateError,
  listInvocationControlTickets,
  readInvocationControlRailwayDiscovery,
  readInvocationControlReport,
  runInvocationControlDoctor,
  type InvocationControlBackendOptions,
  type UiConfigPatch,
  type UiRailwayMappingUpdatePatch
} from './backend.js';

export interface InvocationControlApiServer {
  readonly server: Server;
  readonly url: string;
  close(): Promise<void>;
}

export interface StartInvocationControlApiServerOptions extends InvocationControlBackendOptions {
  readonly hostname?: string | undefined;
  readonly port?: number | undefined;
  readonly allowedOrigin?: string | undefined;
}

export async function startInvocationControlApiServer(options: StartInvocationControlApiServerOptions): Promise<InvocationControlApiServer> {
  const hostname = options.hostname ?? '127.0.0.1';
  const server = createServer((request, response) => {
    void handleApiRequest(options, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, hostname, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    server,
    url: `http://${hostname}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    })
  };
}

async function handleApiRequest(options: StartInvocationControlApiServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'OPTIONS') {
      writeJson(response, 204, undefined, options.allowedOrigin);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/summary') {
      writeJson(response, 200, await buildInvocationControlSummary(options), options.allowedOrigin);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/doctor') {
      writeJson(response, 200, runInvocationControlDoctor(options.workspaceRoot), options.allowedOrigin);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/railway/discovery') {
      writeJson(response, 200, await readInvocationControlRailwayDiscovery(options), options.allowedOrigin);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/runs') {
      writeJson(response, 200, (await buildInvocationControlSummary(options)).runs, options.allowedOrigin);
      return;
    }

    const runMatch = /^\/api\/runs\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && runMatch !== null) {
      writeJson(response, 200, await inspectInvocationControlRun(options.workspaceRoot, decodeURIComponent(runMatch[1] ?? '')), options.allowedOrigin);
      return;
    }

    const reportMatch = /^\/api\/runs\/([^/]+)\/reports\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && reportMatch !== null) {
      writeJson(response, 200, await readInvocationControlReport(
        options.workspaceRoot,
        decodeURIComponent(reportMatch[1] ?? ''),
        decodeURIComponent(reportMatch[2] ?? '')
      ), options.allowedOrigin);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/scan') {
      writeJson(response, 200, { tickets: await listInvocationControlTickets(options) }, options.allowedOrigin);
      return;
    }

    if (request.method === 'PATCH' && url.pathname === '/api/config') {
      writeJson(response, 200, applyInvocationControlConfigPatch(options.workspaceRoot, await readJsonBody<UiConfigPatch>(request)), options.allowedOrigin);
      return;
    }

    const stagingMappingMatch = /^\/api\/repositories\/([^/]+)\/deployments\/staging$/u.exec(url.pathname);
    if (request.method === 'PUT' && stagingMappingMatch !== null) {
      writeJson(response, 200, applyInvocationControlStagingMappingPatch(
        options.workspaceRoot,
        decodeURIComponent(stagingMappingMatch[1] ?? ''),
        await readJsonBody<UiRailwayMappingUpdatePatch>(request)
      ), options.allowedOrigin);
      return;
    }

    writeJson(response, 404, { error: 'Not found' }, options.allowedOrigin);
  } catch (error) {
    if (error instanceof InvocationControlUpdateError) {
      writeJson(response, error.statusCode, error.payload, options.allowedOrigin);
      return;
    }

    writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) }, options.allowedOrigin);
  }
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString('utf8').trim();
  return (body.length === 0 ? {} : JSON.parse(body)) as T;
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown, allowedOrigin = 'http://127.0.0.1:3000'): void {
  response.statusCode = statusCode;
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}
