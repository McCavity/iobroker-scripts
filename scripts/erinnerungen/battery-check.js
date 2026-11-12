/* iobroker-scripts-export
 * id:         script.js.erinnerungen.battery-check
 * name:       battery-check
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  erinnerungen.battery-check
// ============================================================================
//  Ersetzt das alte Blockly-Skript script.js.erinnerungen.battery_check.
//
//  Architektur (PME-konform — Klasse 2 "überwachbare Batterien"):
//    1. Mute-Liste:  bewußt vergessene Devices komplett überspringen.
//    2. Offline:     available=false → überspringen, NICHT melden.
//                    Bis 12.11.2026 stand hier ein Block „offline seit >= 7
//                    Tagen", gemessen an available.lc. Ein Adapterneustart
//                    setzt lc zurück — der Leckwarner Küche schwieg seit 11.10.
//                    und wurde nie gemeldet. Stille Geräte meldet jetzt
//                    common.zigbee-waechter (msg_from_zigbee.ts, Grafana).
//    3. Defense:     getState() kann null liefern (Objekt existiert, aber
//                    nie ein Wert) oder non-numeric. Beide Fälle landen im
//                    "Wert unbekannt"-Block — kein Crash, kein WARN-Spam.
//    4. Schwellen:   <= KRITISCH eigener Block, <= WARNUNG Standard-Liste,
//                    Rest stillschweigend.
//    5. Output:      lesbare Device-Namen aus common.name (z.B.
//                    "Fernbedienung Sassi: 18%") statt State-IDs.
//
//  Pfad in ioBroker: script.js.erinnerungen.battery-check
//  Engine-Type:      JavaScript/Typescript (NICHT Blockly)
//
//  Migration: 2026-05-27 — Blockly → JS, Defense-in-Depth nach dem heute
//  morgen gelernten "undefined > N === false"-Bug (Eintracht-Logo).
//  Trigger war ein WARN-Log-Spam stündlich, weil die "Fernbedienung Sassi"
//  (TS0044, 003c84fffeb3ecd1) seit Tagen offline ist und nie einen
//  battery-Wert geliefert hat.
// ============================================================================

// --- Konfiguration -----------------------------------------------------------

const SCHWELLE_KRITISCH = 10;   // % — eigene "Kritisch"-Section in Telegram
const SCHWELLE_WARNUNG  = 20;   // % — Standard-Warnung

// Mute-Liste: Device-Channels die KOMPLETT übersprungen werden sollen.
// Format: 'zigbee.0.<hex-id>' (Channel-ID, ohne .battery-Suffix).
// Verwendung: für bewußt vergessene Geräte (z.B. Schubladen-Leichen),
// damit sie nicht jede Stunde Lärm machen.
const MUTE_LIST = [
    // 'zigbee.0.003c84fffeb3ecd1',  // Fernbedienung Sassi — wenn Status final geklärt
];

const SCHEDULE_CRON = '5 9 * * *';   // 09:05 jeden Tag

// --- Hilfsfunktionen ---------------------------------------------------------

function getDeviceName(channelId) {
    const obj = getObject(channelId);
    const name = obj && obj.common && obj.common.name;
    return (typeof name === 'string' && name.length > 0) ? name : channelId;
}

function isOffline(availableStateId) {
    if (!existsState(availableStateId)) return false;
    const st = getState(availableStateId);
    return !!st && st.val === false;
}

// --- Hauptlogik --------------------------------------------------------------

function buildReport() {
    const kritisch  = [];
    const warnung   = [];
    const unbekannt = [];

    // Direkter als der Original-Blockly-Selektor 'channel[state.id=*attery]':
    // $('state[id=*.battery]') liefert alle States deren ID auf ".battery" endet.
    const batteryStateIds = Array.prototype.slice.apply($('state[id=*.battery]'));

    for (const batteryStateId of batteryStateIds) {
        const channelId = batteryStateId.replace(/\.battery$/, '');

        if (MUTE_LIST.includes(channelId)) continue;

        const name = getDeviceName(channelId);

        // Offline-Devices: NIE den battery-State lesen.
        // Der ioBroker-JS-Adapter loggt einen WARN ('states[id]=null') jedes
        // Mal wenn man einen State liest, der zwar als Objekt existiert aber
        // nie einen Wert bekommen hat — typisch für Devices die seit Pairing
        // nichts senden konnten. Wir verzichten auf "letzte bekannte Battery"
        // in der Offline-Meldung und nehmen dafür einen ruhigen Log in Kauf.
        // Die Stille selbst meldet common.zigbee-waechter.
        if (isOffline(channelId + '.available')) continue;

        // available=true (oder kein available-State vorhanden) → Wert prüfen
        const st = getState(batteryStateId);
        const val = st ? st.val : null;

        if (typeof val !== 'number' || !Number.isFinite(val)) {
            unbekannt.push({ name });
            continue;
        }

        if (val <= SCHWELLE_KRITISCH) {
            kritisch.push({ name, percent: val });
        } else if (val <= SCHWELLE_WARNUNG) {
            warnung.push({ name, percent: val });
        }
    }

    return { kritisch, warnung, unbekannt };
}

function formatTelegramMessage(report) {
    const blocks = [];

    if (report.kritisch.length > 0) {
        const lines = [`Kritisch (<= ${SCHWELLE_KRITISCH}%):`];
        for (const item of report.kritisch) {
            lines.push(`  - ${item.name}: ${item.percent}%`);
        }
        blocks.push(lines.join('\n'));
    }

    if (report.warnung.length > 0) {
        const lines = [`Warnung (<= ${SCHWELLE_WARNUNG}%):`];
        for (const item of report.warnung) {
            lines.push(`  - ${item.name}: ${item.percent}%`);
        }
        blocks.push(lines.join('\n'));
    }

    if (report.unbekannt.length > 0) {
        const lines = ['Wert unbekannt (online, aber kein Battery-Report):'];
        for (const item of report.unbekannt) {
            lines.push(`  - ${item.name}`);
        }
        blocks.push(lines.join('\n'));
    }

    if (blocks.length === 0) return null;

    return ['Batteriezustand:', ...blocks].join('\n\n');
}

function runBatteryCheck() {
    const report = buildReport();
    const summary = [
        `kritisch=${report.kritisch.length}`,
        `warnung=${report.warnung.length}`,
        `unbekannt=${report.unbekannt.length}`,
    ].join(', ');
    log(`Batteriecheck: ${summary}`, 'info');

    const msg = formatTelegramMessage(report);
    if (msg) {
        sendTo('telegram', 'send', { text: msg });
    }
}

schedule(SCHEDULE_CRON, runBatteryCheck);

// Sofort einmal beim Skript-Start laufen lassen — Pattern vom 2026-05-26
// Heartbeat-Refactor: nach Deploy direkt eine Diagnose haben, ohne bis zur
// nächsten vollen Stunde zu warten.
runBatteryCheck();

log('erinnerungen.battery-check geladen — JS-Version, defensive Klasse-2-PME', 'info');

