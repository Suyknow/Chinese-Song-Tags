#!/usr/bin/osascript -l JavaScript
/*
 tag_chinese_music.js

 Tag Apple Music library tracks whose TITLE, ARTIST or ALBUM looks like
 (Simplified) Chinese, by writing a marker into each track's Grouping (or
 Comments). A Smart Playlist can then filter on that marker and keep itself
 up to date.

 Why this exists: Apple Music Smart Playlists have NO regex and NO language
 field, so there is no built-in way to build a "Chinese songs" playlist. Once
 the tracks carry a known tag, a Smart Playlist match like
 `Grouping contains "Chinese Songs"` does exactly that, and updates live.

 A track is tagged only if at least one checked field contains Han characters
 AND none of the checked fields contains Japanese kana, Hangul, Traditional
 Chinese, or a Japanese-only kanji. Every check is configurable (see options).

 Modes (first argument):
   preview      read-only report, changes NOTHING
   apply        full scan and tag every match (idempotent)
   incremental  classify only tracks not seen before. Reads just the tracks
                added in the last `since` days, keeps a local state file of
                classified persistent IDs, so repeat runs are cheap.

 Usage:
   osascript -l JavaScript tag_chinese_music.js preview
   osascript -l JavaScript tag_chinese_music.js apply
   osascript -l JavaScript tag_chinese_music.js incremental

 Options (append as key=value):
   field=grouping|comment    metadata field to write     (default: grouping)
   tag=MyTag                 value to write              (default: Chinese Songs)
   title=0|1                 match the song title        (default: 1)
   artist=0|1                match the artist            (default: 1)
   album=0|1                 include the album           (default: 1)
   kana=keep|exclude         drop Japanese kana          (default: exclude)
   trad=keep|exclude         drop Traditional Chinese    (default: exclude)
   hangul=keep|exclude       drop Korean (Hangul)        (default: exclude)
   jp=keep|exclude           drop Japanese-only kanji    (default: exclude)
   clear=1                   REMOVE the tag instead of adding it
   limit=N                   preview/apply: cap matches; incremental: cap new
                             tracks inspected (for testing)
   state=/path.json          incremental state file
   since=N                   incremental: only look at tracks added in the last
                             N days (default: 30)
   dry=1                     incremental: report only, write nothing

 Examples:
   osascript -l JavaScript tag_chinese_music.js preview
   osascript -l JavaScript tag_chinese_music.js apply
   osascript -l JavaScript tag_chinese_music.js incremental dry=1
   osascript -l JavaScript tag_chinese_music.js apply clear=1
*/

ObjC.import('Foundation');

function homeDir() {
  try {
    var h = $.NSProcessInfo.processInfo.environment.objectForKey('HOME');
    return h ? ObjC.unwrap(h) : '';
  } catch (e) { return ''; }
}

var HOME = homeDir();
var DEFAULT_STATE = (HOME || '/tmp') + '/.local/state/chinesesongs/seen_ids.json';

function readText(path) {
  try {
    var s = $.NSString.stringWithContentsOfFileEncodingError(
      path, $.NSUTF8StringEncoding, null);
    if (!s || s.isNil()) return null;
    return ObjC.unwrap(s);
  } catch (e) { return null; }
}

function writeText(path, text) {
  try {
    var dir = path.replace(/\/[^/]*$/, '');
    $.NSFileManager.defaultManager
      .createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, null, null);
    return $.NSString.stringWithString(text)
      .writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
  } catch (e) { return false; }
}

// Japanese-only kanji (shinjitai + kokuji) that are not valid Chinese
// characters. Any of these in a field marks the track as Japanese. This list
// is a heuristic -- extend it if you find Japanese tracks slipping through.
var JP_ONLY = '働峠畑辻込凪枠栃匂笹麿榊凧凩俣噺畠雫躾粂譲駅円広沢辺剣竜圧変応齢弐択訳釈歓観覚実対経続総転発検権関楽様産顔臓稲穂縄繊聴脳荘蔵薬蛍覧徳恵絵繋鶏塩増奨摂壌嬢弾帰済歳桜図悪戦単労効収処戸抜拠挙拝歯毎気浄涙渋満瀬焼猟読遅郷醸鉄銭錬険雑霊頼顕験髪闘';
var JP_SET = {};
for (var _ji = 0; _ji < JP_ONLY.length; _ji++) JP_SET[JP_ONLY.charAt(_ji)] = 1;
function hasJapaneseKanji(s) {
  if (!s) return false;
  for (var i = 0; i < s.length; i++) if (JP_SET[s.charAt(i)]) return true;
  return false;
}

function run(argv) {
  var args = argv || [];
  var mode = (args[0] || 'preview').toLowerCase();
  var opt = {};
  for (var i = 1; i < args.length; i++) {
    var kv = args[i].split('=');
    opt[kv[0]] = kv.length > 1 ? kv.slice(1).join('=') : '1';
  }
  function flag(name, def) {
    if (!(name in opt)) return def;
    var v = String(opt[name]).toLowerCase();
    return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
  }
  var field = (opt.field || 'grouping').toLowerCase();
  var tag = opt.tag || 'Chinese Songs';
  var matchTitle = flag('title', true);
  var matchArtist = flag('artist', true);
  var matchAlbum = flag('album', true);
  var kanaMode = (opt.kana || 'exclude').toLowerCase();
  var tradMode = (opt.trad || 'exclude').toLowerCase();
  var hangulMode = (opt.hangul || 'exclude').toLowerCase();
  var jpMode = (opt.jp || 'exclude').toLowerCase();
  var clear = flag('clear', false);
  var limit = parseInt(opt.limit, 10);
  if (!isFinite(limit) || limit <= 0) limit = 0;
  var statePath = opt.state || DEFAULT_STATE;
  var sinceDays = parseInt(opt.since, 10);
  if (!isFinite(sinceDays) || sinceDays <= 0) sinceDays = 30;
  var dry = flag('dry', false);

  if (field !== 'grouping' && field !== 'comment') {
    return 'ERROR: field must be grouping or comment';
  }
  if (['preview', 'apply', 'incremental'].indexOf(mode) === -1) {
    return 'ERROR: mode must be preview, apply or incremental.';
  }
  if (mode === 'incremental' && clear) {
    return 'ERROR: clear=1 is not supported in incremental mode; use apply clear=1.';
  }

  var HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3005\u3007]/;
  var KANA = /[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9D]/;
  var HANGUL = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;

  function hasHan(s) { return !!s && HAN.test(s); }
  function hasKana(s) { return !!s && KANA.test(s); }
  function hasHangul(s) { return !!s && HANGUL.test(s); }

  // Traditional detection: apply the built-in Traditional->Simplified transform;
  // if it changes the text, the text contained Traditional characters.
  function hasTraditional(s) {
    if (!s) return false;
    try {
      var r = $.NSString.stringWithString(s)
        .stringByApplyingTransformReverse('Traditional-Simplified', false);
      return r ? (ObjC.unwrap(r) !== s) : false;
    } catch (e) { return false; }
  }

  // Tagged only if at least one checked field has Han characters and NONE of the
  // checked fields contains kana, Hangul, Traditional or Japanese-only kanji.
  function isChineseTrack(name, artist, album) {
    var vals = [];
    if (matchTitle) vals.push(name);
    if (matchArtist) vals.push(artist);
    if (matchAlbum) vals.push(album);
    var anyHan = false, bad = false;
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i] || '';
      if (hasHan(v)) anyHan = true;
      if (kanaMode === 'exclude' && hasKana(v)) bad = true;
      if (tradMode === 'exclude' && hasTraditional(v)) bad = true;
      if (hangulMode === 'exclude' && hasHangul(v)) bad = true;
      if (jpMode === 'exclude' && hasJapaneseKanji(v)) bad = true;
    }
    return anyHan && !bad;
  }

  var Music = Application('Music');
  Music.includeStandardAdditions = true;

  // In watched (incremental) mode, never launch the Music app just to scan it.
  if (mode === 'incremental' && !Music.running()) {
    return 'Music is not running -- skipped.';
  }

  var libs = Music.libraryPlaylists;
  if (!libs || libs.length === 0) return 'ERROR: no Music library found.';
  var tracks = libs[0].tracks;

  // ---------------------------------------------------------------- preview
  if (mode === 'preview') {
    var pNames, pArtists, pAlbums;
    try {
      pNames = tracks.name();
      pArtists = tracks.artist();
      pAlbums = matchAlbum ? tracks.album() : [];
    } catch (e) {
      return 'ERROR reading library: ' + e.message;
    }
    var hits = [];
    for (var t = 0; t < pNames.length; t++) {
      var nm = pNames[t] || '', ar = pArtists[t] || '', al = pAlbums[t] || '';
      if (isChineseTrack(nm, ar, al)) {
        hits.push({ name: nm, artist: ar, album: al });
        if (limit && hits.length >= limit) break;
      }
    }
    console.log('Library tracks : ' + pNames.length);
    console.log('Matched        : ' + hits.length +
                '  (field=' + field + ', tag=' + tag + ')');
    console.log('---------------------------------------------');
    var show = Math.min(hits.length, 300);
    for (var p = 0; p < show; p++) {
      console.log('  ' + hits[p].artist + '  -  ' + hits[p].name);
    }
    if (hits.length > show) console.log('  ... and ' + (hits.length - show) + ' more');
    return 'PREVIEW ONLY -- nothing was changed.';
  }

  // ---------------------------------------------------------------- apply
  if (mode === 'apply') {
    var aNames, aArtists, aAlbums, aCurrent;
    try {
      aNames = tracks.name();
      aArtists = tracks.artist();
      aAlbums = matchAlbum ? tracks.album() : [];
    } catch (e) { return 'ERROR reading library: ' + e.message; }
    // If this fails we must NOT fall back to empty values: the write path would
    // treat a blank current value as "nothing there" and overwrite real content.
    try { aCurrent = (field === 'comment') ? tracks.comment() : tracks.grouping(); }
    catch (e) {
      return 'ERROR: could not read existing ' + field + ' values (' +
             e.message + '); aborting to avoid overwriting them.';
    }

    var changed = 0, skipped = 0, failed = 0, matched = 0;
    for (var a = 0; a < aNames.length; a++) {
      var cur = aCurrent[a] || '';

      // Removal ignores the language rules: strip the tag wherever it exists.
      if (clear) {
        if (limit && changed >= limit) break;
        if (cur.indexOf(tag) === -1) continue;
        var cv = cur.split(tag).join('').replace(/^[;,\s]+|[;,\s]+$/g, '');
        try {
          if (field === 'comment') tracks[a].comment.set(cv); else tracks[a].grouping.set(cv);
          changed++;
        } catch (e) { failed++; }
        continue;
      }

      if (!isChineseTrack(aNames[a] || '', aArtists[a] || '', aAlbums[a] || '')) continue;
      if (limit && matched >= limit) break;
      matched++;
      if (cur.indexOf(tag) !== -1) { skipped++; continue; }
      var base = cur.replace(/^\s+|\s+$/g, '');
      var nv = base ? (base + ' ' + tag) : tag;
      try {
        if (field === 'comment') tracks[a].comment.set(nv); else tracks[a].grouping.set(nv);
        changed++;
      } catch (e) { failed++; }
      if ((a + 1) % 100 === 0) console.log('  ... scanned ' + (a + 1) + '/' + aNames.length);
    }
    console.log('---------------------------------------------');
    if (clear) {
      console.log('Removed : ' + changed);
      console.log('Failed  : ' + failed);
      return 'Done. Removed tag "' + tag + '" from ' + changed + ' tracks.';
    }
    console.log('Matched : ' + matched);
    console.log('Changed : ' + changed);
    console.log('Skipped : ' + skipped + ' (already in desired state)');
    console.log('Failed  : ' + failed);
    return 'Done. Tagged ' + changed + ' tracks with ' + field + '="' + tag + '".';
  }

  // ---------------------------------------------------------- incremental
  // State file: { v:1, config:"...", ids:{ persistentID: 1, ... } }.
  // An empty state (first run) or a config change (field/tag/match/album/kana/
  // trad/hangul/jp) forces one full-library pass. Normal runs only pull tracks
  // added in the last `sinceDays` days, keeping each run cheap.
  var config = [field, tag, matchTitle ? '1' : '0', matchArtist ? '1' : '0',
                matchAlbum ? '1' : '0', kanaMode, tradMode, hangulMode,
                jpMode].join('|');
  var seen = {}, storedConfig = null, pending = {}, legacy = false;
  var raw = readText(statePath);
  if (raw) {
    try {
      var parsed = JSON.parse(raw) || {};
      if (parsed && parsed.ids && typeof parsed.ids === 'object') {
        seen = parsed.ids;
        storedConfig = parsed.config || null;
        if (parsed.pending && parsed.pending.length) {
          for (var pi = 0; pi < parsed.pending.length; pi++) pending[parsed.pending[pi]] = 1;
        }
      } else {
        seen = parsed;          // legacy flat map: persistentID -> 1
        legacy = true;
      }
    } catch (e) { seen = {}; }
  }

  var configChanged = (storedConfig !== null && storedConfig !== config);
  if (configChanged) { seen = {}; pending = {}; }
  var needFull = (Object.keys(seen).length === 0) || legacy;
  if (needFull) {
    console.log('Full pass (' + (configChanged ? 'config changed' :
                (legacy ? 'legacy state' : 'no prior state')) + ').');
  }
  var seenCount0 = Object.keys(seen).length;

  var srcNames, srcArtists, srcAlbums, srcIds, srcCurrent, container, scanned, usedRecent = false;
  if (!needFull) {
    try {
      var since = new Date(Date.now() - sinceDays * 86400000);
      var recent = tracks.whose({ dateAdded: { _greaterThan: since } });
      srcNames = recent.name();
      srcArtists = recent.artist();
      srcAlbums = matchAlbum ? recent.album() : [];
      srcIds = recent.persistentID();
      srcCurrent = (field === 'comment') ? recent.comment() : recent.grouping();
      container = recent;
      scanned = srcNames.length;
      usedRecent = true;
    } catch (e) { usedRecent = false; }
  }
  if (!usedRecent) {
    try {
      srcNames = tracks.name();
      srcArtists = tracks.artist();
      srcAlbums = matchAlbum ? tracks.album() : [];
      srcIds = tracks.persistentID();
      srcCurrent = (field === 'comment') ? tracks.comment() : tracks.grouping();
      container = tracks;
      scanned = srcNames.length;
    } catch (e2) {
      return 'ERROR reading library: ' + e2.message;
    }
  }

  var newTracks = 0, rechecked = 0, matched = 0, changed = 0, skipped = 0, failed = 0, retried = 0;
  var touched = [];

  for (var k = 0; k < scanned; k++) {
    var id = srcIds[k];
    if (!id) continue;
    var isNew = !seen[id];
    // In the recent-window pass, re-evaluate already-seen tracks too: a track
    // first seen before its (cloud) metadata finished loading would otherwise
    // stay classified as "not Chinese" forever.
    if (!usedRecent && !isNew) continue;
    if (isNew) {
      if (limit && newTracks >= limit) break;
      newTracks++;
    } else {
      rechecked++;
    }

    var nm3 = srcNames[k] || '', ar3 = srcArtists[k] || '';
    var isHit = isChineseTrack(nm3, ar3, srcAlbums[k] || '');
    if (!isHit) { touched.push(id); delete pending[id]; continue; }  // not Chinese
    matched++;

    var cur3 = srcCurrent[k] || '';
    if (cur3.indexOf(tag) !== -1) {                // already tagged
      skipped++;
      touched.push(id);
      delete pending[id];
      continue;
    }
    var base3 = cur3.replace(/^\s+|\s+$/g, '');
    var nv3 = base3 ? (base3 + ' ' + tag) : tag;
    if (dry) { changed++; continue; }              // dry run remembers nothing
    try {
      if (field === 'comment') container[k].comment.set(nv3); else container[k].grouping.set(nv3);
      changed++;
      touched.push(id);                            // remember only on success
      delete pending[id];
    } catch (e) {
      failed++;
      pending[id] = 1;                             // retried by the pending pass below
      console.log('  ! failed for ' + ar3 + ' - ' + nm3 + ': ' + e.message);
    }
  }

  // Retry tracks that failed on an earlier run even if they have since fallen
  // out of the date window. They are looked up by persistent ID individually.
  if (!dry && !needFull && !limit) {
    var pendIds = Object.keys(pending);
    for (var q = 0; q < pendIds.length; q++) {
      var pid = pendIds[q];
      try {
        var found = tracks.whose({ persistentID: pid });
        if (!found || found.length === 0) { delete pending[pid]; continue; }
        var el = found[0];
        var pn = el.name() || '', pa = el.artist() || '';
        var pal = matchAlbum ? (el.album() || '') : '';
        if (!isChineseTrack(pn, pa, pal)) { delete pending[pid]; continue; }
        var pc = ((field === 'comment') ? el.comment() : el.grouping()) || '';
        if (pc.indexOf(tag) !== -1) { delete pending[pid]; continue; }
        var pbase = pc.replace(/^\s+|\s+$/g, '');
        var pv = pbase ? (pbase + ' ' + tag) : tag;
        if (field === 'comment') el.comment.set(pv); else el.grouping.set(pv);
        delete pending[pid];
        retried++;
      } catch (e) { /* leave it pending for the next run */ }
    }
  }

  // Never persist progress when `limit` was used: a capped test run must not
  // mark unscanned tracks as done.
  if (!dry && !limit) {
    for (var m = 0; m < touched.length; m++) seen[touched[m]] = 1;
    var wrote = writeText(statePath, JSON.stringify({
      v: 1, config: config, ids: seen, pending: Object.keys(pending)
    }));
    if (!wrote) console.log('  ! WARNING: could not write state file ' + statePath);
  } else if (limit && !dry) {
    console.log('  ! limit set -- state NOT persisted (avoids partial progress).');
  }

  console.log('---------------------------------------------');
  console.log('Source         : ' + (usedRecent ? ('tracks added in last ' +
              sinceDays + ' days') : ('full library' +
              (needFull ? ' (full pass)' : ' (date filter unavailable)'))));
  console.log('Scanned        : ' + scanned + ' track(s)');
  console.log('New inspected  : ' + newTracks + (limit ? ' (limit ' + limit + ')' : ''));
  if (rechecked) console.log('Re-checked     : ' + rechecked + ' (seen, re-evaluated)');
  console.log('Matched        : ' + matched);
  console.log('Changed        : ' + changed);
  console.log('Skipped        : ' + skipped + ' (already tagged)');
  console.log('Failed         : ' + failed);
  if (retried) console.log('Retried        : ' + retried + ' (from pending)');
  console.log('State          : ' + statePath + '  (' + seenCount0 + ' -> ' +
              Object.keys(seen).length + ' ids, ' + Object.keys(pending).length + ' pending)');
  if (dry) return 'DRY RUN -- nothing was written.';
  return 'Incremental done. Tagged ' + changed + ' new track(s)' +
         (retried ? ' (+' + retried + ' retried)' : '') +
         ' with ' + field + '="' + tag + '".';
}
