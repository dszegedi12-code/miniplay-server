# MiniPlay FPS — Colyseus Multiplayer Server

## Deploy to Colyseus Cloud

### Step 1 — Install Colyseus CLI
```bash
npm install -g @colyseus/cli
```

### Step 2 — Login
```bash
npx colyseus-cli login
```

### Step 3 — Create a new project (from this folder)
```bash
cd colyseus-server
npm install
npx colyseus-cli deploy
```

### Step 4 — Done!
Your server will be live at:
`wss://us-sjc-1ae3ea9b.colyseus.cloud`

The client (index.html) is already pointed at this URL.

## Local Testing
```bash
cd colyseus-server
npm install
node index.js
```
Then open two browser tabs on your game and both will connect locally.

## Room: fps_room
- Max 2 players per room
- Server handles: movement, bullets, enemies, PvP damage, waves
- Client handles: local input, rendering, animations
