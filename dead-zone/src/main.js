import { initInput, input, wasPressed, consumePressed } from './input.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { ZOMBIE_TYPES, waveComposition, spawnZombie } from './zombies.js';
import * as sfx from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// persistent blood decals live on an offscreen canvas so they never repaint
let decalCanvas = document.createElement('canvas');
let decalCtx = decalCanvas.getContext('2d');

function resize() {
  const keep = document.createElement('canvas');
  keep.width = decalCanvas.width || 1;
  keep.height = decalCanvas.height || 1;
  keep.getContext('2d').drawImage(decalCanvas, 0, 0);
  canvas.width = decalCanvas.width = window.innerWidth;
  canvas.height = decalCanvas.height = window.innerHeight;
  decalCtx = decalCanvas.getContext('2d');
  decalCtx.drawImage(keep, 0, 0);
}
window.addEventListener('resize', resize);
resize();
initInput(canvas);

// ---- Game state -------------------------------------------------------

const HIGGS = { radius: 190, slowFactor: 0.25, slowDuration: 5, cooldown: 15, knockback: 420 };

let state; // 'title' | 'playing' | 'gameover'
let game;

function newGame() {
  return {
    time: 0,
    score: 0,
    wave: 0,
    waveBannerT: 0,
    spawnQueue: [],
    spawnTimer: 0,
    intermission: 0,
    player: {
      x: canvas.width / 2, y: canvas.height / 2,
      radius: 14, hp: 100, maxHp: 100,
      speed: 220, sprintMult: 1.6,
      stamina: 1,
      weapon: 'pistol',
      mags: Object.fromEntries(WEAPON_ORDER.map((w) => [w, WEAPONS[w].magSize])),
      fireCooldown: 0,
      reloading: 0,
      muzzleFlash: 0,
      hurtFlash: 0,
      angle: 0,
    },
    zombies: [],
    bullets: [],
    particles: [],
    higgs: { charge: 1, activeUntil: 0, ringT: -1 },
  };
}

function startGame() {
  decalCtx.clearRect(0, 0, decalCanvas.width, decalCanvas.height);
  game = newGame();
  state = 'playing';
  nextWave();
}

function nextWave() {
  game.wave++;
  game.spawnQueue = waveComposition(game.wave);
  game.spawnTimer = 0;
  game.waveBannerT = 2.2;
}

// ---- Update -----------------------------------------------------------

function update(dt) {
  const g = game;
  const p = g.player;
  g.time += dt;

  // -- player movement
  let dx = 0, dy = 0;
  if (input.keys.has('w')) dy -= 1;
  if (input.keys.has('s')) dy += 1;
  if (input.keys.has('a')) dx -= 1;
  if (input.keys.has('d')) dx += 1;
  const sprinting = input.keys.has('shift') && (dx || dy) && p.stamina > 0;
  if (sprinting) p.stamina = Math.max(0, p.stamina - dt / 2.5);
  else p.stamina = Math.min(1, p.stamina + dt / 4);
  const spd = p.speed * (sprinting ? p.sprintMult : 1);
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    p.x += (dx / len) * spd * dt;
    p.y += (dy / len) * spd * dt;
  }
  p.x = Math.max(p.radius, Math.min(canvas.width - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(canvas.height - p.radius, p.y));
  p.angle = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);

  // -- weapon switching
  for (const w of WEAPON_ORDER) {
    if (wasPressed(WEAPONS[w].key) && p.weapon !== w) {
      p.weapon = w;
      p.reloading = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
    }
  }

  // -- reload
  const def = WEAPONS[p.weapon];
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) p.mags[p.weapon] = def.magSize;
  } else if (wasPressed('r') && p.mags[p.weapon] < def.magSize) {
    p.reloading = def.reloadTime;
    sfx.playReload();
  }

  // -- shooting
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
  const wantsFire = def.auto ? input.mouse.down : wasPressed('mouse');
  if (wantsFire && p.fireCooldown === 0 && p.reloading <= 0) {
    if (p.mags[p.weapon] <= 0) {
      sfx.playEmptyClick();
      p.fireCooldown = 0.25;
    } else {
      p.mags[p.weapon]--;
      p.fireCooldown = def.fireInterval;
      p.muzzleFlash = 0.05;
      sfx.playGunshot(p.weapon);
      for (let i = 0; i < def.pellets; i++) {
        const a = p.angle + (Math.random() - 0.5) * 2 * def.spread;
        g.bullets.push({
          x: p.x + Math.cos(p.angle) * (p.radius + 10),
          y: p.y + Math.sin(p.angle) * (p.radius + 10),
          vx: Math.cos(a) * def.bulletSpeed,
          vy: Math.sin(a) * def.bulletSpeed,
          damage: def.damage, color: def.color, life: 1.2,
        });
      }
      if (p.mags[p.weapon] === 0) {
        p.reloading = def.reloadTime;
        sfx.playReload();
      }
    }
  }

  // -- higgs field
  const h = g.higgs;
  h.charge = Math.min(1, h.charge + dt / HIGGS.cooldown);
  if (h.ringT >= 0) h.ringT += dt;
  if (wasPressed('e') && h.charge >= 1) {
    h.charge = 0;
    h.activeUntil = g.time + HIGGS.slowDuration;
    h.ringT = 0;
    sfx.playHiggsWhomp();
    for (const z of g.zombies) {
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d < HIGGS.radius + z.radius) {
        z.slowUntil = g.time + HIGGS.slowDuration;
        const k = HIGGS.knockback / Math.max(d, 30);
        z.x += (z.x - p.x) * k * 0.2;
        z.y += (z.y - p.y) * k * 0.2;
      }
    }
  }

  // -- spawning
  if (g.spawnQueue.length) {
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      g.zombies.push(spawnZombie(g.spawnQueue.shift(), canvas.width, canvas.height));
      g.spawnTimer = Math.max(0.25, 1.4 - g.wave * 0.08);
    }
  } else if (!g.zombies.length) {
    g.intermission += dt;
    if (g.intermission > 3) {
      g.intermission = 0;
      nextWave();
    }
  }

  // -- zombies
  const fieldActive = g.time < h.activeUntil;
  for (const z of g.zombies) {
    const distP = Math.hypot(p.x - z.x, p.y - z.y);
    // higgs field keeps slowing anything inside while active
    if (fieldActive && distP < HIGGS.radius + z.radius) z.slowUntil = g.time + 0.3;
    const slowed = g.time < z.slowUntil;
    const spdZ = z.speed * (slowed ? HIGGS.slowFactor : 1);
    z.wobble += dt * 5;
    if (distP > 1) {
      z.x += ((p.x - z.x) / distP) * spdZ * dt;
      z.y += ((p.y - z.y) / distP) * spdZ * dt;
      z.x += Math.cos(z.wobble) * 8 * dt;
      z.y += Math.sin(z.wobble * 1.3) * 8 * dt;
    }
    // attack
    z.attackCooldown -= dt;
    if (distP < z.radius + p.radius + 4 && z.attackCooldown <= 0) {
      z.attackCooldown = 0.8;
      p.hp -= z.damage;
      p.hurtFlash = 0.25;
      spawnBlood(p.x, p.y, 6, '#c62828');
    }
    // ambient groans, volume by distance
    z.groanTimer -= dt;
    if (z.groanTimer <= 0) {
      z.groanTimer = 4 + Math.random() * 8;
      sfx.playGroan(Math.min(1, distP / 900));
    }
    // boss spawns minions
    if (z.type === 'boss') {
      z.minionTimer -= dt;
      if (z.minionTimer <= 0) {
        z.minionTimer = 6;
        const m = spawnZombie('runner', canvas.width, canvas.height);
        m.x = z.x; m.y = z.y;
        g.zombies.push(m);
      }
    }
  }

  // -- bullets
  for (const b of g.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    for (const z of g.zombies) {
      if (z.hp <= 0) continue;
      if (Math.hypot(z.x - b.x, z.y - b.y) < z.radius + 3) {
        z.hp -= b.damage;
        b.life = 0;
        spawnBlood(b.x, b.y, 4, '#7b1d1d');
        if (z.hp <= 0) {
          g.score += z.score;
          sfx.playSquelch();
          spawnBlood(z.x, z.y, z.type === 'boss' ? 40 : 14, '#7b1d1d');
          stampDecal(z.x, z.y, z.radius);
        }
        break;
      }
    }
  }
  g.bullets = g.bullets.filter(
    (b) => b.life > 0 && b.x > -50 && b.x < canvas.width + 50 && b.y > -50 && b.y < canvas.height + 50
  );
  g.zombies = g.zombies.filter((z) => z.hp > 0);

  // -- particles
  for (const pa of g.particles) {
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.vx *= 0.9;
    pa.vy *= 0.9;
    pa.life -= dt;
  }
  g.particles = g.particles.filter((pa) => pa.life > 0);

  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  g.waveBannerT = Math.max(0, g.waveBannerT - dt);

  if (p.hp <= 0) {
    state = 'gameover';
    sfx.playGameOverSting();
  }
}

function spawnBlood(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 220;
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.3 + Math.random() * 0.4, color,
      size: 2 + Math.random() * 3,
    });
  }
}

function stampDecal(x, y, r) {
  decalCtx.fillStyle = 'rgba(90, 12, 12, 0.55)';
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * 1.4;
    const s = 3 + Math.random() * r * 0.5;
    decalCtx.beginPath();
    decalCtx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2);
    decalCtx.fill();
  }
}

// ---- Render -----------------------------------------------------------

function drawGround() {
  ctx.fillStyle = '#0b0d0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const grid = 64;
  ctx.beginPath();
  for (let x = 0; x < canvas.width; x += grid) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = 0; y < canvas.height; y += grid) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
  ctx.drawImage(decalCanvas, 0, 0);
}

function drawZombie(z) {
  const slowed = game.time < z.slowUntil;
  ctx.save();
  ctx.translate(z.x, z.y);
  // glow
  const grad = ctx.createRadialGradient(0, 0, z.radius * 0.3, 0, 0, z.radius * 2.2);
  grad.addColorStop(0, z.glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, z.radius * 2.2, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.fillStyle = z.color;
  ctx.beginPath();
  ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
  ctx.fill();
  // arms reaching toward player
  const a = Math.atan2(game.player.y - z.y, game.player.x - z.x);
  ctx.strokeStyle = z.color;
  ctx.lineWidth = Math.max(3, z.radius * 0.25);
  ctx.lineCap = 'round';
  for (const off of [-0.5, 0.5]) {
    const reach = z.radius * 1.5 + Math.sin(z.wobble * 2 + off) * z.radius * 0.3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a + off) * z.radius * 0.7, Math.sin(a + off) * z.radius * 0.7);
    ctx.lineTo(Math.cos(a + off * 0.4) * reach, Math.sin(a + off * 0.4) * reach);
    ctx.stroke();
  }
  // eyes
  ctx.fillStyle = '#fff';
  const ex = Math.cos(a) * z.radius * 0.45, ey = Math.sin(a) * z.radius * 0.45;
  const sep = z.radius * 0.35;
  ctx.beginPath();
  ctx.arc(ex - Math.sin(a) * sep, ey + Math.cos(a) * sep, z.radius * 0.13, 0, Math.PI * 2);
  ctx.arc(ex + Math.sin(a) * sep, ey - Math.cos(a) * sep, z.radius * 0.13, 0, Math.PI * 2);
  ctx.fill();
  // higgs slow indicator
  if (slowed) {
    ctx.strokeStyle = 'rgba(100,181,246,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // health bar for damaged / big zombies
  if (z.hp < z.maxHp) {
    const w = z.radius * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w / 2, -z.radius - 12, w, 4);
    ctx.fillStyle = z.type === 'boss' ? '#e040fb' : '#8bc34a';
    ctx.fillRect(-w / 2, -z.radius - 12, (w * z.hp) / z.maxHp, 4);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = game.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  // body
  ctx.fillStyle = '#cfd8dc';
  ctx.beginPath();
  ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
  ctx.fill();
  // gun barrel
  ctx.fillStyle = '#90a4ae';
  ctx.fillRect(p.radius - 4, -3, 18, 6);
  // muzzle flash
  if (p.muzzleFlash > 0) {
    ctx.fillStyle = '#ffe082';
    ctx.beginPath();
    ctx.arc(p.radius + 18, 0, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHiggs() {
  const h = game.higgs;
  const p = game.player;
  const active = game.time < h.activeUntil;
  if (active) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const grad = ctx.createRadialGradient(0, 0, HIGGS.radius * 0.6, 0, 0, HIGGS.radius);
    grad.addColorStop(0, 'rgba(33,150,243,0.04)');
    grad.addColorStop(1, 'rgba(33,150,243,0.18)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, HIGGS.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,181,246,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // orbiting particles
    for (let i = 0; i < 10; i++) {
      const a = game.time * 1.5 + (i * Math.PI * 2) / 10;
      const r = HIGGS.radius * (0.92 + 0.05 * Math.sin(game.time * 3 + i));
      ctx.fillStyle = '#90caf9';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // activation shockwave ring
  if (h.ringT >= 0 && h.ringT < 0.5) {
    const t = h.ringT / 0.5;
    ctx.strokeStyle = `rgba(144,202,249,${1 - t})`;
    ctx.lineWidth = 5 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HIGGS.radius * (0.3 + t * 1.3), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawHUD() {
  const p = game.player;
  const def = WEAPONS[p.weapon];
  ctx.save();
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';

  // health
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 20, 220, 18);
  ctx.fillStyle = p.hp > 30 ? '#66bb6a' : '#ef5350';
  ctx.fillRect(20, 20, 220 * Math.max(0, p.hp / p.maxHp), 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.max(0, Math.ceil(p.hp))}`, 26, 22);

  // stamina
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 44, 220, 8);
  ctx.fillStyle = '#ffee58';
  ctx.fillRect(20, 44, 220 * p.stamina, 8);

  // higgs charge
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 58, 220, 10);
  ctx.fillStyle = game.higgs.charge >= 1 ? '#42a5f5' : '#1e5a8a';
  ctx.fillRect(20, 58, 220 * game.higgs.charge, 10);
  ctx.fillStyle = '#bbdefb';
  ctx.fillText(game.higgs.charge >= 1 ? 'HIGGS FIELD READY [E]' : 'HIGGS CHARGING…', 20, 72);

  // weapon + ammo
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#fff';
  const ammoTxt = p.reloading > 0 ? 'RELOADING…' : `${p.mags[p.weapon]} / ${def.magSize}`;
  ctx.fillText(`${def.name}  ${ammoTxt}`, canvas.width - 24, canvas.height - 70);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[1]PISTOL [2]RIFLE [3]SHOTGUN [4]SMG  [R]RELOAD', canvas.width - 24, canvas.height - 40);

  // wave + score
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText(`WAVE ${game.wave}`, canvas.width / 2, 22);
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.fillText(`SCORE ${game.score}   ZOMBIES ${game.zombies.length + game.spawnQueue.length}`, canvas.width / 2, 46);

  // wave banner slam
  if (game.waveBannerT > 0) {
    const t = game.waveBannerT;
    const scale = t > 1.9 ? 1 + (t - 1.9) * 8 : 1;
    const alpha = Math.min(1, t);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 - 80);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 64px monospace';
    ctx.fillStyle = '#d32f2f';
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = 30;
    ctx.fillText(`WAVE ${game.wave}`, 0, 0);
    ctx.restore();
  }

  // hurt vignette
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(183,28,28,${p.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

function drawTitle() {
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const t = performance.now() / 1000;

  // drifting fog blobs
  for (let i = 0; i < 6; i++) {
    const x = cx + Math.sin(t * 0.1 + i * 2.1) * canvas.width * 0.4;
    const y = cy + Math.cos(t * 0.13 + i * 1.7) * canvas.height * 0.35;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, 220);
    grad.addColorStop(0, 'rgba(40,16,16,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 96px monospace';
  ctx.fillStyle = '#b71c1c';
  ctx.shadowColor = '#ff1744';
  ctx.shadowBlur = 25 + Math.sin(t * 2) * 12;
  ctx.fillText('DEAD ZONE', cx, cy - 60);
  ctx.shadowBlur = 0;
  ctx.font = '16px monospace';
  ctx.fillStyle = '#9e9e9e';
  const lines = [
    'WASD move · SHIFT sprint · MOUSE aim/shoot',
    '1-4 weapons · R reload · E higgs field',
    '',
  ];
  lines.forEach((l, i) => ctx.fillText(l, cx, cy + i * 26));
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 3)})`;
  ctx.fillText('CLICK TO ENTER', cx, cy + 110);
  ctx.restore();
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(6,6,8,0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 72px monospace';
  ctx.fillStyle = '#b71c1c';
  ctx.shadowColor = '#ff1744';
  ctx.shadowBlur = 30;
  ctx.fillText('YOU DIED', cx, cy - 40);
  ctx.shadowBlur = 0;
  ctx.font = '20px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`Survived to wave ${game.wave} · Score ${game.score}`, cx, cy + 16);
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('CLICK TO RESTART', cx, cy + 70);
  ctx.restore();
}

function render() {
  if (state === 'title') {
    drawTitle();
    return;
  }
  drawGround();
  drawHiggs();
  for (const z of game.zombies) drawZombie(z);
  // bullets
  for (const b of game.bullets) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.stroke();
  }
  drawPlayer();
  // particles
  for (const pa of game.particles) {
    ctx.globalAlpha = Math.min(1, pa.life * 3);
    ctx.fillStyle = pa.color;
    ctx.fillRect(pa.x - pa.size / 2, pa.y - pa.size / 2, pa.size, pa.size);
  }
  ctx.globalAlpha = 1;
  drawHUD();
  if (state === 'gameover') drawGameOver();
}

// ---- Loop -------------------------------------------------------------

state = 'title';
game = newGame();
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'title' && wasPressed('mouse')) {
    sfx.startMusic();
    startGame();
  } else if (state === 'gameover' && wasPressed('mouse')) {
    startGame();
  } else if (state === 'playing') {
    update(dt);
  }

  render();
  consumePressed();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
