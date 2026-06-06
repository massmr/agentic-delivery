import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { redactCommand, redactSensitiveText } from '../src/runners/opencode/redaction.js';

test('redactSensitiveText redacts auth-like fields without removing field names', () => {
  const text = 'access_token=fake-access-token refreshToken:fake-refresh client_secret=fake-client credential=fake-credential Authorization=Bearer fake-bearer';

  const redacted = redactSensitiveText(text);

  assert.match(redacted, /access_token=\[redacted\]/u);
  assert.match(redacted, /refreshToken:\[redacted\]/u);
  assert.match(redacted, /client_secret=\[redacted\]/u);
  assert.match(redacted, /credential=\[redacted\]/u);
  assert.match(redacted, /Authorization=\[redacted\]/u);
  assert.doesNotMatch(redacted, /fake-access-token|fake-refresh|fake-client|fake-credential|fake-bearer/u);
});

test('redactCommand redacts values following auth-like flags', () => {
  const command = redactCommand('ewokbot', ['auth', 'login', 'jira', '--access-token', 'fake-access-token', '--client-secret', 'fake-client']);

  assert.equal(command, 'ewokbot auth login jira --access-token [redacted] --client-secret [redacted]');
});
