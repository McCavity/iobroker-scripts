# CLAUDE.md — iobroker-scripts

> Workflow notes for Claude Code sessions in this repo.

## What this repo is

A version-controlled snapshot of all `script.js.*` objects from Hennings ioBroker instance on `iobapp02`. The actual source-of-truth is **ioBroker itself** — this repo is a downstream backup. Edits in the repo do **not** automatically propagate to ioBroker.

## Editing flow

The intended editing direction is **ioBroker → repo**, not the other way around. If you change a script in this repo, you also need to copy it back into the ioBroker UI for the change to take effect. The next ZIP export will overwrite the repo copy.

## How the export works

ioBroker's admin UI has a built-in scripts-export that produces a ZIP with one JSON file per script object (full `_id`, `common.*`, `native`, etc.). The path is `~/Downloads/YYYY-MM-DD-scripts.zip`.

`tools/zip-to-scripts.py` consumes that ZIP and writes our `scripts/` tree:

```bash
cd ~/git/projects/own/iobroker-scripts
python3 tools/zip-to-scripts.py    # auto-detects latest in ~/Downloads
```

## Why this approach (and not what we tried first)

We started with two paths that both failed:

1. **ioBroker JS-script using `getObjectListAsync`** — the JS-adapter sandbox in iobroker.javascript v7.x only exposes `getObjectAsync` (single object), not list / view APIs. Listing all `script.js.*` IDs from inside a script isn't possible without ugly workarounds.

2. **Shell script using `iobroker list scripts` + `jq` on iobapp02** — works in principle but needs `jq` installed (not default), needs git push from iobapp02 (no GitHub credentials configured for `iobuser`), and pulls us back into permissions management between `iobuser` and `iobroker` daemon user.

The UI's official ZIP export sidesteps all of this. ioBroker exports cleanly, Mac handles the conversion + git locally where credentials already exist.

## Repo conventions

- **License:** MIT
- **Branch protection:** Solo-Maintainer-Pattern (required PRs but `required_approving_review_count: 0`, `enforce_admins: false` — Henning bypasses for trivial direct pushes)
- **Public:** Yes — illustrative for others
- **Secrets in committed scripts:** the signaltower API key is committed because the endpoint is LAN-only (172.16.31.241). If this ever changes, rotate AND pull the key out into a config file before re-exporting.

## File format details

The frontmatter block tracks all fields needed for a restore:

```javascript
/* iobroker-scripts-export
 * id:         script.js.common.signaltower-heartbeat
 * name:       signaltower-heartbeat
 * engineType: Javascript/js                  ← "Javascript/js" or "Blockly" or "Rules"
 * enabled:    true                            ← restore should preserve this
 * debug:      true                            ← only present when true
 * verbose:    true                            ← only present when true
 * expert:     true                            ← only present when true
 */

<source code as-is>
```

For Blockly: `common.source` contains both the Blockly XML (as a `<xml>...</xml>` block at the top, inside a JS comment) and the rendered JS at the bottom. Saving as `.js` preserves both — the frontmatter `engineType: Blockly` flags it for re-import.

## Architecture decisions

### Why not store the raw JSON dump per script?

The JSON has the source code as a JSON-escaped string — newlines as `\n`, quotes as `\"`, etc. Diffs are useless across formatting changes; readability is terrible. Extracting to `.js` with frontmatter as JS comment is the right format.

### Why wipe `scripts/` before each export?

If we just overwrite, scripts deleted in ioBroker linger in the repo forever. Wiping ensures the repo reflects the current ioBroker state. Git tracks the deletions automatically.

### Future: cron job?

For full automation we'd need:
- A way to trigger the UI export non-interactively (the admin REST API at port 8081 can probably do this — `POST /scripts/export` or similar; not yet investigated)
- Git push from iobapp02 (or rsync to a host that can push)

Not needed for now — manual export is fine when meaningful changes happen.
