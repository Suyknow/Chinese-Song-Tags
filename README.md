> 🌐 **English** | [中文](README_CN.md)

# Chinese-Song-Tags

Tag your Apple Music library with a **"Chinese Songs"** marker, so a **Smart
Playlist** can collect all Chinese-language tracks automatically — even when
their genre is `Pop`, `Blues`, `Rock`, etc. and nothing in the metadata says
"Chinese".

## Why this exists

Apple Music **Smart Playlists have no regex and no language field**. That means
there is no built-in rule for "title/artist/album contains Chinese characters".
The only workable approach is:

1. classify the tracks once (by looking at the characters in their metadata),
2. write a normal tag (the `Grouping` field) onto the matching tracks,
3. let a Smart Playlist match that tag and keep itself updated.

This project automates step 1 and 2, and keeps doing it for newly added tracks.

## Applicability

- **macOS only** (uses the built-in `osascript` + `launchd`; no packages to install).
- Works on a **local Apple Music / Music.app library**. Songs that are only
  streamed and never added to the library are not touched.
- Useful whenever you want to separate, e.g.:
  - **Mandarin / Cantonese / other Chinese** songs from a mixed library,
  - Chinese songs whose `Genre` is generic (`Pop`, `Blues`, …),
  - Simplified-Chinese tracks only (Traditional, Japanese kana, Korean and
    Japanese-only kanji are excluded by default),
- Any metadata field can be checked (`title`, `artist`, `album`) and any tag
  value can be used — see [Options](#options).

## How it works

```
Music library ──► tag_chinese_music.js ──► writes Grouping = "Chinese Songs"
                        ▲
        launchd agent (run-tagger.sh) watches the library and tags NEW songs
                        ▲
        Smart Playlist:  Grouping contains "Chinese Songs"   (Live updating ON)
```

- **Detection**: a track is tagged if at least one checked field contains Han
  characters **and** none of the checked fields contains Japanese kana, Hangul,
  Traditional Chinese, or a Japanese-only kanji (新字体/国字).
  Traditional Chinese is detected with the built-in
  `Traditional-Simplified` string transform (no external data).
- **Incremental**: a state file remembers the `persistentID` of every track it
  has already classified, so repeat runs only look at **tracks added in the
  last `since` days** (default 30). Adding a Chinese song therefore tags it in
  seconds without rescanning the whole library. Tracks in that window are
  re-checked on every run, so a song whose (cloud) metadata finishes loading
  after it was added still gets tagged.
- **Idempotent**: the tag is appended once; running again changes nothing.

## Requirements

- macOS with the **Music** app.
- A local Music library (default `~/Music/Music/Music Library.musiclibrary`).
- Nothing else. No Python/npm/Homebrew packages are installed.

## Install

```sh
git clone https://github.com/Suyknow/Chinese-Song-Tags.git
cd Chinese-Song-Tags
./install.sh
```

`install.sh` copies the scripts to `~/.local/share/chinesesongs`, generates a
LaunchAgent at `~/Library/LaunchAgents/local.chinesesongs.plist`, and loads it.
The agent runs once immediately and then whenever the Music library changes.

Then, in **Music**: `File ▸ New ▸ Smart Playlist`, set the rule

```
Grouping   contains   Chinese Songs
```

and tick **Live updating**.

> The first agent run performs a **full-library pass** (a one-time scan) so
> existing songs are classified. After that only new songs are checked.

## Usage (manual)

Run the tagger directly for previews, one-off scans, or a rule change:

```sh
osascript -l JavaScript tag_chinese_music.js preview       # read-only report
osascript -l JavaScript tag_chinese_music.js apply         # full scan + tag
osascript -l JavaScript tag_chinese_music.js incremental   # new songs only
```

### Modes

| Mode | What it does |
|---|---|
| `preview` | Lists matches. Changes nothing. |
| `apply` | Scans the whole library and tags every match (idempotent). |
| `incremental` | Classifies only tracks not seen before. First run is a full pass; later runs only inspect tracks added in the last `since` days. Used by the agent. |

### Options

Options are appended as `key=value`.

| Option | Default | Meaning |
|---|---|---|
| `field=grouping\|comment` | `grouping` | Which metadata field to write. |
| `tag=TEXT` | `Chinese Songs` | Tag value to write. |
| `title=0\|1` | `1` | Check the song title. |
| `artist=0\|1` | `1` | Check the artist. |
| `album=0\|1` | `1` | Check the album. |
| `kana=keep\|exclude` | `exclude` | Drop tracks containing Japanese kana. |
| `trad=keep\|exclude` | `exclude` | Drop tracks containing Traditional Chinese. |
| `hangul=keep\|exclude` | `exclude` | Drop tracks containing Korean Hangul. |
| `jp=keep\|exclude` | `exclude` | Drop tracks containing Japanese-only kanji. |
| `clear=1` | off | Remove the tag instead of adding it (`apply` only). |
| `limit=N` | off | Cap the number of tracks processed (testing). |
| `since=N` | `30` | `incremental`: only look at tracks added in the last N days. |
| `state=/path.json` | `~/.local/state/chinesesongs/seen_ids.json` | State file for `incremental`. |
| `dry=1` | off | `incremental`: report only, write nothing. |

Examples:

```sh
# preview what would be tagged, without writing
osascript -l JavaScript tag_chinese_music.js preview

# tag into the Comments field instead of Grouping
osascript -l JavaScript tag_chinese_music.js apply field=comment

# also allow Japanese kana (tag everything Han-looking)
osascript -l JavaScript tag_chinese_music.js apply kana=keep

# remove the tag everywhere
osascript -l JavaScript tag_chinese_music.js apply clear=1
```

### Wrapper configuration (environment variables)

The launchd wrapper `run-tagger.sh` reads these optional variables:

| Variable | Default |
|---|---|
| `CHINESESONGS_TAG` | `Chinese Songs` |
| `CHINESESONGS_STATE` | `~/.local/state/chinesesongs/seen_ids.json` |
| `CHINESESONGS_LOG` | `~/.local/state/chinesesongs/tagger.log` |

### Rebuilding after changing the rules

Changing an option (e.g. `kana`, `album`) makes `incremental` do one full pass,
but tags that no longer match are **not** removed automatically. To rebuild
cleanly:

```sh
osascript -l JavaScript tag_chinese_music.js apply clear=1   # remove all tags
rm -f ~/.local/state/chinesesongs/seen_ids.json               # reset state
osascript -l JavaScript tag_chinese_music.js incremental      # full re-tag
```

## Logs

The agent appends one timestamped block per run to
`~/.local/state/chinesesongs/tagger.log`, and prunes blocks older than 30 days
on every run. Each block ends with a `# exit=… status=ok|failures|error` line.

## Uninstall

```sh
./uninstall.sh          # remove the agent, keep state/log
./uninstall.sh --purge  # also delete state and log
```

To only remove the tag from your library:

```sh
osascript -l JavaScript tag_chinese_music.js apply clear=1
```

## Limitations

- **Heuristic language detection.** Chinese is inferred from characters, not
  from a real language field:
  - A Japanese track whose checked fields use only Chinese-shared, non-Traditional
    kanji and no kana (e.g. `大阪`, `京都`) can still be tagged. Add the
    characters to `JP_ONLY` in `tag_chinese_music.js` or use `jp=`/`kana=`.
  - Traditional-Chinese and Japanese tracks are excluded by default; flip
    `trad=` / `kana=` / `jp=` to `keep` to include them.
  - The `JP_ONLY` kanji list is curated, not exhaustive.
- `clear=1` removes the tag as a substring; if your own `Grouping` value embeds
  the tag inside a longer word it will be rewritten.
- Within the `since` window, tracks are re-checked every run, so manually
  removing the tag from a **recently added** song may cause a later run to add
  it back.
- Only the local library is processed; streaming-only items are ignored.

## Files

| File | Purpose |
|---|---|
| `tag_chinese_music.js` | The tagger (JXA). All detection logic. |
| `run-tagger.sh` | launchd wrapper: lock, log rotation, status reporting. |
| `install.sh` | Installs scripts + generates and loads the LaunchAgent. |
| `uninstall.sh` | Removes the LaunchAgent (optionally purges state/log). |
| `README.md` / `README_CN.md` | This document (English / Chinese). |

## License

This project is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
(Attribution-NonCommercial-ShareAlike). See [LICENSE](LICENSE).
