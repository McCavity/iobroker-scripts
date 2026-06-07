/* iobroker-scripts-export
 * id:         script.js.scenes.lighting.fernbedienung-henning
 * name:       fernbedienung-henning
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  scenes.lighting.fernbedienung-henning
// ============================================================================
//  Tasten-Belegung der tint-Szenen-Fernbedienung "Fernbedienung Henning"
//  (Müller-Licht MLI-404011/MLI-404049, zigbee.0.00158d0002d4d05a).
//
//  Die FB kann NUR Einfach-Klick (kein double/long) und sendet pro Taste einen
//  Scene-String nach .action (scene_1..scene_6, plus on/off/dim/color, hier
//  ungenutzt). .action ist momentan (resettet auf '') — daher change:'ne' +
//  leeren String ignorieren (gleiches Muster wie smart-switches.js).
//
//  Vier Tasten steuern die Alarm-Kette (PME-Selbsttest, siehe common/alarm-*),
//  eine ist ein Licht-Bonus:
//
//    scene_1  → TEST_WARN   alerting.test.trigger = 'warning'
//    scene_2  → TEST_CRIT   alerting.test.trigger = 'critical'
//    scene_3  → TEST_OK     alerting.test.trigger = ''        (Entwarnung)
//    scene_6  → ALM_ACK     alerting.ack          = true      (generischer Ack)
//    scene_5  → Toggle everyday-Beleuchtung (Bonus)
//    scene_4  → frei
//
//  Hinweis: JavaScript (kein Blockly), Engine "Javascript/js".
// ============================================================================

const REMOTE   = 'zigbee.0.00158d0002d4d05a.action';
const ALERTING = '0_userdata.0.alerting.';
const EVERYDAY = '0_userdata.0.trigger.scenes.lighting.everyday';

// Test-Severity setzen (Quelle: Fernbedienung). Ziel kommt von
// alarm-source-selftest; fehlt er, lieber warnen als still schlucken.
function setTrigger(value) {
    const id = ALERTING + 'test.trigger';
    if (!existsState(id)) {
        log(`Fernbedienung: ${id} fehlt — ist alarm-source-selftest geladen?`, 'warn');
        return;
    }
    setState(id, value);  // ack=false (Command) → Selftest-Handler feuert
    log(`Fernbedienung → test.trigger='${value}'`, 'info');
}

// Generischer Ack — Orchestrator quittiert und setzt den Button selbst zurück.
function pressAck() {
    const id = ALERTING + 'ack';
    if (!existsState(id)) {
        log(`Fernbedienung: ${id} fehlt — ist alarm-orchestrator geladen?`, 'warn');
        return;
    }
    setState(id, true);
    log('Fernbedienung → alerting.ack=true', 'info');
}

// Bonus: everyday-Beleuchtung umschalten (everyday.js/buttonplus.js reagieren).
function toggleEveryday() {
    if (!existsState(EVERYDAY)) {
        log(`Fernbedienung: ${EVERYDAY} fehlt`, 'warn');
        return;
    }
    const cur = getState(EVERYDAY).val;
    setState(EVERYDAY, !cur);
    log(`Fernbedienung → everyday ${cur} → ${!cur}`, 'info');
}

const ACTIONS = {
    scene_1: () => setTrigger('warning'),
    scene_2: () => setTrigger('critical'),
    scene_3: () => setTrigger(''),
    scene_6: pressAck,
    scene_5: toggleEveryday,
    // scene_4, on, off, brightness_*, color_* bewusst unbelegt
};

on({ id: REMOTE, change: 'ne' }, (obj) => {
    const action = obj.state.val;
    if (!action) return;  // momentaner '' -Reset ignorieren
    const handler = ACTIONS[action];
    if (handler) {
        handler();
    } else {
        log(`Fernbedienung: unbelegte Taste '${action}' — ignoriert`, 'debug');
    }
});

log('scenes.lighting.fernbedienung-henning geladen — tint-FB: 4 Alarm-Tasten + everyday-Toggle', 'info');
