const { Server, Room, LobbyRoom } = require("colyseus");
const { Schema, type, MapSchema } = require("@colyseus/schema");
const http = require("http");
const express = require("express");
const { monitor } = require("@colyseus/monitor");

// ── SCHEMAS ──────────────────────────────────────────
class Player extends Schema {}
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "hp");
type("number")(Player.prototype, "shield");
type("number")(Player.prototype, "aimX");
type("number")(Player.prototype, "aimY");
type("number")(Player.prototype, "score");
type("number")(Player.prototype, "kills");
type("boolean")(Player.prototype, "alive");
type("number")(Player.prototype, "wIdx");
type("boolean")(Player.prototype, "reloading");
type("string")(Player.prototype, "color");

class Bullet extends Schema {}
type("string")(Bullet.prototype, "id");
type("number")(Bullet.prototype, "x");
type("number")(Bullet.prototype, "y");
type("number")(Bullet.prototype, "vx");
type("number")(Bullet.prototype, "vy");
type("string")(Bullet.prototype, "owner");
type("string")(Bullet.prototype, "color");

class Enemy extends Schema {}
type("string")(Enemy.prototype, "id");
type("number")(Enemy.prototype, "x");
type("number")(Enemy.prototype, "y");
type("number")(Enemy.prototype, "hp");
type("number")(Enemy.prototype, "maxHp");
type("number")(Enemy.prototype, "r");
type("string")(Enemy.prototype, "color");
type("number")(Enemy.prototype, "pts");
type("string")(Enemy.prototype, "name");

class GameState extends Schema {}
type({ map: Player })(GameState.prototype, "players");
type({ map: Bullet })(GameState.prototype, "bullets");
type({ map: Enemy })(GameState.prototype, "enemies");
type("number")(GameState.prototype, "wave");
type("boolean")(GameState.prototype, "gameOver");
type("string")(GameState.prototype, "winner");

// ── FPS ROOM ─────────────────────────────────────────
class FPSRoom extends Room {
  onCreate(options) {
    this.maxClients = 2;
    this.setState(new GameState());
    this.state.players = new MapSchema();
    this.state.bullets = new MapSchema();
    this.state.enemies = new MapSchema();
    this.state.wave = 1;
    this.state.gameOver = false;
    this.state.winner = "";

    this.bulletCounter = 0;
    this.enemyCounter = 0;
    this.frame = 0;
    this.waveTimer = 0;

    this.covers = [
      {x:100,y:80,w:55,h:18},{x:325,y:80,w:55,h:18},
      {x:50,y:150,w:18,h:55},{x:412,y:150,w:18,h:55},
      {x:195,y:120,w:18,h:18},{x:267,y:120,w:18,h:18},
      {x:140,y:220,w:40,h:15},{x:300,y:220,w:40,h:15},
      {x:220,y:180,w:40,h:15},
    ];

    this.ENEMY_TYPES = [
      {color:'#eab308',r:13,pts:5, hp:1,speed:1.0,shootRate:180,name:'Bot'},
      {color:'#a855f7',r:18,pts:15,hp:3,speed:0.6,shootRate:120,name:'Heavy'},
    ];

    this.spawnWave();

    // Server tick at 20fps
    this.setSimulationInterval((dt) => this.serverTick(dt), 50);

    // Handle player input
    this.onMessage("input", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      if (data.x !== undefined) p.x = Math.max(12, Math.min(468, data.x));
      if (data.y !== undefined) p.y = Math.max(12, Math.min(308, data.y));
      if (data.aimX !== undefined) p.aimX = data.aimX;
      if (data.aimY !== undefined) p.aimY = data.aimY;
      if (data.wIdx !== undefined) p.wIdx = data.wIdx;
      if (data.reloading !== undefined) p.reloading = data.reloading;
    });

    this.onMessage("shoot", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      const id = "b" + (++this.bulletCounter);
      const b = new Bullet();
      b.id = id; b.x = p.x; b.y = p.y;
      b.vx = data.vx; b.vy = data.vy;
      b.owner = client.sessionId;
      b.color = p.color === '#6c63ff' ? '#fef08a' : '#f87171';
      this.state.bullets.set(id, b);
      // Auto-remove after ~35 frames
      setTimeout(() => { if (this.state.bullets.has(id)) this.state.bullets.delete(id); }, 1800);
    });

    console.log("FPSRoom created!");
  }

  onJoin(client, options) {
    const isFirst = this.state.players.size === 0;
    const p = new Player();
    p.x = isFirst ? 80 : 400;
    p.y = 160;
    p.hp = 100; p.shield = 50;
    p.aimX = isFirst ? 160 : 320;
    p.aimY = 160;
    p.score = 0; p.kills = 0;
    p.alive = true; p.wIdx = 0; p.reloading = false;
    p.color = isFirst ? '#6c63ff' : '#ef4444';
    this.state.players.set(client.sessionId, p);

    client.send("init", {
      sessionId: client.sessionId,
      playerNumber: isFirst ? 1 : 2,
      covers: this.covers,
    });

    console.log(`Player ${isFirst ? 1 : 2} joined: ${client.sessionId}`);
  }

  onLeave(client, consented) {
    this.state.players.delete(client.sessionId);
    if (!this.state.gameOver) {
      const remaining = [...this.state.players.keys()];
      if (remaining.length === 1) {
        this.state.gameOver = true;
        this.state.winner = "OPPONENT LEFT";
      }
    }
  }

  hitsWall(x, y, r) {
    return this.covers.some(cv => x+r > cv.x && x-r < cv.x+cv.w && y+r > cv.y && y-r < cv.y+cv.h);
  }

  spawnWave() {
    const wave = this.state.wave;
    const count = 3 + wave * 2;
    for (let i = 0; i < count; i++) {
      const t = this.ENEMY_TYPES[Math.random() < 0.7 ? 0 : 1];
      const edge = Math.floor(Math.random() * 4);
      let ex, ey;
      if (edge===0){ex=20+Math.random()*440;ey=-20;}
      else if(edge===1){ex=500;ey=20+Math.random()*280;}
      else if(edge===2){ex=20+Math.random()*440;ey=340;}
      else{ex=-20;ey=20+Math.random()*280;}
      const id = "e" + (++this.enemyCounter);
      const e = new Enemy();
      e.id = id; e.x = ex; e.y = ey;
      e.hp = t.hp + Math.floor(wave/3);
      e.maxHp = e.hp;
      e.r = t.r; e.color = t.color; e.pts = t.pts; e.name = t.name;
      e._speed = t.speed + wave * 0.04;
      e._shootTimer = Math.random() * t.shootRate;
      e._shootRate = t.shootRate;
      this.state.enemies.set(id, e);
    }
  }

  serverTick(dt) {
    if (this.state.gameOver) return;
    this.frame++;

    // Move enemies
    const playerList = [];
    this.state.players.forEach((p) => { if (p.alive) playerList.push(p); });

    this.state.enemies.forEach((e, eid) => {
      // Find nearest player
      let nearest = null, nearDist = Infinity;
      playerList.forEach(p => {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) return;

      const dx = nearest.x - e.x, dy = nearest.y - e.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > e.r + 12) {
        const mx = (dx/dist)*e._speed, my = (dy/dist)*e._speed;
        if (!this.hitsWall(e.x+mx, e.y, e.r)) e.x += mx;
        if (!this.hitsWall(e.x, e.y+my, e.r)) e.y += my;
      }
      e.x = Math.max(e.r, Math.min(480-e.r, e.x));
      e.y = Math.max(e.r, Math.min(320-e.r, e.y));

      // Enemy shoot
      e._shootTimer--;
      if (e._shootTimer <= 0 && nearDist < 280) {
        e._shootTimer = e._shootRate + Math.random()*30;
        const angle = Math.atan2(nearest.y-e.y, nearest.x-e.x) + (Math.random()-0.5)*0.2;
        const bid = "b" + (++this.bulletCounter);
        const b = new Bullet();
        b.id = bid; b.x = e.x; b.y = e.y;
        b.vx = Math.cos(angle)*4.5; b.vy = Math.sin(angle)*4.5;
        b.owner = "enemy"; b.color = '#fbbf24';
        this.state.bullets.set(bid, b);
        setTimeout(() => { if (this.state.bullets.has(bid)) this.state.bullets.delete(bid); }, 3200);
      }
    });

    // Bullet collision with enemies & players
    const toDeleteBullets = new Set();
    const toDeleteEnemies = new Set();

    this.state.bullets.forEach((b, bid) => {
      // Move bullet server-side
      b.x += b.vx; b.y += b.vy;
      if (b.x < -10 || b.x > 490 || b.y < -10 || b.y > 330) { toDeleteBullets.add(bid); return; }
      if (this.hitsWall(b.x, b.y, 3)) { toDeleteBullets.add(bid); return; }

      if (b.owner === "enemy") {
        // Hit players
        this.state.players.forEach((p, pid) => {
          if (!p.alive) return;
          if (Math.hypot(b.x-p.x, b.y-p.y) < 14) {
            toDeleteBullets.add(bid);
            if (p.shield > 0) { p.shield = Math.max(0, p.shield - 10); }
            else {
              p.hp -= 12;
              if (p.hp <= 0) { p.alive = false; p.hp = 0; }
            }
          }
        });
      } else {
        // Player bullet hits enemies
        this.state.enemies.forEach((e, eid) => {
          if (toDeleteEnemies.has(eid)) return;
          if (Math.hypot(b.x-e.x, b.y-e.y) < e.r + 3) {
            toDeleteBullets.add(bid);
            e.hp--;
            if (e.hp <= 0) {
              toDeleteEnemies.add(eid);
              // Award points to shooter
              this.state.players.forEach((p, pid) => {
                if (pid === b.owner) { p.score += e.pts; p.kills++; }
              });
            }
          }
        });

        // PVP: player bullets hit other players
        this.state.players.forEach((p, pid) => {
          if (pid === b.owner || !p.alive) return;
          if (Math.hypot(b.x-p.x, b.y-p.y) < 14) {
            toDeleteBullets.add(bid);
            if (p.shield > 0) { p.shield = Math.max(0, p.shield - 15); }
            else {
              p.hp -= 18;
              if (p.hp <= 0) {
                p.alive = false; p.hp = 0;
                // Award killer
                this.state.players.forEach((killer, kid) => {
                  if (kid === b.owner) { killer.score += 50; killer.kills++; }
                });
              }
            }
          }
        });
      }
    });

    toDeleteBullets.forEach(id => this.state.bullets.delete(id));
    toDeleteEnemies.forEach(id => this.state.enemies.delete(id));

    // Wave clear
    if (this.state.enemies.size === 0) {
      this.waveTimer++;
      if (this.waveTimer > 40) {
        this.state.wave++;
        this.waveTimer = 0;
        this.state.players.forEach(p => {
          if (p.alive) { p.hp = Math.min(100, p.hp + 25); p.shield = 50; }
        });
        this.spawnWave();
        this.broadcast("waveStart", { wave: this.state.wave });
      }
    }

    // Shield regen
    this.state.players.forEach(p => {
      if (p.alive && p.shield < 50 && this.frame % 5 === 0) {
        p.shield = Math.min(50, p.shield + 0.15);
      }
    });

    // Game over check
    const alivePlayers = [];
    this.state.players.forEach((p, pid) => { if (p.alive) alivePlayers.push({p, pid}); });
    if (this.state.players.size >= 2 && alivePlayers.length <= 1) {
      this.state.gameOver = true;
      if (alivePlayers.length === 1) {
        const winnerPlayer = alivePlayers[0].p;
        this.state.winner = winnerPlayer.color === '#6c63ff' ? 'P1 WINS' : 'P2 WINS';
      } else {
        this.state.winner = 'DRAW';
      }
    }
  }

  onDispose() {
    console.log("FPSRoom disposed");
  }
}

// ── EXPRESS + COLYSEUS SERVER ─────────────────────────
const app = express();
app.use(express.json());

const server = http.createServer(app);
const gameServer = new Server({ server });

gameServer.define("fps_room", FPSRoom);
gameServer.define("lobby", LobbyRoom);

app.use("/colyseus", monitor());

const PORT = process.env.PORT || 2567;
server.listen(PORT, () => {
  console.log(`✅ MiniPlay FPS Server running on port ${PORT}`);
  console.log(`   Monitor: http://localhost:${PORT}/colyseus`);
});
