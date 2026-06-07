import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { message } from '../src/message.js';

test('message returns fixture text', () => {
  assert.equal(message(), 'hello from fixture');
});
