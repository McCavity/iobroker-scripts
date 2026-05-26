/* iobroker-scripts-export
 * id:         script.js.tools.export-scripts
 * name:       export-scripts
 * engineType: Javascript/js
 * enabled:    true
 * expert:     true
 */
// ============================================================================
//  tools/export-scripts
// ============================================================================
//  Pfad in ioBroker: `script.js.tools.export-scripts`
//  Engine-Type:     JavaScript/Typescript
//
//  Schreibt alle `script.js.*`-Objekte als Dateien in:
//      /home/iobuser/iobroker-scripts/scripts/<path>.js
//
//  Triggern:
//    - manuell aus der UI durch Start-Klick
//    - oder per setState() auf `0_userdata.0.trigger.tools.export-scripts`
//
//  Nach dem Lauf auf dem Host iobapp02:
//      cd /home/iobuser/iobroker-scripts
//      git add -A
//      git diff --cached --quiet || git commit -m "auto-export $(date +%Y-%m-%d_%H:%M)"
//      git push
//
//  Repo: https://github.com/McCavity/iobroker-scripts
// ============================================================================

const fs   = require('fs');
const path = require('path');

const EXPORT_ROOT = '/home/iobuser/iobroker-scripts/scripts';

// ---------------------------------------------------------------------------
//  Trigger-Datenpunkt — falls Henning das Skript per setState() feuern will
// ---------------------------------------------------------------------------
createState('0_userdata.0.trigger.tools.export-scripts', false, {
    name:  'Trigger: tools/export-scripts (write false to fire)',
    type:  'boolean',
    role:  'button',
    read:  true,
    write: true,
});

on({ id: '0_userdata.0.trigger.tools.export-scripts', change: 'ne' }, () => {
    runExport();
});

// ---------------------------------------------------------------------------
//  Export-Logik
// ---------------------------------------------------------------------------

function frontmatter(obj) {
    const c = obj.common || {};
    const lines = [
        '/* iobroker-scripts-export',
        ` * id:         ${obj._id}`,
        ` * name:       ${c.name || ''}`,
        ` * engineType: ${c.engineType || 'Javascript/Typescript'}`,
        ` * enabled:    ${c.enabled === true}`,
    ];
    if (c.debug)   lines.push(` * debug:      true`);
    if (c.verbose) lines.push(` * verbose:    true`);
    lines.push(' */', '');
    return lines.join('\n');
}

function relPathFor(id) {
    // `script.js.scenes.lighting.smart-switches` → `scenes/lighting/smart-switches`
    return id.replace(/^script\.js\./, '').replace(/\./g, '/');
}

function wipeDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            wipeDir(full);
            try { fs.rmdirSync(full); } catch (e) { /* not empty, skip */ }
        } else {
            fs.unlinkSync(full);
        }
    }
}

async function runExport() {
    const started = new Date();
    let written  = 0;
    let skipped  = 0;

    try {
        // Vorher leeren — damit gelöschte Skripte auch aus der Repo-Snapshot fallen.
        // Wir machen das gezielt, statt rm -rf, um Symlinks o.ä. zu schonen.
        if (fs.existsSync(EXPORT_ROOT)) {
            wipeDir(EXPORT_ROOT);
        } else {
            fs.mkdirSync(EXPORT_ROOT, { recursive: true });
        }

        const result = await getObjectListAsync({
            startkey: 'script.js.',
            endkey:   'script.js.香',
        });

        for (const row of result.rows) {
            const obj = row.value;

            // Nur Skript-Objekte mit Source — keine Channels/Folders
            if (!obj || !obj.common || typeof obj.common.source !== 'string') {
                skipped++;
                continue;
            }

            const rel = relPathFor(obj._id);
            const filePath = path.join(EXPORT_ROOT, rel + '.js');

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, frontmatter(obj) + obj.common.source + '\n');
            written++;
        }

        const elapsed = ((Date.now() - started.getTime()) / 1000).toFixed(2);
        log(
            `export-scripts: ${written} files written, ${skipped} channels/folders skipped (${elapsed}s) — ` +
            `next: cd ${path.dirname(EXPORT_ROOT)} && git add -A && git commit && git push`,
            'info'
        );
    } catch (err) {
        log(`export-scripts: FAILED — ${err && err.stack || err}`, 'error');
    }
}

// ---------------------------------------------------------------------------
//  Einmal beim Script-Start automatisch laufen
// ---------------------------------------------------------------------------
runExport();

log('export-scripts bereit — write false to 0_userdata.0.trigger.tools.export-scripts to fire', 'info');
