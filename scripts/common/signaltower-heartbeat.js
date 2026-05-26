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
//  Eigene Konstanten für URL + Key — bewusst NICHT über den Controller
//  geroutet: ein hängender Controller darf den Watchdog nicht stumm schalten.
// ============================================================================

const HEARTBEAT_URL = 'http://172.16.31.241:5000/heartbeat';
const HEARTBEAT_KEY = 'b6f43fe3b5ca508930dbdeff07d4ed37f9f032603f01315a340858b3806464e8';
const TIMEOUT_MS    = 2000;

function sendHeartbeat() {
    httpGet(
        `${HEARTBEAT_URL}?key=${HEARTBEAT_KEY}`,
        { timeout: TIMEOUT_MS },
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

log('signaltower-heartbeat bereit — 1× pro Minute → ' + HEARTBEAT_URL, 'info');

