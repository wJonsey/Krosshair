# Krosshair soundtrack

Drop your own songs in this folder and list them in `tracks.json`. No code changes needed.

```json
{
  "menu": ["krosshair-theme.mp3"],
  "match": ["buy-phase.mp3", "between-rounds.mp3"]
}
```

- **`menu`** plays in the menus and the lobby.
- **`match`** plays during the buy phase, between rounds and on the end screen. If it is empty, the menu tracks are used there too.
- In a match the music plays just under the menu level (88%, and 80% while a round is live), all scaled by the Music volume slider. Players can switch it off for rounds with Settings → Audio & HUD → *Keep music during rounds*.
- More than one file in a list = a playlist: it starts on a random track and plays through in order. One file = it loops, so make the end run cleanly into the start.
- While both lists are empty the game plays a quiet generated pad in the menus instead.

## Seamless loops

A plain single file loops with a tiny gap (every browser does this). For a loop with no gap at all, list it as an object with loop points:

```json
{
  "menu":  [{ "file": "krosshair-lobby.m4a", "loopStart": 0.5, "loopEnd": 35.4091 }],
  "match": [{ "file": "krosshair-game.m4a",  "loopStart": 0.5, "loopEnd": 35.4091 }]
}
```

The game then cycles between those two times sample-accurately. For that to be inaudible the file has to be built for it: half a second of lead-in (the *end* of the loop) before `loopStart`, and half a second of lead-out (the *start* of the loop) after `loopEnd`, so the audio either side of the jump is identical. If the piece ends with a ring-out, mix that tail over the start of the loop so it is not chopped off. Both Krosshair themes were made this way: 16 bars at 110 BPM (34.9091 s), cut on the bar line, with the ring-out folded back over the opening.

**Beat-matched transitions.** When the menu loop and the match loop are the same length (same tempo, same number of bars, ideally the same key), the game brings the new one in at the exact point in the bar the old one had reached and cross-fades over about a bar, so going from the lobby into a match never breaks the rhythm. Loops of different lengths just get a short plain cross-fade.

## File rules

- Formats: `.mp3` (safest, works everywhere), `.ogg`, `.m4a`, `.wav`, `.flac`.
- File names: letters, numbers, `-`, `_` and `.` only. **No spaces** (`my-theme.mp3`, not `my theme.mp3`).
- Keep each file under about 8 MB (a 3–4 minute MP3 at 192 kbps is ~5 MB). Everyone who opens the game downloads it.
- Export at a sensible level: around −14 LUFS, peaks under −1 dB. The Music volume slider tops out at half of full scale on purpose (and defaults to 90% of that), so the game's own sounds always have room on top.
- Only use music you made or have the right to use. This repository is public.

## Trying it

Put the file here, add its name to `tracks.json`, reload the game and click once anywhere (browsers only start audio after a click). To ship it: commit the audio file and `tracks.json` and push. The live site updates itself.
