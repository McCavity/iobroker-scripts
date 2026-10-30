/* iobroker-scripts-export
 * id:         script.js.global.signaltower-helpers
 * name:       signaltower-helpers
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  global/signaltower-helpers
// ============================================================================
//  WICHTIG: Dieses Skript MUSS im Pfad `script.js.global.signaltower-helpers`
//  liegen, damit der javascript-Adapter es als Global-Skript erkennt und seine
//  Funktionen in allen anderen Skripten verfügbar macht.
//
//  Engine-Type: JavaScript/Typescript (NICHT Blockly)
//
//  Geschrieben: 2026-05-25 — Zentralisierung der Signaltower-Ansteuerung.
//  Konsumenten sollen nicht direkt HTTP rufen, sondern diese Helper benutzen.
//  Implementierung lebt im signaltower-controller (script.js.common.*).
//
//  Pattern: Helper → schreibt JSON in 0_userdata.0.signaltower.request →
//  Controller hört, ruft HTTP, schreibt Status in 0_userdata.0.signaltower.*
//
//  Update 2026-10-30: Endpoint + API-Key stehen nicht mehr im Skript, sondern
//  in /etc/iobroker-secrets/signaltower.json auf dem ioBroker-Host
//  ({"url": "http://<host>:5000", "key": "…"}, iobroker:iobroker 0600).
//  Grund: das Repo ist öffentlich. Ein 0_userdata-Datenpunkt wäre über die
//  SimpleAPI im LAN lesbar und scheidet deshalb aus.
// ============================================================================

const SIGNALTOWER_SECRETS = '/etc/iobroker-secrets/signaltower.json';

/**
 * Endpoint + Key der Signalsäule aus der Secret-Datei. Wird bei jedem Aufruf
 * neu gelesen — nach einer Key-Rotation genügt es, die Datei zu tauschen.
 * @returns {{url: string, key: string} | null}  null, wenn nicht lesbar
 */
function signaltowerConfig() {
    try {
        const raw = require('fs').readFileSync(SIGNALTOWER_SECRETS, 'utf8');
        let cfg;
        // Eigener Fehlertext: neuere Node-Versionen zitieren in der
        // JSON.parse-Meldung einen Ausschnitt des Inhalts — also ggf. den Key.
        try { cfg = JSON.parse(raw); } catch (_) { throw new Error('kein gültiges JSON'); }
        if (typeof cfg.url !== 'string' || typeof cfg.key !== 'string' || !cfg.url || !cfg.key) {
            throw new Error('url/key fehlt');
        }
        return { url: cfg.url.replace(/\/+$/, ''), key: cfg.key };
    } catch (e) {
        // Nur die Fehlermeldung loggen, nie den Dateiinhalt
        log(`signaltower: ${SIGNALTOWER_SECRETS} nicht lesbar — ${e.message}`, 'error');
        return null;
    }
}

/**
 * Generischer Signaltower-Aufruf.
 * @param {string} colour    — case-sensitive, erlaubt: 'BLUE', 'WHITE', 'AMBER'
 * @param {string} mode      — erlaubt: 'off', 'on', 'slow_blink', 'fast_blink'
 * @param {number} duration  — Sekunden
 *
 * Hinweis: API gibt HTTP 422 bei falschen Werten zurück
 * (Pydantic-Validierung). Die Convenience-Aliasse unten halten die
 * gültigen Werte fest.
 */
async function signal(colour, mode = 'on', duration = 1) {
    setState('javascript.0.signaltower.request',
             JSON.stringify({ colour, mode, duration }),
             false);
}

// ---------------------------------------------------------------------------
//  Semantische Convenience-Aliase
//  Sollte sich später die Konvention ändern (z.B. Alarme rot statt amber),
//  einfach hier anpassen — alle Konsumenten profitieren automatisch.
//
//  Achtung: colour-Werte GROSSGESCHRIEBEN, mode-Werte kleingeschrieben.
// ---------------------------------------------------------------------------

/** Alarm-Quittierung — Amber, schnell blinkend, 3 Sekunden */
async function signalAlarm() {
    return signal('AMBER', 'fast_blink', 3);
}

/** Allgemeine Bestätigung (z.B. Müllabfuhr) — Weiß, solide an, 2 Sekunden */
async function signalAck() {
    return signal('WHITE', 'on', 2);
}

/** Licht-Toggle (auto-switch-2026 etc.) — Blau, solide an, 1 Sekunde */
async function signalLightToggle() {
    return signal('BLUE', 'on', 1);
}

