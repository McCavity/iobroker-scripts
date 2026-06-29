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

test('applyAck: setzt acked=true auf alle', () => {
  const out = C.applyAck([{id:'a',acked:false},{id:'b',acked:false}]);
  assert.ok(out.every(a => a.acked === true));
});

test('computeSignaltower: unacked → AMBER fast_blink', () => {
  assert.deepEqual(C.computeSignaltower([{id:'a',acked:false}]), {colour:'AMBER', mode:'fast_blink'});
});
test('computeSignaltower: alle acked → AMBER on', () => {
  assert.deepEqual(C.computeSignaltower([{id:'a',acked:true}]), {colour:'AMBER', mode:'on'});
});
test('computeSignaltower: leer → off', () => {
  assert.deepEqual(C.computeSignaltower([]), {mode:'off'});
});

const TS = '2026-06-07T08:15:03Z';

test('buildList: Vertrags-Form', () => {
  const p = C.buildList('werkstatt', [{id:'a',host:'TEST',name:'n',severity:'warning',summary:'s',since:TS}], TS);
  assert.equal(p.schema_version, 1);
  assert.equal(p.device_id, 'werkstatt');
  assert.equal(p.count, 1);
  assert.equal(p.max_severity, 'warning');
  assert.deepEqual(p.alarms[0], {id:'a',host:'TEST',name:'n',severity:'warning',summary:'s',since:TS,runbook_url:null,acked:false});
});

test('buildList: acked-Flag wird durchgereicht (Contract §3.1, additiv) + fail-safe false', () => {
  const p = C.buildList('office', [
    {id:'a',host:'H',name:'n',severity:'critical',since:TS,acked:true},
    {id:'b',host:'H',name:'n',severity:'warning',since:TS,acked:false},
    {id:'c',host:'H',name:'n',severity:'warning',since:TS},   // acked fehlt → fail-safe false
  ], TS);
  assert.equal(p.alarms[0].acked, true);
  assert.equal(p.alarms[1].acked, false);
  assert.equal(p.alarms[2].acked, false);
});

test('buildNew: null wenn keine attention, sonst count+max', () => {
  assert.equal(C.buildNew([], TS), null);
  assert.deepEqual(C.buildNew([{severity:'critical'}], TS), {schema_version:1, ts:TS, count_new:1, max_severity:'critical'});
});

test('computeOutputs: Test-Alarm fired → fast_blink, new gesetzt, Test-Telegram 🔔', () => {
  const r = C.computeOutputs({alarms:[]}, {test:[{id:'t1',host:'TEST',name:'Selbsttest',severity:'warning',since:TS}]},
    {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
  assert.ok(r.mqtt.new && r.mqtt.new.count_new === 1);
  assert.equal(r.telegrams.length, 1);
  assert.match(r.telegrams[0], /🔔.*warning/);
  assert.equal(r.state.alarms[0].acked, false);
});

test('computeOutputs: ack → signaltower on, kein new', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:false}]};
  const r = C.computeOutputs(prev, {test:[{id:'t1',host:'TEST',name:'n',severity:'warning'}]},
    {ack:true, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'on'});
  assert.equal(r.mqtt.new, null);
});

test('computeOutputs: Test-Alarm resolved → off, Test-Telegram ✅', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:false}]};
  const r = C.computeOutputs(prev, {test:[]}, {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {mode:'off'});
  assert.equal(r.telegrams.length, 1);
  assert.match(r.telegrams[0], /✅/);
});

test('computeOutputs: Eskalation warning→critical → erneute attention + Telegram', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:true}]};
  const r = C.computeOutputs(prev, {test:[{id:'t1',host:'TEST',name:'n',severity:'critical'}]},
    {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
  assert.equal(r.mqtt.new.count_new, 1);
  assert.match(r.telegrams[0], /eskaliert auf critical/);
});

test('computeOutputs: mode=away unterdrückt signaltower + new, Telegram bleibt, state aktualisiert', () => {
  const r = C.computeOutputs({alarms:[]}, {test:[{id:'t1',host:'TEST',name:'n',severity:'warning',since:TS}]},
    {ack:false, mode:'away', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {mode:'off'});
  assert.equal(r.mqtt.new, null);
  assert.equal(r.telegrams.length, 1);
  assert.equal(r.state.alarms.length, 1);
});

test('buildHeartbeat: Contract §3.3 — schema_version, ts, grafana_ok, poll_age_s', () => {
  assert.deepEqual(C.buildHeartbeat(true, 2, TS), {
    schema_version: C.SCHEMA_VERSION, ts: TS, grafana_ok: true, poll_age_s: 2,
  });
});

test('buildHeartbeat: grafana_ok false wird durchgereicht (Stale-Signal)', () => {
  const hb = C.buildHeartbeat(false, 47, TS);
  assert.equal(hb.grafana_ok, false);
  assert.equal(hb.poll_age_s, 47);
});

test('buildHeartbeat: poll_age_s wird zu ganzer Zahl normalisiert, fehlend → null', () => {
  assert.equal(C.buildHeartbeat(true, 2.9, TS).poll_age_s, 2);
  assert.equal(C.buildHeartbeat(true, null, TS).poll_age_s, null);
  assert.equal(C.buildHeartbeat(true, undefined, TS).poll_age_s, null);
});
