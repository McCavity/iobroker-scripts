/* iobroker-scripts-export
 * id:         script.js.scenes.lighting.smart-switches
 * name:       smart-switches
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  scenes.lighting.smart-switches
// ============================================================================
//  Ersetzt: smartcontrol-Adapter (2.0.1) — komplette Switch- und Motion-Logik
//
//  Geschrieben: 2026-05-25 (Pfingstmontag) — Anlaß: smartcontrol war seit
//  ~Januar 2025 tot, weil der ZigBee-Adapter sein Event-Schema von .click=true
//  auf .action='single'/'double'/'hold' umgestellt hat. Statt smartcontrol-
//  Konfig nachzuziehen: ganzen Adapter raus, Logik direkt als JS.
//
//  Pattern: jeder ZigBee-Switch hat einen Single-Klick (Standard-Toggle),
//  einen optionalen Hold (Sekundär-Aktion), und einen Doppelklick — der ist
//  überall an einen Alarm-ACK-Hook gebunden, damit jeder Switch ein Alarm-
//  Quittierungs-Punkt sein kann (Stub bis die Alarm-Infrastruktur steht).
//
//  Hinweis: dieses Skript ist NICHT Blockly — JavaScript-Adapter, Engine-Type
//  "Javascript/Typescript". Beim Anlegen entsprechend wählen.
// ============================================================================

// ---------------------------------------------------------------------------
//  Helper: Toggle eines bool-States
// ---------------------------------------------------------------------------
function toggle(stateId) {
    const cur = getState(stateId).val;
    setState(stateId, !cur);
    log(`toggle ${stateId}: ${cur} → ${!cur}`, 'debug');
}

// ---------------------------------------------------------------------------
//  Helper: Alarm-ACK
//  Schreibt 0_userdata.0.alerting.ack=true → der alarm-orchestrator quittiert
//  den aktiven Alarm (Signaltower fast_blink → solid) und setzt den Button selbst
//  zurück. Damit ist jeder Switch-Doppelklick ein generischer Quittierungspunkt.
//  Ersetzt das alte signalAlarm()-3s-Blink: der Signaltower wird jetzt vom
//  Orchestrator besessen, ein separates Blinken würde nur kollidieren.
// ---------------------------------------------------------------------------
function ackAlarm(source) {
    const ackId = '0_userdata.0.alerting.ack';
    if (existsState(ackId)) {
        setState(ackId, true);
    } else {
        log(`Alarm-ACK von '${source}': ${ackId} fehlt — alarm-orchestrator geladen?`, 'warn');
    }
    log(`Alarm-ACK von '${source}'`, 'info');
}

// ---------------------------------------------------------------------------
//  Helper: ZigBee-Switch-Handler
//  Hört auf zigbee.0.<deviceId>.action, dispatcht single/double/hold.
//  Jeder Slot ist optional — null bedeutet "keine Aktion".
// ---------------------------------------------------------------------------
function onSwitch(deviceId, friendlyName, handlers) {
    const stateId = `zigbee.0.${deviceId}.action`;
    on({ id: stateId, change: 'ne' }, (obj) => {
        const action = obj.state.val;
        if (!action) return;  // empty string nach reset ignorieren
        // Auf 'info' Level, damit Test-Sessions im Standard-Log sichtbar sind.
        // Wenn das mal nervt, einfach zurück auf 'debug' setzen.
        log(`Switch '${friendlyName}': action=${action}`, 'info');
        if (action === 'single' && handlers.single) handlers.single();
        if (action === 'double' && handlers.double) handlers.double();
        if (action === 'hold'   && handlers.hold)   handlers.hold();
        // 'release' / 'long_release' werden bewusst ignoriert
    });
}

// ============================================================================
//  USE-CASES
// ============================================================================

// ---------------------------------------------------------------------------
//  1) Büro-Deckenleuchten (ZigBee-Gruppe group_2 = 3 Lampen atomar)
//     Schreibtischschalter + Türschalter Click → toggle
//     Schreibtischschalter Double → Alarm-ACK
// ---------------------------------------------------------------------------
const BURO_LICHT = 'zigbee.0.group_2.state';

onSwitch('00158d000ab722c0', 'Büro Schreibtisch', {
    single: () => toggle(BURO_LICHT),
    double: () => ackAlarm('Büro Schreibtisch'),
    hold:   () => toggle('sonoff.0.Büro.POWER'),  // Ventilator
});

onSwitch('00158d0007c585bf', 'Büro Tür', {
    single: () => toggle(BURO_LICHT),
    double: () => ackAlarm('Büro Tür'),
    hold:   null,
});

// ---------------------------------------------------------------------------
//  2) Studio-Deckenleuchten (ZigBee-Gruppe group_3 = 3 Lampen atomar)
// ---------------------------------------------------------------------------
onSwitch('00158d0007c5bcc8', 'Studio Tür', {
    single: () => toggle('zigbee.0.group_3.state'),
    double: () => ackAlarm('Studio Tür'),
    hold:   null,
});

// ---------------------------------------------------------------------------
//  3) Schlafzimmer Leselampen (separate Sonoff-Steckdosen pro Seite)
// ---------------------------------------------------------------------------
onSwitch('00158d0007c58a16', 'Schlafzimmer Henning', {
    single: () => toggle('sonoff.0.SchlafzimmerHenning.POWER'),
    double: () => ackAlarm('Schlafzimmer Henning'),
    hold:   null,
});

onSwitch('00158d0007c58a2e', 'Schlafzimmer Sassi', {
    single: () => toggle('sonoff.0.SchlafzimmerSassi.POWER'),
    double: () => ackAlarm('Schlafzimmer Sassi'),
    hold:   null,
});

// ---------------------------------------------------------------------------
//  4) Wohnzimmer Altbau-Deckenlicht (Shelly-Relay)
// ---------------------------------------------------------------------------
onSwitch('00158d0007c586c8', 'Wohnzimmer Altbautür', {
    single: () => toggle('shelly.0.shelly1minig3#cc8da25af6c8#1.Relay0.Switch'),
    double: () => ackAlarm('Wohnzimmer Altbautür'),
    hold:   null,
});

// ---------------------------------------------------------------------------
//  5) Couchtischschalter (Doppel-Aktion: Click=Weihnachten, Hold=Terrasse)
// ---------------------------------------------------------------------------
onSwitch('00158d000ab7850f', 'Wohnzimmer Couchtisch', {
    single: () => toggle('0_userdata.0.trigger.scenes.lighting.christmas'),
    double: () => ackAlarm('Wohnzimmer Couchtisch'),
    hold:   () => toggle('sonoff.0.Wohnzimmer Anlage.POWER'),
});

// ---------------------------------------------------------------------------
//  6) Wohnzimmer Eintracht-Logo Nachtlicht
//     Logo dient tagsüber als Deko-Licht (via Astro-Schalter aus
//     scenes-lighting-everyday.js + auto-switch.js — schaltet sich um 01:00
//     hart aus und um 05:00 wieder ein). In dem 4-Stunden-Fenster dazwischen
//     soll es bei Wohnzimmer-Bewegung 60s als Nachtlicht reagieren, wenn es
//     tatsächlich dunkel ist.
//
//     Defense in depth:
//       1. Hartes Zeitfenster 01:00–05:00 (egal was der Lux-Sensor sagt)
//       2. `_manual`-Override (Party-Modus → nur loggen)
//       3. Lux-State-Fallback: `illuminance` (Vor-Re-Pair-Name) ODER
//          `illuminance_raw` (nach 2026-05-27 Re-Pair / ZigBee-Adapter-Update)
//       4. Fail-closed wenn beide States fehlen oder undefined sind
//       5. Auto-Off respektiert Ownership-Transfer: Wenn der 60s-Timer über
//          05:00 hinaus läuft, hat das Astro-Tag-Skript übernommen → kein Off
//
//     Bug-Historie:
//       2026-05-27 — `getState(...illuminance).val` lieferte `undefined` nach
//       dem CR2450-Re-Pair (Adapter heißt den State jetzt `illuminance_raw`).
//       `undefined > 15` ist `false` in JS, der Lux-Check schlug fehl, das
//       Logo ging tagsüber an. Plus: das Zeitfenster war im Skript nie
//       umgesetzt — Use-Case-Kommentar sprach nur von "dunkel".
//       2026-05-28 — Ownership-Transfer-Konflikt am Morgenende: Bewegung um
//       04:59:xx → 60s-Timer läuft bis ~05:00:xx → Astro hat um 05:00:00
//       das Logo via Tag-Schaltung übernommen, aber der Timer schaltete es
//       fälschlich wieder aus. Fix: isNightHours()-Check im setTimeout.
// ---------------------------------------------------------------------------
const WZ_MOTION_DEV     = '00158d0007c62b1b';
const EINTRACHT_LOGO    = 'sonoff.0.Eintracht Logo.POWER';
const MANUAL_OVERRIDE   = '0_userdata.0.trigger.scenes.lighting._manual';
const NIGHTLIGHT_LUX    = 15;
const NIGHTLIGHT_TIME   = 60 * 1000;  // 60 Sekunden
const NIGHT_START_HOUR  = 1;          // ab 01:00 inkl.
const NIGHT_END_HOUR    = 5;          // bis 05:00 exkl.

// Helper: aktueller Lux-Wert mit Adapter-Rename-Fallback. Liefert null wenn
// kein State einen numerischen Wert hat → Caller behandelt das als
// "Unklar — nicht auslösen".
function getWzLux() {
    const candidates = [
        `zigbee.0.${WZ_MOTION_DEV}.illuminance`,
        `zigbee.0.${WZ_MOTION_DEV}.illuminance_raw`,
    ];
    for (const id of candidates) {
        const s = getState(id);
        if (s && typeof s.val === 'number') return s.val;
    }
    return null;
}

// Helper: ist gerade Nacht im Sinne des Use-Cases?
function isNightHours() {
    const h = new Date().getHours();
    return h >= NIGHT_START_HOUR && h < NIGHT_END_HOUR;
}

let eintrachtTimeout = null;

on({ id: `zigbee.0.${WZ_MOTION_DEV}.occupancy`, val: true, change: 'ne' }, () => {
    // (2) Party-Override: Lichtsteuerung manuell überschrieben → nichts tun.
    if (getState(MANUAL_OVERRIDE).val === true) {
        log(`Wohnzimmer-Bewegung erkannt, aber _manual=true (Party-Modus) — Eintracht-Logo bleibt aus`, 'info');
        return;
    }
    // (1) Außerhalb des Nacht-Fensters macht das Logo via Astro seine Sache.
    if (!isNightHours()) {
        log(`Wohnzimmer-Bewegung außerhalb Nacht-Fenster (Stunde ${new Date().getHours()}) — Eintracht-Logo bleibt aus`, 'debug');
        return;
    }
    // (3) Lux mit Fallback holen.
    const lux = getWzLux();
    // (4) Fail-closed bei fehlendem Wert.
    if (lux === null) {
        log(`Wohnzimmer-Bewegung nachts, aber kein Lux-Wert verfügbar — fail-closed, Eintracht-Logo bleibt aus`, 'warn');
        return;
    }
    if (lux > NIGHTLIGHT_LUX) {
        log(`Wohnzimmer-Bewegung nachts erkannt, aber zu hell (${lux} lx) — Eintracht-Logo bleibt aus`, 'debug');
        return;
    }
    log(`Wohnzimmer-Nachtbewegung (${lux} lx) — Eintracht-Logo 60s an`, 'info');
    setState(EINTRACHT_LOGO, true);
    if (eintrachtTimeout) clearTimeout(eintrachtTimeout);
    eintrachtTimeout = setTimeout(() => {
        // Wenn der Timer über 05:00 hinaus läuft, hat das Astro-Tag-Skript
        // (scenes-lighting-everyday) inzwischen die Ownership übernommen —
        // nicht ausschalten, sonst kippt das Logo nach dem morgendlichen
        // Astro-Einschalten fälschlich wieder aus.
        if (!isNightHours()) {
            log('Eintracht-Logo Auto-Off übersprungen — Nacht-Fenster vorbei (Astro hat übernommen)', 'info');
            eintrachtTimeout = null;
            return;
        }
        setState(EINTRACHT_LOGO, false);
        eintrachtTimeout = null;
    }, NIGHTLIGHT_TIME);
});

// ============================================================================
//  Initialisierungs-Log
// ============================================================================
log('scenes.lighting.smart-switches geladen — 7 Switches + 1 Motion-Trigger aktiv', 'info');
