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
//  Sendet via signaltower-helpers (global script) das Amber-Blink-Signal an
//  den Signaltower. Sobald die echte Alarm-Infrastruktur steht, hier zusätzlich
//  den State-Write für die Alarm-Quittung ergänzen (z.B. setState auf einen
//  0_userdata.0.alarm.ack-Datenpunkt).
// ---------------------------------------------------------------------------
function ackAlarm(source) {
    signalAlarm();  // aus script.js.global.signaltower-helpers → 3s Amber blink
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
//     Bewegung im Wohnzimmer + dunkel (<15 lx) → Eintracht-Logo 60s an
// ---------------------------------------------------------------------------
const WZ_MOTION_DEV     = '00158d0007c62b1b';
const EINTRACHT_LOGO    = 'sonoff.0.Eintracht Logo.POWER';
const NIGHTLIGHT_LUX    = 15;
const NIGHTLIGHT_TIME   = 60 * 1000;  // 60 Sekunden

let eintrachtTimeout = null;

on({ id: `zigbee.0.${WZ_MOTION_DEV}.occupancy`, val: true, change: 'ne' }, () => {
    const lux = getState(`zigbee.0.${WZ_MOTION_DEV}.illuminance`).val;
    if (lux > NIGHTLIGHT_LUX) {
        log(`Wohnzimmer-Bewegung erkannt, aber zu hell (${lux} lx) — Eintracht-Logo bleibt aus`, 'debug');
        return;
    }
    log(`Wohnzimmer-Nachtbewegung (${lux} lx) — Eintracht-Logo 60s an`, 'info');
    setState(EINTRACHT_LOGO, true);
    if (eintrachtTimeout) clearTimeout(eintrachtTimeout);
    eintrachtTimeout = setTimeout(() => {
        setState(EINTRACHT_LOGO, false);
        eintrachtTimeout = null;
    }, NIGHTLIGHT_TIME);
});

// ============================================================================
//  Initialisierungs-Log
// ============================================================================
log('scenes.lighting.smart-switches geladen — 7 Switches + 1 Motion-Trigger aktiv', 'info');

