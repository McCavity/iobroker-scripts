/* iobroker-scripts-export
 * id:         script.js.common.signaltower-heartbeat
 * name:       signaltower-heartbeat
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  common/signaltower-heartbeat
// ============================================================================
//  Pfad in ioBroker: `script.js.common.signaltower-heartbeat`
//  Engine-Type: JavaScript/Typescript (NICHT Blockly)
//
//  Migriert am 2026-05-26 von Blockly (`schaltungen.heartbeat`) nach JS:
//  - Lesbarer im Diff
//  - Versionierbar im Vault
//  - Naming-konsistent mit `common.signaltower-controller`
//
//  Sendet 1× pro Minute GET an /heartbeat damit der Signaltower-Watchdog
//  GREEN behält. Bleibt der Heartbeat aus, schaltet der Tower nach 2 Min auf RED.
//  Beim Skript-Start wird zusätzlich sofort einmal gefeuert (= GREEN ohne
//  Wartezeit bis zur nächsten vollen Minute).
//
//  Bewusst NICHT über den Controller geroutet: ein hängender Controller darf
//  den Watchdog nicht stumm schalten. URL + Key kommen seit 2026-10-30 aus
//  signaltowerConfig() (Global-Skript signaltower-helpers) — eine reine
//  Dateilesefunktion, kein gemeinsamer Zustand mit dem Controller.
// ============================================================================

const TIMEOUT_MS    = 2000;

function sendHeartbeat() {
    const cfg = signaltowerConfig();
    if (!cfg) return;   // Fehler ist geloggt; der Tower geht nach 2 Min auf RED
    httpGet(
        `${cfg.url}/heartbeat`,
        { timeout: TIMEOUT_MS, headers: { 'X-API-Key': cfg.key } },
        (error, response) => {
            const statusCode = response && response.statusCode;
            if (error || statusCode !== 200) {
                log(
                    `signaltower-heartbeat: http (GET) failed, return code: ${statusCode}; error message: ${error}`,
                    'warn'
                );
                log(
                    `signaltower-heartbeat: Response body: ${response && response.data}`,
                    'warn'
                );
            }
        }
    );
}

schedule('* * * * *', sendHeartbeat);

// Sofort feuern, damit der Tower beim Skript-Start direkt GREEN wird
// und nicht bis zur nächsten vollen Minute auf der RED-Schwelle bleibt.
sendHeartbeat();

log('signaltower-heartbeat bereit — 1× pro Minute → ' + ((signaltowerConfig() || {}).url || 'NICHT KONFIGURIERT'), 'info');

