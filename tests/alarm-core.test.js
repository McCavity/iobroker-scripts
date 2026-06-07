const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../scripts/global/alarm-core.js');

test('severityRank: critical > warning > info, unknown = warning (fail-safe)', () => {
  assert.equal(C.severityRank('critical'), 2);
  assert.equal(C.severityRank('warning'), 1);
  assert.equal(C.severityRank('info'), 0);
  assert.equal(C.severityRank('bogus'), 1);
  assert.equal(C.severityRank(undefined), 1);
});

test('maxSeverity: highest of set, null when empty', () => {
  assert.equal(C.maxSeverity([]), null);
  assert.equal(C.maxSeverity([{severity:'warning'},{severity:'critical'}]), 'critical');
  assert.equal(C.maxSeverity([{severity:'warning'},{severity:'info'}]), 'warning');
});

test('mergeSources: flattens, tags source, sorts critical-first then since-asc', () => {
  const merged = C.mergeSources({
    test: [{id:'t1', severity:'warning', since:'2026-06-07T08:00:00Z'}],
    grafana: [{id:'g1', severity:'critical', since:'2026-06-07T09:00:00Z'},
              {id:'g2', severity:'warning', since:'2026-06-07T07:00:00Z'}],
  });
  assert.deepEqual(merged.map(a => a.id), ['g1','g2','t1']);
  assert.equal(merged[0].source, 'grafana');
  assert.equal(merged[2].source, 'test');
});

test('reconcile: neuer Alarm → unacked + attention', () => {
  const r = C.reconcile([], [{id:'a', severity:'warning'}]);
  assert.equal(r.alarms[0].acked, false);
  assert.deepEqual(r.attention.map(a=>a.id), ['a']);
  assert.deepEqual(r.resolved, []);
});

test('reconcile: bestehender acked Alarm bleibt acked, keine attention', () => {
  const prev = [{id:'a', severity:'warning', acked:true}];
  const r = C.reconcile(prev, [{id:'a', severity:'warning'}]);
  assert.equal(r.alarms[0].acked, true);
  assert.deepEqual(r.attention, []);
});

test('reconcile: Eskalation warning→critical setzt acked zurück + attention', () => {
  const prev = [{id:'a', severity:'warning', acked:true}];
  const r = C.reconcile(prev, [{id:'a', severity:'critical'}]);
  assert.equal(r.alarms[0].acked, false);
  assert.deepEqual(r.attention.map(a=>a.id), ['a']);
});

test('reconcile: Deeskalation critical→warning lässt acked bestehen', () => {
  const prev = [{id:'a', severity:'critical', acked:true}];
  const r = C.reconcile(prev, [{id:'a', severity:'warning'}]);
  assert.equal(r.alarms[0].acked, true);
  assert.deepEqual(r.attention, []);
});

test('reconcile: entfernter Alarm → resolved', () => {
  const prev = [{id:'a', severity:'warning', acked:false}];
  const r = C.reconcile(prev, []);
  assert.deepEqual(r.alarms, []);
  assert.deepEqual(r.resolved.map(a=>a.id), ['a']);
});
