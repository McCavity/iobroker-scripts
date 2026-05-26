/* iobroker-scripts-export
 * id:         script.js.scenes.lighting.auto-switch
 * name:       auto-switch
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// auto-switch-v2 — blinkpy-CLI statt HAM-Adapter
// Setzt scenes.lighting.auto-switch (Blockly) ab — altes Skript bitte deaktivieren!

const BLINK_CMD = '/home/iobuser/blink-venv/bin/python /home/iobuser/blink_control.py';

function blinkSet(action) {
    // action = 'arm' oder 'disarm'
    // @ts-expect-error: ioBroker type defs don't include options arg
    exec(`${BLINK_CMD} ${action} Außen`, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
            log(`blink ${action} Außen FAILED: ${err.message} | stderr=${stderr}`, 'error');
        } else {
            log(`blink ${action} Außen ok: ${stdout.trim()}`);
        }
    });
}

async function istWeihnachtszeit() {
    const year = new Date().getFullYear();
    const heiligabend = getDateObject(`${year}-12-24`).getTime();
    const dayOfWeek = (() => { const d = getDateObject(heiligabend).getDay(); return d === 0 ? 7 : d; })();
    const my_1_Advent = heiligabend - 86400000 * (dayOfWeek + 21);
    const lichtmess = getDateObject(`${year}-02-03`).getTime();
    let result;
    if (compareTime(my_1_Advent, null, '>=', null)) result = true;
    else if (compareTime(lichtmess, null, '<=', null)) result = true;
    else result = false;
    console.debug(`Weihnachtszeit: ${result}`);
    return result;
}

async function beleuchtung(zustand) {
    if (getState('0_userdata.0.trigger.scenes.lighting._manual').val) return;
    console.debug('Schalte Weihnachtsbeleuchtung');
    if (await istWeihnachtszeit()) {
        setState('0_userdata.0.trigger.scenes.lighting.christmas', zustand);
        setState('mqtt.0.button.btn_fa21e8.5-1.wall', String(zustand));
        setState('mqtt.0.button.btn_fa21e8.5-1.label', 'Weihnacht');
    } else {
        setState('mqtt.0.button.btn_fa21e8.5-1.label', 'Fenster');
    }
    console.debug('Schalte tägliche Lichter');
    setState('0_userdata.0.trigger.scenes.lighting.everyday', zustand);
    setState('mqtt.0.button.btn_fa21e8.6-1.wall', String(zustand));
    await signal('BLUE', zustand ? 'on' : 'off', -1);
}

// Sonnenuntergang -30: Blink scharf + Beleuchtung
schedule({ astro: 'sunset', shift: -30 }, async () => {
    blinkSet('arm');
    if (compareTime('22:00', null, '<=')) {
        console.debug('Checke Beleuchtung ½h vor Sonnenuntergang');
        await beleuchtung(true);
    }
});

// Sonnenaufgang +30: Blink unscharf + Beleuchtung
schedule({ astro: 'sunriseEnd', shift: 30 }, async () => {
    blinkSet('disarm');
    if (compareTime('05:00', null, '>=')) {
        console.debug('Checke Beleuchtung ½h nach Sonnenaufgang');
        await beleuchtung(false);
    }
});

// Backup-Schedules (unverändert von alt)
schedule('0 1 * * *', async () => {
    console.debug('Checke Beleuchtung aus abends (01:00 Backup)');
    await beleuchtung(false);
});
schedule('0 5 * * *', async () => {
    console.debug('Checke Beleuchtung an morgens (05:00 Backup)');
    await beleuchtung(true);
});
