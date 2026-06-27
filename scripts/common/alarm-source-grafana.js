/* iobroker-scripts-export
 * id:         script.js.common.alarm-source-grafana
 * name:       alarm-source-grafana
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Slice 3: pollt den Grafana-Alertmanager (aktive Alarme) und mappt sie nach
// 0_userdata.0.alerting.sources.grafana — die deklarative Quelle, die der
// alarm-orchestrator bereits abonniert. Read-only gegen Grafana (token-frei,
// anonymer Viewer seit 28.05.). Schreibt zusätzlich grafana.ok / grafana.last_ok
// als Poll-Status (Rohstoff für den Slice-2-Heartbeat).
//
// Aufbau wie alarm-core: die reine mapGrafanaAlerts(raw, nowIso) hat KEINE
// ioBroker-Globals und ist via module.exports node-testbar. Der ioBroker-Adapter
// (createState/httpGet/setInterval) läuft NUR in ioBroker (else-Zweig).
//
// Defensiv (Eintracht-Logo-Lehre `undefined > N === false`):
//  - fehlende Felder fail-safe (severity → 'warning', host → instance → 'unknown')
//  - fingerprint Pflicht (ohne → Alarm überspringen + warnen, nie stumm verschlucken)
//  - suppressed/silenced wird verworfen (gehört nicht aufs Button-Listing)
//  - Poll-Fehler leert sources.grafana NICHT (sonst false-resolve aller Alarme →
//    Tower fälschlich aus); stattdessen grafana.ok=false als Stale-Signal.

const VALID_SEV = { info: true, warning: true, critical: true };

function mapGrafanaAlerts(raw, nowIso) {
  const alarms = [];
  const dropped = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const a of list) {
    const labels = (a && a.labels) || {};
    const ann = (a && a.annotations) || {};
    const state = (a && a.status && a.status.state) || 'active';
    if (state !== 'active') {
      dropped.push({ reason: 'not-active', state, fingerprint: a && a.fingerprint });
      continue;
    }
    if (!a || !a.fingerprint) {
      dropped.push({ reason: 'no-fingerprint', name: labels.alertname });
      continue;
    }
    const severity = VALID_SEV[labels.severity] ? labels.severity : 'warning';
    alarms.push({
      id: a.fingerprint,
      host: labels.host || labels.instance || 'unknown',
      name: labels.alertname || (ann.summary ? String(ann.summary).slice(0, 60) : 'unbenannter Alarm'),
      severity,
      summary: ann.summary || '',
      since: a.startsAt || nowIso,
      runbook_url: ann.runbook_url || null,
      source: 'grafana',
    });
  }
  return { alarms, dropped };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapGrafanaAlerts };
} else {
  // ===================== ioBroker-Adapter =====================
  const DP = '0_userdata.0.alerting.';
  const GRAFANA_URL = 'http://192.168.178.162:3000/api/alertmanager/grafana/api/v2/alerts';
  const POLL_MS = 15000;
  const TIMEOUT_MS = 5000;

  createState(DP + 'sources.grafana', '[]', { name: 'alerting sources.grafana', type: 'string', role: 'json', read: true, write: true });
  createState(DP + 'grafana.ok', false, { name: 'alerting grafana.ok', type: 'boolean', role: 'indicator.reachable', read: true, write: true });
  createState(DP + 'grafana.last_ok', '', { name: 'alerting grafana.last_ok', type: 'string', role: 'text', read: true, write: true });

  function setStateSafe(id, val) { if (existsState(id)) setState(id, val, true); }

  function poll() {
    httpGet(GRAFANA_URL, { timeout: TIMEOUT_MS }, (error, response) => {
      const statusCode = response && response.statusCode;
      if (error || statusCode !== 200) {
        log('alarm-source-grafana: Poll fehlgeschlagen rc=' + statusCode + ' err=' + error, 'warn');
        setStateSafe(DP + 'grafana.ok', false);
        return; // sources.grafana NICHT anfassen — Stale-Alarme bleiben, kein false-resolve
      }
      let raw;
      try {
        raw = JSON.parse((response && response.data) || '[]');
      } catch (e) {
        log('alarm-source-grafana: JSON-Parse-Fehler: ' + e, 'warn');
        setStateSafe(DP + 'grafana.ok', false);
        return;
      }
      const { alarms, dropped } = mapGrafanaAlerts(raw, new Date().toISOString());
      for (const d of dropped) {
        if (d.reason === 'no-fingerprint') log('alarm-source-grafana: Alarm ohne fingerprint übersprungen (' + d.name + ')', 'warn');
      }
      // Nur schreiben, wenn sich die Quelle wirklich geändert hat → kein 15-s-Churn
      // im Orchestrator (er dri-vet auf jede sources.grafana-Änderung).
      const next = JSON.stringify(alarms);
      const cur = existsState(DP + 'sources.grafana') ? (getState(DP + 'sources.grafana').val || '[]') : '[]';
      if (next !== cur) setStateSafe(DP + 'sources.grafana', next);
      setStateSafe(DP + 'grafana.ok', true);
      setStateSafe(DP + 'grafana.last_ok', new Date().toISOString());
    });
  }

  setInterval(poll, POLL_MS);
  poll(); // sofort beim Start, nicht erst nach POLL_MS warten
  log('alarm-source-grafana gestartet — Poll alle ' + (POLL_MS / 1000) + 's → ' + GRAFANA_URL, 'info');
}
