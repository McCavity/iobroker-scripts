/* iobroker-scripts-export
 * id:         script.js.common.alarm-source-test
 * name:       alarm-source-test
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Test-Injektor: übersetzt 0_userdata.0.alerting.test.trigger → sources.test,
// inkl. Auto-Clear (10 Min) und PME-Log (test.last_run).
const AUTO_CLEAR_MS = 10 * 60 * 1000;
const DP = '0_userdata.0.alerting.';
let autoClearTimer = null;
let autoClearing = false;

createState(DP + 'test.trigger', '', { name: 'alerting test.trigger', type: 'string', role: 'state', read: true, write: true });
createState(DP + 'test.last_run', '', { name: 'alerting test.last_run', type: 'string', role: 'text', read: true, write: true });
createState(DP + 'sources.test', '[]', { name: 'alerting sources.test', type: 'string', role: 'json', read: true, write: true });

function nowIso() { return new Date().toISOString(); }

function declare(sev) {
  if (sev === 'warning' || sev === 'critical') {
    autoClearing = false;
    // bestehende Test-ID + since beibehalten, damit reconcile eine Severity-Änderung als Eskalation sieht
    const cur = JSON.parse(getState(DP + 'sources.test').val || '[]');
    const id = cur.length ? cur[0].id : 'test-' + Date.now();
    const since = cur.length ? cur[0].since : nowIso();
    setState(DP + 'sources.test', JSON.stringify([{
      id, host: 'TEST', name: 'Selbsttest Alarmkette', severity: sev,
      summary: 'PME-Selbsttest ausgelöst', since, source: 'test',
    }]), true);
    if (autoClearTimer) clearTimeout(autoClearTimer);
    autoClearTimer = setTimeout(() => { autoClearing = true; setState(DP + 'test.trigger', '', true); }, AUTO_CLEAR_MS);
  } else {
    setState(DP + 'sources.test', '[]', true);
    if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
    setState(DP + 'test.last_run', nowIso() + ' ' + (autoClearing ? 'auto-clear' : 'manual-resolve'), true);
    autoClearing = false;
  }
}

on({ id: DP + 'test.trigger' }, (obj) => declare(String(obj.state.val || '')));
log('alarm-source-test gestartet');
