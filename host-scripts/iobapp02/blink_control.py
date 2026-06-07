#!/usr/bin/env python3
"""
blink_control.py — CLI für Blink-Sync-Modul-Steuerung.

Usage:
    blink_control.py status [<sync-name>]
    blink_control.py arm <sync-name>
    blink_control.py disarm <sync-name>

Exit-Codes:
    0 = OK
    1 = Usage-Fehler
    2 = Auth/Token-Fehler  (→ blink-setup.py neu ausführen)
    3 = Sync-Modul nicht gefunden
    4 = Blink-API-Fehler ODER Soll/Ist-Mismatch nach Retry (Befehl nicht bestaetigt)

Wichtig: arm/disarm verifizieren das Ergebnis (Ground-Truth-Re-Read) und
liefern exit 4, wenn der Ist-Zustand nach allen Versuchen nicht der Absicht
entspricht. Ein exit 0 bedeutet damit *bestaetigt gesetzt*, nicht nur
"keine Exception". Der aufrufende ioBroker-Code darf sich auf den exit-code
verlassen.
"""
import asyncio
import os
import sys
from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth
from blinkpy.helpers.util import json_load

CRED_PATH = '/home/iobuser/blink-data/blink.cred.json'

# Verifiziertes Setzen: nach jedem async_arm Ground-Truth re-lesen und gegen
# die Absicht pruefen. Blinks Command-Completion ist gelegentlich flakey
# (wait_for_command kann False liefern, ohne dass async_arm wirft) — daher
# Retry mit Backoff, bevor wir Mismatch als Fehler melden.
SET_ATTEMPTS = 3
SET_BACKOFF = (3, 6)  # Sekunden zwischen Versuch 1->2 und 2->3


async def _connect():
    session = ClientSession()
    try:
        cred = await json_load(CRED_PATH)
    except Exception as e:
        await session.close()
        print(f'Token-Datei nicht lesbar: {e}', file=sys.stderr)
        print('  -> /home/iobuser/blink-venv/bin/python /home/iobuser/blink-setup.py', file=sys.stderr)
        sys.exit(2)

    blink = Blink(session=session)
    blink.auth = Auth(cred, session=session)
    try:
        await blink.start()
    except Exception as e:
        await session.close()
        print(f'Login fehlgeschlagen: {e}', file=sys.stderr)
        print('  -> /home/iobuser/blink-venv/bin/python /home/iobuser/blink-setup.py', file=sys.stderr)
        sys.exit(2)
    return blink, session


async def _save_tokens(blink):
    """Token speichern (falls refresht), Mode 600 wiederherstellen."""
    try:
        await blink.save(CRED_PATH)
        os.chmod(CRED_PATH, 0o640)
    except Exception as e:
        print(f'(warn) Token-Save fehlgeschlagen: {e}', file=sys.stderr)


async def _cmd_status(name=None):
    blink, session = await _connect()
    try:
        if name:
            sync = blink.sync.get(name)
            if not sync:
                print(f"Sync-Modul '{name}' nicht gefunden. Verfügbar: {list(blink.sync.keys())}", file=sys.stderr)
                sys.exit(3)
            print(f"{name}: {'armed' if sync.arm else 'disarmed'}")
        else:
            for sync_name, sync in blink.sync.items():
                print(f"{sync_name}: {'armed' if sync.arm else 'disarmed'}")
        await _save_tokens(blink)
    finally:
        await session.close()


async def _read_arm_state(sync):
    """Frische Ground-Truth des Netz-Arm-Status lesen.

    Bewusst nur ``get_network_info()`` statt ``blink.refresh()`` — letzteres
    zieht auch den local-storage-manifest-Endpoint, der bei Henning gelegentlich
    in eine Stale-Schleife laeuft. ``sync.arm`` wird ohnehin aus dem
    network_info abgeleitet, das get_network_info() aktualisiert.

    Raises wenn der Status nicht verlaesslich lesbar ist (sync_module_error).
    """
    ok = await sync.get_network_info()
    if not ok:
        raise RuntimeError('get_network_info meldete sync_module_error / unavailable')
    return bool(sync.arm)


async def _drive_to_state(sync, want, sleeper=asyncio.sleep):
    """Setzt `sync` auf `want` (bool) und verifiziert per Ground-Truth-Re-Read.

    Retry mit Backoff bei Mismatch (Blinks Command-Completion ist gelegentlich
    flakey). Liefert den zuletzt gelesenen Ist-Zustand (bool) oder ``None``,
    wenn der Status nicht lesbar war.

    Reine Logik mit injizierbarem `sleeper` → ohne echte Wartezeiten und ohne
    blinkpy-Login testbar (siehe test_blink_control.py).
    """
    actual = None
    for attempt in range(SET_ATTEMPTS):
        # Befehl absetzen — blinkpy wartet intern (wait_for_command) auf
        # Vollendung, ignoriert aber dessen Bool-Ergebnis. Daher pruefen wir
        # selbst gegen die frisch gelesene Ground-Truth.
        try:
            await sync.async_arm(want)
        except Exception as e:
            print(f"(warn) async_arm Versuch {attempt + 1}/{SET_ATTEMPTS} warf: {e}", file=sys.stderr)
        try:
            actual = await _read_arm_state(sync)
        except Exception as e:
            print(f"(warn) Status-Read Versuch {attempt + 1}/{SET_ATTEMPTS} warf: {e}", file=sys.stderr)
            actual = None

        if actual == want:
            return actual
        if attempt < SET_ATTEMPTS - 1:
            await sleeper(SET_BACKOFF[min(attempt, len(SET_BACKOFF) - 1)])
    return actual


async def _cmd_set(name, value):
    blink, session = await _connect()
    try:
        sync = blink.sync.get(name)
        if not sync:
            print(f"Sync-Modul '{name}' nicht gefunden. Verfügbar: {list(blink.sync.keys())}", file=sys.stderr)
            sys.exit(3)

        want = bool(value)
        verb = 'arm' if want else 'disarm'
        actual = await _drive_to_state(sync, want)
        await _save_tokens(blink)

        if actual is None:
            print(f"{name}: unbekannt (Status nach {SET_ATTEMPTS} Versuchen nicht lesbar)", file=sys.stderr)
            sys.exit(4)

        # Verifiziertes Ergebnis auf stdout; exit-code spiegelt Soll==Ist.
        print(f"{name}: {'armed' if actual else 'disarmed'}")
        if actual != want:
            print(
                f"MISMATCH: {name} sollte nach {verb} '{'armed' if want else 'disarmed'}' sein, "
                f"ist aber '{'armed' if actual else 'disarmed'}' (nach {SET_ATTEMPTS} Versuchen)",
                file=sys.stderr,
            )
            sys.exit(4)
    finally:
        await session.close()


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('status', 'arm', 'disarm'):
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = args[0]
    if cmd == 'status':
        asyncio.run(_cmd_status(args[1] if len(args) > 1 else None))
    elif cmd in ('arm', 'disarm'):
        if len(args) < 2:
            print(f'Usage: blink_control.py {cmd} <sync-name>', file=sys.stderr)
            sys.exit(1)
        asyncio.run(_cmd_set(args[1], cmd == 'arm'))


if __name__ == '__main__':
    main()
