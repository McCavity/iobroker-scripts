/* iobroker-scripts-export
 * id:         script.js.global.drucker-core
 * name:       drucker-core
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Pure Zustandslogik 3D-Drucker → weiße Lampe der Signalsäule + Alarmquelle.
// KEINE ioBroker-Globals zur Ladezeit (node-testbar, tests/drucker-core.test.js).
// Konsument: common/drucker-status (Polling, Signalsäule, Datenpunkte).
//
// Belegung (entschieden 30.10.2026):
//   printing → an · paused → schnell blinkend · complete → langsam blinkend
//   („fertig, Platte tauschen“, endet beim nächsten Druckstart oder nach 20 min)
//   · cancelled/standby → aus · error bzw. webhooks ≠ ready → aus + Alarm
//   (zwei Ticks Entprellung, Ethernet des Druckers flattert).
// Drucker nicht erreichbar → Steckdose entscheidet: aus → aus; Leistung ≥ HEATING_W
// → Zustand halten (Druck läuft vermutlich weiter); sonst 90 s halten, dann aus.
//
// „fertig“ kommt aus moon.lastJob ({status, endMs}, letzter Job der Moonraker-Historie):
// der QIDI setzt print_stats 9 s nach Druckende von printing direkt auf standby zurück
// (gemessen 30.10.2026, 18:24) — „complete“ ist beim 10-s-Takt praktisch nie zu sehen.
// Die 20 min zählen ab Jobende; so überlebt „fertig“ auch einen Skript-Neustart.

const DRUCKER_HEATING_W = 40;            // gemessen 23.–30.10.: Ruhe ≤ 16 W, Druck-Tiefstwert 46 W
const DRUCKER_HOLD_LOW_MS = 90 * 1000;   // Link-Aussetzer gemessen 9–35 s
const DRUCKER_COMPLETE_MS = 20 * 60 * 1000;
const DRUCKER_ERROR_TICKS = 2;
const DRUCKER_ALARM_ID = 'drucker-fehler';

function druckerInitialMemory() {
  return { white: 'off', status: 'unbekannt', alarm: null,
           unreachableSince: null, completeSince: null, errorTicks: 0, errorSince: null };
}

function druckerFinishedAt(moon) {
  const j = moon.lastJob;
  return j && j.status === 'completed' && typeof j.endMs === 'number' ? j.endMs : null;
}

function druckerTick({ now, moon, plug, mem }) {
  const m = Object.assign(druckerInitialMemory(), mem || {});
  const p = plug || {};
  const out = (white, status, alarm) =>
    ({ white, status, alarm, mem: Object.assign(m, { white, status, alarm }) });

  if (!moon) {
    if (m.unreachableSince === null) m.unreachableSince = now;
    if (p.power === false) return out('off', 'aus', null);
    if (typeof p.watts === 'number' && p.watts >= DRUCKER_HEATING_W)
      return out(m.white, 'Netz weg, Druck läuft vermutlich', m.alarm);
    if (now - m.unreachableSince < DRUCKER_HOLD_LOW_MS)
      return out(m.white, 'Netz weg, halte Zustand', m.alarm);
    return out('off', 'nicht erreichbar', null);
  }
  m.unreachableSince = null;

  const failed = moon.webhooks !== 'ready' || moon.state === 'error';
  if (failed) {
    if (m.errorTicks === 0) m.errorSince = now;
    m.errorTicks += 1;
    if (m.errorTicks < DRUCKER_ERROR_TICKS) return out(m.white, m.status, m.alarm);
    const alarm = {
      id: DRUCKER_ALARM_ID,
      name: '3D-Drucker: Fehler',
      severity: 'warning',
      summary: moon.message ? String(moon.message).slice(0, 120)
                            : `Klipper ${moon.webhooks}/${moon.state}`,
      since: new Date(m.errorSince).toISOString(),
    };
    m.completeSince = null;
    return out('off', 'fehler', alarm);
  }
  m.errorTicks = 0;
  m.errorSince = null;

  switch (moon.state) {
    case 'printing':
      m.completeSince = null;
      return out('on', 'druckt', null);
    case 'paused':
      return out('fast_blink', 'pausiert', null);
    case 'complete':
    case 'standby': {
      const end = druckerFinishedAt(moon);
      if (end !== null) m.completeSince = Math.min(end, now);
      else if (moon.state === 'complete' && m.completeSince === null) m.completeSince = now;
      else if (moon.state === 'standby') m.completeSince = null;
      if (m.completeSince !== null && now - m.completeSince < DRUCKER_COMPLETE_MS)
        return out('slow_blink', 'fertig', null);
      return out('off', 'bereit', null);
    }
    case 'cancelled':
      m.completeSince = null;
      return out('off', 'abgebrochen', null);
    default:
      return out('off', 'bereit', null);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HEATING_W: DRUCKER_HEATING_W, HOLD_LOW_MS: DRUCKER_HOLD_LOW_MS, COMPLETE_MS: DRUCKER_COMPLETE_MS,
    initialMemory: druckerInitialMemory, tick: druckerTick,
  };
}
