#!/bin/sh
# run-tagger.sh
# launchd wrapper for tag_chinese_music.js (incremental mode).
#
# - Resolves its own directory, so it works from wherever it is installed.
# - Serializes runs with a PID lock (concurrent manual/triggered runs can overlap).
# - Prunes log blocks older than 30 days on every run.
# - Appends one timestamped block per run, with a status field so failures are
#   visible regardless of osascript's exit code.
#
# Configuration (environment variables, all optional):
#   CHINESESONGS_TAG    tag value to write        (default: "Chinese Songs")
#   CHINESESONGS_STATE  incremental state file    (default: ~/.local/state/chinesesongs/seen_ids.json)
#   CHINESESONGS_LOG    log file                  (default: ~/.local/state/chinesesongs/tagger.log)
#
# Usage: run-tagger.sh [label]     (label defaults to "manual")

DIR="$(cd "$(dirname "$0")" && pwd)"
: "${HOME:?HOME is not set}"
OSA="/usr/bin/osascript"
SCRIPT="$DIR/tag_chinese_music.js"
STATE="${CHINESESONGS_STATE:-$HOME/.local/state/chinesesongs/seen_ids.json}"
LOG="${CHINESESONGS_LOG:-$HOME/.local/state/chinesesongs/tagger.log}"
TAG="${CHINESESONGS_TAG:-Chinese Songs}"
LABEL="${1:-manual}"
LOCKDIR="/tmp/chinesesongs.lock"

mkdir -p "$(dirname "$STATE")" "$(dirname "$LOG")" || exit 1

# --- serialize runs -------------------------------------------------------
if [ -d "$LOCKDIR" ]; then
	oldpid="$(cat "$LOCKDIR/pid" 2>/dev/null)"
	if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
		exit 0                     # owner is genuinely alive; never steal
	fi
	# No live owner. Remove if it recorded a dead PID, or if old enough that a
	# starting run would already have written its PID by now.
	if [ -n "$oldpid" ] || [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +5 2>/dev/null)" ]; then
		rm -rf "$LOCKDIR"
	else
		exit 0
	fi
fi
if ! mkdir "$LOCKDIR" 2>/dev/null; then
	exit 0
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -rf "$LOCKDIR" 2>/dev/null' EXIT INT TERM

# --- prune blocks older than 30 days --------------------------------------
if [ -f "$LOG" ]; then
	CUT="$(date -v-30d '+%Y-%m-%d')"
	if awk -v cut="$CUT" '
		/^# [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ {
			keep = (substr($2, 1, 10) >= cut)
		}
		keep { print }
	' "$LOG" > "$LOG.tmp" 2>/dev/null; then
		mv "$LOG.tmp" "$LOG"
	else
		rm -f "$LOG.tmp"      # never let a failed awk clobber the log
	fi
fi

# --- run and append -------------------------------------------------------
OUT="$("$OSA" -l JavaScript "$SCRIPT" incremental "tag=$TAG" "state=$STATE" 2>&1)"
RC=$?

STATUS="ok"
if [ "$RC" -ne 0 ]; then
	STATUS="error"
elif printf '%s\n' "$OUT" | grep -q '^ERROR'; then
	STATUS="error"
elif printf '%s\n' "$OUT" | grep -qE '^Failed[[:space:]]*: [1-9]'; then
	STATUS="failures"
fi

{
	printf '# %s run=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$LABEL"
	printf '%s\n' "$OUT"
	printf '# exit=%s status=%s\n' "$RC" "$STATUS"
} >> "$LOG"
