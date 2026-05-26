#!/bin/bash
# ============================================================================
#  tools/export-scripts.sh
# ============================================================================
#  Exportiert alle script.js.*-Objekte aus dem laufenden ioBroker als
#  Textdateien nach $SCRIPTS_DIR.
#
#  Ausführen auf dem ioBroker-Host (iobapp02) als iobuser:
#      bash /home/iobuser/iobroker-scripts/tools/export-scripts.sh
#
#  Danach (vom Mac aus oder direkt):
#      rsync -av iobuser@iobapp02:/home/iobuser/iobroker-scripts/scripts/ \
#                ~/git/projects/own/iobroker-scripts/scripts/
#      cd ~/git/projects/own/iobroker-scripts
#      git add -A
#      git diff --cached --quiet || git commit -m "auto-export $(date +%Y-%m-%d_%H:%M)"
#      git push
# ============================================================================

set -euo pipefail

REPO="/home/iobuser/iobroker-scripts"
SCRIPTS_DIR="$REPO/scripts"
IOBROKER="iobroker"   # /usr/local/bin/iobroker oder /opt/iobroker/iobroker — beides geht über PATH

# ---------------------------------------------------------------------------
#  Sanity-Checks
# ---------------------------------------------------------------------------
command -v "$IOBROKER" >/dev/null 2>&1 || { echo "FAIL: iobroker CLI nicht im PATH" >&2; exit 1; }
command -v jq         >/dev/null 2>&1 || { echo "FAIL: jq nicht installiert" >&2; exit 1; }

if [ ! -d "$REPO" ]; then
    echo "FAIL: $REPO existiert nicht — git clone fehlt?" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
#  Vorher leeren — sonst bleiben Karteileichen für gelöschte Skripte stehen
# ---------------------------------------------------------------------------
rm -rf "$SCRIPTS_DIR"
mkdir -p "$SCRIPTS_DIR"

# ---------------------------------------------------------------------------
#  Skript-IDs ermitteln. "iobroker list scripts" gibt jeweils eine Zeile:
#      "+ instance 0 group.scriptname"
#      "- instance 0 group.disabled-scriptname"
#  Wir nehmen die letzte Spalte (Skript-Pfad ohne "script.js." Prefix).
# ---------------------------------------------------------------------------
SCRIPT_TAILS=$("$IOBROKER" list scripts 2>/dev/null | awk 'NF >= 2 { print $NF }')

WRITTEN=0
SKIPPED=0

while IFS= read -r short_id; do
    [ -z "$short_id" ] && continue
    full_id="script.js.$short_id"

    # Objekt holen — Fehler still wegstecken (Skript könnte zwischenzeitlich
    # gelöscht worden sein)
    obj=$("$IOBROKER" object get "$full_id" --pretty 2>/dev/null) || { SKIPPED=$((SKIPPED+1)); continue; }
    [ -z "$obj" ] && { SKIPPED=$((SKIPPED+1)); continue; }

    # Quelle extrahieren — wenn keine, ist's kein Skript-Objekt (Channel/Folder)
    source=$(echo "$obj" | jq -r '.common.source // empty')
    if [ -z "$source" ]; then
        SKIPPED=$((SKIPPED+1))
        continue
    fi

    # Metadaten für Frontmatter
    name=$(echo "$obj"       | jq -r '.common.name       // ""')
    engineType=$(echo "$obj" | jq -r '.common.engineType // "Javascript/Typescript"')
    enabled=$(echo "$obj"    | jq -r '.common.enabled    // false')
    debug=$(echo "$obj"      | jq -r '.common.debug      // false')
    verbose=$(echo "$obj"    | jq -r '.common.verbose    // false')

    # Pfad: "scenes.lighting.smart-switches" → "scenes/lighting/smart-switches.js"
    rel_path=$(echo "$short_id" | tr '.' '/')
    file_path="$SCRIPTS_DIR/$rel_path.js"

    mkdir -p "$(dirname "$file_path")"

    # Frontmatter + Source schreiben
    {
        echo "/* iobroker-scripts-export"
        echo " * id:         $full_id"
        echo " * name:       $name"
        echo " * engineType: $engineType"
        echo " * enabled:    $enabled"
        [ "$debug"   = "true" ] && echo " * debug:      true"
        [ "$verbose" = "true" ] && echo " * verbose:    true"
        echo " */"
        echo ""
        echo "$source"
    } > "$file_path"

    WRITTEN=$((WRITTEN+1))
done <<< "$SCRIPT_TAILS"

echo "$WRITTEN scripts written, $SKIPPED skipped (channels/folders/errors)"
echo "Target: $SCRIPTS_DIR"
echo ""
echo "Next: sync to local Mac repo and commit, e.g.:"
echo "  rsync -av iobuser@iobapp02:$SCRIPTS_DIR/ ~/git/projects/own/iobroker-scripts/scripts/"
echo "  cd ~/git/projects/own/iobroker-scripts && git add -A && git commit -m \"auto-export\" && git push"
