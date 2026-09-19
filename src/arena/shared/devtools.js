// Dev tools. The developers' accounts only (server/devs.js), switched on from the K menu in a match.
// `server: true` means the server has to agree: it checks the account on every toggle, so a tool can
// never be turned on by anyone else, and bots have no account at all.
export const DEV_TOOLS = [
  { id: 'fly', name: 'Fly', desc: 'No gravity, no walls. Jump and crouch to rise and drop.', server: true },
  { id: 'ghost', name: 'Invisible', desc: 'Nobody sees you. Not even the bots.', server: true },
  { id: 'god', name: 'God mode', desc: 'Nothing hurts you.', server: true },
  { id: 'ammo', name: 'Infinite ammo', desc: 'Never empty, never reloads.', server: true },
  { id: 'speed', name: 'Speed', desc: 'Move much faster.', server: true },
  { id: 'rich', name: 'Full credits', desc: 'Buy anything in the armoury.', server: true },
  { id: 'esp', name: 'ESP', desc: 'Every pilot through walls, with health and range.' },
  { id: 'aimbot', name: 'Aimbot', desc: 'Locks onto the nearest enemy you can see.' },
  { id: 'nospread', name: 'No sway', desc: 'No scope sway, no recoil kick.' },
];
export const DEV_SERVER_TOOLS = DEV_TOOLS.filter((tool) => tool.server).map((tool) => tool.id);
export const DEV_TOOL_IDS = DEV_TOOLS.map((tool) => tool.id);
// One-shot actions, not toggles.
export const DEV_ACTIONS = [
  { id: 'heal', name: 'Full health', desc: 'Back to 100 and full armour.', server: true },
  { id: 'teleport', name: 'Teleport', desc: 'Jump to where you are looking.', server: true },
  { id: 'refill', name: 'Refill ammo', desc: 'Every magazine full again.', server: true },
];
export const DEV_ACTION_IDS = DEV_ACTIONS.map((action) => action.id);
export const DEV_SPEED = 2.2;        // how much faster the speed tool moves you
export const DEV_FLY_SPEED = 2.6;    // fly speed, as a share of the run speed
export const DEV_FLY_LIFT = 11;      // metres a second up or down while flying
