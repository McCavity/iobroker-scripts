/* iobroker-scripts-export
 * id:         script.js.common.drucker-status
 * name:       drucker-status
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  common/drucker-status
// ============================================================================
//  Geschrieben 2026-10-30. Fragt alle 10 s Moonraker am 3D-Drucker ab (ohne
//  Login, am Drucker ändert sich nichts — bewusst kein Moonraker-MQTT, das
//  müsste moonraker.conf ändern und überlebt QIDI-Updates vielleicht nicht),
//  liest die Tasmota-Steckdose und entscheidet über drucker-core (Global):
//    - weiße Lampe der Signalsäule (über signal() → signaltower-controller)
//    - Alarmquelle 0_userdata.0.alerting.sources.drucker (→ alarm-orchestrator)
//    - Datenpunkte 0_userdata.0.drucker.* (Status für Menschen und Panels)
//
//  Weiß wird bei jedem Takt neu gesetzt (Dauer 60 s): eine kurze Müll-Quittung
//  von buttonplus überschreibt die Lampe sonst dauerhaft. Fällt dieses Skript
//  aus, erlischt die Lampe nach spätestens 60 s von selbst. „aus“ wird nur beim
//  Wechsel gesendet — im Leerlauf bleiben fremde Weiß-Signale unberührt.
// ============================================================================

const MOONRAKER = 'http://p3dapp01.lan:7125/printer/objects/query?webhooks&print_stats&display_status';
const PLUG = 'sonoff.0.3D Drucker.';
const POLL_MS = 10 * 1000;
const HTTP_TIMEOUT_MS = 9000;            // gemessen 30.10.: Median 1 s, Spitzen bis 14 s
const WHITE_DURATION_S = 60;
const PLUG_STALE_MS = 60 * 1000;          // Tasmota meldet alle ~10 s
const DP = '0_userdata.0.drucker.';
const SOURCE = '0_userdata.0.alerting.sources.drucker';

createState(DP + 'status', '', { name: '3D-Drucker: Status', type: 'string', role: 'text', read: true, write: false });
createState(DP + 'weiss', '', { name: '3D-Drucker: Modus der weißen Lampe', type: 'string', role: 'text', read: true, write: false });
createState(DP + 'klipper', '', { name: '3D-Drucker: Klipper-Zustand (print_stats.state)', type: 'string', role: 'text', read: true, write: false });
createState(DP + 'fortschritt', 0, { name: '3D-Drucker: Fortschritt', type: 'number', role: 'value', unit: '%', read: true, write: false });
createState(DP + 'datei', '', { name: '3D-Drucker: Datei', type: 'string', role: 'text', read: true, write: false });
createState(DP + 'erreichbar', false, { name: '3D-Drucker: Moonraker erreichbar', type: 'boolean', role: 'indicator.reachable', read: true, write: false });
createState(SOURCE, '[]', { name: 'alerting sources.drucker', type: 'string', role: 'json', read: true, write: true });

let mem = druckerInitialMemory();
let lastSentWhite = null;
let downSince = null;                     // Beginn des aktuellen Moonraker-Ausfalls
let inFlight = false;                     // keine zweite Abfrage, solange eine läuft
let stopped = false;                      // gesetzt in onStop — siehe dort

function readPlug(now) {
    const get = (id) => existsState(PLUG + id) ? getState(PLUG + id) : null;
    const power = get('POWER');
    const watts = get('ENERGY_Power');
    const alive = get('alive');
    if (alive && alive.val === false) return { power: null, watts: null };
    const fresh = (st) => st && st.val !== null && st.val !== undefined && now - st.ts < PLUG_STALE_MS;
    return {
        power: power && typeof power.val === 'boolean' ? power.val : null,
        watts: fresh(watts) ? Number(watts.val) : null,
    };
}

function setIfChanged(id, val) {
    const cur = existsState(id) ? getState(id) : null;
    if (!cur || cur.val !== val) setState(id, val, true);
}

function apply(moon) {
    const now = Date.now();
    const r = druckerTick({ now, moon, plug: readPlug(now), mem });
    mem = r.mem;

    if (r.white !== 'off') signal('WHITE', r.white, WHITE_DURATION_S);
    else if (lastSentWhite !== 'off') signal('WHITE', 'off');
    lastSentWhite = r.white;

    setIfChanged(DP + 'status', r.status);
    setIfChanged(DP + 'weiss', r.white);
    setIfChanged(DP + 'erreichbar', !!moon);
    if (moon) {
        setIfChanged(DP + 'klipper', moon.state);
        setIfChanged(DP + 'fortschritt', Math.round((moon.progress || 0) * 100));
        setIfChanged(DP + 'datei', moon.filename || '');
    }
    setIfChanged(SOURCE, JSON.stringify(r.alarm ? [r.alarm] : []));
}

// Eigener HTTP-Abruf statt httpGet(): der Adapter loggt jeden Fehlschlag von
// httpGet fest auf Stufe error (sandbox.js, ohne Option). Das Ethernet des
// Druckers flattert (Gewährleistungsfall) — hier wird je Ausfall EINMAL geloggt,
// bei Rückkehr mit Dauer. Diese Zeilen sind zugleich der Beleg für QIDI.
function fetchStatus(cb) {
    let done = false;
    const finish = (err, body) => { if (!done) { done = true; cb(err, body); } };
    const req = require('http').get(MOONRAKER, { timeout: HTTP_TIMEOUT_MS }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => finish(res.statusCode === 200 ? null : new Error('HTTP ' + res.statusCode), body));
    });
    req.on('timeout', () => req.destroy(new Error('Timeout ' + HTTP_TIMEOUT_MS + ' ms')));
    req.on('error', (e) => finish(e));
}

function noteReachability(ok, err) {
    const now = Date.now();
    if (!ok && downSince === null) {
        downSince = now;
        log(`drucker-status: Moonraker nicht erreichbar (${err && err.message})`, 'info');
    } else if (ok && downSince !== null) {
        log(`drucker-status: Moonraker wieder erreichbar nach ${Math.round((now - downSince) / 1000)} s`, 'info');
        downSince = null;
    }
}

function poll() {
    if (inFlight) return;
    inFlight = true;
    fetchStatus((error, data) => {
        inFlight = false;
        if (stopped) return;
        let moon = null;
        if (!error) {
            try {
                const s = JSON.parse(data).result.status;
                moon = {
                    state: s.print_stats.state,
                    webhooks: s.webhooks.state,
                    message: s.print_stats.message || (s.webhooks.state !== 'ready' ? s.webhooks.state_message : ''),
                    filename: s.print_stats.filename,
                    progress: s.display_status.progress,
                };
            } catch (e) {
                log(`drucker-status: Antwort nicht lesbar — ${e.message}`, 'warn');
            }
        }
        noteReachability(!error, error);
        apply(moon);
    });
}

schedule(`*/${POLL_MS / 1000} * * * * *`, poll);
poll();

// require('http') läuft am Adapter vorbei: anders als bei httpGet bricht ein
// Skript-Stopp eine laufende Abfrage NICHT ab. Ohne `stopped` setzte deren
// späte Antwort Weiß nach dem Stopp wieder auf „an“ (gemessen 30.10., 15:38).
onStop(() => { stopped = true; signal('WHITE', 'off'); }, 2000);

log('drucker-status bereit — Takt ' + POLL_MS / 1000 + ' s', 'info');
