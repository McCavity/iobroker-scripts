const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../scripts/global/drucker-core.js');

const T0 = Date.parse('2026-10-30T12:00:00Z');
const S = 1000, MIN = 60 * S;
const ok = (state, extra = {}) => Object.assign({ state, webhooks: 'ready' }, extra);
const plugOn = (watts) => ({ power: true, watts });

// Mehrere Ticks hintereinander; liefert das letzte Ergebnis.
function run(steps) {
  let mem = D.initialMemory();
  let r;
  for (const [t, moon, plug] of steps) {
    r = D.tick({ now: t, moon, plug, mem });
    mem = r.mem;
  }
  return r;
}

test('Klipper-Zustände → Weiß', () => {
  assert.equal(run([[T0, ok('printing'), plugOn(200)]]).white, 'on');
  assert.equal(run([[T0, ok('paused'), plugOn(60)]]).white, 'fast_blink');
  assert.equal(run([[T0, ok('complete'), plugOn(10)]]).white, 'slow_blink');
  assert.equal(run([[T0, ok('cancelled'), plugOn(10)]]).white, 'off');
  assert.equal(run([[T0, ok('standby'), plugOn(5)]]).white, 'off');
});

test('fertig blinkt höchstens 20 Minuten', () => {
  const steps = [[T0, ok('printing'), plugOn(200)], [T0 + 10 * S, ok('complete'), plugOn(10)]];
  assert.equal(run([...steps, [T0 + 10 * S + 19 * MIN, ok('complete'), plugOn(10)]]).white, 'slow_blink');
  assert.equal(run([...steps, [T0 + 10 * S + 21 * MIN, ok('complete'), plugOn(10)]]).white, 'off');
});

test('fertig endet sofort beim nächsten Druckstart', () => {
  const r = run([[T0, ok('complete'), plugOn(10)], [T0 + 5 * MIN, ok('printing'), plugOn(300)]]);
  assert.equal(r.white, 'on');
  // ...und ein späteres complete blinkt wieder volle 20 Minuten
  const r2 = run([[T0, ok('complete'), plugOn(10)], [T0 + 30 * MIN, ok('printing'), plugOn(300)],
                  [T0 + 60 * MIN, ok('complete'), plugOn(10)], [T0 + 75 * MIN, ok('complete'), plugOn(10)]]);
  assert.equal(r2.white, 'slow_blink');
});

// Beleg 30.10.2026, 18:24: Der QIDI setzt print_stats 9 s nach Druckende von printing direkt
// auf standby zurück (Dateiname leer). „complete“ ist beim 10-s-Takt praktisch nie zu sehen;
// Quelle für „fertig“ ist deshalb der letzte Job aus der Moonraker-Historie.
const done = (endMs, status = 'completed') => ({ state: 'standby', webhooks: 'ready', lastJob: { status, endMs } });

test('standby nach abgeschlossenem Job blinkt langsam, 20 Minuten ab Jobende', () => {
  const steps = [[T0, ok('printing'), plugOn(200)], [T0 + 10 * S, done(T0 + 1 * S), plugOn(15)]];
  const r = run(steps);
  assert.equal(r.white, 'slow_blink');
  assert.equal(r.status, 'fertig');
  assert.equal(run([...steps, [T0 + 19 * MIN, done(T0 + 1 * S), plugOn(15)]]).white, 'slow_blink');
  assert.equal(run([...steps, [T0 + 21 * MIN, done(T0 + 1 * S), plugOn(15)]]).white, 'off');
});

test('standby nach abgebrochenem Job bleibt aus', () => {
  assert.equal(run([[T0, done(T0 - 5 * S, 'cancelled'), plugOn(15)]]).white, 'off');
});

test('Skript-Neustart kurz nach Druckende blinkt weiter, alter Job nicht', () => {
  assert.equal(run([[T0, done(T0 - 5 * MIN), plugOn(15)]]).white, 'slow_blink');
  assert.equal(run([[T0, done(T0 - 3 * 60 * MIN), plugOn(15)]]).white, 'off');
});

test('complete mit Jobende zählt ab Jobende', () => {
  const r = run([[T0, Object.assign(ok('complete'), { lastJob: { status: 'completed', endMs: T0 - 21 * MIN } }), plugOn(15)]]);
  assert.equal(r.white, 'off');
});

test('Fehler braucht zwei Ticks (Entprellung), dann Alarm + Weiß aus', () => {
  const one = run([[T0, ok('printing'), plugOn(200)], [T0 + 10 * S, ok('error'), plugOn(50)]]);
  assert.equal(one.alarm, null);
  assert.equal(one.white, 'on');                      // erster Fehler-Tick hält noch
  const two = run([[T0, ok('printing'), plugOn(200)], [T0 + 10 * S, ok('error'), plugOn(50)],
                   [T0 + 20 * S, ok('error'), plugOn(50)]]);
  assert.equal(two.white, 'off');
  assert.ok(two.alarm);
  assert.equal(two.alarm.id, 'drucker-fehler');
  assert.equal(two.alarm.severity, 'warning');
  assert.equal(two.alarm.since, new Date(T0 + 10 * S).toISOString());   // Beginn, nicht Bestätigung
});

test('webhooks ≠ ready zählt als Fehler', () => {
  const r = run([[T0, { state: 'standby', webhooks: 'shutdown' }, plugOn(5)],
                 [T0 + 10 * S, { state: 'standby', webhooks: 'shutdown' }, plugOn(5)]]);
  assert.ok(r.alarm);
});

test('Entwarnung: Fehler weg → Alarm weg', () => {
  const r = run([[T0, ok('error'), plugOn(5)], [T0 + 10 * S, ok('error'), plugOn(5)],
                 [T0 + 20 * S, ok('standby'), plugOn(5)]]);
  assert.equal(r.alarm, null);
  assert.equal(r.white, 'off');
});

test('nicht erreichbar + Steckdose aus → sofort aus, Alarm weg', () => {
  const r = run([[T0, ok('error'), plugOn(5)], [T0 + 10 * S, ok('error'), plugOn(5)],
                 [T0 + 20 * S, null, { power: false, watts: 0 }]]);
  assert.equal(r.white, 'off');
  assert.equal(r.alarm, null);
  assert.equal(r.status, 'aus');
});

test('nicht erreichbar + hohe Leistung → Zustand halten, auch lange', () => {
  const r = run([[T0, ok('printing'), plugOn(250)], [T0 + 10 * S, null, plugOn(250)],
                 [T0 + 30 * MIN, null, plugOn(120)]]);
  assert.equal(r.white, 'on');
  assert.match(r.status, /Netz weg/);
});

test('nicht erreichbar + niedrige Leistung → 90 s halten, dann aus', () => {
  const base = [[T0, ok('paused'), plugOn(60)], [T0 + 10 * S, null, plugOn(12)]];
  assert.equal(run([...base, [T0 + 10 * S + 80 * S, null, plugOn(12)]]).white, 'fast_blink');
  const r = run([...base, [T0 + 10 * S + 100 * S, null, plugOn(12)]]);
  assert.equal(r.white, 'off');
  assert.equal(r.status, 'nicht erreichbar');
});

test('Steckdose unbekannt verhält sich wie niedrige Leistung (fail-safe: nicht ewig halten)', () => {
  const r = run([[T0, ok('printing'), plugOn(250)], [T0 + 10 * S, null, { power: null, watts: null }],
                 [T0 + 200 * S, null, { power: null, watts: null }]]);
  assert.equal(r.white, 'off');
});

test('Rückkehr nach Netzausfall übernimmt den echten Zustand', () => {
  const r = run([[T0, ok('printing'), plugOn(250)], [T0 + 10 * S, null, plugOn(250)],
                 [T0 + 60 * S, ok('complete'), plugOn(20)]]);
  assert.equal(r.white, 'slow_blink');
});

test('Schwelle liegt zwischen gemessener Ruhe (≤16 W) und Druck-Tiefstwert (≥46 W)', () => {
  assert.ok(D.HEATING_W > 16 && D.HEATING_W < 46);
});
