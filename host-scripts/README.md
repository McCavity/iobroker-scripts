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
