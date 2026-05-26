/* iobroker-scripts-export
 * id:         script.js.scenes.lighting.christmas
 * name:       christmas
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  scenes.lighting.christmas
// ============================================================================
//  Ersetzt: scenes.0-Szene "Weihnachten" (Fensterbeleuchtung in der
//  Weihnachtszeit). Hört auf den vorhandenen Trigger-Datenpunkt und
//  schaltet die 7 Sonoff-Steckdosen parallel ein bzw. aus.
//
//  Pfad in ioBroker: script.js.scenes.lighting.christmas
//  Engine-Type: JavaScript/Typescript (NICHT Blockly)
//
//  Geschrieben: 2026-05-25 — Migration vom scenes.0-Adapter zu reinem JS.
//  Der scenes-Adapter speichert seine Szenen-Definitionen in Objects, die
//  via simple-api nicht lesbar sind (analog zum script.js-Filter). Statt
//  weiter mit dieser Black-Box zu leben und scenes.0 unrealistisch
//  beobachten/warten zu können: Logik direkt als JS, Konfiguration im
//  Vault versionierbar.
//
//  Trigger-Verhalten (1:1 wie die Original-Szene):
//    Trigger = true  → alle 7 Steckdosen TRUE
//    Trigger = false → alle 7 Steckdosen FALSE
//
//  Trigger-Quellen (heute):
//    - Couchtisch-Single-Click via scenes-lighting-smart-switches.js
//      (toggelt den Trigger-State, der dieses Skript dann auswertet)
//    - manuelles Setzen via Admin-UI / VIS / Telegram-Befehl
//
//  Wichtig: dieses Skript schaltet die "Wohnzimmer Anlage.POWER"-Steckdose
//  mit. Couchtisch-Hold (smart-switches) toggelt dieselbe Steckdose
//  unabhängig. Das ist OK als manuelle Übersteuerung — falls Konflikte
//  entstehen ("Christmas an aber Anlage aus"), liegt's an einer manuellen
//  Toggle-Aktion, nicht an einem Skript-Bug.
// ============================================================================

const CHRISTMAS_TRIGGER = '0_userdata.0.trigger.scenes.lighting.christmas';

const CHRISTMAS_LIGHTS = [
    'sonoff.0.Eßzimmer Balkon.POWER',
    'sonoff.0.Eßzimmer Fenster.POWER',
    'sonoff.0.Küche.POWER',
    'sonoff.0.Küche Spüle.POWER',
    'sonoff.0.Büro Lichterkette.POWER',
    'sonoff.0.Wohnzimmer Couch.POWER',
    'sonoff.0.Wohnzimmer Anlage.POWER',
];

on({ id: CHRISTMAS_TRIGGER, change: 'ne' }, (obj) => {
    const target = !!obj.state.val;
    log(`Weihnachten-Szene: ${target ? 'AN' : 'AUS'} (${CHRISTMAS_LIGHTS.length} Steckdosen)`, 'info');
    for (const light of CHRISTMAS_LIGHTS) {
        setState(light, target);
    }
});

log('scenes.lighting.christmas geladen — 7 Fensterbeleuchtungs-Steckdosen verdrahtet', 'info');

