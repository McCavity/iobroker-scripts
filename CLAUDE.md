# CLAUDE.md — iobroker-scripts

> Workflow notes for Claude Code sessions in this repo.

## What this repo is

A version-controlled snapshot of all `script.js.*` objects from Hennings ioBroker instance on `iobapp02`. The actual source-of-truth is **ioBroker itself** — this repo is a downstream backup. So: edits in the repo do **not** automatically propagate to ioBroker.

## Editing flow

The intended editing direction is **ioBroker → repo**, not the other way around. If you change a script in this repo, you also need to copy it back into the ioBroker UI for the change to take effect. The exporter will then re-write the file on the next run.

## Why shell instead of ioBroker JS

We started with an ioBroker-JS exporter using `getObjectListAsync` — but the JavaScript-adapter sandbox in iobroker.javascript v7.x only exposes `getObjectAsync` (single object), not list / view APIs. Listing all `script.js.*` IDs requires either an unconvenient selector workaround, or simply shelling out to the well-tested `iobroker` CLI.

`tools/export-scripts.sh` calls `iobroker list scripts` + `iobroker object get` for each. Clean, no sandbox quirks, easy to test on the command line.

## Running the export

On the ioBroker host (`iobapp02`) as `iobuser`:

```bash
bash /home/iobuser/iobroker-scripts/tools/export-scripts.sh
```

Output: `N scripts written, M skipped — Target: /home/iobuser/iobroker-scripts/scripts/`

Then on the Mac (or wherever your repo clone lives):

```bash
rsync -av iobuser@iobapp02:/home/iobuser/iobroker-scripts/scripts/ \
          ~/git/projects/own/iobroker-scripts/scripts/
cd ~/git/projects/own/iobroker-scripts
git add -A
git diff --cached --quiet || git commit -m "auto-export $(date +%Y-%m-%d_%H:%M)"
git push
```

For a future cron job: the iobapp02-side rsync+push (with iobuser's GitHub credentials) is the cleanest path. For now, manual is fine — Henning runs it after meaningful changes.

## Repo conventions

- **License:** MIT
- **Branch protection:** Solo-Maintainer-Pattern (required_review=0, enforce_admins=false, no force-push, no deletion)
- **Public:** Yes — illustrative for others, secrets are LAN-only.
- **Secrets in scripts:** the signaltower key (`b6f43fe3...`) is committed because the endpoint is LAN-only (172.16.31.241). If this ever changes, the key has to rotate AND be pulled out into a config file.

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
// ...
```

For Blockly scripts, the source contains both the Blockly XML (as a comment block at top) and the rendered JS. Saving as `.js` works for both — the frontmatter's `engineType: Blockly` field flags it.

## Architecture decisions

### Why not store the JSON object dump directly?

The interesting part (source code) becomes hard to read in JSON-escaped strings; diffs are useless. Frontmatter-as-comment + plain JS body is the right format.

### Why `.js` for Blockly too?

ioBroker stores Blockly scripts with both XML and the rendered JS in `common.source`. Saving as `.js` preserves both, frontmatter flags `engineType: Blockly`. Re-importing means pasting the XML part into the Blockly editor.

### Where does the exporter live?

The canonical version lives in this repo as `tools/export-scripts.sh`. It runs on the iobapp02 host (NOT inside ioBroker), using the `iobroker` CLI. The repo's local clone on iobapp02 is at `/home/iobuser/iobroker-scripts/`.
