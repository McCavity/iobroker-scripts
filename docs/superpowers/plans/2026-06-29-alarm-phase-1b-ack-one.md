# Phase 1b — `ack_one` (Einzel-Alarm-Quittierung) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der ioBroker-Empfänger kann einen einzelnen Alarm per Fingerprint quittieren (`ack_one`), zusätzlich zum bestehenden `ack_all`.

**Architecture:** Reine Quittier-Logik im node-testbaren `alarm-core` (`applyAck(alarms, id)` + `computeOutputs`-Präzedenz `ackId` > `ack`). Der Fingerprint wird über einen neuen String-DP `0_userdata.0.alerting.ack_one` von der `alarm-ack-bridge` (parst MQTT-Ack) zum `alarm-orchestrator` (subscribt DP, ruft `drive`) getragen. Der bestehende boolean-`ack`-DP (Wandschalter-Pfad) bleibt unangetastet = `ack_all`.

**Tech Stack:** ioBroker JS-Adapter (iobroker.javascript v7), reine JS-Module mit `module.exports` für `node:test`, `node --test` als Test-Runner.

## Global Constraints

- **Node-Testbarkeit:** Reine Funktionen tragen KEINE ioBroker-Globals zur Ladezeit; nur sie werden via `node --test` getestet. Adapter-Code (`on`/`setState`/`getState`/`createState`) liegt im `else`-Zweig (`typeof module … else`) und bleibt ungetestet — bestehende Konvention.
- **ACK = „gesehen", KEIN Grafana-Silence.** Quittierter Alarm bleibt in der `list`, bis Grafana ihn nicht mehr meldet.
- **Signaltower/Beacon-Semantik unverändert:** `fast_blink`, solange irgendein Alarm `!acked` (any-unacked = Aufmerksamkeit). `ack_one` beruhigt nur eine Triage-Zeile, nicht die physische Säule.
- **Single-Device `office`** — der `ack_one`-DP ist single-tree wie `ack`. Multi-Device = Phase 1b+.
- **`applyAck` ohne id bleibt rückwärtskompatibel** (= alle acked) — bestehende Aufrufer/Tests dürfen nicht brechen.
- **Test-Runner:** `npm test` (= `node --test`). Require-Pfade: core `../scripts/global/alarm-core.js`, bridge `../scripts/common/alarm-ack-bridge.js`.
- **Commit-Messages enden mit:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Deployment propagiert NICHT automatisch:** geänderte Skripte müssen über den UI-Export-Flow zurück nach ioBroker gepastet werden (manuell, durch Henning).

## File Structure

- `scripts/global/alarm-core.js` — reine Logik. `applyAck` erhält optionalen 2. Parameter `id`; `computeOutputs` bekommt `opts.ackId`-Pfad. (Tasks 1+2)
- `tests/alarm-core.test.js` — neue Tests für `applyAck(id)` + `computeOutputs(ackId)`. (Tasks 1+2)
- `scripts/common/alarm-orchestrator.js` — neuer DP `ack_one`, `drive(ackPressed, ackId)`, neue Subscription. Kein node-Test (ioBroker-Globals). (Task 3)
- `scripts/common/alarm-ack-bridge.js` — `ack_one`-Routing in den neuen DP statt ignorieren. `parseAckPayload` unverändert (bereits getestet). Kein neuer node-Test. (Task 4)

---

### Task 1: `applyAck(alarms, id)` — Einzel-Alarm-Ack im Core

**Files:**
- Modify: `scripts/global/alarm-core.js:49`
- Test: `tests/alarm-core.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts (erste Task).
- Produces: `applyAck(alarms: Array<{id, acked, ...}>, id?: string) → Array` — bei nicht-leerem String `id` wird nur der Alarm mit `a.id === id` `acked:true`; bei fehlender/leerer `id` werden ALLE `acked:true`; unbekannte `id` → No-op. Gibt stets frische Objekt-Kopien zurück.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/alarm-core.test.js` ans Ende anhängen:

```js
test('applyAck(id): nur der Match wird acked, übrige unverändert', () => {
  const out = C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], 'a');
  assert.equal(out.find(x => x.id === 'a').acked, true);
  assert.equal(out.find(x => x.id === 'b').acked, false);
});
test('applyAck(unbekannte id): No-op, keiner acked', () => {
  const out = C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], 'zzz');
  assert.ok(out.every(a => a.acked === false));
});
test('applyAck(leere/fehlende id): rückwärtskompatibel → alle acked', () => {
  assert.ok(C.applyAck([{id:'a',acked:false},{id:'b',acked:false}], '').every(a => a.acked === true));
  assert.ok(C.applyAck([{id:'a',acked:false}], undefined).every(a => a.acked === true));
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag verifizieren**

Run: `npm test`
Expected: Die drei neuen Tests schlagen fehl (`applyAck(id)` ignoriert heute den 2. Parameter und setzt immer alle → „nur der Match"-Test scheitert an `b.acked === false`, „No-op"-Test scheitert ebenfalls). Die bestehenden Tests bleiben grün.

- [ ] **Step 3: Minimale Implementierung**

In `scripts/global/alarm-core.js` Zeile 49 ersetzen:

```js
function applyAck(alarms) { return alarms.map(a => Object.assign({}, a, { acked: true })); }
```

durch:

```js
// id (optional): nicht-leerer String → nur dieser Alarm acked (Einzel-Quittierung, Phase 1b);
// fehlend/leer → alle acked (ack_all, rückwärtskompatibel). Unbekannte id → No-op. Stets Kopien.
function applyAck(alarms, id) {
  const all = !(typeof id === 'string' && id);
  return alarms.map(a => (all || a.id === id)
    ? Object.assign({}, a, { acked: true })
    : Object.assign({}, a));
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg verifizieren**

Run: `npm test`
Expected: Alle Tests grün (die drei neuen + die bestehende `applyAck: setzt acked=true auf alle`).

- [ ] **Step 5: Commit**

```bash
git add scripts/global/alarm-core.js tests/alarm-core.test.js
git commit -m "$(cat <<'EOF'
feat(alarm-core): applyAck(alarms, id) — Einzel-Alarm-Ack (Phase 1b)

Optionaler id-Parameter quittiert nur den Match; ohne id weiterhin alle
(rückwärtskompatibel), unbekannte id → No-op.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `computeOutputs` — `opts.ackId`-Präzedenz vor `opts.ack`

**Files:**
- Modify: `scripts/global/alarm-core.js:99`
- Test: `tests/alarm-core.test.js` (anhängen)

**Interfaces:**
- Consumes: `applyAck(alarms, id)` aus Task 1.
- Produces: `computeOutputs(prevState, sourcesMap, opts)` akzeptiert zusätzlich `opts.ackId: string`. Wenn gesetzt → nur dieser Alarm acked (Präzedenz vor `opts.ack`). `opts.ack` (boolean = ack_all) bleibt unverändert.

- [ ] **Step 1: Failing-Tests schreiben**

In `tests/alarm-core.test.js` ans Ende anhängen (nutzt die vorhandene Konstante `TS`):

```js
test('computeOutputs: ackId → nur der eine Alarm acked, fast_blink bleibt', () => {
  const prev = {alarms:[
    {id:'a',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
    {id:'b',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
  ]};
  const r = C.computeOutputs(prev, {grafana:[
    {id:'a',host:'H',name:'n',severity:'warning'},
    {id:'b',host:'H',name:'n',severity:'warning'},
  ]}, {ackId:'a', mode:'normal', ts:TS, deviceId:'office'});
  assert.equal(r.state.alarms.find(x => x.id === 'a').acked, true);
  assert.equal(r.state.alarms.find(x => x.id === 'b').acked, false);
  assert.deepEqual(r.signaltower, {colour:'AMBER', mode:'fast_blink'});
});
test('computeOutputs: ackId hat Präzedenz vor ack (nur der eine, nicht alle)', () => {
  const prev = {alarms:[
    {id:'a',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
    {id:'b',host:'H',name:'n',severity:'warning',source:'grafana',acked:false},
  ]};
  const r = C.computeOutputs(prev, {grafana:[
    {id:'a',host:'H',name:'n',severity:'warning'},
    {id:'b',host:'H',name:'n',severity:'warning'},
  ]}, {ack:true, ackId:'a', mode:'normal', ts:TS, deviceId:'office'});
  assert.equal(r.state.alarms.find(x => x.id === 'a').acked, true);
  assert.equal(r.state.alarms.find(x => x.id === 'b').acked, false);
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag verifizieren**

Run: `npm test`
Expected: Beide neuen Tests scheitern (`computeOutputs` kennt `opts.ackId` heute nicht → `a.acked` bleibt `false`).

- [ ] **Step 3: Minimale Implementierung**

In `scripts/global/alarm-core.js` Zeile 99 ersetzen:

```js
  if (opts.ack) alarms = applyAck(alarms);
```

durch:

```js
  // Präzedenz: opts.ackId (Einzel, Phase 1b) vor opts.ack (alle). Beide leer → kein Ack.
  if (opts.ackId) alarms = applyAck(alarms, opts.ackId);
  else if (opts.ack) alarms = applyAck(alarms);
```

- [ ] **Step 4: Tests laufen lassen, Erfolg verifizieren**

Run: `npm test`
Expected: Alle Tests grün (insb. bleibt `computeOutputs: ack → signaltower on, kein new` grün — `opts.ack` ohne `ackId`).

- [ ] **Step 5: Commit**

```bash
git add scripts/global/alarm-core.js tests/alarm-core.test.js
git commit -m "$(cat <<'EOF'
feat(alarm-core): computeOutputs opts.ackId — Präzedenz vor ack (Phase 1b)

opts.ackId (string) quittiert nur den einen Alarm; Präzedenz vor opts.ack
(ack_all). Beide leer → kein Ack.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Orchestrator — `ack_one`-DP + Subscription + `drive(ackPressed, ackId)`

**Files:**
- Modify: `scripts/common/alarm-orchestrator.js` (createState-Block ~Z.21-24, `drive` Z.75-77, `ready` Z.91-100)

**Interfaces:**
- Consumes: `computeOutputs(..., {ackId})` aus Task 2.
- Produces: DP `0_userdata.0.alerting.ack_one` (string). Ein nicht-leerer Schreibwert quittiert den Alarm mit dieser Fingerprint-id; der Handler ruft `drive(false, id)` und setzt den DP wieder auf `''`. (Konsument: Task 4.)

Kein node-Test — der gesamte Orchestrator nutzt ioBroker-Globals (kein `module.exports`). Verifikation = Regressions-Suite grün + manuelle ioBroker-Beobachtung (Step 5).

- [ ] **Step 1: `ack_one`-DP idempotent anlegen**

In `scripts/common/alarm-orchestrator.js` nach Zeile 21 (`createState(DP + 'ack', …)`) einfügen:

```js
createState(DP + 'ack_one', '', { name: 'alerting ack_one', type: 'string', role: 'state', read: true, write: true });
```

- [ ] **Step 2: `drive` um `ackId` erweitern**

`drive`-Signatur (Z.75) und den `computeOutputs`-Aufruf (Z.76-77) ersetzen:

```js
function drive(ackPressed) {
  const out = computeOutputs(currentState, readSources(),
    { ack: !!ackPressed, mode: readMode(), ts: new Date().toISOString(), deviceId: DEVICE_ID });
```

durch:

```js
function drive(ackPressed, ackId) {
  const out = computeOutputs(currentState, readSources(),
    { ack: !!ackPressed, ackId: ackId, mode: readMode(), ts: new Date().toISOString(), deviceId: DEVICE_ID });
```

(Bestehende Aufrufer `drive(false)` / `drive(true)` übergeben `ackId=undefined` → `computeOutputs` ignoriert es.)

- [ ] **Step 3: `ack_one`-Subscription in `ready()` ergänzen**

Nach der bestehenden ack-Subscription (Z.94, `on({ id: DP + 'ack', val: true }, …)`) einfügen:

```js
  on({ id: DP + 'ack_one', change: 'ne' }, () => {
    const id = String((getState(DP + 'ack_one') || {}).val || '');
    if (!id) return;                          // Reset-Schreibung ('') ignorieren
    drive(false, id);
    setState(DP + 'ack_one', '', true);       // Reset, analog zum ack→false
  });
```

- [ ] **Step 4: Regressions-Suite laufen lassen**

Run: `npm test`
Expected: Alle Tests grün (der Orchestrator wird von keinem Test importiert → keine neuen Tests, aber sicherstellen, dass nichts anderes brach).

- [ ] **Step 5: Commit**

```bash
git add scripts/common/alarm-orchestrator.js
git commit -m "$(cat <<'EOF'
feat(alarm-orchestrator): ack_one-DP + drive(ackPressed, ackId) (Phase 1b)

Neuer String-DP 0_userdata.0.alerting.ack_one; Subscription ruft
drive(false, id) und resettet den DP. Boolean-ack (ack_all) unverändert.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

> **Manuelle ioBroker-Verifikation (nach Deployment, durch Henning):** Skript `alarm-core` (Global) + `alarm-orchestrator` pasten. Dann mit ≥2 feuernden Alarmen den DP `0_userdata.0.alerting.ack_one` von Hand auf eine Fingerprint-id setzen → erwartetes Log `alarm-orchestrator: N Alarm(e) …`, im `state`-DP genau dieser Alarm `acked:true`, übrige `false`, Signaltower bleibt `fast_blink`, DP danach wieder `''`.

---

### Task 4: Ack-Bridge — `ack_one` in den `ack_one`-DP routen

**Files:**
- Modify: `scripts/common/alarm-ack-bridge.js` (Adapter-`else`-Zweig Z.50 + Z.62-64, Kommentar Z.20-21)

**Interfaces:**
- Consumes: DP `0_userdata.0.alerting.ack_one` aus Task 3; `parseAckPayload` (unverändert, liefert bereits `{valid, action, id}`).
- Produces: end-to-end `ack_one`-Pfad (MQTT → DP → Orchestrator).

`parseAckPayload` ist bereits vollständig getestet (`tests/alarm-ack-bridge.test.js` Z.9-16, ack_one mit/ohne id) → kein neuer node-Test. Der geänderte Code liegt im ungetesteten Adapter-`else`-Zweig.

- [ ] **Step 1: `ACK_ONE_TARGET`-Konstante ergänzen**

In `scripts/common/alarm-ack-bridge.js` nach Zeile 50 (`const TARGET = '0_userdata.0.alerting.ack';`) einfügen:

```js
  const ACK_ONE_TARGET = '0_userdata.0.alerting.ack_one';   // Einzel-Quittierung (Phase 1b)
```

- [ ] **Step 2: `ack_one`-Zweig statt Ignorieren**

Den `else`-Zweig (Z.62-64) ersetzen:

```js
    } else {
      log('alarm-ack-bridge: ack_one (id=' + parsed.id + ') ignoriert — Phase 1b', 'info');
    }
```

durch:

```js
    } else if (parsed.action === 'ack_one') {
      if (!parsed.id) {
        log('alarm-ack-bridge: ack_one ohne id verworfen', 'warn');   // KEIN Fallback auf ack_all
        return;
      }
      setState(ACK_ONE_TARGET, parsed.id);
      log('alarm-ack-bridge: ack_one (id=' + parsed.id + ') → ' + ACK_ONE_TARGET);
    }
```

- [ ] **Step 3: Header-Kommentar aktualisieren**

Die Zeilen 20-21:

```js
// Phase 1a: nur action="ack_all" (der Orchestrator kann heute nur ack_all). action="ack_one"
// (mit id) wird geloggt + ignoriert → Phase 1b (braucht Single-ID-Ack im Core).
```

ersetzen durch:

```js
// ack_all → boolean-DP 0_userdata.0.alerting.ack (Wandschalter-Pfad). ack_one (mit id) →
// String-DP 0_userdata.0.alerting.ack_one (Phase 1b). ack_one ohne id wird verworfen.
```

- [ ] **Step 4: Regressions-Suite laufen lassen**

Run: `npm test`
Expected: Alle Tests grün (insb. die 9 `parseAckPayload`-Tests unverändert).

- [ ] **Step 5: Commit**

```bash
git add scripts/common/alarm-ack-bridge.js
git commit -m "$(cat <<'EOF'
feat(alarm-ack-bridge): ack_one → ack_one-DP routen (Phase 1b)

ack_one (mit id) schreibt 0_userdata.0.alerting.ack_one statt ignoriert zu
werden; ack_one ohne id wird verworfen (kein Fallback auf ack_all).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

> **Manuelle End-to-End-Verifikation (nach Deployment, durch Henning):** alle drei Skripte deployt. `mosquitto_pub -h 192.168.178.152 -p 1884 -u <user> -P <pass> -t alarmbutton/office/ack -m '{"action":"ack_one","id":"<fingerprint eines feuernden Alarms>"}'` → Bridge-Log `ack_one (id=…) → …ack_one`, Orchestrator quittiert genau diesen Alarm, retained `list` trägt für ihn `acked:true`. `ack_all` weiterhin via Wandschalter + `{"action":"ack_all"}`.

---

## Abschluss

Nach Task 4: Branch `claude/alarm-phase-1b-ack-one` enthält Spec + 4 Implementierungs-Commits. PR gegen `main` öffnen (durch Henning oder auf Wunsch). Im PR-Body vermerken: **ack_one wirkt erst nach Deployment** der drei Skripte (`alarm-core` Global, `alarm-orchestrator` + `alarm-ack-bridge` common) über den UI-Export-Flow; Firmware kann `ack_one` contract-first unabhängig nachziehen.
