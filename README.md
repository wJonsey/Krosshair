# Sniper Shootout

A fast browser-based multiplayer shooter prototype built for local play in a private arena. The project includes a 3D sniper arena in the browser, a WebSocket multiplayer server, and a lightweight Python backend for Call of Duty profile lookups.

## Features

- Browser-based 3D sniper arena experience
- Match lobby and room-based multiplayer via WebSockets
- Private room codes for quick local sessions
- Player customization for callsign, operator style, colors, and settings
- HUD, scoreboard, reload flow, respawn loop, and match state handling
- Python API endpoint for external Call of Duty profile data

## Project layout

```text
.
├── index.html                  # Redirects to the arena entry page
├── package.json                # Node scripts and dependencies
├── backend/
│   ├── server.py               # Python API server
│   └── codwrapper/             # Call of Duty API client package
├── src/
│   └── arena/
│       ├── arena.css           # Arena styling
│       ├── arena.js            # Game client logic and rendering
│       ├── index.html          # Game UI shell
│       └── multiplayer-server.mjs  # WebSocket game server
└── README.md
```

## Requirements

- Node.js 18+
- npm
- Python 3.10+

## Install dependencies

```bash
npm install
```

## Run the arena server

Start the multiplayer arena server:

```bash
npm run arena
```

This starts the WebSocket server and static file host on the default port:

- http://localhost:4174/src/arena/index.html

You can override the port with:

```bash
ARENA_PORT=5000 npm run arena
```

## Run the Python backend

The Python backend exposes a profile endpoint at `/api/cod/profile`.

```bash
python backend/server.py
```

Default port:

- http://127.0.0.1:4173

To use the profile API, set one of the following environment variables:

```bash
export COD_SSO="your-sso-token"
```

or

```bash
export COD_EMAIL="your-email@example.com"
export COD_PASSWORD="your-password"
```

Then query:

```bash
http://127.0.0.1:4173/api/cod/profile?username=YourUsername&platform=uno&title=mw&mode=zm
```

## Test the project

```bash
npm test
```

This checks the JavaScript files for syntax issues.

## Local gameplay

1. Start the arena server with `npm run arena`.
2. Open the page in your browser:
   - http://localhost:4174/src/arena/index.html
3. Enter a callsign and join a room.
4. Open the same room in another browser or device on the same network to play together.

## Notes

- The arena is designed for local or private network multiplayer, not a public production deployment.
- The root `index.html` redirects to the arena page for convenience.
- The Call of Duty profile endpoint depends on valid credential environment variables and may require platform-specific configuration.

## License

ISC
