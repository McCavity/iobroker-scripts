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
const LIST_MAX_BYTES = 7000;   // unter dem 8192-Byte-MQTT-Puffer des Buttons (MqttLink.h)
const SEV_RANK = { info: 0, warning: 1, critical: 2 };
const REMINDER_MS = 4 * 3600 * 1000;
const GRAFANA_DOWN_MS = 5 * 60 * 1000;

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

// UTF-8-Bytelänge ohne Annahme über den Sandbox-Scope: Buffer, falls vorhanden, sonst
// encodeURIComponent-Zählung (Umlaute/Emoji zählen dann ebenfalls mehrbytig).
function utf8Bytes(s) {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8');
  return unescape(encodeURIComponent(s)).length;
}

function listEntry(a, ts) {
  return {
    id: a.id, host: a.host, name: a.name, severity: a.severity,
    summary: a.summary || '', since: a.since || ts, runbook_url: a.runbook_url || null,
    acked: !!a.acked,   // Contract §3.1 (additiv, schema bleibt 1): Button kennt den Quittier-Stand
  };
}

// Byte-Budget: alarms[] kommt sortiert (critical zuerst, dann älteste zuerst). Bei Überlauf
// fallen die letzten Einträge heraus (= jüngste Warnungen) und werden ehrlich gezählt, statt
// den Button-Puffer still zu sprengen. count ≡ ausgelieferte alarms.length (Lehre 29.06.).
function buildList(deviceId, alarms, ts, maxBytes) {
  const budget = (typeof maxBytes === 'number') ? maxBytes : LIST_MAX_BYTES;
  const entries = alarms.map(a => listEntry(a, ts));
  const make = (n) => ({
    schema_version: SCHEMA_VERSION, device_id: deviceId, ts,
    count: n, max_severity: maxSeverity(alarms),
    omitted: alarms.length - n,
    omitted_unacked: alarms.slice(n).filter(a => !a.acked).length,
    alarms: entries.slice(0, n),
  });
  let n = entries.length;
  let out = make(n);
  while (n > 0 && utf8Bytes(JSON.stringify(out)) > budget) {
    n -= 1;
    out = make(n);
  }
  return out;
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

// Ereignisse für die Telegram-Sammelnachricht (Phase 2, Strang 3). Quelle ist reconcile():
// attention = neu ODER eskaliert (ACK-Reset nach ISA-18.2), resolved = nicht mehr gemeldet.
// Verschwindet ein Alarm, weil Grafana ihn per Silence unterdrückt, ist das KEIN OK.
function collectEvents(prevAlarms, attention, resolved, suppressedIds) {
  const prevIds = new Set((prevAlarms || []).map(a => a.id));
  const suppressed = new Set(suppressedIds || []);
  const events = [];
  for (const a of attention) events.push({ kind: prevIds.has(a.id) ? 'escalated' : 'fired', alarm: a });
  for (const a of resolved) events.push({ kind: suppressed.has(a.id) ? 'silenced' : 'resolved', alarm: a });
  return events;
}

// Integration: prev-State + Quellen + Ack + Mode → { state, signaltower, mqtt, events }.
// Mode-Hook: away/maintenance unterdrücken physische/hörbare Ausgänge (signaltower + new-Beep);
// Ereignisse + state-Wahrheit bleiben.
function computeOutputs(prevState, sourcesMap, opts) {
  const ts = opts.ts, deviceId = opts.deviceId, mode = opts.mode || 'normal';
  const prevAlarms = (prevState && prevState.alarms) || [];
  const merged = mergeSources(sourcesMap);
  let { alarms, attention, resolved } = reconcile(prevAlarms, merged);
  // Präzedenz: opts.ackId (Einzel, Phase 1b) vor opts.ack (alle). Beide leer → kein Ack.
  if (opts.ackId) alarms = applyAck(alarms, opts.ackId);
  else if (opts.ack) alarms = applyAck(alarms);
  const events = collectEvents(prevAlarms, attention, resolved, opts.suppressedIds);
  const physical = (mode === 'normal');
  return {
    state: { alarms },
    signaltower: physical ? computeSignaltower(alarms) : { mode: 'off' },
    mqtt: { list: buildList(deviceId, alarms, ts), new: physical ? buildNew(attention, ts) : null },
    events,
  };
}

const DIGEST_SECTIONS = [
  { kind: 'fired',     icon: '🔴', title: 'NEU' },
  { kind: 'escalated', icon: '⬆️', title: 'ESKALIERT' },
  { kind: 'resolved',  icon: '✅', title: 'OK' },
  { kind: 'silenced',  icon: '🔕', title: 'STUMM (Grafana-Silence)' },
];

function alarmLine(a) {
  return `${a.host}: ${a.name} (${a.severity})`;
}

// Eine Sammelnachricht je Auswertungsfenster. Feste Reihenfolge, damit das Wichtige oben steht.
function formatDigest(events, opts) {
  if (!events || !events.length) return null;
  const prefix = (opts && opts.prefix) || '';
  const max = (opts && opts.max) || 15;
  const lines = [];
  let shown = 0, hidden = 0;
  for (const sec of DIGEST_SECTIONS) {
    const inSec = events.filter(e => e.kind === sec.kind);
    if (!inSec.length) continue;
    lines.push(`${sec.icon} ${sec.title} (${inSec.length})`);
    for (const e of inSec) {
      if (shown < max) { lines.push(`${sec.icon} ${alarmLine(e.alarm)}`); shown++; }
      else hidden++;
    }
  }
  if (hidden) lines.push(`… und ${hidden} weitere`);
  return prefix + 'Alarmkette\n' + lines.join('\n');
}

// Erinnerung und „Wartung beendet": Zustand statt Ereignis.
function formatOpenList(title, alarms, opts) {
  const prefix = (opts && opts.prefix) || '';
  const max = (opts && opts.max) || 15;
  const unacked = alarms.filter(a => !a.acked).length;
  const lines = [`${prefix}${title} — ${alarms.length} offen, davon ${unacked} unquittiert`];
  alarms.slice(0, max).forEach(a => lines.push(`${a.acked ? '☑️' : '🔴'} ${alarmLine(a)}`));
  if (alarms.length > max) lines.push(`… und ${alarms.length - max} weitere`);
  return lines.join('\n');
}

function touchesUnacked(events) {
  return (events || []).some(e => e.kind === 'fired' || e.kind === 'escalated');
}

// Erinnerung nur für unquittierte Alarme; maintenance unterdrückt sie (away nicht).
// Fehlender Takt (Erstlauf) ist NICHT fällig — der Orchestrator initialisiert ihn beim Laden.
function dueReminder(notify, alarms, nowMs, mode, intervalMs) {
  if (mode === 'maintenance') return false;
  if (!notify || typeof notify.last_unacked_notify !== 'number') return false;
  if (!(alarms || []).some(a => !a.acked)) return false;
  const interval = (typeof intervalMs === 'number') ? intervalMs : REMINDER_MS;
  return nowMs - notify.last_unacked_notify >= interval;
}

// Gegenseitige Überwachung: Grafana tot, ioBroker lebt → der Orchestrator meldet es.
function grafanaWatch(prev, grafanaOk, nowMs, thresholdMs) {
  const limit = (typeof thresholdMs === 'number') ? thresholdMs : GRAFANA_DOWN_MS;
  const p = prev || { down_since: null, notified: false };
  if (grafanaOk) {
    return { next: { down_since: null, notified: false }, message: p.notified ? 'up' : null };
  }
  const since = (p.down_since === null || p.down_since === undefined) ? nowMs : p.down_since;
  if (!p.notified && nowMs - since >= limit) return { next: { down_since: since, notified: true }, message: 'down' };
  return { next: { down_since: since, notified: p.notified }, message: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEMA_VERSION, LIST_MAX_BYTES, REMINDER_MS, GRAFANA_DOWN_MS, severityRank, maxSeverity, mergeSources, reconcile, applyAck,
    computeSignaltower, buildList, buildNew, buildHeartbeat, collectEvents, computeOutputs, utf8Bytes,
    formatDigest, formatOpenList, touchesUnacked, alarmLine, dueReminder, grafanaWatch,
  };
}


