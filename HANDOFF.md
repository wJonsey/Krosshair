# Handoff: what changed recently, and how to work on it

Read `CLAUDE.md` first. It has the ground rules, the commands and the file map, and it still applies.
This file covers the systems added since then and the traps that have already cost time. If you add a
system, add it here.

## Ground rules worth repeating

- `main` is production. A push deploys to krosshair.online within about five minutes and restarts the
  server, dropping anyone mid match. `npm test` must pass before every commit.
- Never read, print or commit `.env`. Never touch `data/`.
- No em dashes anywhere in the repo, ever. Use a colon, a comma or a full stop.
- Only paths under `src/arena/` are served, and never `server/`, `tests/` or dotfiles. That is load
  bearing: see "Secrecy" below.

## The Item Shop

Four themed sets a day, swapped at midnight UTC, gone the next day.

| Piece | File | What it holds |
| --- | --- | --- |
| The catalogue | `server/itemsets.js` | **Server only.** Every set: name, blurb, debut date, contents, and the exclusive skins' and cosmetics' names and rarities. |
| The rules | `shared/itemshop.js` | Rotation, last seen, prices, bundles, runway. Holds no set data of its own. |
| Buying | `server/economy.js` `buyItemShop` | Checks the set is out today, the piece is in it, the bundle is today's, and the coins are there. |
| The menu | `client/shop.js` `marketHtml` | Merged with the crates into one tab. |

**Nothing is random at runtime.** The day's line-up is dealt from the date, so every pilot, the server
and the menus work out the same shop with nothing stored. That is also what makes a set's history
replayable: walking the days backwards is how "last seen" is answered.

**Secrecy.** `shared/itemshop.js` starts empty and is filled by `setCatalogue()`. The server calls
`installCatalogue()` at boot with everything; a client is sent only `publicCatalogue(today)`, which is
the sets that have already debuted. A set that has not landed is not in the page source at all. Keep it
that way: never import `server/itemsets.js` from client or shared code, and never add a set, a name or a
debut date to a shared file. Tests assert the wire payload contains no unreleased name or id.

Known limit, accepted: the painters in `client/skins.js` and the geometry in `client/operator.js` ship
with the client and are keyed by id, so a reader of the source can find bare ids. What they cannot find
is the name, the set, the price or the date.

**Adding a set.** Add it to `ALL_SETS` in `server/itemsets.js` (the list is in debut order) with a debut a
week after the last one, add its pieces to `EXCLUSIVE_FINISHES` or `EXCLUSIVE_COSMETICS` with `shop: 'item'`,
then add the art: a painter in `client/skins.js`, a maker in `client/charms.js`, or a group in
`client/operator.js`. `tests/itemshop.test.mjs` fails if a piece has no art, if two sets debut on one day,
or if more than a fortnight passes with nothing new.

**The schedule is what makes it rotate.** Four a day out of however many have landed: with one set out the
shop shows that one set every day, which is exactly what players saw for its first week (the next debut was
three months away). It launched with a week of one set a day, then one a week; the last current set lands
2026-12-17, so new ones are needed before then (the dev runway line counts down to it).

**The page deals for the server's day.** The catalogue arrives stamped with the server's `day` and clock
(`shopCatalogue` in `multiplayer-server.mjs`), and `client/itemcatalogue.js` keeps them (`shopToday`,
`shopNow`). Every shop call in `client/shop.js` passes `shopToday()`: a machine whose clock is off used to
deal a hand the server refused to sell, and a fast one asked for the new shop before the server's midnight.

**A bought piece is worn by the same rule everywhere.** `cosmeticUnlocked` in `shared/constants.js` decides;
the Locker, the Operator page and the server all call it. A copy of the rule that only knew prices and levels
is how every exclusive once showed as "Level undefined" with no Equip. An Item Shop purchase replies
`{ set, kind, id }`, a skin included (`kind: 'finish'`), so the reply handler turns that into a skin before
anything treats it as gear.

**Exclusives have no other way in.** No crate drops one, no trade-up pays one out or eats one, the
normal shelf refuses to sell one, and they cannot be scrapped. If you add a route that hands out a
finish, exclude `finish.shop === 'item'` and add a test.

**The runway** is the dev-only line on the shop header saying how many days of sets are left. It counts
sets a client is never told about, so it is computed on the server and attached to the profile view for
dev accounts only. Do not move it client side: it will read zero.

## Friends and parties

Mutual friendship and the party you queue with. It is a drawer off the menu bar, not a page: the
button sits in the tool row next to the online count, and the panel slides in over whatever you were
doing. Checking who is on should not cost you your place.

| Piece | File | What it holds |
| --- | --- | --- |
| The rules | `server/social.js` | Requests, accepting, blocking, and the migration off the old list. Pure functions over two profiles, so the tests drive them with no sockets. |
| The parties | `server/party.js` | `PartyBook`: in memory, never on disk, like rooms. A pilot is always in exactly one party, their own party of one to start with. |
| The wiring | `multiplayer-server.mjs` `handleFriends`, `handleParty` | Resolves a name to an account and a profile, then pushes a `social` snapshot to everyone affected. |
| The drawer | `client/social.js` | Owns its own DOM (appended to `body`, like the settings card), draws itself, and handles its own clicks. `menu.js` only renders `socialButtonHtml()` into the bar and calls `toggleSocial()`. |

**`friends` used to be a one-way address book** for sending coins: you added a name and that was that.
It is mutual now, so `normalize()` moves any entry the other side never agreed to into a pending request
rather than deleting it. It runs whenever a snapshot is built and is idempotent. Sending coins still works
by name through `lookup`, so nobody lost the ability to pay anyone.

**One message, every list.** The server sends `social` holding friends, requestsIn, requestsOut, blocked,
recent and the party. The page never patches a list itself: act, then draw whatever comes back. Anything
that changes a relationship has to push to both sides (`pushSocialTo`) or one of them sees stale rows.

**Presence is derived, never stored.** `presenceOf` reads the live sockets and their room. Only connected
friends are told when you move (`tellFriends`), because nobody else can see it.

**A party follows its leader.** `enter()` seats the leader, then seats the rest in the same room through
`place()`. It reuses the leader's room object rather than the room name, because a quick or ranked room
is not joinable by name. Anyone who cannot be seated is told and stays in the menu: the leader still goes.

**An unhandled message is invisible.** The first version of this shipped with the server sending
`party-invite` correctly and the client never listening for it, so every invite vanished and the
tests stayed green: they asserted the server *sent* it. `socialwire.test.mjs` now scans the server
for social message types and fails if any has no `net.on` on the client. Worth copying for other
systems.

**Traps.**
- `friends` messages go through the coins rate limiter in `handleCoins`: two actions inside 200ms get
  `coins-error: Slow down`. Fine for clicking, but a test has to pace itself.
- Blocking has to break the party too, or the blocked pilot is still sitting in it.
- `party.queued` is cleared when the last member leaves the room, not when the leader does, or a party
  that finished a match can never queue again.
- A party join is only honoured if the party actually invited you, checked on the party, not the client.
- The drawer redraws itself wholesale, so the search box is preserved by hand in `drawFriends()`.
  Same problem the shop pages have, same shape of fix.
- Adding a server message means adding `net.on` for it in the same change, or it goes nowhere.

## Ranked

One rating, four sizes: `ranked-1v1`, `ranked-2v2`, `ranked-3v3`, `ranked-5v5`, each matchmaking on its
own. Use `isRanked(queue)` rather than comparing to the string `'ranked'`; the bare `'ranked'` queue is
kept only so an old client still finds a match. `RANKED_MODES` and `TEAM_MODES` live in
`shared/constants.js`, and `teamSizeOf` answers for both.

The Ranked page (`rankedPageHtml` in `client/menu.js`) is a hub: tier emblem, SR, the six tier climb,
season record and recent form. All of it is derived by walking `profile.history` backwards through each
match's stored SR swing. Nothing new is persisted, so do not add a store for it.

Maps lay out four spawns a side, so a 5v5 wraps. `room.js` `spawnPoint` steps the extra pilots aside to
the nearest clear spot. Anything that raises team size past five needs that looked at again.

## Who can see what

- **Guests** get Play, Settings, Controls and Feedback. Everything that belongs to an account is shut
  (`GUEST_PAGES` in `client/menu.js`). The gate page must not offer guest play: pass
  `authHtml({ guestOption: false })`.
- **Devs** are `server/devs.js` by Discord name, through `profile.dev` to `view().dev` to
  `game.profile.dev`. Dev cosmetics are the `dev` rarity and are secret: `rarityOrder()`,
  `PUBLIC_FINISHES` and `PUBLIC_RARITIES` exist so nothing dev shows to anyone else. The server is the
  real enforcement; the client gate is only so it is not drawn. Bots never get dev anything.
- Dev tools are on `K` (`client/devtools.js`), and the header online count becomes a "who is playing"
  panel for devs.

## Warnings

`showNotice()` in `client/menu.js` is the one card for anything a pilot has to read. Entering from the
loading screen raises the build warning; queueing the royale raises a gate that has to be agreed to,
asked once a session. `boot.js` is a classic script and cannot import the bus, so it fires a
`krosshair:entered` window event instead.

## Controller

With a menu open the pad drives the menu, not the pilot. `pollPad` in `client/player.js` emits `pad-ui`
with `up`, `down`, `left`, `right`, `confirm`, `back`, `tabPrev`, `tabNext`, and the HUD acts on it. That
layer reads **raw** button codes, not the bind table: a menu button has to sit where every pad puts it,
whatever the pilot rebound for the game.

## Gunsmith screen

`gunsmithHtml()` in `client/shop.js` draws the gun in the middle with its slots around it, a parts list
that slides in from the right for the open slot, and the numbers bottom left. It is presentation only:
every change to a build still goes through the `d.smithPart` click handler and `keepBuilds()`, and the
Escape and R keys on that screen are synthetic clicks on the same buttons. The summary bars read the
same `resolveWeapon` output as the detailed rows and only place each number against the rest of the guns.

At 1920x1080 the slots sit around the gun. Below 1800 wide or 1000 tall they go in a row above the gun
and a row below, with the numbers in a column of their own; below 1020 wide it all stacks. The gun's box
is kept clear of the side slots by `--callout-w`, the slots' own width, and the camera fits the gun to
that box whatever its shape (the `tab === 'gunsmith'` branch in the stage's `fit`). Dragging the gun
turns it: all the way round, a little tilt, and back to side on for a new gun. Every other preview turns
the same way (skins, charms, crates, the Locker and Play page pilot), all through `client/turntable.js`.
A crate lets go of its angle the moment it is opened, so the opening always swings round to face you.

## The royale deployment

The opening of a royale: a countdown, one transport flying a line across the island, and each pilot
choosing when to go off its back ramp. The only third-person camera in the game; it hands back to first
person the moment the pilot is on their feet.

| Piece | File | What it holds |
| --- | --- | --- |
| The numbers | `shared/royale.js` `DEPLOY` | Countdown, aircraft altitude, speed and route, ramp door delay, max flight, free fall and chute speeds, auto-deploy height, landing time, camera tuning. |
| The maths | `shared/royale.js` | `flightRoute`, `flightPlan`, `aircraftAt`, `rampAt`, and `descentStep` (one frame of falling, flown by the browser and by the tests). |
| The rules | `server/royale.js` | `board` at match start, `fly` each tick, `jump` (validated), `exit`, `fallLimit`, bots' `jumpAt`. |
| The show | `client/deploy.js` | The aircraft model, your own pilot and chute, the camera director, the countdown and prompts, marking the ground. |
| The poses | `client/operator.js` `animateOperator` `pose.deploy` | Ramp, free fall and canopy, blended in like crouch; `buildChute` is shared with other pilots (`characters.js`). |

**Stages, one at a time.** `plane` (aboard: `player.mode === 'plane'`), `jump` (a run down the ramp and off,
predicted on the key press), `freefall`, `chute`, `landing` (knees, stand, camera blends into the eye over
`DEPLOY.blend`), then null: first person, viewmodel drawn back in. The stage follows the server: `you.inPlane`,
then a `spawn` high up, then the ground. A death or leaving the match resets it.

**The server owns it.** Aboard, a pilot is alive but nowhere: no snapshot row, no damage, no storm, no loot,
and their own position messages are ignored. `royale-jump` is taken only aboard, alive, with the ramp open,
once. Anyone still aboard at `ejectAt` goes out over land. Off the ramp the descent is budgeted: free fall
speed until the chute has had `DEPLOY.parachute.open` to slow you (the chute flag in state, or being under
`autoDeploy` above the ground, whichever is first), chute speed after. No weapon, swing or gadget works until
`inDrop` clears on landing.

**The aircraft costs nothing to send.** The flight plan goes out once (`royale-flight`), and every browser places
the aircraft with `aircraftAt` on its own clock.

**Traps.**
- The sea is outside the world: bounds clamp anything beyond them. The ramp opens `route.lead` metres inland
  for that reason, and `exit` clamps too.
- The ramp camera is fenced to `camera.ramp.arc` round the tail and kept under the tailplane: further round
  or higher and it is inside the hold or looking at the tail's underside.
- On Jump the facing turns to the flight heading at once (as the spawn will), or the follow camera swings
  through the fuselage while waiting for the server.
- Each scratch vector in `deploy.js` has one job. Sharing one between the follow target and its direction
  once put the camera at the world origin.
- There are no squads in the royale (everyone is their own team), so there is no squad drop or follow.

## Weapon levels

Every gun starts at level 0 with only its stock build, earns XP when it gets kills and assists, and unlocks
attachments as it levels. Everything to tune is at the top of `shared/gunlevels.js`: `MAX_WEAPON_LEVEL`,
`XP_CURVE` (total XP per level), `WEAPON_XP` (kill, bot kill, headshot, assist), `UNLOCK_LEVELS` (per part)
and `WEAPON_UNLOCKS` (a different level for one part on one gun). A new attachment needs a line in
`UNLOCK_LEVELS` or `tests/gunlevels.test.mjs` fails.

**Saved with the profile.** Levels live in `profile.gunXp` (weapon id to XP) and are written with the rest
of the profile, so a restart or deploy keeps them. A guest's profile is never written, so a guest's levels
last only as long as the guest. The kill-count mastery badges in `profile.weapons` are a separate record.

**Parts are free.** Fitting parts never changes a gun's Armoury price: `resolveWeapon` keeps `cost` at the
base weapon's, and the Gunsmith shows no part prices.

**The server decides.** XP is paid only from `kill()` in `room.js` (`gunXp`), for the gun the server says
did it; assists pay the gun the damage was done with (`damageWith`). Bots, watchers and the range earn
nothing. What a gun may carry is `usableBuild`, applied when a build is saved (`saveBuilds` refuses locked
parts and says so), sent (`view().builds`), handed out (`holdBuild`) and bought (`buy`). The Gunsmith reads
`game.profile.gunXp` and the `gun-xp` message only to draw levels and locks.

This replaced the old rule that every part unlocked at pilot level 4 (`ATTACHMENT_LEVEL`): with both,
a gun at level 10 would still have been locked for a new pilot.

## One game per person

The newest tab or connection wins. In one browser the tabs tell each other over a `BroadcastChannel`
(`net.js`), which covers guests: they get a new identity per tab, so the server cannot tell two of them
apart. For accounts the server also keeps one connection each (`signIn`), which covers other browsers
and machines, and a takeover mid-match carries the seat into the new tab with a `rejoin-offer`. A tab
that is taken over stands down (`net.suspend` state, no retries) and shows a card whose only way on is
Play here: if it reconnected by itself the two tabs would take the game from each other for ever.
Two different browsers as two guests are still two players; nothing ties them together.

## What the server checks

The client is a proposal. These are the rules it is held to, and the tests that prove each one
(`tests/anticheat.test.mjs`, `serving.test.mjs`, `partyfollow.test.mjs`); each was a working exploit first.

- **Movement is budgeted over time** (`onState` in `room.js`). Distance refills at `BODY.speedLimit` a second
  and at most `MOVE_BANK` seconds of it can be carried; the path between updates must be clear (`swept`); a
  landing is still only a jump above the last ground (`climbOk`); coming down is budgeted too (`fallLimit`,
  and the royale drop's own chute rule on `RoyaleRoom`). The drone has the same budget and stays in the map.
  The test that matters most is the honest one: a pilot flat out on every arena with network hitches is never
  refused. Run it after touching any of this, or after adding a way to move fast (a pad, a boost, a mode).
- **Shots start at the server's eye** for the pilot, within `SHOT_SLACK` and in sight of it. The spread seed
  follows the server's count of shots (`shotSeed`), so a client cannot pick a lucky one; an honest page counts
  up by one and still predicts every pellet.
- **A table lookup with a client key uses `own()`.** `WEAPONS['constructor']` is truthy; buying it made
  credits NaN and every price check pass after that. The same goes for `COSMETICS`, `MODIFIERS` and the rest.
- **Ranked is settled by the roster that started** (`rankedStart`, `expectedA`). Walking out is a loss there and
  then (`forfeit`), a started ranked match takes nobody new, and a pilot who played no round of a match gets
  nothing recorded; a win's rewards need half the rounds (`short`).
- **A gun keeps the build it was bought or handed out with** (`holdBuild`). A build saved mid-match is for the
  next gun; in the lobby and on the range it applies at once (`takeBuilds`). Parts unlock by level on the server.
- **A party follows its leader only where that is fair**: never out of a match a member is playing, never past
  the anti-cheat lockout, never onto both sides of a ranked match, and dealt onto one side where it fits.
  Where a pilot is (`presenceOf`) goes to friends and party members only. Invites go to friends, paced.
- **Floods are bounded**: 40 connections per address (the address Cloudflare saw, believed only from
  loopback), one guest profile per socket, room pushes gathered past 20 a second, one catalogue a couple of
  seconds, a few logins in progress per address.
- **Each pilot is sent only the enemies they could see or hear** (`sightSet` and `canSee` in `room.js`), so an
  ESP has nothing to draw. In sight means a clear line from the eye, or from where it will be a moment from now,
  to the head, chest or knees, or a little either side (`SIGHT_EDGE`, `SIGHT_LEAD`), held for `SIGHT_HOLD`
  after; heard means running within `HEARING`, which is how far the browser plays footsteps; marked means a
  pulse, a drone or overtime. Team mates are always sent and the dead see what their side sees. Developer
  accounts (`player.dev`, from the server), staff watching and the royale's dead get everything, which is
  what keeps the dev ESP working. `client/characters.js` drops a pilot's old samples across a gap so one
  coming back into sight does not slide there. Two tests matter: the ESP one, and the one where a pilot
  sprints out past a corner and the enemy must already be on the page the first frame they could see them.
  Gunfire (`shot`) and a pulse still go to everyone, on purpose: they are meant to give you away.
- **Stores refuse to start over a file that will not parse** (`readStore`). It used to load as empty and the next
  save wrote the empty store over everyone.
- **Not fixable from the server, so still open**: aim is the client's (an aimbot needs a modified client, and
  `window.__arena` hands one everything it can see), an enemy running within earshot is sent through walls
  because the page needs them for footsteps, rewind trusts the client's timestamp up to `MAX_REWIND`, and the
  crouch/scoped/ground flags are the client's word.

## Traps that have already cost a day

- **The gunsmith stage must stay inside the floor, first on it, and `width: auto`.** It takes drags to
  turn the gun, and a canvas takes the click anywhere it overlaps, which once made a gun unpickable. `.skin-stage` is `width: 100%` for every other
  stage, and an explicit width beats `left`/`right`, so without `width: auto` the box silently ran the
  full width and the gun sat off to one side.

- **`net.on` used to keep one handler per type.** It holds arrays now. If you register a second handler
  for a type, check it still holds arrays before assuming both run.
- **One `#skin-stage` exists at a time.** Whichever tab renders one gets the shared 3D stage moved into
  it by `mountShop`. Never create a second `WebGLRenderer` for a preview, and route what it shows
  through `stageSubject()`.
- **`skinArt(weaponId, finishId)`, in that order.** Reversing it throws, gets swallowed, and every image
  comes back blank.
- **A charm with no mount is never parented.** Guns without `userData.charmAt` get no charm, and an
  unparented charm must never be animated. That crash killed a frame 12,000 times a second and looked
  like the royale being broken.
- **ID selectors in `arena.css` beat class selectors.** A bare `#operator-preview { ... }` written for
  one page silently sized the canvas on another. Scope page specific rules to the page.
- **The page chrome is 68px of bar, 81px of page padding and a 59px footer.** A `min-height` that
  subtracts anything else will fight the layout and leave content below the fold.
- **Coverage tests are the safety net.** `every finish has a painter`, `every charm a maker`, and the
  Item Shop's own art test will fail if you register content before the art exists. That is working as
  intended: add both in the same change.

## Verifying

- `npm test` runs everything. It is headless and fast enough to run on every change.
- The browser preview is `.claude/launch.json` `krosshair-shop` on port 4192: webhooks off, and pointed
  at scratch data so it never touches real profiles. Never start a server with the real `.env` webhooks.
- The live site can be checked without logging in: the config handshake at `wss://krosshair.online/arena`
  carries the public item shop catalogue, and `curl` on `/src/arena/...` shows exactly what ships to a
  browser. Use that to prove a secret stayed secret.
- If a browser session is signed in as a real player, read only. Never spend their coins or change their
  loadout to test something.
