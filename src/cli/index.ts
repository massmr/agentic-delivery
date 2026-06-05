#!/usr/bin/env node

import { createCliProgram } from './program.js';
import { createPublicCliRuntimeMcp } from './runtime-mcp.js';
import { loadWorkspaceEnvironment } from '../setup/index.js';

const publicRuntimeMcp = createPublicCliRuntimeMcp({ environmentProvider: () => loadWorkspaceEnvironment(process.cwd()) });

try {
  process.exitCode = await createCliProgram({ runtimeMcp: publicRuntimeMcp.runtimeMcp }).run(process.argv);
} catch (error: unknown) {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await publicRuntimeMcp.close();
}
