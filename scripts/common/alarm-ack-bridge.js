/* iobroker-scripts-export
 * id:         script.js.common.alarm-ack-bridge
 * name:       alarm-ack-bridge
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// Phase 1a — Brücke: Button-Ack vom MQTT-Broker → Orchestrator-Ack-Datenpunkt.
//
// Der Alarm-Button publisht alarmbutton/<device>/ack. Der mqtt.0-Server-Adapter legt
// eingehende Client-Topics als Punkt-Pfad-States ab (verifiziert an den ButtonPlus-
// Wandschaltern: button/btn_fa21e8/3-1/click → mqtt.0.button.btn_fa21e8.3-1.click).
// Also landet der Ack als State mqtt.0.alarmbutton.<device>.ack (Payload = JSON-String).
//
// Dieser Handler parst den Payload und triggert den BESTEHENDEN Ack-Datenpunkt des
// Orchestrators (0_userdata.0.alerting.ack) — exakt derselbe Pfad wie der Wandschalter-Ack.
// Der Orchestrator (on {val:true}) macht daraus applyAck (alle acked) und setzt den DP
// selbst wieder auf false zurück.
//
// Phase 1a: nur action="ack_all" (der Orchestrator kann heute nur ack_all). action="ack_one"
// (mit id) wird geloggt + ignoriert → Phase 1b (braucht Single-ID-Ack im Core).
//
// ACK = "gesehen", KEIN Grafana-Silence (der Grafana-Poll verwirft suppressed Alarme →
// ein Silence würde den acked Alarm aus der Liste tilgen; siehe mqtt-contract §3.4).
//
// Aufbau wie alarm-core / alarm-source-grafana: die reine parseAckPayload(raw) hat KEINE
// ioBroker-Globals und ist via module.exports node-testbar. Der Adapter-Teil (on/setState)
// läuft NUR in ioBroker (else-Zweig).

function parseAckPayload(raw) {
  if (typeof raw !== 'string' || raw === '') return { valid: false };
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return { valid: false }; }
  if (!obj || typeof obj !== 'object') return { valid: false };
  const action = obj.action;
  if (action !== 'ack_all' && action !== 'ack_one') return { valid: false };
  return { valid: true, action, id: (typeof obj.id === 'string' && obj.id) ? obj.id : null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAckPayload };
} else {
  // ===================== ioBroker-Adapter =====================
  // Wildcard-Subscription (pattern-basiert): fängt den State auch dann, wenn der mqtt.0-Broker
  // ihn erst beim ERSTEN Button-Publish anlegt — kein "non-existent state"-Warning wie bei
  // exakter id. Eng genug, um die btn_*-Wandschalter (mqtt.0.button.*) nicht zu treffen.
  const SUB_PATTERN = 'mqtt.0.alarmbutton.*.ack';
  const TARGET = '0_userdata.0.alerting.ack';   // Orchestrator-Ack-DP (= Wandschalter-Pfad)

  // Single-Device (office): heute existiert genau ein alerting-Baum, daher routet jeder
  // alarmbutton-Ack auf den einen TARGET. Multi-Device (per-Gerät-Baum) = Phase 1b+.
  on({ id: SUB_PATTERN, change: 'ne' }, (obj) => {
    const raw = obj && obj.state ? obj.state.val : null;
    const parsed = parseAckPayload(raw);
    if (!parsed.valid) {
      log('alarm-ack-bridge: ungültiger Ack-Payload verworfen: ' + JSON.stringify(raw), 'warn');
      return;
    }
    if (parsed.action === 'ack_all') {
      setState(TARGET, true);   // command (ack=false) → Orchestrator on({val:true}) feuert + reset
      log('alarm-ack-bridge: ack_all → ' + TARGET + ' = true');
    } else {
      log('alarm-ack-bridge: ack_one (id=' + parsed.id + ') ignoriert — Phase 1b', 'info');
    }
  });

  log('alarm-ack-bridge bereit — hört auf ' + SUB_PATTERN);
}
