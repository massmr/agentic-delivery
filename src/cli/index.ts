#!/usr/bin/env node

import { createCliProgram } from './program.js';
import { createPublicCliRuntimeMcp } from './runtime-mcp.js';

const publicRuntimeMcp = createPublicCliRuntimeMcp();

try {
  process.exitCode = await createCliProgram({ runtimeMcp: publicRuntimeMcp.runtimeMcp }).run(process.argv);
} catch (error: unknown) {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await publicRuntimeMcp.close();
}
