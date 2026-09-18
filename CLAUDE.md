# Working on Krosshair — guide for agents and people

Krosshair is a browser sniper game: one Node process (`src/arena/multiplayer-server.mjs`) serves the page and runs the matches. The README explains the game and how it is hosted; this file is about changing it safely. Read both before editing.

## Ground rules

1. **`main` is production.** A push to `main` is deployed to krosshair.online within minutes by a timer on the game machine, and the restart drops anyone mid-match (they get a warning). So: `npm test` must pass before every commit, and never push half-finished work. Work in branches if a change takes several sessions.
2. **Never touch secrets.** `.env` is git-ignored and holds the Discord bot token and webhook URLs. Do not read it, print it, paste values into chat, or commit it. Check *shape* only (e.g. line lengths, `git check-ignore .env`). Secrets can only be added by the human, on the machine that needs them. The one non-secret Discord value is the public Application ID in `shared/constants.js`.
3. **`data/` is player data** (profiles, accounts, sessions, webhook state) and is git-ignored. Never commit it, never wipe it, never fake entries in it. For tests use a temp directory via `ARENA_DATA=/tmp/...`.
4. **The simulation is shared code.** Anything under `src/arena/shared/` runs in both the browser and the server and they must agree (movement, hits, maps). Change it on both sides at once — it is the same file — and re-run the tests; `version.js` fingerprints maps so a stale page notices a mismatch.
5. **The server is the authority.** Health, ammo, credits, hits, room state and the leaderboard live on the server. Client changes are presentation and prediction; never trust the client for anything that affects fairness.
6. **No build step, no bundler, no framework.** Plain ES modules, Three.js from a CDN via the import map in `index.html`, one hand-written CSS file. Keep it that way; add no dependencies without a strong reason (there are two: `three`, `ws`).

## Commands

```bash
npm install                      # once
npm run arena                    # game server on http://localhost:4174 (client + WebSocket)
ALLOW_GUESTS=1 npm run arena     # play with a callsign, no Discord (local testing)
npm test                         # ~100 checks; must pass before committing
MAP=foundry node --test src/arena/tests/maps.test.mjs   # one arena's fairness tests
```

The server sends `Cache-Control: no-cache` for everything, but a browser tab that only changes its `#hash` does **not** reload modules — force a real reload (`location.reload()` or a changed query string) after editing client code before trusting what you see.

For the Claude desktop app there is a `.claude/launch.json` in this repo (`preview_start` name `krosshair`). Restart the preview server after changing anything under `server/`, `shared/` or the entry point; client-only edits just need a page reload.

## Where things are

| Area | Files | Notes |
| --- | --- | --- |
| Entry, HTTP, WebSocket, auth routes, `/api/status`, deploy shutdown | `multiplayer-server.mjs` | Only paths under `src/arena/` are served (never `server/`, `tests/`, dotfiles). |
| Match rules, combat, gadgets, economy | `server/room.js`, `shared/combat.js`, `shared/constants.js` | Weapons and gadgets are data in `constants.js`. |
| Arena selection, vote | `server/mapflow.js`, `client/mapvote.js` | The vote lists every arena. |
| Bots | `server/bots.js`, `server/nav.js` | Each bot rolls `traits` (skill offset + habits) around `BOT_DIFFICULTY`. Turning is a damped spring, movement eases, aim tracks with lag. Tune levels in `constants.js`, behaviour in `bots.js`. |
| Maps | `shared/map.js` (registry + Kestrel Yard), `shared/mapkit.js`, `shared/maps/*.js` | See "Adding an arena" below. |
| Accounts, login, progression | `server/accounts.js`, `server/discord.js`, `server/profiles.js` | Discord-only login; settings sync is whitelisted in `profiles.js` (`SETTING_RULES`, `cleanBinds`, `cleanCrosshair`). |
| Discord channel posts | `server/webhooks.js` | Deploy warnings, "update live", leaderboard podium changes. Never mentions users. |
| Client boot, loading screen, mobile block | `client/boot.js`, `index.html` | `boot.js` is a classic script that loads `main.js`; phones never download the engine. |
| Player input, key binds | `client/player.js`, `client/input.js` | Every action has two bind slots; mouse buttons are `Mouse0…4`. Use `held()/isBound()`; never hard-code key codes. |
| HUD, crosshair, sights | `client/hud.js`, `client/crosshair.js`, `client/viewmodel.js` | Dot/holo optics are real geometry; the HUD draws only the reticle. |
| Menus, settings, leaderboard, lobby | `client/menu.js` | Hash-routed pages (`#play #operator #career #leaderboard #rooms #settings #controls #feedback`). Re-renders are frequent — keep typed input via the `keep`/draft patterns already there. |
| Sound and music | `client/audio.js`, `music/` | All effects are synthesised (layers: `noise`, `tone`, `modal`, `bell`, `grains`); weapons are `GUN_CLASS` + per-gun pitch/level in `GUNS`. You cannot hear — check output with `await window.__arena.audio.meter(800)` after a real click (peaks should stay under ~1.0 for own guns). Music is file-based: `music/tracks.json`; the server streams audio with byte ranges. |
| Operator model | `client/characters.js` | `buildOperator` / `animateOperator`; proportions must match the hit zones in `combat.js` (head centre 1.6 m). |
| Styling | `arena.css` | One file, sections marked with `/* ---------- name ---------- */`. Design language: "rangefinder glass" — frost type on smoked glass, corner brackets, tick-scale meters, amber for money/selection, cyan = friendly, red = rival. |

## Conventions

- **Comments explain why, briefly, in plain English** — the existing files are the model. No "what" comments, no essays, no changelogs in code.
- **Naming:** camelCase JS, kebab-case ids and classes, arena ids are one lower-case word. Player-facing copy is short, sentence case, British spelling ("armour", "colour").
- **Long lines are normal here** (template literals, one-liners for symmetric pairs). Match the surrounding density rather than reformatting.
- **Every player-facing key label must come from `input.js`** (`bindLabel`, `codeLabel`) so rebinding stays consistent.
- **Escape user-provided strings** (`escapeHtml` in `menu.js`/`hud.js`) — names come from Discord.
- **Server messages** are `{ type, ... }` JSON over one WebSocket; add handlers in `multiplayer-server.mjs` (connection-level) or `room.js` (`handle`), and on the client with `net.on(type, fn)`. Bound every field you accept.
- **Persisted state must survive restarts:** both stores `flush()` on SIGTERM; if you add a store, hook it into the shutdown path.

## Testing what you change

`npm test` covers: map fairness for every arena, physics/combat behaviour, a real `Room` driven through map pinning/voting, Discord login against a stubbed API, settings sanitising, webhooks. Tests are plain `node:test`; add one next to the code you touched.

Things the tests do **not** cover, so check them by hand: anything visual, audio, the feel of movement or aim, the lobby/HUD in a real match. Use the preview browser: `?skipintro` skips the loading-screen button; `window.__arena` exposes `game`, `net`, `player`, `hud`, `arena`, `operators`, `renderer`, `camera`, `viewmodel`; `window.__arena.debugCam = { pos, look }` frames a screenshot from the menu. For bots, simulate headless: build a `Room` as `tests/mapflow.test.mjs` does, monkey-patch `performance.now`, call `room.tick()` in a loop.

## Adding an arena

1. `src/arena/shared/maps/<id>.js` exporting `build<Name>()`. Use `arenaShell` (ground, perimeter, gated lobbies, spawns, bounds), `flight` (stairs bots can climb: 0.6 m runs, ≤0.334 m risers, ≥2.2 m wide), `SYM` on every piece in the south half — the north is the mirror; a piece that straddles `z = 0` is placed once. Materials come from `MATERIALS` in `constants.js`; `deco: true` marks decoration (no collision, ignored by the mirror test).
2. No spawn gate may see another: stagger walls, and put a solid screen in front of the centre gate. The test prints the open sightlines if you miss one.
3. ≥12 `interest` points (mirrored with `mirrorPoints`), reachable from both spawns, on walkable ground at the stated height; a few `lanes`; `zones` named "A …" for the south half (mirrored to "B …").
4. Register in `MAP_INFO` and `BUILDERS` (`shared/map.js`), add a palette in `client/mapvote.js`, run `MAP=<id> node --test src/arena/tests/maps.test.mjs`, then look at it (`debugCam`) and play a bot match on it.

## Deploying

There is nothing to run: commit to `main` and push. The live machine pulls and restarts by itself. Afterwards check `https://krosshair.online/api/status` (it returns the new shape you expect) and, if the change was visible, the site. If a deploy needs a new `.env` value, say so clearly in the commit message and in your summary — an agent cannot add it.

The GitHub Pages workflow in `.github/workflows/` is a leftover from before the dedicated server and is not the deploy path.

## Repo notes

- Remote: `https://github.com/wJonsey/sniper-shootout-multiplayer`. Some contributors have push but not admin rights: repo settings, secrets and Pages cannot be changed from here.
- `backend/` is an unrelated legacy Python API, untouched by the game. Leave it alone unless asked.
- Commit messages: a short imperative subject, a body that says what changed and why, and the co-author trailer the harness asks for.
