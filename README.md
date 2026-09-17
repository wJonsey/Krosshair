# Krosshair

A round-based tactical sniper game for the browser. Two teams, one life per round, best of nine, a buy phase between rounds, and five hand-built arenas from a 1v1 gallery to a canyon-sized sniper range. The Node server owns the truth — health, ammo, credits, hit detection — so matches stay fair between friends on different connections.

No asset downloads: every model, texture and sound is generated in code. Log in with Discord to play; your progress follows you to any device.

## Play now

The game is live at **[krosshair.online](https://krosshair.online)** — no install needed. Pick a callsign and press **Find a match** (bots fill empty seats) or **Learn the ropes** for the practice range.

## Quick start (running it yourself)

```bash
npm install
npm run arena
```

Open http://localhost:4174/ — the server hosts the client itself (HTML, JS, CSS) alongside the WebSocket, so there's nothing else to stand up. Pick a callsign and press **Find a match** or **Learn the ropes**.

To play with friends, create a private room and send them the invite link shown in the lobby. On a LAN, replace `localhost` with your machine's address. Override the port with `ARENA_PORT=5000 npm run arena`.

## Deployment

`krosshair.online` runs off a single dedicated machine: `npm run server` behind a Cloudflare Tunnel (`cloudflared`) routes the domain straight to the Node process on port 4174 — Cloudflare terminates HTTPS and there is no port-forwarding or reverse proxy involved. The game process is managed by systemd (`krosshair.service`) so it restarts on crash and on boot.

A systemd timer (`krosshair-deploy.timer`) polls `origin/main` every few minutes; when it finds a new commit it pulls, reinstalls dependencies if `package.json`/`package-lock.json` changed, and restarts `krosshair.service`. In practice: push to `main` and the live site updates itself within a few minutes, no manual deploy step required.

## Discord login

A Discord login is required to play — quick play, ranked, bot matches, the practice range, all of it. There is no email and no password: the menu shows **Log in / sign up with Discord**, the first login creates the account (and adopts the guest progress already in that browser), and later logins find it again by Discord ID. Level, stats, unlocks, look, settings, key binds and crosshair are saved to the account on the server, so they survive restarts and follow the pilot to any device.

**What is already set up.** The game logs in through the Discord application whose public ID is `DISCORD_CLIENT_ID` in `src/arena/shared/constants.js`, with these redirects registered on it: `https://krosshair.online/auth/discord/callback` and `http://localhost:4174/auth/discord/callback`. That is everything login needs — no secrets on the server. The server checks with Discord that every token it is handed was issued to this application before trusting it.

**Adding pilots to the Discord server automatically** needs the application's bot, because only a bot can add members:

1. Developer Portal → the application → **Bot** → create it and copy the token.
2. Invite the bot to the [Krosshair Discord](https://discord.gg/uFVygVtKzt) with the **Create Invite** permission.
3. On the game machine, copy `.env.example` to `.env`, set `DISCORD_BOT_TOKEN`, and restart `krosshair.service`. `.env` is git-ignored; never commit it.

Until then logins work and the menu links to the invite instead. Setting `DISCORD_CLIENT_SECRET` as well switches login to the code flow, which keeps Discord's token off the browser entirely. Discord shows "Join servers for you" on its consent screen whenever auto-join is on. Only the `identify` and `guilds.join` scopes are ever requested.

**Checking it.** `https://krosshair.online/api/status` reports `"discord": { "login", "autoJoin", "required" }`, and the server prints what it found at start-up (key names only):

```bash
journalctl -u krosshair -n 20 | grep discord:
```

`ALLOW_GUESTS=1` in the environment lets people in with a callsign instead — for local testing or an emergency. Sessions are stored as SHA-256 hashes in `data/accounts.json`, and pending saves are flushed when the service stops, so a deploy never costs anyone progress.

## How a match plays

- **Best of nine.** First team to five rounds wins. Sides switch after round four.
- **One life.** Die and you watch the killcam, then spectate your team until the round ends.
- **Buy phase.** Twelve seconds behind your spawn gate to spend credits on weapons, armour and two gadgets. Survive a round and you keep your gear; die and you are back to the M-44 and a P9.
- **Sudden death.** If the clock runs out, every pilot is revealed and every hit is lethal for 35 seconds.
- **Rematch.** The end screen has a rematch vote; when everyone votes the next match starts straight away.

### Shots matter

- Head, torso and limb hit zones. The M-44 kills with one shot to the head or an unarmoured torso; a vest lets you survive one body shot.
- Bullets pass through planks, cloth and sheet metal, losing damage on the way. Brick and concrete stop them. Glass shatters.
- The long rifle leaves a vapour trail back to the shooter, loud weapons show on the rival minimap, footsteps are audible unless you walk or crouch, and near misses blur your aim.
- Scoped rifles sway. Crouch to settle, hold **Shift** to hold your breath, scroll to change zoom.

### Gadgets (two slots, keys Q and E)

Radar Pulse · Recon Drone (pilotable) · Decoy Hologram · Deploy Shield · Silent Step · Field Stim

### Arenas

Every arena is mirrored so both teams play the same ground, names its locations on the HUD, and gives bots a generated navigation grid. Hosts choose **Lobby vote** (three candidates plus "surprise me", 15 seconds, ties broken at random), **Random each match** (never the same map twice running, weighted by lobby size), or pin one arena. Matchmade queues rotate at random.

| Arena | Size | Style | What defines it |
| --- | --- | --- | --- |
| Kestrel Yard | Medium · 2v2–4v4 | Industrial rail yard | Depot roofs, a glass-fronted office, a plus-shaped underpass |
| Halcyon Atrium | Small · 1v1–2v2 | Glass-and-marble gallery | Two mezzanines with breakable glass railings, a skybridge, shoot-through exhibit panels |
| Campanile | Small–medium · 2v2–3v3 | Old-town piazza | A climbable bell tower, arcades, a balcony house per side, a sunken canal walk |
| Frostbite Station | Medium–large · 3v3–4v4 | Arctic research base | Helipad on stilts, lab roofs, snow berms (thin ones stop nothing), an ice trench |
| Dustline Pass | Large · 3v3–4v4 | Desert canyon outpost | One stone bridge over a dry riverbed, plank crossings, a watchtower, a roof-terrace house, a climbable mesa |

Each arena has its own set of conditions: Dusk, Night Fog, Storm Front and High Noon, plus **Whiteout** (snowfall, 90 m visibility) on Frostbite and **Dust Haze** on Dustline.

## Modes

| Mode | What it is |
| --- | --- |
| Quick play | Casual queue. Bots fill seats and hand them to humans who join later. |
| Ranked | Humans only. Skill rating (Elo) moves when people face people. |
| Arcade | The day's modifier: Headhunter, One Tap, Low Orbit or Sidearms Only. |
| Bot match | 3v3 against Recruit, Veteran or Elite bots. |
| Practice range | Free gear, moving targets, wall-penetration and glass lessons, guided drills. |
| Private room | Room code + invite link, team select, bots, custom rules (arena vote / random / fixed, format, round time, credits, weather, modifier, friendly fire, sudden death). |

## Leaderboard

The **Leaderboard** page ranks every account by skill rating (ranked players only), level, player kills, wins, headshots and longest kill: a podium for the top three, the rest of the top 50, and your own position however far down it is. The Play page shows the top five. Standings are rebuilt on the server at most every 30 seconds.

Phones and tablets are stopped at the loading screen with a note to play on a laptop or desktop — the game needs a mouse and keyboard — and the engine is never downloaded on them.

## Progression

Profiles live on the server in `data/profiles.json`, keyed by a random token kept in the browser. They track XP and level, skill rating, career stats, per-weapon mastery, the last 25 matches, and three daily contracts that rotate at 00:00 UTC. Levels unlock suit, visor and tracer colours and titles. The end screen can render a shareable match card (PNG).

## Controls

| Input | Action |
| --- | --- |
| W A S D / Space | Move / jump |
| Shift | Walk quietly · hold breath while scoped |
| Ctrl or C | Crouch (silent) |
| LMB / RMB / wheel | Fire / scope / zoom or switch weapon |
| 1 2 3 · R | Primary, sidearm, blade · reload |
| Q / E | Gadgets |
| B | Armoury (buy phase) |
| Z or MMB · X | Ping a location · radio commands |
| Enter / Y · Tab | Chat all / team · scoreboard |
| Gamepad | Sticks move and aim, RT fire, LT scope, X reload, Y swap, B crouch, LB/RB gadgets |

Settings cover sensitivity, field of view, volume, graphics quality, announcer voice, invert Y and toggle scope/crouch. Graphics step down automatically if the frame rate cannot hold.

## Project layout

```text
src/arena/
├── index.html, arena.css        # UI shell and styling
├── multiplayer-server.mjs       # HTTP + WebSocket entry point, matchmaking
├── shared/                      # Runs on both sides
│   ├── constants.js             # Weapons, gadgets, economy, rules, progression
│   ├── map.js                   # Map registry, Kestrel Yard and the practice range
│   ├── mapkit.js                # Box-map authoring tools (mirroring, walls, stairs, glass runs)
│   ├── maps/                    # Halcyon Atrium, Campanile, Frostbite Station, Dustline Pass
│   ├── physics.js               # Box world: movement, stairs, raycasts
│   └── combat.js                # Hit zones, penetration, spread
├── server/
│   ├── room.js                  # Match state machine, authoritative combat, gadgets
│   ├── mapflow.js               # Arena selection: fixed, random rotation, lobby vote
│   ├── bots.js, nav.js          # Bot AI and the generated navigation grid
│   ├── profiles.js              # JSON profile store
│   └── accounts.js, discord.js  # Accounts and "Log in with Discord"
├── client/                      # Three.js client (world, characters, viewmodel, HUD, menus, audio)
└── tests/                       # `npm test`
backend/                         # Separate Python Call of Duty profile API (unrelated to the arena)
```

### Networking notes

The client predicts its own movement and draws tracers immediately; the server validates movement speed and position, rewinds other players to the moment you fired (lag compensation, capped at 400 ms), and decides every hit. Remote players are interpolated 100 ms in the past. If your connection drops mid-match your seat is held for 45 seconds and the page rejoins on its own, even after a refresh.

## Tests

```bash
npm test
```

For every arena: mirroring, clear spawns inside their zones, closed gate-to-gate sightlines, and bot paths from both spawns to every point of interest. Also walks a body through the yard's underpass and roofs, exercises hit zones, penetration, glass and the damage model, and drives a real room through map pinning, voting and random rotation.

Adding an arena: write `shared/maps/<id>.js` with the `mapkit` builder (author the south half with `SYM`), register it in `MAP_INFO`/`BUILDERS` in `shared/map.js`, and `npm test` will tell you what is unfair or unreachable.

## Python backend

`backend/server.py` exposes `/api/cod/profile` on http://127.0.0.1:4173 and is independent of the game. It needs `COD_SSO`, or `COD_EMAIL` and `COD_PASSWORD`, in the environment:

```bash
python backend/server.py
# http://127.0.0.1:4173/api/cod/profile?username=YourUsername&platform=uno&title=mw&mode=zm
```

## Notes

- The server is authoritative about combat, but it does not hide enemy positions from a modified client — fine for playing with friends, worth keeping in mind if the player base ever grows beyond that.
- The announcer uses the browser's speech synthesis, so its voice varies by system. It can be turned off in Settings.

## License

ISC
