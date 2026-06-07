/* iobroker-scripts-export
 * id:         script.js.common.alarm-orchestrator
 * name:       alarm-orchestrator
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Orchestrator: sources.* + ack + mode → computeOutputs (Global alarm-core)
// → Signaltower (Global signaltower-helpers) + Test-Telegram + state.
const DP = '0_userdata.0.alerting.';
const DEVICE_ID = 'werkstatt';            // TODO Umsetzung: finalen Standort setzen
const SOURCES = ['test', 'grafana'];      // 'grafana' erst mit Slice 3 aktiv
const PERSIST = -1;                        // rbhapp01: duration -1 = dauerhaft bis nächstes Signal

// Datenpunkte idempotent anlegen (auch die sources, damit Reads nie auf null laufen → kein WARN)
createState(DP + 'ack', false, { name: 'alerting ack', type: 'boolean', role: 'button', read: true, write: true });
createState(DP + 'mode', 'normal', { name: 'alerting mode', type: 'string', role: 'state', read: true, write: true });
createState(DP + 'state', '{"alarms":[]}', { name: 'alerting state', type: 'string', role: 'json', read: true, write: true });
SOURCES.forEach(s => createState(DP + 'sources.' + s, '[]', { name: 'alerting sources.' + s, type: 'string', role: 'json', read: true, write: true }));

function readJson(id, fallback) {
  const st = getState(id);
  if (!st || st.val === null || st.val === undefined || st.val === '') return fallback;
  try { return JSON.parse(st.val); } catch (e) { return fallback; }
}
function readSources() {
  const map = {};
  SOURCES.forEach(s => { map[s] = readJson(DP + 'sources.' + s, []); });
  return map;
}
function driveSignaltower(st) {
  if (st.mode === 'off') signal('AMBER', 'off');
  else signal(st.colour, st.mode, PERSIST);
}

function drive(ackPressed) {
  const out = computeOutputs(
    readJson(DP + 'state', { alarms: [] }),
    readSources(),
    { ack: !!ackPressed, mode: String(getState(DP + 'mode').val || 'normal'), ts: new Date().toISOString(), deviceId: DEVICE_ID }
  );
  setState(DP + 'state', JSON.stringify(out.state), true);
  driveSignaltower(out.signaltower);
  out.telegrams.forEach(msg => sendTo('telegram.0', { text: msg }));
  // MQTT-Publish: Slice 2 (hier bewusst noch nicht).
  log('alarm-orchestrator: ' + out.state.alarms.length + ' Alarm(e), ST=' + JSON.stringify(out.signaltower)
    + (out.telegrams.length ? ', TG=' + out.telegrams.length : ''));
}

SOURCES.forEach(s => on({ id: DP + 'sources.' + s, change: 'any' }, () => drive(false)));
on({ id: DP + 'ack', val: true }, () => { drive(true); setState(DP + 'ack', false, true); });
on({ id: DP + 'mode', change: 'any' }, () => drive(false));
log('alarm-orchestrator gestartet');
