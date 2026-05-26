# iobroker-scripts

> Version-controlled backup of all `script.js.*` objects from my ioBroker instance.

Disaster-recovery for the scripts I run inside ioBroker (`iobapp02`). They normally live as objects inside ioBroker's internal database and are only included in the `backitup`-adapter's tar files — neither human-readable nor easy to diff over time. This repo extracts them as plain text files so I can:

- See changes over time (`git log`)
- Restore a single script after an accidental edit
- Re-deploy after a hardware failure
- Review by reading the same way I read any other repo

## Repository layout

```
.
├── README.md
├── CLAUDE.md          ← workflow notes for Claude Code
├── LICENSE            ← MIT
├── .gitignore
├── tools/
│   └── zip-to-scripts.py   ← converts an ioBroker UI ZIP export into scripts/
└── scripts/                ← one file per ioBroker script object
    ├── common/
    │   ├── signaltower-controller.js
    │   └── signaltower-heartbeat.js
    ├── global/
    │   └── signaltower-helpers.js
    └── scenes/
        └── lighting/
            ├── auto-switch.js
            ├── christmas.js
            ├── everyday.js
            └── smart-switches.js
```

The directory tree under `scripts/` mirrors the dotted ioBroker path: `script.js.scenes.lighting.smart-switches` → `scripts/scenes/lighting/smart-switches.js`.

## File format

Each `.js` file starts with a comment block carrying the object's metadata, then the source as-is:

```javascript
/* iobroker-scripts-export
 * id:         script.js.common.signaltower-heartbeat
 * name:       signaltower-heartbeat
 * engineType: Javascript/js
 * enabled:    true
 */

const HEARTBEAT_URL = 'http://172.16.31.241:5000/heartbeat';
// ... rest of the script
```

For Blockly scripts, the source contains both the Blockly XML (as a comment) and the rendered JS — saving as `.js` works for both.

## Workflow

### Periodic export

The ioBroker admin UI has a built-in scripts-export. Three steps:

1. **In ioBroker UI:** Skripte → 3-dots menu → „Exportieren" → ZIP downloads to `~/Downloads/YYYY-MM-DD-scripts.zip`
2. **On the Mac:**
   ```bash
   cd ~/git/projects/own/iobroker-scripts
   python3 tools/zip-to-scripts.py
   # → auto-detects newest *-scripts.zip in ~/Downloads
   # → wipes scripts/ and writes the fresh tree
   ```
3. **Commit:**
   ```bash
   git add -A
   git diff --cached --stat   # review what changed
   git commit -m "scripts export $(date +%Y-%m-%d)"
   git push
   ```

Pass an explicit path if needed: `python3 tools/zip-to-scripts.py /path/to/export.zip`.

### One-off restore

1. Find the file in this repo
2. Read the frontmatter for the original `id`, `engineType`, `enabled` state
3. In ioBroker UI: create a fresh script at the matching path, paste the source (everything after `*/` line)

## Related

- [`homelab-docker`](https://github.com/McCavity/homelab-docker) — same solo-maintainer pattern (MIT, BP, .env-based secrets)
- ki-os vault `08-resources/iob-scripts/` — manually-maintained reference copies of the most important scripts (will be deprecated once this repo is the canonical source)
