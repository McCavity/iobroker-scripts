/* iobroker-scripts-export
 * id:         script.js.scenes.lighting.everyday
 * name:       everyday
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  scenes.lighting.everyday
// ============================================================================
//  Ersetzt: scenes.0-Szene "Täglich" — täglich zu schaltende Lichter
//  (Terrasse / Eintracht-Logo / Billy-Regal-Fachbeleuchtung / etc.).
//  Hört auf den vorhandenen Trigger-Datenpunkt und schaltet 6 Geräte
//  parallel ein bzw. aus.
//
//  Pfad in ioBroker: script.js.scenes.lighting.everyday
//  Engine-Type: JavaScript/Typescript (NICHT Blockly)
//
//  Geschrieben: 2026-05-25 — Migration vom scenes.0-Adapter zu reinem JS,
//  analog zu scenes-lighting-christmas.js. Hauptauslöser ist der
//  Sonnenstand-Schedule in `auto-switch-2026.js` (sunset-30 / sunrise+30
//  plus 01:00 / 05:00 Backup-Schedules), der den Trigger-Datenpunkt
//  `0_userdata.0.trigger.scenes.lighting.everyday` setzt.
//
//  Trigger-Verhalten (1:1 wie die Original-Szene):
//    Trigger = true  → alle 6 Lichter TRUE
//    Trigger = false → alle 6 Lichter FALSE
//
//  Geräte-Mix:
//    - Sonoff-Steckdosen für Eintracht-Logo und das zweckentfremdete
//      "Büro Stereoanlage"-Topic (sitzt physisch im Wohnzimmer als
//      Dekolicht)
//    - ZigBee-Steckdose draußen für die Terrassen-Lichterketten
//    - 3× IKEA Tradfri Hubs für die Billy-Regal-Fachbeleuchtung im
//      Wohnzimmer
// ============================================================================

const EVERYDAY_TRIGGER = '0_userdata.0.trigger.scenes.lighting.everyday';

const EVERYDAY_LIGHTS = [
    'sonoff.0.Eintracht Logo.POWER',         // Eintracht-Logo (Wohnzimmer)
    'zigbee.0.7cb03eaa0a0c8179.state',       // Terrasse Außensteckdose (2 Lichterketten)
    'sonoff.0.Büro Stereoanlage.POWER',      // Dekolicht im Wohnzimmer (zweckentfremdetes Topic)
    'zigbee.0.00be44fffe9a61ee.state',       // Tradfri-Hub #1 — Billy-Regal Fachbeleuchtung
    'zigbee.0.00be44fffe7a23a2.state',       // Tradfri-Hub #2 — Billy-Regal Fachbeleuchtung
    'zigbee.0.00be44fffe9a621b.state',       // Tradfri-Hub #3 — Billy-Regal Fachbeleuchtung
];

on({ id: EVERYDAY_TRIGGER, change: 'ne' }, (obj) => {
    const target = !!obj.state.val;
    log(`Täglich-Szene: ${target ? 'AN' : 'AUS'} (${EVERYDAY_LIGHTS.length} Lichter)`, 'info');
    for (const light of EVERYDAY_LIGHTS) {
        setState(light, target);
    }
});

log('scenes.lighting.everyday geladen — 6 tägliche Lichter verdrahtet', 'info');

