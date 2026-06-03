import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCliProgram } from '../src/index.js';

test('agentic scan lists mock Jira backlog tickets', async () => {
  const captured = createCapturedIO();
  const exitCode = await createCliProgram({ configPath: 'config/workspace.example.yml', io: captured.io }).run(['node', 'agentic', 'scan']);

  assert.equal(exitCode, 0);
  assert.match(captured.stdout, /Found 2 mock Jira backlog tickets/u);
  assert.match(captured.stdout, /LK-101/u);
  assert.match(captured.stdout, /LK-102/u);
  assert.equal(captured.stderr, '');
});

function createCapturedIO() {
  let stdout = '';
  let stderr = '';

  return {
    io: {
      stdout(text: string) {
        stdout += text;
      },
      stderr(text: string) {
        stderr += text;
      }
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    }
  };
}
