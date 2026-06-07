#!/usr/bin/env python3
"""Tests fuer die verifizierte Set-Logik (_drive_to_state) aus blink_control.py.

Laeuft auf iobapp02 im blink-venv (der Import von blink_control zieht blinkpy).
Reine Logik-Tests mit FakeSync + No-op-Sleeper — kein echter Blink-Login,
keine echten Wartezeiten.

    cd /home/iobuser && /home/iobuser/blink-venv/bin/python test_blink_control.py
"""
import asyncio
import sys

import blink_control as bc


class FakeSync:
    """Simuliert ein blinkpy-Sync-Modul fuer _drive_to_state.

    reads:  Arm-Zustaende, die aufeinanderfolgende arm-Reads liefern
            (letzter Wert wird wiederholt).
    gni_ok: Rueckgabe von get_network_info() (False => _read_arm_state raised).
    """

    def __init__(self, reads, gni_ok=True):
        self._reads = list(reads)
        self._gni_ok = gni_ok
        self._i = 0
        self.arm_calls = []

    async def async_arm(self, value):
        self.arm_calls.append(value)

    async def get_network_info(self):
        return self._gni_ok

    @property
    def arm(self):
        v = self._reads[min(self._i, len(self._reads) - 1)]
        self._i += 1
        return v


async def _run(sync, want):
    sleeps = []

    async def sleeper(seconds):
        sleeps.append(seconds)

    actual = await bc._drive_to_state(sync, want, sleeper=sleeper)
    return actual, sleeps


def check(name, cond):
    print(f"{'PASS' if cond else 'FAIL'}: {name}")
    if not cond:
        check.failed += 1


check.failed = 0


async def main():
    # 1) Sofort-Erfolg (disarm, schon disarmed): 1 Versuch, kein Sleep
    s = FakeSync(reads=[False])
    actual, sleeps = await _run(s, False)
    check("sofort-erfolg: actual=False", actual is False)
    check("sofort-erfolg: 1 async_arm-call", s.arm_calls == [False])
    check("sofort-erfolg: kein sleep", sleeps == [])

    # 2) Nie erfolgreich (disarm bleibt armed): 3 Versuche, 2 Sleeps, actual=True => exit 4
    s = FakeSync(reads=[True, True, True])
    actual, sleeps = await _run(s, False)
    check("nie-erfolg: actual=True (mismatch)", actual is True)
    check("nie-erfolg: 3 async_arm-calls", len(s.arm_calls) == 3)
    check("nie-erfolg: backoff 3+6", sleeps == [3, 6])

    # 3) Flaky dann Erfolg (disarm): Versuch1 armed, Versuch2 disarmed => 2 calls, 1 sleep
    s = FakeSync(reads=[True, False])
    actual, sleeps = await _run(s, False)
    check("flaky: actual=False", actual is False)
    check("flaky: 2 async_arm-calls", len(s.arm_calls) == 2)
    check("flaky: 1 sleep", sleeps == [3])

    # 4) Status nicht lesbar (get_network_info False) => actual=None => exit 4
    s = FakeSync(reads=[True], gni_ok=False)
    actual, sleeps = await _run(s, False)
    check("unlesbar: actual=None", actual is None)
    check("unlesbar: 3 Versuche", len(s.arm_calls) == 3)

    # 5) arm-Richtung (want=True): sofort armed
    s = FakeSync(reads=[True])
    actual, sleeps = await _run(s, True)
    check("arm: actual=True", actual is True)
    check("arm: async_arm(True)", s.arm_calls == [True])

    print(f"\n{'ALLE TESTS GRUEN' if check.failed == 0 else str(check.failed) + ' FEHLER'}")
    sys.exit(1 if check.failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
