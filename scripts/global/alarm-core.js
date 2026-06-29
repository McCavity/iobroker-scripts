/* iobroker-scripts-export
 * id:         script.js.global.alarm-core
 * name:       alarm-core
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Pure Alarm-Orchestrator-Logik. KEINE ioBroker-Globals zur Ladezeit (node-testbar).
// In ioBroker als Global-Skript: die Funktionen liegen damit im Scope aller Skripte.
const SCHEMA_VERSION = 1;
const SEV_RANK = { info: 0, warning: 1, critical: 2 };

function severityRank(sev) {
  return Object.prototype.hasOwnProperty.call(SEV_RANK, sev) ? SEV_RANK[sev] : SEV_RANK.warning;
}

function maxSeverity(alarms) {
  let best = null;
  for (const a of alarms) if (best === null || severityRank(a.severity) > severityRank(best)) best = a.severity;
  return best;
}

function mergeSources(sourcesMap) {
  const out = [];
  for (const src of Object.keys(sourcesMap || {}))
    for (const a of (sourcesMap[src] || [])) out.push(Object.assign({}, a, { source: a.source || src }));
  out.sort((x, y) => severityRank(y.severity) - severityRank(x.severity)
    || String(x.since || '').localeCompare(String(y.since || '')));
  return out;
}

// Überträgt Ack-Zustand aus prev auf die neue Menge; erkennt Eskalation (acked-Reset)
// und Resolve (in prev, nicht mehr in new).
function reconcile(prevAlarms, mergedAlarms) {
  const prevById = new Map((prevAlarms || []).map(a => [a.id, a]));
  const newIds = new Set(mergedAlarms.map(a => a.id));
  const attention = [];
  const alarms = mergedAlarms.map(a => {
    const prev = prevById.get(a.id);
    if (!prev) { attention.push(a); return Object.assign({}, a, { acked: false }); }
    const escalated = severityRank(a.severity) > severityRank(prev.severity);
    if (escalated) attention.push(a);
    return Object.assign({}, a, { acked: escalated ? false : !!prev.acked });
  });
  const resolved = (prevAlarms || []).filter(a => !newIds.has(a.id));
  return { alarms, attention, resolved };
}

// id (optional): nicht-leerer String → nur dieser Alarm acked (Einzel-Quittierung, Phase 1b);
// fehlend/leer → alle acked (ack_all, rückwärtskompatibel). Unbekannte id → No-op. Stets Kopien.
function applyAck(alarms, id) {
  const all = !(typeof id === 'string' && id);
  return alarms.map(a => (all || a.id === id)
    ? Object.assign({}, a, { acked: true })
    : Object.assign({}, a));
}

function computeSignaltower(alarms) {
  if (alarms.some(a => !a.acked)) return { colour: 'AMBER', mode: 'fast_blink' };
  if (alarms.length > 0) return { colour: 'AMBER', mode: 'on' };
  return { mode: 'off' };
}

function buildList(deviceId, alarms, ts) {
  return {
    schema_version: SCHEMA_VERSION, device_id: deviceId, ts,
    count: alarms.length, max_severity: maxSeverity(alarms),
    alarms: alarms.map(a => ({
      id: a.id, host: a.host, name: a.name, severity: a.severity,
      summary: a.summary || '', since: a.since || ts, runbook_url: a.runbook_url || null,
      acked: !!a.acked,   // Contract §3.1 (additiv, schema bleibt 1): Button kennt den Quittier-Stand
    })),
  };
}

function buildNew(attention, ts) {
  if (!attention.length) return null;
  return { schema_version: SCHEMA_VERSION, ts, count_new: attention.length, max_severity: maxSeverity(attention) };
}

// Contract §3.3 — Lebenszeichen + Poll-Status. poll_age_s aus dem Grafana-Poll
// (Slice 3: grafana.ok + Sekunden seit grafana.last_ok). Fehlend → null (nie raten).
function buildHeartbeat(grafanaOk, pollAgeS, ts) {
  return {
    schema_version: SCHEMA_VERSION, ts,
    grafana_ok: !!grafanaOk,
    poll_age_s: (typeof pollAgeS === 'number' && isFinite(pollAgeS)) ? Math.floor(pollAgeS) : null,
  };
}

function buildTestTelegram(kind, alarm) {
  const sev = alarm ? alarm.severity : '';
  if (kind === 'fired')     return `🔔 TEST-Alarm (${sev}) ausgelöst — Selbsttest Alarmkette`;
  if (kind === 'escalated') return `🔔 TEST-Alarm eskaliert auf ${sev}`;
  if (kind === 'resolved')  return `✅ TEST-Alarm Entwarnung — Selbsttest beendet`;
  return '';
}

// Integration: prev-State + Quellen + Ack + Mode → { state, signaltower, mqtt, telegrams }.
// Mode-Hook: away/maintenance unterdrücken physische/hörbare Ausgänge (signaltower + new-Beep),
// Test-Telegram + state-Wahrheit bleiben.
function computeOutputs(prevState, sourcesMap, opts) {
  const ts = opts.ts, deviceId = opts.deviceId, mode = opts.mode || 'normal';
  const prevAlarms = (prevState && prevState.alarms) || [];
  const merged = mergeSources(sourcesMap);
  let { alarms, attention, resolved } = reconcile(prevAlarms, merged);
  // Präzedenz: opts.ackId (Einzel, Phase 1b) vor opts.ack (alle). Beide leer → kein Ack.
  if (opts.ackId) alarms = applyAck(alarms, opts.ackId);
  else if (opts.ack) alarms = applyAck(alarms);
  const telegrams = [];
  for (const a of attention) if (a.source === 'test') {
    const wasPresent = prevAlarms.some(p => p.id === a.id);
    telegrams.push(buildTestTelegram(wasPresent ? 'escalated' : 'fired', a));
  }
  for (const a of resolved) if (a.source === 'test') telegrams.push(buildTestTelegram('resolved', a));
  const physical = (mode === 'normal');
  return {
    state: { alarms },
    signaltower: physical ? computeSignaltower(alarms) : { mode: 'off' },
    mqtt: { list: buildList(deviceId, alarms, ts), new: physical ? buildNew(attention, ts) : null },
    telegrams,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_VERSION, severityRank, maxSeverity, mergeSources, reconcile, applyAck,
    computeSignaltower, buildList, buildNew, buildHeartbeat, buildTestTelegram, computeOutputs,
  };
}
