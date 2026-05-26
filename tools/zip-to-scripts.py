#!/usr/bin/env python3
"""
zip-to-scripts.py — Convert an ioBroker UI scripts-export ZIP into our scripts/ tree.

Workflow:
  1. In ioBroker UI: Skripte → Export (3-dots menu) → downloads a ZIP like
     ~/Downloads/YYYY-MM-DD-scripts.zip with one .json per script object.
  2. Run this script:
         python3 tools/zip-to-scripts.py
     (auto-detects the newest *-scripts.zip in ~/Downloads, or pass a path)
  3. Each script's common.source is written to scripts/<path>.js with a
     frontmatter comment block carrying id, name, engineType, enabled, etc.
  4. Existing scripts/ tree is wiped first, so deletions in ioBroker are
     reflected as deletions in the repo.
  5. git add -A && git commit && git push

Usage:
  python3 tools/zip-to-scripts.py                      # auto-find newest ZIP
  python3 tools/zip-to-scripts.py path/to/export.zip   # explicit ZIP
  python3 tools/zip-to-scripts.py path/to/unpacked/    # already-unpacked dir
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"


def find_latest_export_zip() -> Path:
    downloads = Path.home() / "Downloads"
    candidates = sorted(
        downloads.glob("*-scripts.zip"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        sys.exit(
            f"FAIL: keine *-scripts.zip in {downloads} — "
            "ioBroker UI: Skripte → Export ausführen, ZIP landet automatisch im Downloads-Ordner"
        )
    return candidates[0]


def unpack_zip(zip_path: Path) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="iobroker-export-"))
    print(f"  Unpacking {zip_path.name} into {tmp}")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(tmp)
    return tmp


def frontmatter(obj: dict, full_id: str) -> str:
    c = obj.get("common", {})
    lines = [
        "/* iobroker-scripts-export",
        f" * id:         {full_id}",
        f" * name:       {c.get('name', '')}",
        f" * engineType: {c.get('engineType', 'Javascript/Typescript')}",
        f" * enabled:    {str(c.get('enabled', False)).lower()}",
    ]
    if c.get("debug"):
        lines.append(" * debug:      true")
    if c.get("verbose"):
        lines.append(" * verbose:    true")
    if c.get("expert"):
        lines.append(" * expert:     true")
    lines.append(" */")
    lines.append("")
    return "\n".join(lines)


def process_tree(tree_root: Path) -> tuple[int, int]:
    """Walk tree_root, write .js for each script JSON. Returns (written, skipped)."""
    written = 0
    skipped = 0

    for json_file in sorted(tree_root.rglob("*.json")):
        try:
            obj = json.loads(json_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"  SKIP (bad JSON): {json_file.relative_to(tree_root)} — {e}")
            skipped += 1
            continue

        # Only script objects (type=script) with a source
        if obj.get("type") != "script":
            # Channel/folder JSON — skip
            skipped += 1
            continue

        source = obj.get("common", {}).get("source")
        if not isinstance(source, str):
            skipped += 1
            continue

        full_id = obj.get("_id", "")
        if not full_id.startswith("script.js."):
            # Defensive — shouldn't happen for type=script
            skipped += 1
            continue

        # Build path: script.js.scenes.lighting.smart-switches
        #          → scripts/scenes/lighting/smart-switches.js
        rel = full_id[len("script.js."):].replace(".", "/") + ".js"
        out_path = SCRIPTS_DIR / rel
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(frontmatter(obj, full_id) + source + "\n", encoding="utf-8")
        written += 1

    return written, skipped


def main() -> int:
    # Resolve source: arg, or auto-detect
    if len(sys.argv) > 1:
        source = Path(sys.argv[1]).expanduser().resolve()
        if not source.exists():
            sys.exit(f"FAIL: {source} existiert nicht")
    else:
        source = find_latest_export_zip()
        print(f"Auto-detected: {source}")

    # If ZIP, unpack to temp; if dir, use as-is
    cleanup_tmp = None
    if source.is_file() and source.suffix == ".zip":
        tree = unpack_zip(source)
        cleanup_tmp = tree
    elif source.is_dir():
        tree = source
    else:
        sys.exit(f"FAIL: weder ZIP noch Verzeichnis: {source}")

    # Wipe scripts/ — Karteileichen für gelöschte Skripte sollen rausfallen
    if SCRIPTS_DIR.exists():
        shutil.rmtree(SCRIPTS_DIR)
    SCRIPTS_DIR.mkdir(parents=True)

    print(f"Writing into {SCRIPTS_DIR}")
    written, skipped = process_tree(tree)

    if cleanup_tmp is not None:
        shutil.rmtree(cleanup_tmp, ignore_errors=True)

    print()
    print(f"Done: {written} scripts written, {skipped} non-script JSON entries skipped.")
    print()
    print("Next: review changes and commit:")
    print(f"  cd {REPO_ROOT}")
    print("  git status")
    print("  git add -A && git diff --cached --stat")
    print('  git commit -m "scripts export $(date +%Y-%m-%d)"')
    print("  git push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
