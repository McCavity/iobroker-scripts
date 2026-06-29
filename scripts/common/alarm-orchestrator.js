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
const DEVICE_ID = 'office';                // Standort des Buttons (Slice 2: war 'werkstatt')
const SOURCES = ['test', 'grafana'];      // beide Quellen aktiv
const PERSIST = -1;                        // rbhapp01: duration -1 = dauerhaft bis nächstes Signal
const SONOFF_BEACON = 'sonoff.0.Alarm.POWER';  // rote Rundumleuchte — folgt dem Signaltower-fast_blink
const MQTT_TOPIC = 'alarmbutton/' + DEVICE_ID + '/';    // Slice 2: Publish via mqtt.0-Messagebox (sendMessage2Client)
const HEARTBEAT_MS = 15000;                // Slice 2: Lebenszeichen + list-Republish (retain=false-Workaround)

let currentState = { alarms: [] };         // im Speicher (spart getState aufs state-DP)

// Datenpunkte idempotent anlegen (auch die sources, damit Reads nie ins Leere laufen)
createState(DP + 'ack', false, { name: 'alerting ack', type: 'boolean', role: 'button', read: true, write: true });
createState(DP + 'ack_one', '', { name: 'alerting ack_one', type: 'string', role: 'state', read: true, write: true });
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

// Slice 2: publish via mqtt.0-Messagebox. Ein Skript darf NICHT in den fremden
// mqtt.0.*-Namespace createState-en (State bleibt leer, kein Publish) — verifiziert
// 27.06. Der dokumentierte Weg ist sendMessage2Client (gegen den Prod-Broker getestet).
function publishMqtt(leg, payload) {
  sendTo('mqtt.0', 'sendMessage2Client', { topic: MQTT_TOPIC + leg, message: JSON.stringify(payload) });
}

// Lebenszeichen (Contract §3.3) + list-Republish, damit ein frisch gebooteter Button
// binnen HEARTBEAT_MS den aktuellen Stand bekommt (kompensiert retain=false).
function publishHeartbeat() {
  const grafanaOk = existsState(DP + 'grafana.ok') ? !!(getState(DP + 'grafana.ok') || {}).val : false;
  const lastOk = existsState(DP + 'grafana.last_ok') ? (getState(DP + 'grafana.last_ok') || {}).val : null;
  const ts = new Date().toISOString();
  const ageS = lastOk ? Math.round((Date.now() - new Date(lastOk).getTime()) / 1000) : null;
  publishMqtt('heartbeat', buildHeartbeat(grafanaOk, ageS, ts));
  publishMqtt('list', buildList(DEVICE_ID, currentState.alarms, ts));
}

function drive(ackPressed, ackId) {
  const out = computeOutputs(currentState, readSources(),
    { ack: !!ackPressed, ackId: ackId, mode: readMode(), ts: new Date().toISOString(), deviceId: DEVICE_ID });
  currentState = out.state;
  setState(DP + 'state', JSON.stringify(out.state), true);
  driveSignaltower(out.signaltower);
  driveBeacon(out.signaltower);
  out.telegrams.forEach(msg => sendTo('telegram.0', { text: msg }));
  // MQTT-Publish (Slice 2): list bei jeder Änderung, new nur bei neuer/eskalierter Attention.
  publishMqtt('list', out.mqtt.list);
  if (out.mqtt.new) publishMqtt('new', out.mqtt.new);
  log('alarm-orchestrator: ' + out.state.alarms.length + ' Alarm(e), ST=' + JSON.stringify(out.signaltower)
    + (out.telegrams.length ? ', TG=' + out.telegrams.length : ''));
}

// Subscriptions + initialer Reconcile erst NACH createState-Settle (vermeidet Startup-Race)
function ready() {
  currentState = readJson(DP + 'state', { alarms: [] });   // letzten Stand laden (Restart-fest)
  SOURCES.forEach(s => on({ id: DP + 'sources.' + s }, () => drive(false)));
  on({ id: DP + 'ack', val: true }, () => { drive(true); setState(DP + 'ack', false, true); });
  on({ id: DP + 'ack_one', change: 'ne' }, () => {
    const id = String((getState(DP + 'ack_one') || {}).val || '');
    if (!id) return;                          // Reset-Schreibung ('') ignorieren
    drive(false, id);
    setState(DP + 'ack_one', '', true);       // Reset, analog zum ack→false
  });
  on({ id: DP + 'mode' }, () => drive(false));
  drive(false);   // initialer Reconcile gegen die aktuellen Quellen
  setInterval(publishHeartbeat, HEARTBEAT_MS);  // Slice 2: periodisches Lebenszeichen + list-Republish
  publishHeartbeat();                            // sofort ein erstes Lebenszeichen
  log('alarm-orchestrator bereit');
}
setTimeout(ready, 2000);
log('alarm-orchestrator gestartet (init…)');
