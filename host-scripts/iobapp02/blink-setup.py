#!/usr/bin/env python3
"""
Erst-Setup für blinkpy mit zweistufigem 2FA-Flow.
    /home/iobuser/blink-venv/bin/python /home/iobuser/blink-setup.py
"""
import asyncio
import os
import sys
from getpass import getpass
from aiohttp import ClientSession
from blinkpy.blinkpy import Blink
from blinkpy.auth import Auth, BlinkTwoFARequiredError

CRED_PATH = '/home/iobuser/blink-data/blink.cred.json'

async def main():
    email = input('Blink-Email: ').strip()
    password = getpass('Blink-Passwort: ')

    session = ClientSession()
    try:
        blink = Blink(session=session)
        blink.auth = Auth(
            {'username': email, 'password': password},
            no_prompt=False,
            session=session,
        )

        print('\n[*] Starte Login ...')
        try:
            await blink.start()
        except BlinkTwoFARequiredError:
            print('\n[*] 2FA erforderlich.')
            print('    Hinweis: PIN ist typisch ~10 Min gültig. Wenn du gerade')
            print('    eben den PIN bekommen hast (z.B. vom vorigen Versuch), nimm den.')
            pin = input('2FA-PIN aus Mail: ').strip()
            ok = await blink.auth.complete_2fa_login(pin)
            if not ok:
                print('[!] 2FA-Verifikation fehlgeschlagen.')
                sys.exit(1)
            print('[OK] 2FA bestätigt, lade jetzt Networks ...')
            await blink.start()

        await blink.save(CRED_PATH)
        os.chmod(CRED_PATH, 0o600)
        print(f'\n[OK] Tokens gespeichert: {CRED_PATH} (Mode 600)')
        print(f'[OK] Networks: {list(blink.networks.keys())}')
        print(f'[OK] Sync-Module: {[sm.name for sm in blink.sync.values()]}')
        print(f'[OK] Cameras: {list(blink.cameras.keys())}')
    finally:
        await session.close()

if __name__ == '__main__':
    asyncio.run(main())
