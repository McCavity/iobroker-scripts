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

function applyAck(alarms) { return alarms.map(a => Object.assign({}, a, { acked: true })); }

function computeSignaltower(alarms) {
  if (alarms.some(a => !a.acked)) return { colour: 'AMBER', mode: 'fast_blink' };
  if (alarms.length > 0) return { colour: 'AMBER', mode: 'on' };
  return { mode: 'off' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SCHEMA_VERSION, severityRank, maxSeverity, mergeSources, reconcile, applyAck, computeSignaltower };
}
