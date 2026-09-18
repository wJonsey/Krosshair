# Krosshair

A round-based tactical sniper game for the browser, live at **[krosshair.online](https://krosshair.online)**. Two teams, one life per round, best of nine, a buy phase between rounds, and twelve hand-built arenas from a 1v1 subway platform to a canyon-sized sniper range. A single Node process serves the page and runs the match; it owns every hit, health point and credit, so games stay fair between friends on different connections.

No asset downloads: every model, texture and sound is generated in code. Players sign in with Discord (no email, no password) and their progress follows them to any device, or jump straight in as a guest.

Working on the code? Read **[CLAUDE.md](CLAUDE.md)** first. It is the guide for anyone, human or AI agent, changing this project.

## Running it locally

Needs Node 20 or newer.

```bash
npm install
npm run arena
```

Open http://localhost:4174/. The server hosts the client (HTML, JS, CSS) alongside the WebSocket, so there is nothing else to start.

- **Logging in locally** works out of the box: the game logs in through the Krosshair Discord application, whose public ID is committed in `src/arena/shared/constants.js`, and `http://localhost:4174/auth/discord/callback` is registered on it.
- **Playing without Discord**: the menu always offers guest play with a callsign. `ALLOW_GUESTS=0 npm run arena` turns that off and makes the login compulsory.
- **Port:** `ARENA_PORT=5000 npm run arena`.
- **Tests:** `npm test`: about 100 checks, including every arena's fairness (see below), the login flow against a stand-in Discord, and the webhooks. `MAP=foundry node --test src/arena/tests/maps.test.mjs` runs one arena.

## How krosshair.online runs

One dedicated machine runs `npm run server` behind a Cloudflare Tunnel (`cloudflared` routes the domain straight to port 4174 and terminates HTTPS, so no port forwarding and no reverse proxy). `systemd` manages the process as `krosshair.service`, restarting it on crash and on boot.

**Deploys are automatic.** A systemd timer (`krosshair-deploy.timer`) polls `origin/main` every few minutes; on a new commit it pulls, reinstalls dependencies if `package.json` or the lockfile changed, and restarts the service. Pushing to `main` *is* the deploy: expect it live within about five minutes. When the service stops:

1. everyone online gets an in-game warning and the Discord updates channel gets "⚠️ Update incoming";
2. the server waits `RESTART_GRACE_SECONDS` (20 by default; skipped when nobody is online), then flushes profiles and accounts to disk and exits;
3. the new process posts "✅ Update live" with the commit, and pages that were left open refresh themselves onto the same menu page without the loading screen's Enter button.

`https://krosshair.online/api/status` shows who is online, the public rooms, and which Discord features are configured: `discord: { login, autoJoin, required, webhooks: { updates, leaderboard } }`.

### Keeping the repository private

The deploy timer pulls from GitHub, so before the repository is made private the game machine needs its own read-only key (otherwise deploys silently stop). On the game machine, as the user the deploy timer runs as:

```bash
ssh-keygen -t ed25519 -N "" -C "krosshair-deploy" -f ~/.ssh/krosshair_deploy
cat ~/.ssh/krosshair_deploy.pub
```

1. The repository owner adds that public key under GitHub → the repo → Settings → Deploy keys → Add deploy key (leave "Allow write access" off).
2. On the machine, point the checkout at SSH with that key and check it works:
   ```bash
   printf 'Host github-krosshair\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/krosshair_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
   ssh-keyscan github.com >> ~/.ssh/known_hosts
   git -C <checkout> remote set-url origin git@github-krosshair:wJonsey/sniper-shootout-multiplayer.git
   git -C <checkout> fetch origin
   ```
3. Only once `fetch` works: Settings → General → Danger Zone → Change visibility → Private. Collaborators keep their access.

### Secrets: the `.env` file

Everything secret lives in a git-ignored `.env` next to `package.json` on the machine that runs the server. Copy `.env.example` and fill in what you have:

| Variable | What it does | Where it comes from |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Lets a login add the pilot to the Krosshair Discord server (auto-join). Without it, logins still work and players get an invite card instead. | Developer Portal → the app → Bot → Reset Token |
| `DISCORD_WEBHOOK_UPDATES` | Deploy warnings and "update live" posts | Discord channel → Integrations → Webhooks |
| `DISCORD_WEBHOOK_LEADERBOARD` | Posts when the top three of any leaderboard changes | same |
| `DISCORD_CLIENT_SECRET` | Optional. Switches login to the OAuth code flow so Discord's token never reaches the browser. | Developer Portal → OAuth2 |
| `PUBLIC_URL` | Optional. Only if the server cannot work out its own public address. | - |
| `ALLOW_GUESTS=0` | Turns guest play off: a Discord login is needed to play at all. | - |
| `RESTART_GRACE_SECONDS` | Warning time before a deploy restart (0–60). | - |

The server logs what it found at start-up (key names only, never values): `journalctl -u krosshair -n 30 | grep discord`. A restart is needed after `.env` changes: `sudo systemctl restart krosshair.service`.

Never commit `.env`, never paste a token or webhook URL into chat or an issue. If one leaks, reset it in Discord and the old one stops working at once.

### Discord application

Login goes through one Discord application ("Krosshair"). What is set up on it: the public Application ID in `constants.js`; redirects `https://krosshair.online/auth/discord/callback` and `http://localhost:4174/auth/discord/callback`; a bot user invited to the Krosshair Discord with the **Create Invite** permission (needed for auto-join). Scopes requested from players are only `identify` and `guilds.join`. Discord shows "Join servers for you" on its consent screen when auto-join is on.

## Playing

### A match

- **Best of nine.** First team to five rounds wins. Sides switch after round four.
- **One life.** Die and you watch the killcam, then spectate your team until the round ends.
- **Buy phase.** Twelve seconds behind your spawn gate to spend credits on weapons, armour and two gadgets. Survive a round and you keep your gear; die and you are back to the M-44 and a P9.
- **Sudden death.** If the clock runs out, every pilot is revealed and every hit is lethal for 35 seconds.
- **Rematch.** The end screen has a rematch vote; when everyone votes the next match starts straight away.

### Shots

- Head, torso and limb hit zones. The M-44 kills with one shot to the head or an unarmoured torso; a vest lets you survive one body shot.
- Bullets pass through planks, cloth and sheet metal, losing damage on the way. Brick and concrete stop them. Glass shatters.
- The long rifle leaves a vapour trail back to the shooter, loud weapons show on the rival minimap, footsteps are audible unless you walk or crouch, and near misses blur your aim.
- Scoped rifles sway: crouch to settle, hold breath, scroll to change zoom. Red dots and holographic sights are real optics on the gun: aiming brings the housing up to your eye and the reticle sits in its window.

### Gadgets (two slots)

Radar Pulse · Recon Drone (pilotable) · Decoy Hologram · Deploy Shield · Silent Step · Field Stim

### Modes

| Mode | What it is |
| --- | --- |
| Quick play | Casual queue. Bots fill seats and hand them to humans who join later. |
| Ranked | Discord accounts only, humans only. Five placement matches, then a rank from Bronze III to Apex (see below). |
| Arcade | The day's modifier: Headhunter, One Tap, Low Orbit or Sidearms Only. |
| Bot match | 3v3 against Recruit, Veteran or Elite bots. The level is a centre point. Every bot rolls its own skill and habits around it, so no two play alike. |
| Practice range | Free gear, moving targets, wall-penetration and glass lessons, guided drills. |
| Wager | A private room where every pilot stakes the same coins (1v1, 2v2 or 3v3, humans with a Discord login only). Stakes are taken at the start; the winning side splits the pot; a draw refunds everyone. A side that leaves for good forfeits. |
| Private room | Room code + invite link, team select, bots, custom rules (arena vote / random / fixed, format, round time, credits, weather, modifier, friendly fire, sudden death). |

### Arenas

Every arena is mirrored so both teams play the same ground, names its locations on the HUD, and gives bots a generated navigation grid. Hosts choose **Lobby vote** (every arena on the ballot plus "surprise me", 25 seconds, ties broken at random), **Random each match** (never the same map twice running, weighted by lobby size), or pin one arena.

| Arena | Size | Style | What defines it |
| --- | --- | --- | --- |
| Kestrel Yard | Medium · 2v2–4v4 | Industrial rail yard | Depot roofs, a glass-fronted office, a plus-shaped underpass |
| Halcyon Atrium | Small · 1v1–2v2 | Glass-and-marble gallery | Two mezzanines with breakable glass railings, a skybridge |
| Campanile | Small–medium · 2v2–3v3 | Old-town piazza | A climbable bell tower, arcades, a balcony house per side, a sunken canal walk |
| Frostbite Station | Medium–large · 3v3–4v4 | Arctic research base | Helipad on stilts, lab roofs, snow berms, an ice trench |
| Foundry 4 | Small–medium · 2v2–3v3 | Steel mill floor | A dead furnace, catwalks down both sides, two bridges |
| Saffron Market | Small–medium · 2v2–3v3 | Covered souk | Shoot-through stalls, two flat roofs to climb, a kiosk in the square |
| Line 9 | Small · 1v1–2v2 | Underground station | Two platforms, two parked trains to run through, a track bed |
| Skyline Terrace | Medium · 2v2–4v4 | Tower rooftop | A breakable glass greenhouse, water tanks on stilts, plant rooms |
| Breakwater | Medium–large · 3v3–4v4 | Container quay | Long lanes between the stacks, a walkway across the crane beam |
| Timberline | Large · 3v3–4v4 | Mountain logging camp | A lodge, a watchtower each, rock that stops everything, hedgerows that stop nothing |
| Ravelin | Large · 3v3–4v4 | Desert fort | Crenellated ramparts down both walls, a keep in the courtyard |
| Dustline Pass | Large · 3v3–4v4 | Desert canyon outpost | A stone bridge over a dry riverbed, a watchtower, a climbable mesa |

Conditions rotate per arena: Dusk, Night Fog, Storm Front and High Noon, plus Whiteout (snowfall) on Frostbite and Timberline and Dust Haze on Dustline, Saffron and Ravelin.

### Sound and music

Every sound effect is synthesised in code (`client/audio.js`): gunshots are layered from a crack, a distorted muzzle blast, a sub thump, per-weapon body resonances, a tail that changes with distance and shelter, then the action cycling and a casing landing. Footsteps are heel-then-toe and differ per surface, metal rings with inharmonic partials, and two generated reverbs (open yard, hard room) cross-fade as you move under cover. Nothing plays identically twice.

**Music can be your own.** Drop audio files in `src/arena/music/` and list them in `tracks.json` (see `src/arena/music/README.md`). `menu` tracks play in the menus and lobby, `match` tracks in the match (quieter while a round is live; players can turn that off). Loops can be sample-accurate, and two loops of the same length cross-fade on the beat, as the lobby and in-game themes do. With no tracks listed, a quiet generated pad plays in the menus.

### Accounts, progression, leaderboard

- **Guests** play with just a callsign. Nothing is saved: the progress lives in the server's memory and the tab's session storage, and is gone when the tab closes (or the server restarts). Guests can play every mode except ranked and are not on the leaderboard. A guest who then logs in with Discord for the first time keeps that session's progress on the new account.
- **Discord login** creates the account on the first visit; later logins find it by Discord ID.
- The account keeps XP and level, skill rating, career stats, per-weapon mastery, the last 25 matches, three daily contracts (reset 00:00 UTC), the operator's look, and every setting (key binds and crosshair included), so they follow the pilot between devices.
- **Ranked ladder:** the first five ranked matches are placements (rating moves twice as far) and show no rank. After that the skill rating maps to Bronze, Silver, Gold, Platinum and Diamond, each with divisions III → I, and Apex from 1850 SR. The rank emblem and progress to the next division are on the Play and Career pages; the end screen shows placements, promotions and demotions; ranked lobbies show everyone's rank and matchmaking prefers the lobby closest to your rating.
- **Coins** are the account currency (Discord accounts only; guests earn none). They are slow to earn: a finished match 4, a win 12 (3 against bots only), most kills in a match with other people 8, each human kill 2 (a little more for higher-level victims, a little less for lower), each bot kill 0.4, each daily contract 5, and never more than 60 from one match. New accounts start with 50. Coins are never sold for money.
- **Shop** (menu tab 03): 36 gun finishes bought per gun and seen by everyone in first and third person: Common 150, Rare 400, Epic 1,000, Legendary 2,500, Mythic 6,000. Legendary and Mythic finishes are their own shaders (a gold shine sweep, a parallax starfield, glowing magma cracks, shifting dragon scales, hex light waves, aurora ribbons, live fire, a glitching hologram, thin-film prism) and the shop shows every finish on a live turntable. Two crates (Field 120, Elite 450 with no commons; odds on the page, duplicates pay 30% back); coin flip, dice and slots, each keeping about 5%; and a wallet with history and **sending coins** to any pilot by username (their name and Discord picture are shown before you confirm). Neon Grid, Circuit, Toxic and Frostbite move too. The Kestrel Blade takes finishes like any gun.
- **Operator**: suit, visor and tracer colours, titles, 9 suit patterns, 11 headgear (up to a crown), 9 face pieces (up to a cyber visor), 7 packs (up to a jetpack) and 9 gun charms that hang off your gun and swing as you move. Some unlock with level; the rest are bought once with coins, 300 to 8,000.
- **Leaderboard** (menu tab 05): skill rating, level, player kills, wins, headshots and longest kill; podium, top 50, and your own position. The Play page shows the top five.
- Phones and tablets are stopped at the loading screen: the game needs a mouse and keyboard, and the engine is never downloaded on them.

### Controls and settings

Every key and mouse button is rebindable in Settings → Key binds (two slots per action). Defaults:

| Input | Action |
| --- | --- |
| W A S D / Space | Move / jump |
| Shift | Walk quietly · hold breath while scoped |
| Ctrl or C | Crouch (silent) |
| LMB / RMB / wheel | Fire / aim / zoom or switch weapon |
| 1 2 3 · R | Primary, sidearm, blade · reload |
| Q / E | Gadgets |
| B | Armoury (buy phase) |
| Z or MMB · X | Ping a location · radio commands |
| Enter / Y · Tab | Chat all / team · scoreboard |
| Gamepad | Sticks move and aim, RT fire, LT scope, X reload, Y swap, B crouch, LB/RB gadgets |

Settings pages: Aim (sensitivities, toggles), Graphics (presets or render scale / shadows / lights / brightness / FOV, frame-rate cap, FPS counter, automatic step-down), Audio & HUD (master, weather and music volume, music during rounds, announcer, sound visualiser), Crosshair (colour, outline, dot, inner and outer lines, dynamic spread, presets, share codes), Key binds.

## Project layout

```text
index.html                       # Redirects to the game page
src/arena/
├── index.html, arena.css        # UI shell, loading screen markup, all styling
├── brand/                       # Logo (SVG + PNG), favicon, touch icon
├── music/                       # Your soundtrack: audio files + tracks.json (see its README)
├── multiplayer-server.mjs       # HTTP + WebSocket entry point, matchmaking, auth routes, status API
├── shared/                      # Runs on both sides: the simulation must agree
│   ├── constants.js             # Weapons, gadgets, match economy, rules, progression, cosmetics, bot levels, Discord IDs
│   ├── economy.js               # Coins: earn rates, skin finishes and prices, crate odds, minigame maths, wagers
│   ├── map.js, mapkit.js        # Map registry + Kestrel Yard; box-map authoring tools (arenaShell, flight, SYM …)
│   ├── maps/                    # One file per arena
│   ├── physics.js, combat.js    # Box world, movement, raycasts; hit zones, penetration, spread
│   └── version.js               # Map fingerprints so stale pages notice
├── server/
│   ├── room.js                  # Match state machine, authoritative combat, gadgets
│   ├── mapflow.js               # Arena selection: fixed, random rotation, lobby vote
│   ├── bots.js, nav.js          # Bot personalities + AI; generated navigation grid
│   ├── profiles.js, accounts.js # JSON stores: progression, settings and coins (with wager escrow); accounts and sessions
│   ├── economy.js               # Shop, crates, minigames and coin transfers (server-side dice)
│   ├── discord.js               # "Log in with Discord" (implicit or code flow) and auto-join
│   └── webhooks.js              # Discord channel posts: deploy warnings, leaderboard changes
├── client/                      # Three.js client
│   ├── boot.js                  # Loading screen, mobile block, loads main.js
│   ├── main.js, net.js, state.js
│   ├── world.js, characters.js, viewmodel.js, effects.js, audio.js
│   ├── player.js, input.js, hud.js, crosshair.js
│   ├── skins.js, ranks.js       # Procedural gun finishes and suit patterns; rank emblems
│   ├── shop.js                  # Shop page: skins, crates, games, wallet
│   └── menu.js, mapvote.js      # Every screen outside the match
└── tests/                       # `npm test`
backend/                         # Unrelated legacy Python API (Call of Duty profile lookup); not part of the game
```

### Networking

The client predicts its own movement and draws tracers immediately; the server validates movement speed and position, rewinds other players to the moment you fired (lag compensation, capped at 400 ms) and decides every hit. Remote players are interpolated 100 ms in the past. If your connection drops mid-match your seat is held for 45 seconds and the page rejoins on its own, even after a refresh. Anyone in the menus receives the public room list and online count live.

### Adding an arena

Write `src/arena/shared/maps/<id>.js` with the `mapkit` builder: `arenaShell` gives you the ground, perimeter and gated spawn lobbies, `flight` a staircase bots can climb, `SYM` mirrors a piece across `z = 0`. Author the south half; the north is the mirror. Register the id in `MAP_INFO` and `BUILDERS` in `shared/map.js`, add a thumbnail palette in `client/mapvote.js`, and run `MAP=<id> node --test src/arena/tests/maps.test.mjs`. The tests reject anything unfair or unreachable: unmirrored geometry, blocked spawns, a spawn gate that can see another, and any interest point bots cannot reach from both spawns.

## Notes

- The server is authoritative about combat, but it does not hide enemy positions from a modified client. Fine for playing with friends, worth keeping in mind if the player base ever grows beyond that.
- The announcer uses the browser's speech synthesis, so its voice varies by system. It can be turned off in Settings.

## License

ISC
