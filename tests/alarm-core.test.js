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

test('computeOutputs: Test-Alarm fired → fast_blink, new gesetzt, Ereignis fired', () => {
  const r = C.computeOutputs({alarms:[]}, {test:[{id:'t1',host:'TEST',name:'Selbsttest',severity:'warning',since:TS}]},
    {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
  assert.ok(r.mqtt.new && r.mqtt.new.count_new === 1);
  assert.deepEqual(r.events.map(e => e.kind), ['fired']);
  assert.equal(r.events[0].alarm.id, 't1');
  assert.equal(r.state.alarms[0].acked, false);
});

test('computeOutputs: ack → signaltower on, kein new', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:false}]};
  const r = C.computeOutputs(prev, {test:[{id:'t1',host:'TEST',name:'n',severity:'warning'}]},
    {ack:true, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'on'});
  assert.equal(r.mqtt.new, null);
});

test('computeOutputs: Test-Alarm resolved → off, Ereignis resolved', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:false}]};
  const r = C.computeOutputs(prev, {test:[]}, {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {mode:'off'});
  assert.deepEqual(r.events.map(e => e.kind), ['resolved']);
});

test('computeOutputs: Eskalation warning→critical → Ereignis escalated', () => {
  const prev = {alarms:[{id:'t1',host:'TEST',name:'n',severity:'warning',source:'test',acked:true}]};
  const r = C.computeOutputs(prev, {test:[{id:'t1',host:'TEST',name:'n',severity:'critical'}]},
    {ack:false, mode:'normal', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
  assert.equal(r.mqtt.new.count_new, 1);
  assert.deepEqual(r.events.map(e => e.kind), ['escalated']);
  assert.equal(r.events[0].alarm.severity, 'critical');
});

test('computeOutputs: mode=away unterdrückt signaltower + new, Ereignisse bleiben', () => {
  const r = C.computeOutputs({alarms:[]}, {test:[{id:'t1',host:'TEST',name:'n',severity:'warning',since:TS}]},
    {ack:false, mode:'away', ts:TS, deviceId:'werkstatt'});
  assert.deepEqual(r.signaltower, {mode:'off'});
  assert.equal(r.mqtt.new, null);
  assert.equal(r.events.length, 1);
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

test('applyAck(id): nur der Match wird acked, übrige unverändert', () => {
  const out = C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], 'a');
  assert.equal(out.find(x => x.id === 'a').acked, true);
  assert.equal(out.find(x => x.id === 'b').acked, false);
});
test('applyAck(unbekannte id): No-op, keiner acked', () => {
  const out = C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], 'zzz');
  assert.ok(out.every(a => a.acked === false));
});
test('applyAck(leere/fehlende id): rückwärtskompatibel → alle acked', () => {
  assert.ok(C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], '').every(a => a.acked === true));
  assert.ok(C.applyAck([{id:'a',acked:false}], undefined).every(a => a.acked === true));
});

test('computeOutputs: ackId → nur der eine Alarm acked, fast_blink bleibt', () => {
  const prev = {alarms:[
    {id:'a',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
    {id:'b',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
  ]};
  const r = C.computeOutputs(prev, {grafana:[
    {id:'a',host:'H',name:'n',severity:'warning'},
    {id:'b',host:'H',name:'n',severity:'warning'},
  ]}, {ackId:'a', mode:'normal', ts:TS, deviceId:'office'});
  assert.equal(r.state.alarms.find(x => x.id === 'a').acked, true);
  assert.equal(r.state.alarms.find(x => x.id === 'b').acked, false);
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
});
test('computeOutputs: ackId hat Präzedenz vor ack (nur der eine, nicht alle)', () => {
  const prev = {alarms:[
    {id:'a',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
    {id:'b',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
  ]};
  const r = C.computeOutputs(prev, {grafana:[
    {id:'a',host:'H',name:'n',severity:'warning'},
    {id:'b',host:'H',name:'n',severity:'warning'},
  ]}, {ack:true, ackId:'a', mode:'normal', ts:TS, deviceId:'office'});
  assert.equal(r.state.alarms.find(x => x.id === 'a').acked, true);
  assert.equal(r.state.alarms.find(x => x.id === 'b').acked, false);
});

function manyAlarms(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    id: 'id' + String(i).padStart(3, '0'), host: 'host' + i, name: 'Alarmname Nummer ' + i,
    severity: i < 3 ? 'critical' : 'warning',
    summary: 'Eine typische Grafana-Zusammenfassung mit gut hundert Zeichen Länge, damit das Budget realistisch greift ' + i,
    since: '2026-09-23T10:00:00Z', acked: i % 2 === 0,
  });
  return out;
}

test('buildList: unter Budget → alles drin, omitted 0', () => {
  const l = C.buildList('office', manyAlarms(3), TS);
  assert.equal(l.count, 3);
  assert.equal(l.alarms.length, 3);
  assert.equal(l.omitted, 0);
  assert.equal(l.omitted_unacked, 0);
});

test('buildList: über Budget → kürzt vom Ende, zählt omitted + omitted_unacked, JSON paßt', () => {
  const all = manyAlarms(60);
  const l = C.buildList('office', all, TS, 7000);
  assert.ok(Buffer.byteLength(JSON.stringify(l), 'utf8') <= 7000);
  assert.ok(l.omitted > 0);
  assert.equal(l.count, l.alarms.length);                 // Invariante count ≡ alarms.length
  assert.equal(l.count + l.omitted, 60);
  const dropped = all.slice(l.alarms.length);
  assert.equal(l.omitted_unacked, dropped.filter(a => !a.acked).length);
  assert.deepEqual(l.alarms.map(a => a.id), all.slice(0, l.alarms.length).map(a => a.id)); // Reihenfolge = Sortierung
  assert.equal(l.max_severity, 'critical');
});

test('buildList: kritische Alarme fallen nie vor Warnungen heraus', () => {
  const l = C.buildList('office', manyAlarms(60), TS, 7000);
  assert.equal(l.alarms.filter(a => a.severity === 'critical').length, 3);
});

test('utf8Bytes: Umlaut und Emoji zählen mehrbytig', () => {
  assert.equal(C.utf8Bytes('aä🔴'), 1 + 2 + 4);
  assert.equal(unescape(encodeURIComponent('aä🔴')).length, 7);   // Fallback-Zweig, ohne Buffer
});

test('computeOutputs: Grafana-Alarm verschwindet per Silence → silenced, nicht resolved', () => {
  const prev = {alarms:[{id:'g1',host:'h',name:'n',severity:'warning',source:'grafana',acked:true}]};
  const r = C.computeOutputs(prev, {grafana:[]},
    {ack:false, mode:'normal', ts:TS, deviceId:'office', suppressedIds:['g1']});
  assert.deepEqual(r.events.map(e => e.kind), ['silenced']);
});

test('computeOutputs: quittierter Alarm ohne Änderung → keine Ereignisse', () => {
  const prev = {alarms:[{id:'g1',host:'h',name:'n',severity:'warning',source:'grafana',acked:true}]};
  const r = C.computeOutputs(prev, {grafana:[{id:'g1',host:'h',name:'n',severity:'warning'}]},
    {ack:false, mode:'normal', ts:TS, deviceId:'office'});
  assert.deepEqual(r.events, []);
});

test('collectEvents: quittierter Alarm, der endet → resolved (Entwarnung auch nach ACK)', () => {
  const ev = C.collectEvents([{id:'a',acked:true}], [], [{id:'a',acked:true}], []);
  assert.deepEqual(ev.map(e => e.kind), ['resolved']);
});

const A = (id, sev, extra) => Object.assign({id, host:'h'+id, name:'Alarm '+id, severity:sev}, extra || {});

test('formatDigest: leer → null', () => {
  assert.equal(C.formatDigest([], {}), null);
});

test('formatDigest: gliedert neu / eskaliert / OK / stumm in fester Reihenfolge, mit Präfix', () => {
  const txt = C.formatDigest([
    {kind:'resolved', alarm:A('1','warning')},
    {kind:'fired', alarm:A('2','critical')},
    {kind:'silenced', alarm:A('3','warning')},
    {kind:'escalated', alarm:A('4','critical')},
  ], {prefix:'[neu] '});
  assert.ok(txt.startsWith('[neu] '));
  const iNew = txt.indexOf('🔴'), iEsc = txt.indexOf('⬆️'), iOk = txt.indexOf('✅'), iMute = txt.indexOf('🔕');
  assert.ok(iNew >= 0 && iNew < iEsc && iEsc < iOk && iOk < iMute);
  assert.match(txt, /h2: Alarm 2 \(critical\)/);
});

test('formatDigest: feuert und endet im selben Fenster → beide Zeilen', () => {
  const txt = C.formatDigest([{kind:'fired', alarm:A('1','warning')}, {kind:'resolved', alarm:A('1','warning')}], {});
  assert.match(txt, /🔴/);
  assert.match(txt, /✅/);
});

test('formatDigest: Obergrenze → "… und N weitere"', () => {
  const ev = [];
  for (let i = 0; i < 22; i++) ev.push({kind:'fired', alarm:A(String(i),'warning')});
  const txt = C.formatDigest(ev, {max:15});
  assert.match(txt, /… und 7 weitere/);
  assert.equal((txt.match(/^🔴 h/gm) || []).length, 15);
});

test('formatOpenList: Titel, Zählung unquittiert, Obergrenze', () => {
  const alarms = [A('1','critical',{acked:false}), A('2','warning',{acked:true})];
  const txt = C.formatOpenList('⏰ Erinnerung', alarms, {prefix:'[neu] '});
  assert.ok(txt.startsWith('[neu] ⏰ Erinnerung'));
  assert.match(txt, /2 offen, davon 1 unquittiert/);
  assert.match(txt, /h1: Alarm 1 \(critical\)/);
});

test('touchesUnacked: nur fired/escalated setzen den Erinnerungstakt zurück', () => {
  assert.equal(C.touchesUnacked([{kind:'resolved'}, {kind:'silenced'}]), false);
  assert.equal(C.touchesUnacked([{kind:'resolved'}, {kind:'fired'}]), true);
  assert.equal(C.touchesUnacked([{kind:'escalated'}]), true);
});
