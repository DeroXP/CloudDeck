# CloudDeck

A self-hosted cloud gaming and remote PC control platform with a PSP-inspired XMB web interface. Wake your gaming PC from anywhere, browse your Steam and Xbox library, launch games remotely, and stream them to any browser.

The full design and rationale lives in [Project.Md](./Project.Md). This README is the operator's manual — what to install, where, and how to wire it together.

## Architecture at a glance

```
Browser  ──HTTPS/WSS──>  Railway app  ──WSS──>  PC agent  ──>  Sunshine / Windows
                              │
                              └──HTTP──>  Pi (WoL forwarder)  ──UDP magic packet──>  Gaming PC
```

Four pieces:

1. **Railway app** (`client/`) — Node.js + Express + WebSocket signaling. Serves the XMB UI, authenticates users, brokers all command traffic between browsers and PC agents. The video stream does **not** flow through this — WebRTC goes browser→PC directly.
2. **PC agent** (`agent/`) — Node.js script that runs as a Windows service on your gaming rig. Connects to the Railway WebSocket, executes commands (launch game, fetch library, gather stats, sleep), and pushes telemetry.
3. **Raspberry Pi WoL forwarder** (`pi/`) — Python Flask app on your home LAN. Receives wake requests from the Railway app and broadcasts a magic packet to the gaming PC.
4. **Client** — any modern browser. No app to install. The XMB UI auto-adapts to controller, keyboard, mouse, or touch.

## Prerequisites

| Component | Requirements |
|---|---|
| Railway app | Node 20+ (or Railway's hosted runtime). Persistent volume mounted at `client/data/` recommended. |
| PC agent | Windows 10/11 with Node 20+, [Sunshine](https://app.lizardbyte.dev/Sunshine/) installed and configured, Steam installed for Steam library scanning. NVIDIA GPU recommended for NVAPI stats. |
| Pi forwarder | Raspberry Pi (Zero 2 W or any model), Raspberry Pi OS Lite, Python 3.9+, on the same LAN as the gaming PC. |
| BIOS / Windows | Wake-on-LAN enabled in BIOS under network adapter settings. In Windows: Device Manager → Network Adapter → Power Management → check "Allow this device to wake the computer". |

## Setup

### 1. Deploy the Railway app

```bash
cd client
cp ../.env.example .env
# Edit .env — set AGENT_TOKEN, JWT_SECRET, PI_URL, PI_SECRET_TOKEN
npm install
npm start
```

For Railway deployment: connect this repo, set the same env vars in the Railway dashboard, mount a volume at `/app/client/data` for persistent users/sessions.

Docker Compose is available for local development:

```bash
docker compose up
```

### 2. Install the PC agent on your gaming PC

```powershell
cd agent
copy ..\.env.example .env
# Edit .env — set RAILWAY_WS_URL and the SAME AGENT_TOKEN as the Railway app
npm install
npm run install-service   # registers the agent as a Windows service
```

The service auto-starts on boot and reconnects on disconnect. You can also run it in the foreground for testing with `npm start`.

If `robotjs` fails to build (it requires native compilation), install the Windows Build Tools first:

```powershell
npm install --global windows-build-tools
```

### 3. Set up the Raspberry Pi

```bash
ssh pi@raspberrypi.local
git clone <your-fork-url> CloudDeck
cd CloudDeck/pi
cp ../.env.example .env
# Edit .env — set PI_SECRET_TOKEN (matching Railway), PC_MAC_ADDRESS
sudo bash install.sh
```

The install script creates a Python venv, installs dependencies, registers a systemd service, and starts it. Verify with `sudo systemctl status clouddeck-wol`.

### 4. First-run wizard

On first browser visit to the Railway app, a setup wizard walks you through creating the admin account, confirming the PC agent is connected, testing Sunshine, and (optionally) configuring the Pi. The wizard never appears again unless you reset configuration from settings.

## Repository structure

```
CloudDeck/
├── client/                     Railway web app
│   ├── server.js               Express + WebSocket signaling
│   ├── auth.js                 JWT, bcrypt, rate-limit, TOTP 2FA
│   ├── users.js                User/role management
│   ├── store.js                JSON-file persistence
│   ├── pi.js                   Pi forwarder client
│   ├── public/                 XMB frontend
│   │   ├── index.html          Main UI
│   │   ├── login.html          Login screen
│   │   ├── onboarding.html     First-run wizard
│   │   ├── css/                XMB styles
│   │   └── js/                 Frontend modules (focus mgr, network, AFK, etc.)
│   └── package.json
├── agent/                      PC-side Node.js agent
│   ├── index.js                Main agent (WebSocket, command routing)
│   ├── launcher.js             Game launch + exit-code monitoring
│   ├── library.js              Steam + Xbox library scan
│   ├── display.js              Sunshine virtual display + monitor toggle
│   ├── input.js                Mouse/keyboard simulation (robotjs)
│   ├── afk.js                  PC-side AFK helpers
│   ├── crash.js                Process exit-code interpretation
│   ├── resume.js               Detect already-running games
│   ├── sleep.js                Smart sleep scheduler + Windows sleep
│   ├── network.js              Ping/jitter/loss reporting
│   ├── session.js              Session history logging
│   ├── audio.js                PC speaker mute / restore
│   ├── stats.js                WMI + NVAPI stats collection
│   ├── screenshots.js          Steam screenshot watcher
│   ├── updater.js              GitHub-release-based auto-updater
│   └── package.json
├── pi/                         Raspberry Pi WoL forwarder
│   ├── wol_server.py           Flask HTTP server + magic packet sender
│   ├── requirements.txt
│   ├── install.sh              Sets up venv + systemd service
│   └── clouddeck-wol.service   systemd unit file
├── Dockerfile                  Production image for the Railway app
├── docker-compose.yml          Local dev orchestration
├── .env.example                All variables, grouped by component
├── Project.Md                  Full design document
└── README.md                   This file
```

## Security

- All browser → Railway traffic must use HTTPS (Railway terminates TLS at the edge).
- All Railway → agent traffic must use `wss://` in production.
- The PC agent authenticates with `AGENT_TOKEN`. Treat this like a password.
- The Pi authenticates Railway with `PI_SECRET_TOKEN`. Use a strong unique value.
- User login uses bcrypt + JWT with rate limiting. Enable 2FA in settings.
- Guest accounts cannot wake/sleep the PC, change settings, or access remote-desktop mode.

## Costs

| | |
|---|---|
| Railway Hobby Plan | $5/mo |
| Raspberry Pi Zero 2 W | ~$15 one-time |
| microSD card | ~$10 one-time |
| **Total ongoing** | **~$5/mo** |

## License

MIT. See [LICENSE](./LICENSE) (add your preferred license file).

## Contributing

This is open source — fork it, configure your own `.env`, deploy. PRs welcome. See [Project.Md](./Project.Md) for the full feature roadmap (26 phases) and the design intent behind each.
