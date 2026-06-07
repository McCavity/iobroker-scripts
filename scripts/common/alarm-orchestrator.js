/* iobroker-scripts-export
 * id:         script.js.common.alarm-orchestrator
 * name:       alarm-orchestrator
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Orchestrator: sources.* + ack + mode → computeOutputs (Global alarm-core)
// → Signaltower (Global signaltower-helpers) + rote Rundumleuchte + Test-Telegram + state.
const DP = '0_userdata.0.alerting.';
const DEVICE_ID = 'werkstatt';            // TODO Umsetzung: finalen Standort setzen
const SOURCES = ['test', 'grafana'];      // 'grafana' erst mit Slice 3 aktiv
const PERSIST = -1;                        // rbhapp01: duration -1 = dauerhaft bis nächstes Signal
const SONOFF_BEACON = 'sonoff.0.Alarm.POWER';  // rote Rundumleuchte — folgt dem Signaltower-fast_blink

let currentState = { alarms: [] };         // im Speicher (spart getState aufs state-DP)

// Datenpunkte idempotent anlegen (auch die sources, damit Reads nie ins Leere laufen)
createState(DP + 'ack', false, { name: 'alerting ack', type: 'boolean', role: 'button', read: true, write: true });
createState(DP + 'mode', 'normal', { name: 'alerting mode', type: 'string', role: 'state', read: true, write: true });
createState(DP + 'state', '{"alarms":[]}', { name: 'alerting state', type: 'string', role: 'json', read: true, write: true });
SOURCES.forEach(s => createState(DP + 'sources.' + s, '[]', { name: 'alerting sources.' + s, type: 'string', role: 'json', read: true, write: true }));

// existsState-Guard VOR getState → kein WARN auf (noch) nicht gesetzte States (battery-check-Lektion 27.05.)
function readJson(id, fallback) {
  if (!existsState(id)) return fallback;
  const st = getState(id);
  if (!st || st.val === null || st.val === undefined || st.val === '') return fallback;
  try { return JSON.parse(st.val); } catch (e) { return fallback; }
}
function readSources() {
  const map = {};
  SOURCES.forEach(s => { map[s] = readJson(DP + 'sources.' + s, []); });
  return map;
}
function readMode() {
  return existsState(DP + 'mode') ? String((getState(DP + 'mode') || {}).val || 'normal') : 'normal';
}
function driveSignaltower(st) {
  if (st.mode === 'off') signal('AMBER', 'off');
  else signal(st.colour, st.mode, PERSIST);
}
// Rote Rundumleuchte folgt dem Signaltower: AN nur bei sichtbar blinkendem Tower
// (st.mode === 'fast_blink' = unacked Alarm UND mode=normal). Bei Ack (solid),
// Entwarnung (off) und in away/maintenance (Tower unterdrückt) → aus. st ist der
// bereits mode-unterdrückte Signaltower-Output aus computeOutputs.
// Nur bei Wertänderung schreiben — sonst republished der Sonoff-Adapter jeden drive().
function driveBeacon(st) {
  if (!existsState(SONOFF_BEACON)) return;
  const want = st.mode === 'fast_blink';
  const cur = (getState(SONOFF_BEACON) || {}).val;
  if (cur !== want) setState(SONOFF_BEACON, want);
}

function drive(ackPressed) {
  const out = computeOutputs(currentState, readSources(),
    { ack: !!ackPressed, mode: readMode(), ts: new Date().toISOString(), deviceId: DEVICE_ID });
  currentState = out.state;
  setState(DP + 'state', JSON.stringify(out.state), true);
  driveSignaltower(out.signaltower);
  driveBeacon(out.signaltower);
  out.telegrams.forEach(msg => sendTo('telegram.0', { text: msg }));
  // MQTT-Publish: Slice 2 (hier bewusst noch nicht).
  log('alarm-orchestrator: ' + out.state.alarms.length + ' Alarm(e), ST=' + JSON.stringify(out.signaltower)
    + (out.telegrams.length ? ', TG=' + out.telegrams.length : ''));
}

// Subscriptions + initialer Reconcile erst NACH createState-Settle (vermeidet Startup-Race)
function ready() {
  currentState = readJson(DP + 'state', { alarms: [] });   // letzten Stand laden (Restart-fest)
  SOURCES.forEach(s => on({ id: DP + 'sources.' + s }, () => drive(false)));
  on({ id: DP + 'ack', val: true }, () => { drive(true); setState(DP + 'ack', false, true); });
  on({ id: DP + 'mode' }, () => drive(false));
  drive(false);   // initialer Reconcile gegen die aktuellen Quellen
  log('alarm-orchestrator bereit');
}
setTimeout(ready, 2000);
log('alarm-orchestrator gestartet (init…)');
