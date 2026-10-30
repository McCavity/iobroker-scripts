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
//  Endpoint + Key: aus signaltowerConfig() (Global-Skript signaltower-helpers,
//  liest /etc/iobroker-secrets/signaltower.json) — seit 2026-10-30 nicht mehr
//  im Skript, weil das Repo öffentlich ist. Key geht als Header, nicht in der URL.
// ============================================================================

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

    const cfg = signaltowerConfig();
    if (!cfg) {
        setState('javascript.0.signaltower.last_status', 'error: Secret-Datei nicht lesbar', true);
        return;
    }

    httpPost(
        `${cfg.url}/signal`,
        JSON.stringify(payload),
        { timeout: HTTP_TIMEOUT_MS, headers: { 'Content-Type': 'application/json', 'X-API-Key': cfg.key } },
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

log('signaltower-controller bereit — endpoint=' + ((signaltowerConfig() || {}).url || 'NICHT KONFIGURIERT'), 'info');

