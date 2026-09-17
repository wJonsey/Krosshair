# Sniper Shootout

A round-based tactical sniper game for the browser. Two teams, one life per round, best of nine, a buy phase between rounds, and five hand-built arenas from a 1v1 gallery to a canyon-sized sniper range. The Node server owns the truth — health, ammo, credits, hit detection — so matches stay fair between friends on different connections.

No accounts, no asset downloads: every model, texture and sound is generated in code.

## Quick start

```bash
npm install
npm run arena
```

Open http://localhost:4174/ , pick a callsign, and press **Find a match** (bots fill empty seats) or **Learn the ropes** for the practice range.

For a static GitHub Pages frontend, start the multiplayer server with `npm run server`, expose port 4174 publicly, and open Pages with `?server=https%3A%2F%2Fyour-server-host`. The client will use that host for its WebSocket connection.

To play with friends, create a private room and send them the invite link shown in the lobby. On a LAN, replace `localhost` with your machine's address. Override the port with `ARENA_PORT=5000 npm run arena`.

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
│   └── profiles.js              # JSON profile store
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

- Built for private and LAN play. The server is authoritative about combat but does not hide enemy positions from a modified client, so it is not hardened for public deployment.
- The announcer uses the browser's speech synthesis, so its voice varies by system. It can be turned off in Settings.

## License

ISC
