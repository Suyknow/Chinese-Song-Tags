#!/bin/sh
# uninstall.sh - remove the launchd agent installed by install.sh.
#
# Usage: ./uninstall.sh [--purge]
#   --purge  also delete the state file and log
set -eu

: "${HOME:?HOME is not set}"
LABEL="local.chinesesongs"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.local/state/chinesesongs"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$AGENT"
echo "Removed launch agent ($LABEL)."

if [ "${1:-}" = "--purge" ]; then
	rm -rf "$STATE_DIR"
	echo "Removed state and log: $STATE_DIR"
else
	echo "Kept state and log at: $STATE_DIR (use --purge to delete)."
fi
