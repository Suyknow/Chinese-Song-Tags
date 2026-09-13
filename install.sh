#!/bin/sh
# install.sh - install the launchd agent that auto-tags newly added Chinese songs.
#
# Copies the scripts to a stable location, generates a LaunchAgent for the
# current user, and loads it. No packages are installed; only macOS built-ins
# (osascript, launchd) are used.
#
# Environment overrides:
#   CHINESESONGS_HOME    install dir   (default: ~/.local/share/chinesesongs)
#   CHINESESONGS_NO_LOAD set to 1 to generate files without loading launchd
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
: "${HOME:?HOME is not set}"
PREFIX="${CHINESESONGS_HOME:-$HOME/.local/share/chinesesongs}"
# Fixed (not XDG_STATE_HOME): launchd does not inherit shell env vars, so a
# fixed path keeps manual runs and watched runs on the same state file.
STATE_DIR="$HOME/.local/state/chinesesongs"
LABEL="local.chinesesongs"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

# Locate the Music library (path varies between macOS versions).
MUSIC_LIB="$HOME/Music/Music/Music Library.musiclibrary"
[ -d "$MUSIC_LIB" ] || MUSIC_LIB="$HOME/Music/Music Library.musiclibrary"

# 1. install files ---------------------------------------------------------
mkdir -p "$PREFIX" "$STATE_DIR" "$HOME/Library/LaunchAgents"
cp "$DIR/tag_chinese_music.js" "$PREFIX/tag_chinese_music.js"
cp "$DIR/run-tagger.sh" "$PREFIX/run-tagger.sh"
chmod +x "$PREFIX/run-tagger.sh"

# 2. generate the LaunchAgent ---------------------------------------------
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/sh</string>
		<string>$PREFIX/run-tagger.sh</string>
		<string>launchd</string>
	</array>
	<key>WatchPaths</key>
	<array>
		<string>$MUSIC_LIB</string>
		<string>$MUSIC_LIB/Library.musicdb</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>15</integer>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
PLIST

# 3. load it ---------------------------------------------------------------
if [ "${CHINESESONGS_NO_LOAD:-0}" != "1" ]; then
	launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
	launchctl bootstrap "gui/$UID_NUM" "$AGENT"
fi

# 4. report ----------------------------------------------------------------
echo "Installed."
echo "  scripts : $PREFIX"
echo "  state   : $STATE_DIR/seen_ids.json"
echo "  log     : $STATE_DIR/tagger.log"
echo "  agent   : $AGENT"
if [ ! -d "$MUSIC_LIB" ]; then
	echo "WARNING: Music library not found at $MUSIC_LIB" >&2
	echo "         Edit the WatchPaths in $AGENT to point at your library." >&2
fi
echo
echo "Next: in Music, create a Smart Playlist with the rule"
echo "      Grouping  contains  \"Chinese Songs\"   (and enable Live updating)."
