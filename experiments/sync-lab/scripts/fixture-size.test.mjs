import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSize } from './fixture-size.mjs';

test('通常試験へ一万行を混ぜず、負荷測定は一文書に限定する', () => {
  assert.equal(fixtureSize('test-example', false), 30);
  assert.equal(fixtureSize('benchmark-10000', true), 10000);
  assert.throws(() => fixtureSize('benchmark-10000', false));
  assert.throws(() => fixtureSize('test-example', true));
  assert.throws(() => fixtureSize('benchmark-99999999', true));
});
