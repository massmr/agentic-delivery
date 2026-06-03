#!/usr/bin/env node

import { createCliProgram } from './program.js';

try {
  process.exitCode = await createCliProgram().run(process.argv);
} catch (error: unknown) {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`);
  process.exitCode = 1;
}
