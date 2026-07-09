# host-scripts

Helfer-Skripte, die **direkt auf einem Host** laufen (nicht in ioBroker), aber
von ioBroker-Skripten via `exec()` aufgerufen werden. Hier versioniert, damit der
Stand nicht nur auf einer einzelnen Kiste liegt.

| Pfad | Host | Deploy-Ziel | Aufgerufen von |
|---|---|---|---|
| `iobapp02/blink_control.py` | iobapp02 | `/home/iobuser/blink_control.py` (mode 750, `iobuser:iobroker`) | `scripts/scenes/lighting/auto-switch.js` |
| `iobapp02/blink-setup.py` | iobapp02 | `/home/iobuser/blink-setup.py` (mode 700, `iobuser`) | interaktiv (Erst-Setup / Re-Auth des Blink-2FA-Tokens) |

## Deploy

Kein Auto-Deploy. Nach einer Änderung manuell:

```bash
scp host-scripts/iobapp02/blink_control.py iobapp02.lan:/home/iobuser/blink_control.py
ssh iobapp02.lan 'chmod 750 /home/iobuser/blink_control.py'
```

## Re-Auth (Blink-2FA-Token erneuern)

Blink erzwingt alle paar Wochen eine neue 2FA-Anmeldung. Symptom: Telegram-Alarm
`Blink: … fehlgeschlagen — Re-Auth erforderlich` (blink_control.py exit 2). Dann als
`iobuser` auf iobapp02 einmal interaktiv neu anmelden (E-Mail + Passwort + frische
SMS-PIN):

```bash
/home/iobuser/blink-venv/bin/python /home/iobuser/blink-setup.py
# danach verifizieren:
/home/iobuser/blink-venv/bin/python /home/iobuser/blink_control.py status
```

**Wichtig:** braucht **blinkpy ≥ 0.25.6** — Blink hat die 2FA-Aufforderung von
HTTP 412 auf **202 (TSV-Challenge)** umgestellt; ältere blinkpy erkennt das nicht und
meldet fälschlich „Login failed" trotz versendeter PIN (Vorfall 2026-07-09, Fix:
`pip install --upgrade blinkpy` im `blink-venv`).

## Tests

`iobapp02/test_blink_control.py` testet die verifizierte Set-Logik
(`_drive_to_state`) ohne echten Blink-Login (FakeSync + No-op-Sleeper). Muss im
`blink-venv` laufen (Import von `blink_control` zieht `blinkpy`):

```bash
scp host-scripts/iobapp02/test_blink_control.py iobapp02.lan:/home/iobuser/test_blink_control.py
ssh iobapp02.lan 'cd /home/iobuser && blink-venv/bin/python test_blink_control.py'
```
