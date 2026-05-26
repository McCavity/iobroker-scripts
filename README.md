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
│   └── export-scripts.sh   ← runs on iobapp02; uses iobroker CLI to dump scripts/
└── scripts/                ← auto-generated; one file per ioBroker script object
    ├── common/
    │   ├── signaltower-controller.js
    │   └── signaltower-heartbeat.js
    ├── global/
    │   └── signaltower-helper.js
    ├── scenes/
    │   └── lighting/
    │       ├── auto-switch.js
    │       ├── christmas.js
    │       ├── everyday.js
    │       └── smart-switches.js
    └── erinnerungen/
        ├── battery_check.js
        └── ...
```

The directory tree under `scripts/` mirrors the dotted ioBroker path: `script.js.scenes.lighting.smart-switches` → `scripts/scenes/lighting/smart-switches.js`.

## File format

Each `.js` file starts with a comment block carrying the object's metadata, then the source as-is:

```javascript
/* iobroker-scripts-export
 * id:         script.js.common.signaltower-heartbeat
 * name:       signaltower-heartbeat
 * engineType: Javascript/Typescript
 * enabled:    true
 */

const HEARTBEAT_URL = 'http://172.16.31.241:5000/heartbeat';
// ... rest of the script
```

For Blockly scripts, the source contains both the Blockly XML (as a comment) and the rendered JS — saving as `.js` works for both.

## Workflow

### One-off restore (rare, but the reason this repo exists)

1. SSH `iobuser@iobapp02`
2. Find the file you want
3. Copy the source (everything after the `*/` of the frontmatter) into a fresh ioBroker script with the matching engine type and enabled-state from the frontmatter

### Periodic export

`tools/export-scripts.sh` runs on the iobapp02 host (NOT inside ioBroker) and uses the `iobroker` CLI to list + dump all script objects:

```bash
# On iobapp02:
bash /home/iobuser/iobroker-scripts/tools/export-scripts.sh

# Then on Mac (where this repo's local clone has gh auth):
rsync -av iobuser@iobapp02:/home/iobuser/iobroker-scripts/scripts/ \
          ~/git/projects/own/iobroker-scripts/scripts/
cd ~/git/projects/own/iobroker-scripts
git add -A
git diff --cached --quiet || git commit -m "auto-export $(date +%Y-%m-%d_%H:%M)"
git push
```

For now this is manual; host-cron is a future enhancement.

## Related

- [`homelab-docker`](https://github.com/McCavity/homelab-docker) — same solo-maintainer pattern (MIT, BP, .env-based secrets)
- ki-os vault `08-resources/iob-scripts/` — manually-maintained reference copies of the most important scripts (will be deprecated once this repo is the canonical source)
