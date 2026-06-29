# Phase 1b — `ack_one` (Einzel-Alarm-Quittierung)

> Erstellt: 2026-06-29
> Repo: iobroker-scripts · Projekt: alarm-button
> Bezug: KI-OS-Vault `04-projects/alarm-button/mqtt-contract.md` §3.4, `design-2026-05-16-mini.md`
> Status: Design freigegeben (2026-06-29), bereit für Implementierungsplan

## Ziel

Der ioBroker-Empfänger soll einen **einzelnen** Alarm per Fingerprint quittieren können
(`ack_one`), zusätzlich zum bestehenden `ack_all`. Heute kann der Empfänger nur `ack_all`
(alle feuernden Alarme pauschal als „gesehen" markieren); `ack_one` wird in der Bridge
geloggt und verworfen.

Das ist **contract-first**: die Firmware kann `ack_one` unabhängig nachziehen — die
ioBroker-Seite ist nach dieser Phase bereit. (Die Firmware-Phase-1 hatte die
ack_all-vs-ack_one-Entscheidung noch offen; sie sendet ggf. weiterhin `ack_all`, was
unverändert funktioniert.)

**ACK = „gesehen", KEIN Grafana-Silence.** Ein quittierter Alarm bleibt in der `list`,
bis Grafana ihn nicht mehr meldet (= resolved). Silence wäre falsch — der Grafana-Poll
verwirft `suppressed`/`silenced` Alarme, ein Silence würde den acked Alarm aus der Liste
tilgen und das „gesehen ≠ behoben"-Modell brechen (Contract §3.4).

## Ausgangslage (Stand 2026-06-29, nach PR #5/#6/#7)

Ack-Kette heute:

```
Button → alarmbutton/office/ack (MQTT)
       → mqtt.0.alarmbutton.office.ack (State, JSON-String)
       → alarm-ack-bridge.js  (parseAckPayload)
            ├─ ack_all → setState 0_userdata.0.alerting.ack = true
            └─ ack_one → log + ignorieren   ← Phase 1b
       → alarm-orchestrator.js  on(ack, val:true) → drive(true)
       → alarm-core.computeOutputs({ ack:true }) → applyAck(alarms)  (ALLE acked)
       → list-Republish (mit acked-Flag, seit PR #5)
```

Relevante Fakten:
- `0_userdata.0.alerting.ack` ist ein **boolean** (`role:button`) und derselbe Pfad, den der
  Wandschalter-Ack schreibt (= `ack_all`). Ein boolean kann keine Fingerprint-id tragen.
- `parseAckPayload(raw)` in der Bridge extrahiert `id` für `ack_one` **bereits** korrekt
  (`{ valid, action, id }`).
- Die Bridge nutzt eine **exakte** State-id-Subscription (`mqtt.0.alarmbutton.office.ack`,
  `change:'ne'`) — Wildcard feuerte am echten System nicht (PR #7).
- `buildList` trägt `acked` pro Alarm (PR #5) → der Button kann nach `ack_one` den neuen
  Quittier-Stand der einen Zeile sehen.

## Architektur-Entscheidung

Der Fingerprint wird über einen **neuen String-DP** `0_userdata.0.alerting.ack_one`
getragen (statt den boolean-`ack`-DP auf JSON zu überladen):

- Typ-sauber (string vs. boolean), klare Trennung der zwei Quittier-Pfade.
- Der bestehende `ack`-DP (= Wandschalter-Pfad) bleibt **1:1 unangetastet** = `ack_all`.
- Spiegelt das bestehende DP-Muster (idempotenter `createState`, Reset nach Verarbeitung).

## Änderungen

### 1 — `alarm-core.js` (reine, node-testbare Logik)

- **`applyAck(alarms, id)`** — neue optionale 2. Stelle:
  - `id` = nicht-leerer String → nur den Alarm mit `a.id === id` auf `acked:true` setzen,
    übrige unverändert durchreichen.
  - `id` = `undefined`/`null`/`''` → **alle** `acked:true` (= heutiges Verhalten,
    rückwärtskompatibel; bestehende Aufrufer/Tests bleiben grün).
  - Unbekannte `id` (kein Match in `alarms`) → **No-op** (fail-safe, kein Wurf).
- **`computeOutputs(prevState, sourcesMap, opts)`** — Präzedenz beim Ack:
  ```js
  if (opts.ackId) alarms = applyAck(alarms, opts.ackId);
  else if (opts.ack) alarms = applyAck(alarms);
  ```
  `opts.ack` (boolean, = ack_all) bleibt bestehen; `opts.ackId` (string) ist neu.

### 2 — `alarm-orchestrator.js`

- Neuer DP idempotent anlegen:
  `createState(DP + 'ack_one', '', { name:'alerting ack_one', type:'string', role:'state', read:true, write:true })`.
- `drive(ackPressed, ackId)` — `ackId` in `computeOutputs`-`opts` durchreichen.
- Neue Subscription in `ready()`:
  ```js
  on({ id: DP + 'ack_one', change: 'ne' }, () => {
    const id = String((getState(DP + 'ack_one') || {}).val || '');
    if (!id) return;
    drive(false, id);
    setState(DP + 'ack_one', '', true);   // Reset, analog zum ack→false
  });
  ```
- Bestehender `on(ack, val:true)`-Handler unverändert (ack_all).

### 3 — `alarm-ack-bridge.js`

- `ack_one` nicht mehr ignorieren:
  ```js
  } else if (parsed.action === 'ack_one') {
    if (!parsed.id) { log('alarm-ack-bridge: ack_one ohne id verworfen', 'warn'); return; }
    setState('0_userdata.0.alerting.ack_one', parsed.id);
    log('alarm-ack-bridge: ack_one (id=' + parsed.id + ') → 0_userdata.0.alerting.ack_one');
  }
  ```
- **Kein** Fallback `ack_one`-ohne-id → `ack_all` (würde über-quittieren).
- `ack_all`-Zweig unverändert.

## Bewusst unverändert (mit Begründung)

- **Signaltower / rote Rundumleuchte:** `computeSignaltower` liefert `fast_blink`, solange
  *irgendein* Alarm `!acked`. → `ack_one` beruhigt nur **eine** Zeile in der
  Button-Triage-Queue; die physische Säule + die rote Leuchte bleiben amber-blinkend, bis
  **alles** quittiert ist. Das ist das gewollte „any unacked = Aufmerksamkeit"-Modell —
  kein Eingriff.
- **`list`-Republish:** `drive()` publisht am Ende immer die `list` → der Button bekommt
  nach `ack_one` die aktualisierte Liste mit `acked:true` für den einen Alarm.
- **Race / Stale-id** (Alarm zwischen list-Publish und ack resolved): `applyAck` findet
  keinen Match → No-op; `drive` republisht trotzdem die (dann ohne den Alarm) aktuelle Liste.
  Fail-safe, kein Fehler.
- **`new`-Beep:** `ack_one` läuft über `drive(false, id)` → `opts.ack:false`, kein
  Attention-Eintrag aus dem Ack → kein `new`-Event. Korrekt (Quittieren piept nicht).
- **Single-Device (`office`):** bleibt. Der `ack_one`-DP ist — wie `ack` — single-tree.
  Multi-Device (per-Gerät-Baum) ist Phase 1b+.

## Tests (`node --test`)

- **Core `applyAck(alarms, id)`**: (a) nur der Match wird `acked:true`, übrige unverändert;
  (b) unbekannte id → kein Alarm geändert (No-op); (c) leere/fehlende id → alle `acked:true`
  (Rückwärtskompatibilität).
- **Core `computeOutputs`**: mit `opts.ackId` → nur der eine Alarm acked; Präzedenz
  `ackId` vor `ack` (beide gesetzt → nur der eine).
- **Bridge `parseAckPayload`**: extrahiert `id` für `ack_one` bereits (vorhandene Tests
  decken das; ggf. expliziter Fall „ack_one ohne id → id:null").
- Adapter-Routing (`setState`) bleibt **ungetestet** (ioBroker-Globals im `else`-Zweig) —
  gleiche Konvention wie heute (nur die reinen Funktionen sind node-testbar).

## Deployment

Wie alles in diesem Repo: im Repo editieren, dann die **drei** Skripte über den
UI-Export-Flow zurück nach ioBroker pasten (`alarm-core` = Global; `alarm-orchestrator` +
`alarm-ack-bridge` = common). Änderungen propagieren **nicht** automatisch. Im PR vermerken,
dass `ack_one` erst nach dem Deploy end-to-end wirkt.

## Nicht in dieser Phase

- Multi-Device-Routing (per-Gerät-`alerting`-Baum).
- Firmware-Anpassung (eigenes Repo; contract-first, unabhängig).
- Per-Alarm-Snooze, Master-Mute, Severity-Farben (Phase 2).
