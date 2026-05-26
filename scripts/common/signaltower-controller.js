/* iobroker-scripts-export
 * id:         script.js.common.signaltower-controller
 * name:       signaltower-controller
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  common/signaltower-controller
// ============================================================================
//  Pfad in ioBroker: `script.js.common.signaltower-controller`
//  Engine-Type: JavaScript/Typescript (NICHT Blockly)
//
//  Geschrieben: 2026-05-25 — Single Source of Truth für Signaltower-HTTP.
//  Hört auf javascript.0.signaltower.request (JSON), ruft HTTP, schreibt
//  last_signal + last_status zurück.
//
//  Datenpunkte werden beim ersten Skript-Start automatisch angelegt
//  (createState ist idempotent).
//
//  Endpoint + Key: zentral hier definiert, nirgendwo sonst.
//
//  Update 2026-05-26: rbhapp01 von WLAN (172.16.47.242, Smart Home VLAN)
//  auf Kabel (172.16.31.241, HomeLab VLAN) migriert — saubere Trennung
//  "Smart Home = WLAN, HomeLab = Kabel" wiederhergestellt.
// ============================================================================

const SIGNALTOWER_URL  = 'http://172.16.31.241:5000/signal';
const SIGNALTOWER_KEY  = 'b6f43fe3b5ca508930dbdeff07d4ed37f9f032603f01315a340858b3806464e8';
const HTTP_TIMEOUT_MS  = 5000;

// ---------------------------------------------------------------------------
//  Datenpunkte anlegen (idempotent — bei Re-Start kein Doppel-Anlegen)
// ---------------------------------------------------------------------------
createState('signaltower.request', '', {
    name:  'Signaltower: eingehender Request (JSON)',
    type:  'string',
    role:  'json',
    read:  true,
    write: true,
});

createState('signaltower.last_signal', '', {
    name:  'Signaltower: zuletzt gesendetes Signal',
    type:  'string',
    role:  'json',
    read:  true,
    write: false,
});

createState('signaltower.last_status', '', {
    name:  'Signaltower: zuletzt gemeldeter HTTP-Status',
    type:  'string',
    role:  'text',
    read:  true,
    write: false,
});

// ---------------------------------------------------------------------------
//  Request-Handler — feuert bei jedem Schreibvorgang auf request
//  (auch wenn derselbe Wert geschrieben wird, damit zwei identische Signale
//  hintereinander beide ankommen — change: 'ne' wäre falsch)
// ---------------------------------------------------------------------------
on({ id: 'javascript.0.signaltower.request', ack: false }, (obj) => {
    let payload;
    try {
        payload = JSON.parse(obj.state.val);
    } catch (e) {
        const msg = `error: invalid JSON — ${e.message}`;
        log(`signaltower: ${msg} (received: ${obj.state.val})`, 'error');
        setState('javascript.0.signaltower.last_status', msg, true);
        return;
    }

    httpPost(
        `${SIGNALTOWER_URL}?key=${SIGNALTOWER_KEY}`,
        JSON.stringify(payload),
        { timeout: HTTP_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
        (error, response) => {
            const result = error
                ? `error: ${error}`
                : `ok: HTTP ${response.statusCode}`;
            log(`signaltower ← ${JSON.stringify(payload)} → ${result}`, error ? 'warn' : 'debug');
            setState('javascript.0.signaltower.last_signal', JSON.stringify(payload), true);
            setState('javascript.0.signaltower.last_status', result, true);
        }
    );
});

log('signaltower-controller bereit — endpoint=' + SIGNALTOWER_URL, 'info');

