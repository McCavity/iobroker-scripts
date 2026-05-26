# CLAUDE.md — iobroker-scripts

> Workflow notes for Claude Code sessions in this repo.

## What this repo is

A version-controlled snapshot of all `script.js.*` objects from Hennings ioBroker instance on `iobapp02`. The actual source-of-truth is **ioBroker itself** — this repo is a downstream backup. So: edits in the repo do **not** automatically propagate to ioBroker.

## Editing flow

The intended editing direction is **ioBroker → repo**, not the other way around. If you change a script in this repo, you also need to copy it back into the ioBroker UI for the change to take effect. The exporter will then re-write the file on the next run.

### Exception: tools/export-scripts.js

The exporter itself is the one file where the repo is the canonical source. To deploy it:

1. Open the file in the repo
2. Copy the entire contents into ioBroker as `script.js.tools.export-scripts` (engine type: JavaScript)
3. Save → it will export ALL scripts (including itself, into its own file)

## Running the export

```bash
ssh iobuser@iobapp02 \
  'sudo -u iobroker -- bash -c "cd /opt/iobroker && iobroker upload javascript"'  # only if you changed engine config
# Trigger the export script via the ioBroker UI or via setState():
ssh iobuser@iobapp02 \
  'curl -s "http://localhost:8087/set/script.js.tools.export-scripts.trigger?value=true&ack=false"'
# Then commit and push from the host:
ssh iobuser@iobapp02 \
  'cd /home/iobuser/iobroker-scripts && \
   git add -A && \
   git diff --cached --quiet || git commit -m "auto-export $(date +%Y-%m-%d_%H:%M)" && \
   git push'
```

## Repo conventions

- **License:** MIT
- **Branch protection:** Solo-Maintainer-Pattern (required_review=0, enforce_admins=false, no force-push, no deletion)
- **Public:** Yes — Henning's ioBroker setup is unique to his home, the scripts have illustrative value for others; secrets (API keys) ARE present but are LAN-only (signaltower behind home firewall)
- **Secrets:** Yes, the signaltower key (`b6f43fe3...`) is committed because the endpoint is LAN-only (172.16.31.241) and the "secret" only gates access from inside the network. If this ever changes, the key has to be rotated and pulled out into `.env`-style config.

## Architecture decisions

### Why not store the JSON object dump directly?

We considered exporting the full ioBroker object (JSON) per script. Rejected because:

- The interesting part (the source code) becomes hard to read inside JSON-escaped strings
- Diffs are useless across formatting changes that aren't real code changes
- The non-source fields are tiny — frontmatter as JS comment is enough

### Why `.js` for Blockly too?

ioBroker stores Blockly scripts with both XML and the rendered JS in `common.source` (XML as comment block, then JS). Saving as `.js` preserves both, and the frontmatter's `engineType: Blockly` field flags it. Reimporting a Blockly file means pasting the XML part into the Blockly editor — which it auto-detects.

### Where does the exporter live?

The canonical version lives in this repo as `tools/export-scripts.js`. It is COPIED into ioBroker as `script.js.tools.export-scripts` to run there. The exporter exports itself in the process, so after the first run, the version inside ioBroker and the version in the repo stay in sync (modulo the manual deploy step).
