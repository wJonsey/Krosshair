# Working on Krosshair: a guide for agents and people

Krosshair is a browser sniper game: one Node process (`src/arena/multiplayer-server.mjs`) serves the page and runs the matches. The README explains the game and how it is hosted; this file is about changing it safely. Read both before editing.

**Also read `HANDOFF.md`.** It covers the newer systems (the Item Shop and its server-only catalogue, ranked queues, the guest lock, the dev class, controller menus) and the traps that have already cost time. Keep it up to date when you add a system.

## Ground rules

1. **`main` is production.** A push to `main` is deployed to krosshair.online within minutes by a timer on the game machine, and the restart drops anyone mid-match (they get a warning). So: `npm test` must pass before every commit, and never push half-finished work. Work in branches if a change takes several sessions.
2. **Never touch secrets.** `.env` is git-ignored and holds the Discord bot token and webhook URLs. Do not read it, print it, paste values into chat, or commit it. Check *shape* only (e.g. line lengths, `git check-ignore .env`). Secrets can only be added by the human, on the machine that needs them. The one non-secret Discord value is the public Application ID in `shared/constants.js`.
3. **`data/` is player data** (profiles, accounts, sessions, webhook state) and is git-ignored. Never commit it, never wipe it, never fake entries in it. For tests use a temp directory via `ARENA_DATA=/tmp/...`.
4. **The simulation is shared code.** Anything under `src/arena/shared/` runs in both the browser and the server and they must agree (movement, hits, maps). Change it on both sides at once (it is the same file) and re-run the tests; `version.js` fingerprints maps so a stale page notices a mismatch.
5. **The server is the authority.** Health, ammo, credits, hits, room state and the leaderboard live on the server. Client changes are presentation and prediction; never trust the client for anything that affects fairness.
6. **No build step, no bundler, no framework.** Plain ES modules, Three.js from a CDN via the import map in `index.html`, one hand-written CSS file. Keep it that way; add no dependencies without a strong reason (there are two: `three`, `ws`).

## Commands

```bash
npm install                      # once
npm run arena                    # game server on http://localhost:4174 (client + WebSocket)
ALLOW_GUESTS=0 npm run arena     # force the Discord login (guests are allowed by default)
npm test                         # ~100 checks; must pass before committing
MAP=foundry node --test src/arena/tests/maps.test.mjs   # one arena's fairness tests
```

The server sends `Cache-Control: no-cache` for everything, but a browser tab that only changes its `#hash` does **not** reload modules. Force a real reload (`location.reload()` or a changed query string) after editing client code before trusting what you see.

For the Claude desktop app there is a `.claude/launch.json` in this repo (`preview_start` name `krosshair`). It turns the Discord webhooks off: a local server with webhook URLs in `.env` posts "Update live" on boot and "Update incoming" on SIGTERM to the real channel. Stop a local server with Ctrl+C (SIGINT), which skips the webhook. Restart the preview server after changing anything under `server/`, `shared/` or the entry point; client-only edits just need a page reload.

## Where things are

| Area | Files | Notes |
| --- | --- | --- |
| Entry, HTTP, WebSocket, auth routes, `/api/status`, deploy shutdown | `multiplayer-server.mjs` | Only paths under `src/arena/` are served (never `server/`, `tests/`, dotfiles). |
| Match rules, combat, gadgets, economy | `server/room.js`, `shared/combat.js`, `shared/constants.js` | Weapons and gadgets are data in `constants.js`. |
| Arena selection, vote | `server/mapflow.js`, `client/mapvote.js` | The vote lists every arena. |
| Bots | `server/bots.js`, `server/nav.js` | Each bot rolls `traits` (skill offset + habits) around `BOT_DIFFICULTY`. Turning is a damped spring, movement eases, aim tracks with lag. Tune levels in `constants.js`, behaviour in `bots.js`. |
| Maps | `shared/map.js` (registry + Kestrel Yard), `shared/mapkit.js`, `shared/maps/*.js` | See "Adding an arena" below. |
| Accounts, login, progression | `server/accounts.js`, `server/discord.js`, `server/profiles.js` | Discord login, or guest play with a callsign. Guest profiles are memory-only (`holdGuest`/`releaseGuest` in `profiles.js`, token in the tab's `sessionStorage`) and must never reach disk. Settings sync is whitelisted in `profiles.js` (`SETTING_RULES`, `cleanBinds`, `cleanCrosshair`). |
| Gun skins | `FINISHES` in `shared/economy.js`; painters, suit patterns and shader effects in `client/skins.js` | A finish is a tiling canvas texture sampled triplanar in part space. `shader:` finishes add a GLSL snippet (`EFFECTS`) run after the emissive map, animated by one shared `uTime`. Keep metalness moderate: there is no environment map. |
| Coins, shop, wagers | `shared/economy.js` (rates, prices, odds), `server/economy.js` (shop, crates, games, transfers), `ProfileStore` coin methods (`credit`/`debit`/`hold`/`settle`), wager flow in `room.js` (`takeStakes`, `settleWager`, `checkForfeit`), `client/shop.js`, `client/skins.js` | Every balance change goes through `credit`/`debit` so it is logged. Guests never hold coins. Wager stakes sit in `profile.escrow` until settled; `load()` refunds any left over after a crash. All randomness is `crypto.randomInt` on the server. |
| Ranked ladder | `rankInfo`, `RANK_TIERS`, `PLACEMENT_MATCHES` in `shared/constants.js`; Elo in `room.js` `endMatch`; emblems in `client/ranks.js` | Accounts only. Placement matches use double K. |
| Discord channel posts | `server/webhooks.js` | Deploy warnings, "update live", leaderboard podium changes. Never mentions users. |
| Client boot, loading screen, mobile block | `client/boot.js`, `index.html` | `boot.js` is a classic script that loads `main.js`; phones never download the engine. |
| Player input, key binds | `client/player.js`, `client/input.js` | Every action has two bind slots; mouse buttons are `Mouse0…4`. Use `held()/isBound()`; never hard-code key codes. |
| Menu pages | `NAV` and `TOOL_PAGES` in `client/menu.js`, `SECTIONS` in `client/shop.js` | Top nav: Play (+Rooms), Locker, Shop, Games, Profile (Career + Wallet), Leaderboard. Each page has its own hash. Locker, Shop, Games and Wallet are all drawn by `shopPageHtml(page)`. Settings, Controls and Feedback share one rail; the gear icon and the footer link to them. |
| Player model | `client/operator.js` (build, style, animate), `client/characters.js` (entities, interpolation, corpses, replay) | Faceted low-poly pilot. The gun in hand is the first-person model from `buildWeapon`, and both arms are solved onto it every frame (`HOLDS` sets how each weapon class is carried). Cosmetics are groups on the head and chest: add one in `buildOperator` plus a `COSMETICS` entry. Keep the 1.8 m height and 1.62 m head centre: hit zones live in `shared/combat.js`. |
| Battle royale | `server/royale.js` (`RoyaleRoom`: drop phase, loot, storm, airdrops, bot goals), `shared/royale.js` (numbers and loot tables), `shared/maps/island.js` (the seeded 600 m island), `client/royale.js` (drop map, loot, storm wall, radar, cards), lobby and end screen in `client/menu.js` | Everyone is their own team, so combat and bots treat it as free for all. Flow: lobby, `drop` (pick a landing spot), `live` (everyone parachutes in from `DROP.height` with a blade only; the fall is client movement in `player.js`, bots are lowered by the room), `matchEnd`. Pilots pick up what they look at with the interact key (`royale-take`); only ammo is automatic; bots walk over things. Boosts (`POWERS`) and jump pads (`map.pads`) are client movement too. Shots drop on this map only (`ballisticsFor` and the segmented `traceShot` in `shared/combat.js`, same code on server and client). Floor loot is real models within 42 m and one instanced batch of beams beyond (`client/royale.js`); view distance is a graphics setting (`VIEW_DISTANCE` in `client/world.js`). Bots are steered through `botGoal`, `botWants`, `botMustMove` and `botSightRange`. Check balance headless: run a `RoyaleRoom` on a fake clock as `tests/royale.test.mjs` does and watch alive, armed and storm deaths per minute. |
| Charms, crates | `client/charms.js` (models + chain physics), `client/cratebox.js` (crate model + open timeline), reveal in `client/shop.js` + `arena.css` | Add a charm: a maker in `MAKERS` plus a `COSMETICS.charm` entry. `shop.js` redraws often, so reveal animations use `calc(x - var(--since))` delays to avoid restarting. |
| Gun models | `client/guns.js` (`buildWeapon`, `stripHands`) | Built from extruded side profiles with a small kit (`kit(root)`: box, tube, ring, profile, part). Static parts are merged into one mesh per material; moving parts (`mag`, `bolt`, `slide`, `pump`, `cylinder`, `hinge`) are their own groups in `userData`. Long guns are rows in `LONG`. Skins are triplanar, so any geometry takes them. Each gun sets `charmAt`/`charmScale` for its charm and `lens` for a magnified eyepiece. Call `stripHands` anywhere the gun is shown without first-person hands. |
| First-person animation, HUD, sights | `client/viewmodel.js`, `client/hud.js`, `client/crosshair.js` | Reloads are per kind (magazine, tube, revolver, break-open), plus draw, inspect (`V`), strafe tilt, sprint, land, slide and cylinder on each shot. Magnified scopes are real: `main.js` draws the world again into `viewmodel.scopeTarget` and sized so the picture is the weapon's magnification whatever size the lens is on screen, aimed where the gun points. The eyepiece shader works out the eye box per point of the picture (`uSpread`, `uEye`, `uBeam`), so at the hip the glass is dark and the picture opens as the scope reaches the eye. Dots and holos project a collimated reticle sprite that only shows while the eye is behind the window (`data.window`); they, irons and beads do not magnify. Every sight sets `ads` from its own measured sight line, so keep that when adding a gun. Aiming blurs the gun, not what you look through: `drawViewmodel` in `main.js` draws the gun into a buffer, blurs it by `viewmodel.ads`, and draws layer 1 (scope picture, reticles) sharp on top. Sway is a breathing figure of eight plus tremor; most of it moves the gun, a small share moves the aim. Guns never clip walls: `player.js` raycasts the gun's length ahead and `viewmodel.js` springs the gun back and up (`state.wall`); pushed far enough, the aim comes off. Dots and holos are see-through geometry; the HUD draws only their reticle. Other pilots' recoil, reloads, aiming, swings and swaps are in `operator.js` (`operatorAction` and the `scoped`/`reloading` pose flags). |
| Menus, settings, leaderboard, lobby | `client/menu.js` | Hash-routed pages (`#play #operator #career #leaderboard #rooms #settings #controls #feedback`). Re-renders are frequent, so keep typed input via the `keep`/draft patterns already there. |
| Sound and music | `client/audio.js`, `music/` | All effects are synthesised (layers: `noise`, `tone`, `modal`, `bell`, `grains`); weapons are `GUN_CLASS` + per-gun pitch/level in `GUNS`. You cannot hear, so check output with `await window.__arena.audio.meter(800)` after a real click (peaks should stay under ~1.0 for own guns). Music is file-based: `music/tracks.json`; the server streams audio with byte ranges. |
| Operator model | `client/characters.js` | `buildOperator` / `animateOperator`; proportions must match the hit zones in `combat.js` (head centre 1.6 m). |
| Styling | `arena.css` | One file, sections marked with `/* ---------- name ---------- */`. Design language: "rangefinder glass": frost type on smoked glass, corner brackets, tick-scale meters, amber for money/selection, cyan = friendly, red = rival. |

## Conventions

- **One WebGL renderer per purpose, created once.** The menus redraw on every click; a renderer made inside a redraw leaks a context until the browser kills the oldest (the game's) and the match renders white. Keep the canvas outside the redraw and move it into a placeholder (see `ensurePreview` in `menu.js`, `mountShop` in `shop.js`).

- **Comments explain why, briefly, in plain English.** The existing files are the model. No "what" comments, no essays, no changelogs in code.
- **Naming:** camelCase JS, kebab-case ids and classes, arena ids are one lower-case word. Player-facing copy is short, sentence case, British spelling ("armour", "colour").
- **Long lines are normal here** (template literals, one-liners for symmetric pairs). Match the surrounding density rather than reformatting.
- **Every player-facing key label must come from `input.js`** (`bindLabel`, `codeLabel`) so rebinding stays consistent.
- **Escape user-provided strings** (`escapeHtml` in `menu.js`/`hud.js`): names come from Discord.
- **Server messages** are `{ type, ... }` JSON over one WebSocket; add handlers in `multiplayer-server.mjs` (connection-level) or `room.js` (`handle`), and on the client with `net.on(type, fn)`. Bound every field you accept.
- **Persisted state must survive restarts:** both stores `flush()` on SIGTERM; if you add a store, hook it into the shutdown path.

## Writing player-facing text

Every string a player can see (HUD, menus, toasts, notices, server error messages, Discord pages and webhook posts, map blurbs, gear descriptions) follows these rules. They apply to new content too.

- **Say less.** If the player doesn't need it, cut it. If they do, find the shortest natural way to say it. Nobody reads a manual mid-match.
- **HUD and notices are labels, not sentences:** `Helmet broken`, `Enemy drone down`, `Killed Bo · headshot · 62 m`. Readable in under a second.
- **Sound like a person or a game, not a narrator or a product.** Contractions (`can't`, `you're`). No "you must", "in order to", "please", "simply", "currently", "it appears", "seamless", "powerful", "experience", "welcome to", "get ready". No enthusiasm padding.
- **Familiar words over clever ones:** enemy (not rival), server/connecting (not relay), Settings, Controls, Resume. Pilot, operator and callsign are the game's own words; keep them.
- **Don't repeat what's already on screen.** One prompt per thing.
- **No em dashes, anywhere in the repo** (code, comments, docs, tests). Use a full stop, colon, comma, brackets, or ` · ` as a separator in UI.
- Key names always come from `input.js` (`bindLabel`/`codeLabel`), never typed into copy.

Before adding text ask: does the player need it, can it be shorter, would a person say it, is it repeated, does it contain an em dash?

## Testing what you change

`npm test` covers: map fairness for every arena, physics/combat behaviour, a real `Room` driven through map pinning/voting, Discord login against a stubbed API, settings sanitising, webhooks. Tests are plain `node:test`; add one next to the code you touched.

Things the tests do **not** cover, so check them by hand: anything visual, audio, the feel of movement or aim, the lobby/HUD in a real match. Use the preview browser: `?skipintro` skips the loading-screen button; `window.__arena` exposes `game`, `net`, `player`, `hud`, `arena`, `operators`, `renderer`, `camera`, `viewmodel`; `window.__arena.debugCam = { pos, look }` frames a screenshot from the menu. For bots, simulate headless: build a `Room` as `tests/mapflow.test.mjs` does, monkey-patch `performance.now`, call `room.tick()` in a loop.

## Adding an arena

1. `src/arena/shared/maps/<id>.js` exporting `build<Name>()`. Use `arenaShell` (ground, perimeter, gated lobbies, spawns, bounds), `flight` (stairs bots can climb: 0.6 m runs, ≤0.334 m risers, ≥2.2 m wide), `SYM` on every piece in the south half (the north is the mirror); a piece that straddles `z = 0` is placed once. Materials come from `MATERIALS` in `constants.js`; `deco: true` marks decoration (no collision, ignored by the mirror test).
2. No spawn gate may see another: stagger walls, and put a solid screen in front of the centre gate. The test prints the open sightlines if you miss one.
3. ≥12 `interest` points (mirrored with `mirrorPoints`), reachable from both spawns, on walkable ground at the stated height; a few `lanes`; `zones` named "A …" for the south half (mirrored to "B …").
4. Register in `MAP_INFO` and `BUILDERS` (`shared/map.js`), add a palette in `client/mapvote.js`, run `MAP=<id> node --test src/arena/tests/maps.test.mjs`, then look at it (`debugCam`) and play a bot match on it.

## Deploying

There is nothing to run: commit to `main` and push. The live machine pulls and restarts by itself. Afterwards check `https://krosshair.online/api/status` (it returns the new shape you expect) and, if the change was visible, the site. If a deploy needs a new `.env` value, say so clearly in the commit message and in your summary. An agent cannot add it.

There is no GitHub Pages site or Actions workflow any more; the game machine is the only host.

## Repo notes

- Remote: `https://github.com/wJonsey/sniper-shootout-multiplayer`. Some contributors have push but not admin rights: repo settings, secrets and Pages cannot be changed from here.
- `backend/` is an unrelated legacy Python API, untouched by the game. Leave it alone unless asked.
- Commit messages: a short imperative subject, a body that says what changed and why, and the co-author trailer the harness asks for.
