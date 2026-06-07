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
    4 = Blink-API-Fehler
"""
import asyncio
import os
import sys
from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth
from blinkpy.helpers.util import json_load

CRED_PATH = '/home/iobuser/blink-data/blink.cred.json'


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


async def _cmd_set(name, value):
    blink, session = await _connect()
    try:
        sync = blink.sync.get(name)
        if not sync:
            print(f"Sync-Modul '{name}' nicht gefunden. Verfügbar: {list(blink.sync.keys())}", file=sys.stderr)
            sys.exit(3)
        try:
            await sync.async_arm(value)
        except Exception as e:
            print(f"API-Fehler beim {'arm' if value else 'disarm'}: {e}", file=sys.stderr)
            sys.exit(4)
        # Refresh damit sync.arm den neuen Status spiegelt
        try:
            await blink.refresh(force_cache=True)
        except Exception:
            pass  # Status-Refresh ist Bonus, nicht zwingend
        print(f"{name}: {'armed' if sync.arm else 'disarmed'}")
        await _save_tokens(blink)
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
