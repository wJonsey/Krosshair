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

**Adding a set.** Append to `ALL_SETS` in `server/itemsets.js` with a debut at least a week after the
last one, add its pieces to `EXCLUSIVE_FINISHES` or `EXCLUSIVE_COSMETICS` with `shop: 'item'`, then add
the art: a painter in `client/skins.js`, a maker in `client/charms.js`, or a group in
`client/operator.js`. `tests/itemshop.test.mjs` fails if a piece has no art.

**Exclusives have no other way in.** No crate drops one, no trade-up pays one out or eats one, the
normal shelf refuses to sell one, and they cannot be scrapped. If you add a route that hands out a
finish, exclude `finish.shop === 'item'` and add a test.

**The runway** is the dev-only line on the shop header saying how many days of sets are left. It counts
sets a client is never told about, so it is computed on the server and attached to the profile view for
dev accounts only. Do not move it client side: it will read zero.

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

## Traps that have already cost a day

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
