const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../scripts/common/alarm-source-grafana.js');

const NOW = '2026-06-27T07:40:00.000Z';

// Realer Alertmanager-Alarm (Form vom 2026-06-07/17 verifiziert)
function activeAlert(over = {}) {
  return Object.assign({
    fingerprint: '66bab94fd590d22c',
    status: { state: 'active', silencedBy: [], inhibitedBy: [] },
    labels: {
      alertname: 'unpoller: keine UniFi-Daten',
      host: 'dckapp01',
      severity: 'warning',
      grafana_folder: 'Homelab',
    },
    annotations: {
      summary: 'dckapp01: unpoller liefert seit 11.06. keine UniFi-Daten',
      __value_string__: '[ var=B ]',
      __orgId__: '1',
    },
    startsAt: '2026-06-11T13:53:00.000+02:00',
  }, over);
}

test('mapGrafanaAlerts: aktiver Alarm → Contract-Eintrag (id=fingerprint, source=grafana)', () => {
  const { alarms, dropped } = G.mapGrafanaAlerts([activeAlert()], NOW);
  assert.equal(dropped.length, 0);
  assert.equal(alarms.length, 1);
  assert.deepEqual(alarms[0], {
    id: '66bab94fd590d22c',
    host: 'dckapp01',
    name: 'unpoller: keine UniFi-Daten',
    severity: 'warning',
    summary: 'dckapp01: unpoller liefert seit 11.06. keine UniFi-Daten',
    since: '2026-06-11T13:53:00.000+02:00',
    runbook_url: null,
    source: 'grafana',
  });
});

test('mapGrafanaAlerts: since reicht den +02:00-Offset durch (kein Z-Hardcoding)', () => {
  const { alarms } = G.mapGrafanaAlerts([activeAlert()], NOW);
  assert.equal(alarms[0].since, '2026-06-11T13:53:00.000+02:00');
});

test('mapGrafanaAlerts: nur annotations.summary, __*-Felder werden ignoriert', () => {
  const { alarms } = G.mapGrafanaAlerts([activeAlert()], NOW);
  assert.equal(alarms[0].summary, 'dckapp01: unpoller liefert seit 11.06. keine UniFi-Daten');
});

test('mapGrafanaAlerts: suppressed/silenced wird verworfen (nicht auf dem Button-Listing)', () => {
  const supp = activeAlert({
    fingerprint: 'deadbeefdeadbeef',
    status: { state: 'suppressed', silencedBy: ['silence-1'], inhibitedBy: [] },
    labels: { alertname: 'DatasourceNoData', host: 'iobapp02', severity: 'warning' },
  });
  const { alarms, dropped } = G.mapGrafanaAlerts([activeAlert(), supp], NOW);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].id, '66bab94fd590d22c');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'not-active');
  assert.equal(dropped[0].state, 'suppressed');
});

test('mapGrafanaAlerts: fehlender fingerprint → übersprungen + in dropped vermerkt', () => {
  const noFp = activeAlert({ fingerprint: undefined });
  const { alarms, dropped } = G.mapGrafanaAlerts([noFp], NOW);
  assert.equal(alarms.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].reason, 'no-fingerprint');
});

test('mapGrafanaAlerts: fehlender host → instance-Fallback → "unknown"', () => {
  const a1 = activeAlert({ fingerprint: 'aaaa', labels: { alertname: 'x', severity: 'warning', instance: 'host-x:9100' } });
  const a2 = activeAlert({ fingerprint: 'bbbb', labels: { alertname: 'y', severity: 'warning' } });
  const { alarms } = G.mapGrafanaAlerts([a1, a2], NOW);
  assert.equal(alarms.find(a => a.id === 'aaaa').host, 'host-x:9100');
  assert.equal(alarms.find(a => a.id === 'bbbb').host, 'unknown');
});

test('mapGrafanaAlerts: fehlende/ungültige severity → "warning" (fail-safe, nie stumm)', () => {
  const missing = activeAlert({ fingerprint: 'cccc', labels: { alertname: 'x', host: 'h' } });
  const bogus = activeAlert({ fingerprint: 'dddd', labels: { alertname: 'y', host: 'h', severity: 'huge' } });
  const { alarms } = G.mapGrafanaAlerts([missing, bogus], NOW);
  assert.equal(alarms.find(a => a.id === 'cccc').severity, 'warning');
  assert.equal(alarms.find(a => a.id === 'dddd').severity, 'warning');
});

test('mapGrafanaAlerts: critical bleibt critical', () => {
  const crit = activeAlert({ fingerprint: 'eeee', labels: { alertname: 'x', host: 'h', severity: 'critical' } });
  const { alarms } = G.mapGrafanaAlerts([crit], NOW);
  assert.equal(alarms[0].severity, 'critical');
});

test('mapGrafanaAlerts: fehlendes startsAt → since = nowIso', () => {
  const noStart = activeAlert({ fingerprint: 'ffff', startsAt: undefined });
  const { alarms } = G.mapGrafanaAlerts([noStart], NOW);
  assert.equal(alarms[0].since, NOW);
});

test('mapGrafanaAlerts: fehlende summary → leerer String, name fällt auf alertname', () => {
  const noSummary = activeAlert({ fingerprint: 'gggg', annotations: {} });
  const { alarms } = G.mapGrafanaAlerts([noSummary], NOW);
  assert.equal(alarms[0].summary, '');
  assert.equal(alarms[0].name, 'unpoller: keine UniFi-Daten');
});

test('mapGrafanaAlerts: leere/Nicht-Array-Eingabe → leeres Ergebnis (kein Crash)', () => {
  assert.deepEqual(G.mapGrafanaAlerts([], NOW), { alarms: [], dropped: [] });
  assert.deepEqual(G.mapGrafanaAlerts(null, NOW), { alarms: [], dropped: [] });
  assert.deepEqual(G.mapGrafanaAlerts(undefined, NOW), { alarms: [], dropped: [] });
});
