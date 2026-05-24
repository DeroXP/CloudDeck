\# CloudDeck — Full Technical Breakdown



\---



\## What Is CloudDeck?



CloudDeck is an open source, self-hosted cloud gaming and remote PC control platform. It lets you wake your gaming PC, browse your Steam and Xbox game library through a PSP-inspired XMB web interface, launch games remotely, and stream them directly to any browser — on a laptop, phone, or external display. It is deployed on Railway, open sourced on GitHub, and designed so anyone can fork it and configure it for their own setup.



\---



\## High Level Architecture



There are four physical pieces:



1\. \*\*Railway\*\* — hosts the web app (UI + signaling server)

2\. \*\*Your Gaming PC\*\* — runs the agent, hosts Sunshine, runs the games

3\. \*\*Raspberry Pi Zero 2 W\*\* — sits on your home network, handles Wake-on-LAN

4\. \*\*Client Device\*\* — your laptop, phone, or any browser that connects to the Railway app



These four pieces communicate like this:



```

Client Browser ──── HTTPS/WebSocket ──── Railway App

&#x20;                                             │

&#x20;                                        WebSocket

&#x20;                                             │

&#x20;                                        PC Agent (on gaming PC)

&#x20;                                             │

&#x20;                                   ┌─────────┴──────────┐

&#x20;                                Sunshine            Windows APIs

&#x20;                                (stream)         (launch, stats, etc.)



Railway App ──── HTTP POST ──── Pi Script ──── Magic Packet ──── Gaming PC (asleep)

```



The video stream never passes through Railway. It goes directly from Sunshine on your PC to your browser via WebRTC. Railway only handles control signals, commands, and UI delivery.



\---



\## Phase 1 — Railway App + PC Agent WebSocket Connection



\### How It Works



The Railway app is a Node.js/Express server. When it starts up it also spins up a WebSocket server alongside it. The PC agent, which is a Node.js script running permanently on your gaming PC, connects to that WebSocket server on startup and maintains a persistent connection.



This connection is the nervous system of CloudDeck. Every command from the browser (launch game, fetch library, sleep PC, etc.) travels through this channel. Every response from the PC (library data, stats, game status) travels back through it.



\### Railway Side



Express serves the web UI as static files. A WebSocket server listens for the PC agent to connect. When the agent connects, Railway marks the PC as online and broadcasts that status to any open browser sessions. If the agent disconnects (PC sleeps, crashes, loses internet), Railway marks the PC offline and updates the UI.



\### PC Agent Side



A Node.js script runs as a Windows background service using a tool like `node-windows`. It connects to the Railway WebSocket URL on startup and reconnects automatically if the connection drops. It listens for incoming commands and executes them locally on the PC. It also sends periodic heartbeats (every few seconds) so Railway always knows the PC is alive.



\### Environment Variables



Since this is open source and forkable, the Railway URL, auth token, and all config live in a `.env` file. The repo ships with a `.env.example` that documents every variable. Nobody hardcodes anything.



\---



\## Phase 2 — Wake PC Flow (Raspberry Pi + Wake-on-LAN)



\### Why a Pi Is Needed



Wake-on-LAN works by sending a "magic packet" — a specific sequence of bytes containing the PC's MAC address — over the local network. Railway is on the internet, not your home network, so it cannot send this packet directly. The Raspberry Pi Zero 2 W sits on your home WiFi 24/7 and acts as the local forwarder.



\### How It Works Step by Step



1\. You open CloudDeck in your browser and see the PC is offline

2\. You click the Wake PC button

3\. The browser sends a request to the Railway app

4\. Railway makes an HTTP POST request to a small Python server running on the Pi

5\. The Pi receives the request, constructs the WoL magic packet using your PC's MAC address (configured in the Pi's `.env`), and broadcasts it over UDP on port 9 to your local network

6\. Your PC's network adapter, which stays powered even when the PC is off (as long as WoL is enabled in BIOS and Windows settings), receives the packet and triggers a boot

7\. As the PC boots, the agent starts automatically as a Windows service

8\. The agent connects to Railway's WebSocket

9\. Railway detects the connection and updates the UI — the power icon turns red and the interface transitions to the connected state



\### Pi Setup



The Pi runs Raspberry Pi OS Lite (no desktop needed). A Python script using the `wakeonlan` library runs as a systemd service so it starts automatically on boot. It listens on a configurable port for Railway's POST request, validates a shared secret token so random people can't wake your PC, and fires the magic packet.



\### BIOS and Windows Configuration



On the gaming PC, Wake-on-LAN must be enabled in BIOS under the network adapter settings. In Windows, Device Manager → Network Adapter → Power Management must have "Allow this device to wake the computer" checked. This is a one-time setup documented in the README.



\---



\## Phase 3 — Game Library Fetching (Steam + Xbox)



\### Core Principle — Never Store Games



Games are always fetched live from the PC when you connect. Nothing is stored in Railway or any database. This means if you uninstall a game it simply won't appear next time the library loads. No sync issues, no stale data.



\### Steam Library



Steam runs a local web API on your PC at `localhost:27060`. The PC agent queries this endpoint to get your full list of installed games. Each game entry includes the App ID, name, and install status. The agent then constructs box art URLs using Steam's CDN (`cdn.cloudflare.steamstatic.com/steam/apps/{APPID}/library\_600x900.jpg`) which gives the tall portrait artwork used in the grid. This data is sent back to Railway and then to the browser.



\### Xbox / Game Pass Library



Xbox Game Pass games are installed to a configurable directory (usually `C:\\XboxGames\\`). The PC agent scans this directory, reads the folder names, and cross-references them against the Xbox API to get proper titles and artwork. This is slightly less clean than Steam since Xbox doesn't have as open a local API, but folder scanning combined with the Xbox store API covers the vast majority of cases.



\### What the Browser Receives



A JSON array of game objects, each containing name, box art URL, platform (Steam or Xbox), and a launch identifier. The UI renders these into the XMB games grid dynamically. The browser never caches this — every time you connect it fetches fresh.



\---



\## Phase 4 — XMB User Interface



\### Visual Design



The XMB (XrossMediaBar) is inspired by the PlayStation Portable's iconic interface. A deep dark background with a red accent color. Subtle animated wave/particle effects in the background. Categories scroll horizontally across the vertical center of the screen. The selected category's items appear below it in a vertical list or grid. Smooth CSS transitions on all navigation. The whole thing feels like a console UI running in a browser.



\### Categories



Scrolling left/right moves between:



\- \*\*Games\*\* — the full library grid

\- \*\*Dashboard\*\* — PC stats and session info

\- \*\*Screenshots\*\* — Steam screenshot gallery

\- \*\*Settings\*\* — stream, controls, web, AFK configuration



\### Games Grid



Box art displayed in a scrollable grid. Each card shows the game's portrait artwork, name, and platform badge (Steam/Xbox). Clicking a card triggers the launch flow. Smooth scroll on both mouse wheel and controller D-pad. The grid is entirely rendered from the live JSON the agent sends — no hardcoded content anywhere.



\### Boot Screen



When you first open CloudDeck, a boot sequence plays. Your logo fades in, then the XMB appears. The power icon in the corner pulses grey if the PC is offline. Clicking it starts the Wake PC flow — the icon animates, a status message shows ("Sending wake signal…", "Waiting for PC…", "Connected") and once the agent connects the full UI unlocks.



\### Ping Display



A persistent widget in the corner shows the current ping in milliseconds between the browser and the PC agent, measured by WebSocket round-trip time. Updates every few seconds. Color coded — green for good, yellow for moderate, red for high latency.



\---



\## Phase 5 — Game Launch Flow



\### Step by Step



1\. User clicks a game card in the XMB

2\. Browser sends a launch command via WebSocket to Railway, which forwards it to the PC agent

3\. The agent checks which platform the game belongs to

4\. For Steam games: agent calls `steam://rungameid/{APPID}` via Windows shell — Steam handles the entire launch process including any launcher dialogs

5\. For Xbox games: agent launches via the Xbox app URI scheme or direct executable path

6\. The agent monitors the process list to detect when the game's process is actually running

7\. Once detected, agent sends a "game launched" event back to Railway

8\. Railway tells the browser the game is ready

9\. The UI transitions to stream mode



\### Virtual Display Activation



Just before the game launches, the agent activates the virtual display via Sunshine's API. The physical monitors go dark. The game renders to the virtual display at the resolution and FPS cap the user configured in settings. This reduces GPU overhead significantly since the GPU is no longer pushing pixels to your 4K 240Hz monitors simultaneously.



When the user disconnects or the session ends, the agent deactivates the virtual display and the physical monitors come back on automatically.



\---



\## Phase 6 — Video Stream Integration



\### How Sunshine Fits In



Sunshine is an open source game streaming server that runs on your PC. It uses your GPU's hardware encoder (NVENC on your RTX 5070 Ti) to encode the display output into a compressed video stream and delivers it via WebRTC to a browser or Moonlight client.



CloudDeck does not rebuild this. Sunshine handles all the hard streaming work. CloudDeck's job is to control everything around it — launching games, managing the virtual display, handling the UI layer.



\### Browser Stream



Sunshine supports a browser-based client via WebRTC. CloudDeck's in-game view embeds this stream as a full-screen element. The stream goes directly from your PC to your browser — it never passes through Railway. Railway only carries the control signals.



\### Resolution and FPS Settings



In CloudDeck's settings panel, the user configures:

\- Resolution (720p / 1080p / 1440p / 4K)

\- FPS cap (30 / 60 / 90 / 120 / custom)

\- Bitrate

\- Encoder quality preset (performance vs quality)



When a session starts, the PC agent applies these settings to Sunshine via its local API before the stream begins. The virtual display is also created at the matching resolution and refresh rate.



\---



\## Phase 7 — In-Game Overlay



\### The Tab Button



Once the stream fills the screen, a small semi-transparent pill-shaped button sits in a configurable corner. It doesn't obstruct the game. Clicking or tapping it slides in the XMB library overlay on top of the stream without pausing or interrupting the stream at all. The game keeps running in the background. The user can scroll through the library, click a different game, and the agent closes the current game and launches the new one while the stream transitions.



\### Steam/Xbox Notifications



Game notifications (achievements, friend activity, Xbox messages) are captured by the PC agent and forwarded to the browser. They appear as small transparent toast notifications in the bottom right corner of the stream view, matching the style of the XMB aesthetic. They auto-dismiss after a few seconds. The transparency level is configurable in settings.



\---



\## Phase 8 — AFK Detection



\### How Meaningful Input Is Measured



The browser monitors all user inputs — mouse movement, clicks, keyboard presses, controller inputs, touch events on mobile. Not all inputs count. To filter out controller drift and accidental micro-movements, a threshold system is applied:



\- Mouse movement must exceed a minimum pixel delta

\- Controller analog stick input must exceed a deadzone value (configurable in settings, default matches what you'd set for gameplay)

\- Single isolated small inputs are ignored — there must be a pattern of intentional interaction



\### The 15 Minute Timer



A timer runs from the last meaningful input. If it reaches 15 minutes with no qualifying input, the AFK sequence begins.



\### The 5 Minute Countdown



An overlay appears on screen — styled in the XMB aesthetic — showing a countdown from 5 minutes. It clearly tells the user "No activity detected. Your session will end and PC will sleep in X:XX." A large dismiss button lets the user cancel it instantly by clicking or pressing any button.



If the user dismisses it, the 15 minute timer resets and the session continues normally.



If nobody dismisses it and the countdown hits zero:

1\. The current game is closed gracefully

2\. The virtual display is deactivated, physical monitors restored

3\. Windows is sent a sleep command via the PC agent

4\. The browser UI returns to the boot screen showing the PC as offline



\---



\## Phase 9 — PC Stats Dashboard



\### What Is Displayed



The Dashboard XMB category shows live stats pulled from the gaming PC:



\- GPU usage percentage and temperature

\- CPU usage percentage and temperature

\- RAM used / total

\- Current game process name and how long it's been running

\- Active stream resolution and FPS

\- Current ping (ms)

\- Fan speeds if accessible



\### How It Works



The PC agent uses Windows Management Instrumentation (WMI) and GPU vendor APIs (NVAPI for NVIDIA) to read hardware stats. These are packaged into a JSON object and sent to Railway via WebSocket on a regular interval (every 2-3 seconds). The dashboard UI renders them as live updating meters and readouts.



\---



\## Phase 10 — Screenshot Gallery



\### How It Works



Steam saves screenshots to a local folder (`C:\\Users\\{user}\\Pictures\\Screenshots` or the Steam userdata folder depending on settings). The PC agent watches this directory for new files. When a screenshot is taken in game, the agent detects the new file, converts it to a base64 string or serves it via a local HTTP endpoint that Railway proxies, and the gallery in the XMB Screenshots category updates in real time. The user can browse and download their screenshots from any device.



\---



\## Phase 11 — Remote Desktop Mode



\### What It Is



Outside of game mode, the user can switch to a full remote desktop view — seeing and controlling the actual Windows desktop on the gaming PC from the browser.



\### How Input Works



The browser captures:

\- Mouse movement and clicks → translated to absolute screen coordinates and sent to the PC agent → agent uses `robotjs` to move and click the Windows cursor

\- Keyboard input → sent as keycodes → agent simulates keypresses via `robotjs`

\- Laptop trackpad → treated as mouse input, same flow

\- Controller → D-pad and analog stick map to cursor movement, face buttons map to clicks and common shortcuts



All input is sent through the existing WebSocket channel to Railway and forwarded to the agent. The stream in this mode shows the full desktop rather than a game.



\---



\## Phase 12 — Mobile Support



\### Web App on Mobile



Since CloudDeck is a web app, it's accessible on any mobile browser. The XMB UI adapts to portrait and landscape orientations. Touch gestures replace mouse input — swipe left/right to navigate categories, tap to select.



\### On-Screen Virtual Controls



When in game mode on mobile, a virtual gamepad overlay renders on top of the stream:

\- Two analog sticks (using `nipplejs` library) in the lower corners

\- Face buttons (A/B/X/Y equivalent) on the right

\- Trigger and bumper buttons along the top

\- D-pad on the lower left



These touch inputs are captured by the browser and sent through the same WebSocket input channel as controller/keyboard input. The PC agent receives them and simulates the corresponding controller input using `robotjs` or a virtual gamepad driver. The stream fills the mobile screen behind the controls.



\---



\## Phase 13 — Game Crash Detection + Freeze Frame Transition



\### Exit Code Reading



When the PC agent detects a game process has ended, it reads the Windows exit code of that process before deciding how to handle it.



\- \*\*Exit code 0\*\* → clean intentional close → silent freeze frame fade → XMB returns with no notification

\- \*\*Non-zero exit code\*\* (1, -1, 0xC0000005, 0xC0000409, etc.) → crash detected → freeze frame with glitch/distortion effect → crash toast notification → option to relaunch immediately shown in the overlay



\### CloudDeck-Initiated Close Override



If the user explicitly closed the game from within CloudDeck's UI (clicking a different game, hitting a quit button), the agent flags that session as user-initiated. In that case the exit code is ignored entirely and the close is always treated as intentional regardless of what code the process returns. This handles poorly coded games that return non-zero exit codes on clean quits, and crash handlers that swallow the real exit code.



\### Freeze Frame Transition



Whether the game closes cleanly or crashes, the visual transition works the same way with only the overlay treatment differing:



1\. Agent detects process end

2\. Stream captures and holds the last rendered frame

3\. Clean close → frame smoothly blurs and dissolves, XMB fades in underneath

4\. Crash → frame briefly glitches with a distortion effect before dissolving, crash toast appears

5\. XMB is fully restored, physical monitors remain dark until user disconnects



\---



\## Phase 14 — Smart Automated Sleep Schedule



\### Session History as the Foundation



Every session is logged — game played, duration, device used, average ping, start and end time. Over time this builds a picture of when the user typically games and for how long. The sleep scheduler uses this data to suggest a default sleep time, but the user can always override it manually in settings.



\### Sleep Schedule Logic



The scheduled sleep time is not a hard cutoff. It is a smart trigger that respects what the user is actively doing:



\- \*\*User is idle when schedule fires\*\* → immediate sleep sequence, same as AFK flow

\- \*\*User is actively gaming or in remote desktop\*\* → a non-intrusive prompt appears: "Scheduled sleep time reached. Sleep now?" with Yes / Not Yet options

\- \*\*User says Yes\*\* → graceful shutdown: game closes, virtual display deactivates, PC sleeps

\- \*\*User says Not Yet\*\* → system arms itself and waits. The moment the user disconnects or AFK triggers after the scheduled time, sleep executes automatically without asking again

\- \*\*User doesn't respond within 5 minutes\*\* → treated as AFK, countdown begins



This means the scheduled time is always respected eventually — it either sleeps immediately or sleeps at the next natural opportunity after that time.



\### Session History Influence



If session history shows the user typically plays for 2-3 hours starting around 9pm, the scheduler can automatically suggest a midnight sleep time. It can also learn that on weekends sessions run longer and adjust accordingly. All of this is configurable and overridable — the history just informs the defaults.



\---



\## Phase 15 — Physical PC Resume Detection



\### How It Works



The PC agent continuously monitors running processes even when no remote session is active. When a user initiates a remote connection, before showing the game library the agent checks the current process list against a known database of game executables.



If a recognized game is already running:



1\. Agent sends a "game already running" event to Railway with the game name and process info

2\. Instead of showing the library, CloudDeck goes straight to stream mode

3\. Virtual display activates and captures the already-running game

4\. Stream begins immediately — user is in the game within seconds

5\. A small toast confirms which game was resumed



If no game is running, the normal library flow proceeds as usual.



\### Handoff Detection



The reverse also works. If the user was remote playing and physically sits down at their PC and starts using it, the agent detects local keyboard and mouse activity. It can notify the remote session that local input has been detected and offer to gracefully hand control back to the physical setup, deactivating the virtual display and restoring the physical monitors.



\---



\## Phase 16 — Network Quality Indicator



\### What Is Measured



The browser measures three things continuously once a session is active:



\- \*\*Ping\*\* — WebSocket round trip time in milliseconds

\- \*\*Jitter\*\* — variance between consecutive ping measurements (high jitter causes stuttering even when average ping is low)

\- \*\*Packet loss\*\* — percentage of WebRTC packets that fail to arrive



\### The Rating System



Based on the three measurements combined, CloudDeck shows a simple contextual rating:



\- 🟢 \*\*Competitive Ready\*\* — ping under 40ms, jitter under 5ms, packet loss under 0.5%

\- 🟡 \*\*Casual Only\*\* — ping 40-80ms, or moderate jitter/loss

\- 🔴 \*\*Poor Connection\*\* — ping over 80ms, or significant packet loss



This tells the user immediately whether their current network is suitable for competitive play before they load into a lobby.



\### Adaptive Bitrate



When the network quality indicator detects degradation mid-session, it signals Sunshine via the PC agent to step down the stream bitrate. Steps are gradual — it does not jump from high quality to low quality abruptly. When conditions improve it steps back up. The user always sees the current stream quality in the settings overlay and can pin it to a fixed value if they prefer no adaptation.



\---



\## Phase 17 — Auto-Detect Client Settings



\### On First Connect



When a browser connects to CloudDeck for the first time, JavaScript reads the screen resolution and refresh rate via `window.screen.width`, `window.screen.height`, and `window.screen` properties. These are sent to Railway and stored as that device's default stream preferences.



The stream settings panel pre-fills with the detected values — so a 1080p 60Hz laptop gets 1080p 60fps pre-filled, while a 4K 144Hz external monitor gets 4K 144fps. The user can change any of these values at any time and their override is saved per device.



A small note appears in settings indicating the values were auto-detected, so users know where the defaults came from.



\---



\## Phase 18 — Last Played Shortcuts



The XMB home screen shows the three most recently played games as large quick-launch cards above the categories. Each card shows the box art, game name, and time since last played. Clicking one launches immediately without navigating to the full library. The shortcuts update automatically after every session based on session history.



\---



\## Phase 19 — Auto-Reconnect with Session Resume



If the stream drops mid-session — network hiccup, VPN blip, laptop lid closing briefly — CloudDeck does not kick the user back to the home screen. Instead:



1\. Stream freeze frame is held on screen

2\. A reconnecting indicator appears

3\. CloudDeck attempts to re-establish the WebRTC stream and WebSocket connection automatically

4\. If the game is still running on the PC, stream resumes exactly where it left off

5\. If reconnect fails after 30 seconds, user is returned to the home screen with the option to reconnect manually



\---



\## Phase 20 — Universal UI Navigation (Controller, Mouse/Keyboard, Touch)



The entire CloudDeck web UI is fully navigable across all three input methods. No feature is exclusive to one input type — everything reachable by mouse is reachable by controller and by touch.



\### Controller Navigation



The browser's Gamepad API detects any connected controller automatically — Xbox, PlayStation, or generic. Navigation works as follows:



\- \*\*Left/Right on D-pad or left stick\*\* — move between XMB categories

\- \*\*Up/Down on D-pad or left stick\*\* — move between items within a category

\- \*\*A (Xbox) / Cross (PS)\*\* — confirm / launch selected item

\- \*\*B (Xbox) / Circle (PS)\*\* — go back / cancel

\- \*\*Start / Options\*\* — open settings overlay

\- \*\*LB/RB or L1/R1\*\* — jump between categories quickly

\- \*\*Hold B / Circle\*\* — return to XMB home from anywhere



A visible focus indicator (a red highlight/glow matching the XMB aesthetic) always shows which element is currently selected so the user always knows where they are. The focus system is built as a unified focus manager in JavaScript — every interactive element in the UI registers itself and the controller input moves focus through them in a logical order.



When a session is active and the stream is running, the controller automatically switches from UI navigation mode to game input passthrough mode. Pressing the tab button in the corner (or a designated button combo like LB+RB simultaneously) switches back to UI navigation mode temporarily, letting the user browse the library overlay without the inputs being sent to the game.



\### Mouse and Keyboard Navigation



Standard mouse pointing and clicking works on all elements. Additionally full keyboard navigation is supported:



\- \*\*Arrow keys\*\* — move between categories and items, identical to controller D-pad

\- \*\*Enter\*\* — confirm / launch

\- \*\*Escape\*\* — back / close overlay

\- \*\*Tab\*\* — cycle through focusable elements

\- \*\*Ctrl + number keys (1-4)\*\* — jump directly to a category

\- \*\*Slash (/)\*\* — focus the game search bar if one is added later



Mouse hover states trigger the same visual highlight as controller focus so the UI always feels responsive regardless of input method. Keyboard focus outlines are styled to match the XMB aesthetic rather than using the default browser focus ring.



\### Touch / Phone Navigation



On mobile the entire UI is touch-first:



\- \*\*Swipe left/right\*\* — navigate between XMB categories

\- \*\*Swipe up/down\*\* — scroll items within a category

\- \*\*Tap\*\* — confirm / launch

\- \*\*Long press\*\* — context options (like game info or remove from recents)

\- \*\*Swipe down from top\*\* — open settings overlay

\- \*\*Pinch\*\* — not used for zoom (zoom is disabled on the app) but reserved for future use



All tap targets are sized to at least 44x44px to meet comfortable mobile touch standards. The bottom hints bar that shows keyboard shortcuts on desktop is replaced with gesture hints on mobile. The XMB animations are tuned for 60fps on mobile — reduced particle effects and simplified background to keep the UI smooth on lower-powered devices.



\### Input Method Auto-Detection



CloudDeck detects which input method the user is actively using and subtly adapts:



\- Controller connected and used → focus indicator becomes visible, bottom hints show controller button icons

\- Mouse moved → cursor becomes visible, bottom hints show keyboard shortcuts

\- Touch detected → cursor hidden, layout shifts to larger tap targets, gesture hints shown



Switching between input methods mid-session is seamless — picking up the controller while browsing with mouse instantly transfers focus to the controller system without any interruption.



\---



\## Phase 21 — Security



Security is critical since CloudDeck gives remote access to a physical PC. Every layer of the stack has protections.



\### Authentication



A login screen is the first thing any visitor sees — no UI, no library, no controls are accessible before authenticating. Authentication uses a username and password set by the user during first-run setup. Passwords are hashed with bcrypt before storage. On successful login, Railway issues a signed JWT session token with a configurable expiry (default 24 hours). The token is stored in the browser and sent with every WebSocket and HTTP request. Requests without a valid token are rejected before reaching any functionality.



\### Session Tokens and Expiry



Tokens expire automatically. When a token expires the user is returned to the login screen. Token expiry length is configurable in `.env` — shorter for security-conscious users, longer for convenience. A "remember this device" option issues a longer-lived refresh token stored in a secure cookie.



\### Rate Limiting



The Railway app uses rate limiting on the login endpoint — a maximum of 10 attempts per IP per 15 minutes. After that the IP is temporarily blocked and an alert is logged. This prevents brute force attacks against the password.



\### Two-Factor Authentication (Optional)



An optional 2FA layer using TOTP (time-based one-time passwords, compatible with Google Authenticator or Authy) can be enabled in settings. When enabled, after entering the correct password the user is prompted for a 6-digit code from their authenticator app. This is strongly recommended since CloudDeck controls a physical PC remotely.



\### Pi and Agent Authentication



The Raspberry Pi WoL endpoint validates a shared secret token on every incoming request from Railway — random requests to the Pi's port are rejected. The PC agent authenticates with Railway using its own token set in `.env` — a rogue agent cannot impersonate a real one.



\---



\## Phase 22 — Multi-User Support



\### Two Roles



CloudDeck supports two user roles on the same instance:



\- \*\*Admin\*\* — full access to everything: wake PC, launch games, remote desktop, settings, sleep schedule, session history

\- \*\*Guest\*\* — stream and play only. Can browse the library and launch games but cannot access settings, cannot sleep or wake the PC, cannot access remote desktop mode



\### User Management



The admin creates guest accounts from the settings panel with a username and password. Guest accounts can be revoked at any time. There is no limit on guest accounts but only one session can be active at a time — if a guest is streaming and the admin connects, the admin takes priority and the guest is notified their session was ended.



\### Per-User Session History



Session history is logged per user so the admin can see who played what and for how long. This also means the smart sleep scheduler and last played shortcuts are personalized per account.



\---



\## Phase 23 — Game Art Fallback



When the Steam CDN fails to return box art for a game — common with older, obscure, or region-specific titles — the library card does not show a broken image. Instead a styled fallback placeholder renders in the card's place. The placeholder uses the XMB aesthetic — dark background, the CloudDeck red accent, the game's name in the Orbitron font centered on the card. It is visually consistent with the rest of the library rather than looking like an error. If art loads successfully later (on next library refresh) the placeholder is automatically replaced.



\---



\## Phase 24 — Audio



\### Stream Audio



Sunshine streams audio alongside video by default. The PC agent ensures audio is routed correctly — the game's audio output is captured and encoded into the stream so it plays on the client device. Audio quality and bitrate are configurable in the stream settings panel alongside video settings.



\### PC Speaker Muting



When a remote session starts, the PC agent mutes the physical PC's audio output so sound only comes out of the client device. When the session ends, PC audio is automatically restored to its previous volume level. This prevents the awkward situation of the PC playing game audio out loud in an empty room while the user is remote.



\### Audio Latency



Audio and video are synchronized by Sunshine's encoder. On a good network audio latency matches video latency — typically imperceptible. On degraded networks audio is prioritized over video quality in adaptive bitrate adjustments since audio desync is more disruptive than visual quality drops.



\### Audio Settings



Configurable options in the settings panel:

\- Audio bitrate (128kbps / 256kbps / 320kbps)

\- Stereo or surround passthrough

\- Mute PC speakers toggle (default on)

\- Audio-only mode for minimal bandwidth use cases



\---



\## Phase 25 — Agent Auto-Updater



\### The Problem



The PC agent runs as a persistent Windows service. When CloudDeck receives updates on GitHub — bug fixes, new features, protocol changes — the agent needs to be updated to stay compatible with the Railway app. Without an auto-updater this requires the user to manually download and reinstall the agent every time, which most users won't do.



\### How It Works



On every agent startup and once every 24 hours while running, the agent checks the CloudDeck GitHub repository's latest release tag via the GitHub API and compares it to its own version string. If a newer version is available:



1\. Agent downloads the new release package to a temp directory

2\. Verifies the download's integrity via a checksum

3\. Notifies the connected browser session that an update is available with a non-intrusive toast

4\. The user can choose "Update Now" or "Later"

5\. On "Update Now" — agent gracefully closes any active session, installs the update, and restarts the Windows service automatically

6\. On "Later" — agent continues running on the current version and reminds again at next startup



Critical security or breaking updates can be flagged as mandatory in the release metadata, in which case the agent updates automatically at the next natural session end rather than waiting for user confirmation.



\---



\## Phase 26 — First-Run Onboarding Wizard



\### The Problem



Forking and deploying CloudDeck requires configuring multiple components — Railway environment variables, Sunshine on the PC, the Pi script, BIOS WoL settings, Steam/Xbox prerequisites, and the agent installation. For non-technical users this is a significant barrier. A first-run wizard eliminates guesswork.



\### How It Works



The first time CloudDeck loads with no configuration detected, instead of showing the login screen it shows a step-by-step setup wizard styled in the XMB aesthetic. Each step validates its own connection before allowing the user to proceed:



\*\*Step 1 — Create Admin Account\*\*

Set username and password. Optional 2FA setup. These become the permanent admin credentials.



\*\*Step 2 — PC Agent\*\*

Instructions for downloading and installing the agent as a Windows service. CloudDeck polls in the background and automatically advances this step the moment the agent connects — the user sees a live "Waiting for agent..." indicator that turns green and advances automatically.



\*\*Step 3 — Sunshine\*\*

Instructions for installing and configuring Sunshine on the PC. CloudDeck tests the Sunshine connection and confirms it is reachable before advancing.



\*\*Step 4 — Raspberry Pi (Optional)\*\*

Instructions for flashing the Pi, running the WoL script, and testing the wake command. This step can be skipped if the user does not have a Pi — they can always add it later from settings.



\*\*Step 5 — BIOS Wake-on-LAN\*\*

A checklist of BIOS and Windows settings required for WoL to work, with a test button that attempts a wake cycle to verify it is configured correctly.



\*\*Step 6 — Done\*\*

Summary of what was configured, what was skipped, and links to the README for anything that needs follow-up. First-run wizard never appears again unless the user resets their configuration from settings.



\---



\## GitHub Repository Structure



```

CloudDeck/

├── client/                  # Railway web app (Node.js + Express + UI)

│   ├── server.js             # Express + WebSocket signaling server

│   ├── auth.js               # JWT auth, bcrypt, rate limiting, 2FA

│   ├── users.js              # User/role management

│   ├── public/               # XMB frontend (HTML/CSS/JS)

│   │   ├── index.html        # Main UI

│   │   ├── login.html        # Login screen

│   │   └── onboarding.html   # First-run wizard

│   └── package.json

├── agent/                   # PC-side Node.js agent

│   ├── index.js              # Main agent (WebSocket, commands, stats)

│   ├── launcher.js           # Game launch + exit code monitoring

│   ├── library.js            # Game library fetching (Steam + Xbox)

│   ├── display.js            # Virtual display management

│   ├── input.js              # Input simulation (robotjs)

│   ├── afk.js                # AFK detection logic

│   ├── crash.js              # Process exit code monitoring

│   ├── resume.js             # Physical PC resume detection

│   ├── sleep.js              # Smart sleep scheduler

│   ├── network.js            # Ping/jitter/packet loss monitoring

│   ├── session.js            # Session history logging

│   ├── audio.js              # PC speaker muting + audio routing

│   ├── updater.js            # Auto-updater via GitHub releases API

│   └── package.json

├── pi/                      # Raspberry Pi WoL forwarder

│   ├── wol\_server.py         # Python HTTP server + magic packet sender

│   └── requirements.txt

├── .env.example             # All config variables documented

└── README.md                # Full setup guide

```



\---



\## Configuration (.env.example)



```

\# Railway App

PORT=3000

AUTH\_TOKEN=your\_secret\_token\_here



\# Authentication

JWT\_SECRET=your\_jwt\_secret\_here

JWT\_EXPIRY=24h

RATE\_LIMIT\_MAX\_ATTEMPTS=10

RATE\_LIMIT\_WINDOW\_MINUTES=15

ENABLE\_2FA=false



\# PC Agent

RAILWAY\_WS\_URL=wss://your-app.up.railway.app

PC\_MAC\_ADDRESS=XX:XX:XX:XX:XX:XX

AGENT\_TOKEN=your\_agent\_token\_here



\# Raspberry Pi

PI\_SECRET\_TOKEN=your\_secret\_token\_here

PI\_PORT=5000



\# Stream Defaults

DEFAULT\_RESOLUTION=1080p

DEFAULT\_FPS=60

DEFAULT\_BITRATE=20000



\# Audio

MUTE\_PC\_SPEAKERS\_ON\_SESSION=true

DEFAULT\_AUDIO\_BITRATE=256

AUDIO\_SURROUND=false



\# AFK

AFK\_TIMEOUT\_MINUTES=15

AFK\_COUNTDOWN\_SECONDS=300

INPUT\_DEADZONE\_THRESHOLD=0.15



\# Auto-Updater

GITHUB\_REPO=your-username/CloudDeck

AUTO\_UPDATE\_CHECK\_INTERVAL\_HOURS=24

ALLOW\_MANDATORY\_UPDATES=true

```



\---



\## Cost Summary



| Component | Cost |

|---|---|

| Railway Hobby Plan | $5/month |

| Raspberry Pi Zero 2 W | \~$15 one-time |

| SanDisk Ultra 32GB microSD | \~$8-10 one-time |

| \*\*Total ongoing\*\* | \*\*\~$5/month\*\* |



\---



\## Open Source Notes



Anyone who forks CloudDeck fills in their own `.env` values — their PC's MAC address, their Railway URL, their Pi's IP — and gets the full system running on their own hardware. The code contains no hardcoded personal values. The README walks through every setup step: Railway deployment, PC agent installation as a Windows service, Pi setup, Sunshine configuration, BIOS WoL settings, and Steam/Xbox prerequisites.

