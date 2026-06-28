const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../scripts/common/alarm-ack-bridge.js');

test('parseAckPayload: ack_all → valid, id null', () => {
  assert.deepEqual(B.parseAckPayload('{"schema_version":1,"action":"ack_all"}'),
    { valid: true, action: 'ack_all', id: null });
});
test('parseAckPayload: ack_one mit id → valid + id', () => {
  assert.deepEqual(B.parseAckPayload('{"action":"ack_one","id":"a1b2c3"}'),
    { valid: true, action: 'ack_one', id: 'a1b2c3' });
});
test('parseAckPayload: ack_one ohne id → valid, id null', () => {
  assert.deepEqual(B.parseAckPayload('{"action":"ack_one"}'),
    { valid: true, action: 'ack_one', id: null });
});
test('parseAckPayload: leerer String → invalid', () => {
  assert.deepEqual(B.parseAckPayload(''), { valid: false });
});
test('parseAckPayload: kein JSON → invalid', () => {
  assert.deepEqual(B.parseAckPayload('ack_all'), { valid: false });
});
test('parseAckPayload: JSON ohne action → invalid', () => {
  assert.deepEqual(B.parseAckPayload('{"schema_version":1}'), { valid: false });
});
test('parseAckPayload: unbekannte action → invalid', () => {
  assert.deepEqual(B.parseAckPayload('{"action":"reset"}'), { valid: false });
});
test('parseAckPayload: null (nicht-String) → invalid', () => {
  assert.deepEqual(B.parseAckPayload(null), { valid: false });
});
test('parseAckPayload: JSON-Array → invalid (kein action-Objekt)', () => {
  assert.deepEqual(B.parseAckPayload('[1,2,3]'), { valid: false });
});
