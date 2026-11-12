/* iobroker-scripts-export
 * id:         script.js.common.zigbee-waechter
 * name:       zigbee-waechter
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */

// ============================================================================
//  common.zigbee-waechter
// ============================================================================
//  Meldet Zigbee-Geräte, die still geworden sind — bevor man sie neu anlernen
//  muß.
//
//  Maß:  Minuten seit der letzten ECHTEN Meldung des Geräts, also dem
//        Zeitstempel `ts` von zigbee.0.<id>.msg_from_zigbee.
//        NICHT `available` und NICHT dessen `lc`: Nach „Stopping to ping"
//        bleibt available=false stehen, auch wenn das Gerät längst wieder
//        antwortet, und ein Adapterneustart setzt `lc` zurück. Belegt am
//        07.11.2026: Der Leckwarner Küche schwieg seit 11.10., `available.lc`
//        stand aber auf dem Neustart vom 02.11. — battery-check (Schwelle
//        7 Tage auf lc) hat ihn deshalb nie gemeldet.
//
//  Ausgabe: je Gerät 0_userdata.0.zigbeeWaechter.stille.<hex-id> (Minuten),
//           geloggt nach InfluxDB als ZigbeeStille.<Name>, bei JEDEM Lauf
//           (changesOnly:false) — sonst sähe ein gesunder Dauerwert für
//           Grafana wie „keine Daten" aus.
//           Dazu für Menschen: .stumm (Liste) und .anzahl.
//
//  Alarm:   liegt NICHT hier, sondern in Grafana (Regel „Zigbee: Gerät still",
//           Schwelle 6 h). Die Alarmierung bleibt bei Grafana/InfluxDB.
//
//  Kalibriert 07.11.2026: gesunde Geräte max. 2,3 h still, tote ab 79 h.
//
//  Stufe 2 (12.11.2026): Netzgeräte (Leuchten, Steckdosen) zusätzlich nach
//  Erreichbarkeit. Die 6-h-Stille ist für Batteriegeräte gebaut; eine
//  Leuchte, die nachts wegfällt, meldete sie erst am späten Vormittag.
//
//  Maß:  Minuten seit available=false, je Netzgerät
//        0_userdata.0.zigbeeWaechter.offline.<hex-id> (0 = erreichbar),
//        geloggt als ZigbeeOffline.<Name>, ebenfalls changesOnly:false.
//        Beginn = der spätere von available.lc und msg_from_zigbee.ts:
//        Meldet sich das Gerät trotz stehengebliebenem available=false,
//        lebt es, und die Uhr beginnt neu.
//        ⚠ Ein Adapterneustart setzt available.lc zurück — die Uhr beginnt
//        dann ebenfalls neu, der Alarm kommt später, nie früher.
//
//  Netzgerät: laut Adapter (sendTo getDevice → info.device), dieselbe Regel
//        wie isRouter() im Adapter: type === 'Router' oder power 'Mains…'.
//        Nie am Namen. Ergebnis je Gerät gemerkt; ohne Antwort (Adapter
//        aus) wird im nächsten Lauf neu gefragt, bis dahin kein Wert.
//
//  Alarm Stufe 2: Grafana-Regel „Zigbee: Netzgerät nicht erreichbar",
//        Schwelle 50 min. Kalibriert 12.11.2026 an 141 Offline-Phasen von
//        sieben Leuchten (22.10.–12.11.): Flattern dauert bis 36 min
//        (Häufungen bei 11, 15, 19, 34 min), echte Ausfälle ab 68 min.
// ============================================================================

const BASIS        = '0_userdata.0.zigbeeWaechter.';
const SCHWELLE_MIN = 360;               // nur für .stumm/.anzahl; der Alarm hat eigene Schwelle in Grafana
const TAKT         = '*/5 * * * *';

function aliasName(name, hex) {
    const s = String(name || hex)
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
        .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
        .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return 'ZigbeeStille.' + (s || hex);
}

function influxCustom(alias) {
    return {
        'influxdb.0': {
            enabled: true, storageType: '', aliasId: alias,
            debounceTime: 0, blockTime: 0, changesOnly: false, changesRelogInterval: 0,
            changesMinDelta: 0, ignoreBelowNumber: '', disableSkippedValueLogging: false,
            enableDebugLogs: false, debounce: 0
        }
    };
}

createState(BASIS + 'stumm',  '', { name: 'Zigbee-Wächter: stille Geräte (> 6 h)', type: 'string', role: 'text',  read: true, write: false });
createState(BASIS + 'anzahl', 0,  { name: 'Zigbee-Wächter: Anzahl stiller Geräte',  type: 'number', role: 'value', read: true, write: false });

const angelegt = {};
const angelegtOffline = {};
const netzgeraet = {};          // hex → true/false, nur nach Antwort des Adapters
const angefragt  = {};          // hex → Zeitpunkt der offenen Anfrage

// Fragt den Adapter einmal je Gerät nach Typ/Stromquelle. Kein Ergebnis
// (Adapter aus, Fehler) wird nicht gemerkt — der nächste Lauf fragt erneut.
function frageTyp(hex) {
    if (hex in netzgeraet) return;
    // Bleibt die Antwort ganz aus, nach 10 min erneut fragen.
    if (angefragt[hex] && Date.now() - angefragt[hex] < 10 * 60000) return;
    angefragt[hex] = Date.now();
    sendTo('zigbee.0', 'getDevice', { id: 'zigbee.0.' + hex }, res => {
        angefragt[hex] = 0;
        const d    = res && Array.isArray(res.devices) ? res.devices[0] : null;
        const info = d && d.info && d.info.device;
        if (!info) return;
        netzgeraet[hex] = info.type === 'Router' ||
            (typeof info.power === 'string' && info.power.indexOf('Mains') === 0);
    });
}

// Minuten seit available=false; 0 = erreichbar; null = kein available-State.
function offlineMinuten(hex, jetzt, msgTs) {
    const id = 'zigbee.0.' + hex + '.available';
    if (!existsState(id)) return null;
    const st = getState(id);
    if (!st || st.val !== false) return 0;
    const seit = Math.max(typeof st.lc === 'number' ? st.lc : 0, msgTs || 0);
    if (seit <= 0) return null;
    return Math.max(0, Math.round((jetzt - seit) / 60000));
}

function schreibe(merker, ziel, wert, common) {
    if (!merker[ziel]) {
        merker[ziel] = true;
        createState(ziel, wert, common, () => setState(ziel, wert, true));
    } else {
        setState(ziel, wert, true);
    }
}

function pruefe() {
    const jetzt = Date.now();
    const stumm = [];
    // Muster wie in battery-check ('*.battery'): Wildcard nur vorn, Präfix danach filtern —
    // ein `*` mitten in der ID matcht in ioBroker nicht zuverlässig (lehren/iobroker).
    const ids = Array.prototype.slice.apply($('state[id=*.msg_from_zigbee]'))
        .filter(id => id.indexOf('zigbee.0.') === 0);
    if (ids.length === 0) log('zigbee-waechter: keine msg_from_zigbee-States gefunden — Selektor prüfen', 'warn');

    ids.forEach(id => {
        const hex = id.split('.')[2];
        if (!/^[0-9a-f]{16}$/.test(hex)) return;            // Coordinator/Info überspringen
        const st = getState(id);
        if (!st || typeof st.ts !== 'number' || st.ts <= 0) return;   // nie gemeldet → kein Maß

        const dev  = getObject('zigbee.0.' + hex);
        const name = (dev && dev.common && dev.common.name) || hex;
        const min  = Math.max(0, Math.round((jetzt - st.ts) / 60000));

        schreibe(angelegt, BASIS + 'stille.' + hex, min, {
            name: 'Zigbee still: ' + name, type: 'number', role: 'value', unit: 'min',
            read: true, write: false, custom: influxCustom(aliasName(name, hex))
        });
        if (min >= SCHWELLE_MIN) stumm.push(name + ' (' + Math.round(min / 60) + ' h)');

        // Stufe 2: nur Netzgeräte, nur mit bekanntem Typ.
        frageTyp(hex);
        if (netzgeraet[hex] === true) {
            const off = offlineMinuten(hex, jetzt, st.ts);
            if (off !== null) {
                schreibe(angelegtOffline, BASIS + 'offline.' + hex, off, {
                    name: 'Zigbee nicht erreichbar: ' + name, type: 'number', role: 'value', unit: 'min',
                    read: true, write: false,
                    custom: influxCustom(aliasName(name, hex).replace(/^ZigbeeStille\./, 'ZigbeeOffline.'))
                });
            }
        }
    });

    setState(BASIS + 'stumm', stumm.sort().join(', '), true);
    setState(BASIS + 'anzahl', stumm.length, true);
}

schedule(TAKT, pruefe);
setTimeout(pruefe, 5000);
setTimeout(pruefe, 60000);     // Netzgerät-Typen sind nach dem ersten Lauf bekannt
