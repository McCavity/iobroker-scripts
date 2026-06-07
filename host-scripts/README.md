# host-scripts

Helfer-Skripte, die **direkt auf einem Host** laufen (nicht in ioBroker), aber
von ioBroker-Skripten via `exec()` aufgerufen werden. Hier versioniert, damit der
Stand nicht nur auf einer einzelnen Kiste liegt.

| Pfad | Host | Deploy-Ziel | Aufgerufen von |
|---|---|---|---|
| `iobapp02/blink_control.py` | iobapp02 | `/home/iobuser/blink_control.py` (mode 750, `iobuser:iobroker`) | `scripts/scenes/lighting/auto-switch.js` |

## Deploy

Kein Auto-Deploy. Nach einer Änderung manuell:

```bash
scp host-scripts/iobapp02/blink_control.py iobapp02.lan:/home/iobuser/blink_control.py
ssh iobapp02.lan 'chmod 750 /home/iobuser/blink_control.py'
```

## Tests

`iobapp02/test_blink_control.py` testet die verifizierte Set-Logik
(`_drive_to_state`) ohne echten Blink-Login (FakeSync + No-op-Sleeper). Muss im
`blink-venv` laufen (Import von `blink_control` zieht `blinkpy`):

```bash
scp host-scripts/iobapp02/test_blink_control.py iobapp02.lan:/home/iobuser/test_blink_control.py
ssh iobapp02.lan 'cd /home/iobuser && blink-venv/bin/python test_blink_control.py'
```
