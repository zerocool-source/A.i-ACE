import { initInput, input, wasPressed, consumePressed } from './input.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { waveComposition, spawnZombie } from './zombies.js';
import { LEVELS, VICTORY_ART, EPILOGUE } from './levels.js';
import {
  ATTRS, newCharacter, xpForLevel, grantXp, derived, weaponStats,
  shopCatalog, saveCharacter, loadCharacter, wipeSave,
} from './rpg.js';
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

// ---- image cache ---------------------------------------------------------

const IMAGE_CACHE = new Map();
function getImage(url) {
  if (!IMAGE_CACHE.has(url)) {
    const entry = { img: null };
    const img = new Image();
    img.src = url;
    img.onload = () => (entry.img = img);
    IMAGE_CACHE.set(url, entry);
  }
  return IMAGE_CACHE.get(url).img;
}

// Generated top-down sprites (all face right). Every draw call falls back to
// the procedural shapes until its sprite finishes loading / if it's missing.
// Generations carry different amounts of empty padding, so each sprite is
// trimmed to its alpha bounding box once it loads.
const SPRITES = {};

function trimToAlphaBounds(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cc = c.getContext('2d');
  cc.drawImage(img, 0, 0);
  const d = cc.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return c;
  const t = document.createElement('canvas');
  t.width = maxX - minX + 1;
  t.height = maxY - minY + 1;
  t.getContext('2d').drawImage(c, minX, minY, t.width, t.height, 0, 0, t.width, t.height);
  return t;
}

for (const name of ['player', 'walker', 'runner', 'brute', 'boss']) {
  const img = new Image();
  img.src = `/sprites/${name}.png`;
  img.onload = () => {
    SPRITES[name] = trimToAlphaBounds(img);
  };
}

// draws a trimmed sprite centered at the origin, longest side scaled to `size`
function drawSprite(sp, size) {
  const k = size / Math.max(sp.width, sp.height);
  ctx.drawImage(sp, (-sp.width * k) / 2, (-sp.height * k) / 2, sp.width * k, sp.height * k);
}

const titleArt = new Image();
titleArt.src = '/title-bg.png';

// ---- state -----------------------------------------------------------------

const HIGGS = { radius: 190, slowFactor: 0.25, slowDuration: 5, knockback: 420 };

let state = 'title'; // title | levelintro | playing | shop | gameover | victory
let char = loadCharacter();
let hasSave = !!char;
if (!char) char = newCharacter();
let game = null;
let charSheetOpen = false;
let banners = []; // {text, sub, t, color}
let briefingStart = 0; // typewriter clock for the level-intro story text

function enterLevelIntro() {
  state = 'levelintro';
  briefingStart = performance.now();
}

// clickable UI regions built during render, consumed at the start of the next frame
let uiButtons = [];
function button(x, y, w, h, cb, enabled = true) {
  uiButtons.push({ x, y, w, h, cb, enabled });
}

function level() {
  return LEVELS[char.campaignLevel];
}

function banner(text, sub, color = '#d32f2f') {
  banners.push({ text, sub, t: 2.4, color });
}

function newGame() {
  const d = derived(char);
  return {
    time: 0,
    score: 0,
    kills: 0,
    wave: 0,
    spawnQueue: [],
    spawnTimer: 0,
    intermission: 0,
    levelClearing: false,
    player: {
      x: canvas.width / 2, y: canvas.height / 2,
      radius: 14,
      hp: Math.min(char.hp ?? d.maxHp, d.maxHp),
      speed: 220, sprintMult: 1.6,
      stamina: 1,
      weapon: 'pistol',
      mags: Object.fromEntries(WEAPON_ORDER.map((w) => [w, weaponStats(char, w).magSize])),
      fireCooldown: 0,
      reloading: 0,
      muzzleFlash: 0,
      hurtFlash: 0,
      angle: 0,
    },
    zombies: [],
    bullets: [],
    particles: [],
    scraps: [],
    dmgNumbers: [],
    higgs: { charge: 1, activeUntil: 0, ringT: -1 },
  };
}

function startLevel() {
  decalCtx.clearRect(0, 0, decalCanvas.width, decalCanvas.height);
  game = newGame();
  state = 'playing';
  charSheetOpen = false;
  nextWave();
}

function nextWave() {
  const lv = level();
  game.wave++;
  const effW = char.campaignLevel * lv.waves + game.wave;
  let comp = waveComposition(effW).filter((t) => t !== 'boss');
  const extra = Math.floor(comp.length * (lv.countMult - 1));
  for (let i = 0; i < extra; i++) comp.push(comp[Math.floor(Math.random() * comp.length)]);
  if (game.wave === lv.waves) {
    for (let i = 0; i < lv.bosses; i++) comp.push('boss');
    banner(`WAVE ${game.wave}`, 'THE BOSS IS COMING');
  } else {
    banner(`WAVE ${game.wave}`, `${lv.name} — ${game.wave} / ${lv.waves}`);
  }
  game.spawnQueue = comp;
  game.spawnTimer = 0;
}

function spawnLevelZombie(type) {
  const lv = level();
  const z = spawnZombie(type, canvas.width, canvas.height);
  z.hp = z.maxHp = Math.round(z.hp * lv.hpMult);
  z.speed *= lv.speedMult;
  z.damage = Math.round(z.damage * (1 + char.campaignLevel * 0.2));
  return z;
}

function completeLevel() {
  const lv = level();
  char.scrap += lv.scrapBonus;
  char.hp = game.player.hp;
  char.totalKills += game.kills;
  saveCharacter(char);
  sfx.playFanfare();
  state = 'shop';
}

// ---- update ----------------------------------------------------------------

function update(dt) {
  const g = game;
  const p = g.player;
  const d = derived(char);
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
  const spd = p.speed * d.moveMult * (sprinting ? p.sprintMult : 1);
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    p.x += (dx / len) * spd * dt;
    p.y += (dy / len) * spd * dt;
  }
  p.x = Math.max(p.radius, Math.min(canvas.width - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(canvas.height - p.radius, p.y));
  p.angle = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);

  // -- regen
  p.hp = Math.min(d.maxHp, p.hp + d.regen * dt);

  // -- weapon switching
  for (const w of WEAPON_ORDER) {
    if (wasPressed(WEAPONS[w].key) && p.weapon !== w) {
      p.weapon = w;
      p.reloading = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
    }
  }

  // -- reload
  const ws = weaponStats(char, p.weapon);
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) p.mags[p.weapon] = ws.magSize;
  } else if (wasPressed('r') && p.mags[p.weapon] < ws.magSize) {
    p.reloading = ws.reloadTime;
    sfx.playReload();
  }

  // -- shooting
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
  const wantsFire = ws.auto ? input.mouse.down : wasPressed('mouse');
  if (wantsFire && p.fireCooldown === 0 && p.reloading <= 0) {
    if (p.mags[p.weapon] <= 0) {
      sfx.playEmptyClick();
      p.fireCooldown = 0.25;
    } else {
      p.mags[p.weapon]--;
      p.fireCooldown = ws.fireInterval;
      p.muzzleFlash = 0.05;
      sfx.playGunshot(p.weapon);
      for (let i = 0; i < ws.pellets; i++) {
        const a = p.angle + (Math.random() - 0.5) * 2 * ws.spread;
        g.bullets.push({
          x: p.x + Math.cos(p.angle) * (p.radius + 10),
          y: p.y + Math.sin(p.angle) * (p.radius + 10),
          vx: Math.cos(a) * ws.bulletSpeed,
          vy: Math.sin(a) * ws.bulletSpeed,
          damage: ws.damage, color: ws.color, life: 1.2,
        });
      }
      if (p.mags[p.weapon] === 0) {
        p.reloading = ws.reloadTime;
        sfx.playReload();
      }
    }
  }

  // -- higgs field
  const h = g.higgs;
  h.charge = Math.min(1, h.charge + dt / d.higgsCooldown);
  if (h.ringT >= 0) h.ringT += dt;
  if (wasPressed('e') && h.charge >= 1) {
    h.charge = 0;
    h.activeUntil = g.time + HIGGS.slowDuration;
    h.ringT = 0;
    sfx.playHiggsWhomp();
    for (const z of g.zombies) {
      const dist = Math.hypot(z.x - p.x, z.y - p.y);
      if (dist < HIGGS.radius + z.radius) {
        z.slowUntil = g.time + HIGGS.slowDuration;
        const k = HIGGS.knockback / Math.max(dist, 30);
        z.x += (z.x - p.x) * k * 0.2;
        z.y += (z.y - p.y) * k * 0.2;
      }
    }
  }

  // -- spawning / wave progression
  const lv = level();
  if (g.spawnQueue.length) {
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      g.zombies.push(spawnLevelZombie(g.spawnQueue.shift()));
      g.spawnTimer = Math.max(0.25, 1.4 - (char.campaignLevel * 5 + g.wave) * 0.08);
    }
  } else if (!g.zombies.length) {
    if (g.wave >= lv.waves) {
      if (!g.levelClearing) {
        g.levelClearing = true;
        banner('LEVEL CLEARED', `+${lv.scrapBonus} scrap bonus`, '#ffd54f');
      }
      g.intermission += dt;
      if (g.intermission > 2) completeLevel();
    } else {
      g.intermission += dt;
      if (g.intermission > 3) {
        g.intermission = 0;
        nextWave();
      }
    }
  }

  // -- zombies
  const fieldActive = g.time < h.activeUntil;
  for (const z of g.zombies) {
    const distP = Math.hypot(p.x - z.x, p.y - z.y);
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
    z.attackCooldown -= dt;
    if (distP < z.radius + p.radius + 4 && z.attackCooldown <= 0) {
      z.attackCooldown = 0.8;
      const dmg = Math.max(1, z.damage - d.armor);
      p.hp -= dmg;
      p.hurtFlash = 0.25;
      spawnBlood(p.x, p.y, 6, '#c62828');
      g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${dmg}`, color: '#ef5350', life: 0.8, vy: -50 });
    }
    z.groanTimer -= dt;
    if (z.groanTimer <= 0) {
      z.groanTimer = 4 + Math.random() * 8;
      sfx.playGroan(Math.min(1, distP / 900));
    }
    if (z.type === 'boss') {
      z.minionTimer -= dt;
      if (z.minionTimer <= 0) {
        z.minionTimer = 6;
        const m = spawnLevelZombie('runner');
        m.x = z.x;
        m.y = z.y;
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
        const crit = Math.random() < d.critChance;
        const dmg = Math.round(b.damage * (crit ? 2 : 1));
        z.hp -= dmg;
        b.life = 0;
        spawnBlood(b.x, b.y, 4, '#7b1d1d');
        g.dmgNumbers.push({
          x: z.x + (Math.random() - 0.5) * 16, y: z.y - z.radius,
          txt: crit ? `${dmg}!` : `${dmg}`,
          color: crit ? '#ffd740' : '#fff',
          life: crit ? 1 : 0.7, vy: -60,
        });
        if (z.hp <= 0) killZombie(z);
        break;
      }
    }
  }
  g.bullets = g.bullets.filter(
    (b) => b.life > 0 && b.x > -50 && b.x < canvas.width + 50 && b.y > -50 && b.y < canvas.height + 50
  );
  g.zombies = g.zombies.filter((z) => z.hp > 0);

  // -- scrap pickups
  for (const s of g.scraps) {
    const dist = Math.hypot(p.x - s.x, p.y - s.y);
    if (dist < 90) {
      // magnet
      s.x += ((p.x - s.x) / dist) * 320 * dt;
      s.y += ((p.y - s.y) / dist) * 320 * dt;
    } else {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.9;
      s.vy *= 0.9;
    }
    if (dist < p.radius + 10) {
      char.scrap += s.amount;
      s.taken = true;
      sfx.playScrapPickup();
    }
  }
  g.scraps = g.scraps.filter((s) => !s.taken);

  // -- particles / damage numbers / banners
  for (const pa of g.particles) {
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.vx *= 0.9;
    pa.vy *= 0.9;
    pa.life -= dt;
  }
  g.particles = g.particles.filter((pa) => pa.life > 0);
  for (const n of g.dmgNumbers) {
    n.y += n.vy * dt;
    n.life -= dt;
  }
  g.dmgNumbers = g.dmgNumbers.filter((n) => n.life > 0);

  p.hurtFlash = Math.max(0, p.hurtFlash - dt);

  if (p.hp <= 0) {
    state = 'gameover';
    char.scrap = Math.floor(char.scrap * 0.5);
    char.hp = derived(char).maxHp;
    char.totalKills += g.kills;
    saveCharacter(char);
    sfx.playGameOverSting();
  }
}

const SCRAP_DROPS = { walker: [3, 3], runner: [5, 3], brute: [12, 6], boss: [80, 40] };

function killZombie(z) {
  const g = game;
  g.score += z.score;
  g.kills++;
  sfx.playSquelch();
  spawnBlood(z.x, z.y, z.type === 'boss' ? 40 : 14, '#7b1d1d');
  stampDecal(z.x, z.y, z.radius);
  // scrap scatter
  const [base, rand] = SCRAP_DROPS[z.type];
  const total = base + Math.floor(Math.random() * rand);
  const piles = z.type === 'boss' ? 6 : 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < piles; i++) {
    const a = Math.random() * Math.PI * 2;
    g.scraps.push({
      x: z.x, y: z.y,
      vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
      amount: Math.max(1, Math.round(total / piles)),
    });
  }
  // xp
  const ups = grantXp(char, z.score);
  if (ups > 0) {
    sfx.playLevelUp();
    banner(`LEVEL ${char.level}`, `+${ups * 3} attribute points — press TAB`, '#64b5f6');
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

// ---- render: world ---------------------------------------------------------

function drawCoverImage(img, alpha = 1) {
  const s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawGround() {
  ctx.fillStyle = '#0b0d0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ground = getImage(level().ground);
  if (ground) {
    ctx.globalAlpha = 0.35;
    const tile = 256;
    for (let x = 0; x < canvas.width; x += tile)
      for (let y = 0; y < canvas.height; y += tile)
        ctx.drawImage(ground, x, y, tile, tile);
    ctx.globalAlpha = 1;
  } else {
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
  }
  ctx.drawImage(decalCanvas, 0, 0);
  if (level().tint) {
    ctx.fillStyle = level().tint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawZombie(z) {
  const slowed = game.time < z.slowUntil;
  ctx.save();
  ctx.translate(z.x, z.y);
  const grad = ctx.createRadialGradient(0, 0, z.radius * 0.3, 0, 0, z.radius * 2.2);
  grad.addColorStop(0, z.glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, z.radius * 2.2, 0, Math.PI * 2);
  ctx.fill();
  const a = Math.atan2(game.player.y - z.y, game.player.x - z.x);
  const sprite = SPRITES[z.type];
  if (sprite) {
    // sprites face right; rotate toward the player with a walk-cycle bob
    ctx.save();
    ctx.rotate(a + Math.sin(z.wobble * 2) * 0.08);
    drawSprite(sprite, z.radius * 3.2);
    ctx.restore();
  } else {
    ctx.fillStyle = z.color;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();
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
  }
  if (slowed) {
    ctx.strokeStyle = 'rgba(100,181,246,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
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
  if (SPRITES.player) {
    drawSprite(SPRITES.player, p.radius * 3.6);
  } else {
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#90a4ae';
    ctx.fillRect(p.radius - 4, -3, 18, 6);
  }
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
  if (h.ringT >= 0 && h.ringT < 0.5) {
    const t = h.ringT / 0.5;
    ctx.strokeStyle = `rgba(144,202,249,${1 - t})`;
    ctx.lineWidth = 5 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HIGGS.radius * (0.3 + t * 1.3), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawScraps() {
  for (const s of game.scraps) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(performance.now() / 400 + s.x);
    ctx.fillStyle = '#ffb300';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#ffe082';
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
}

// ---- render: HUD + screens ---------------------------------------------------

function drawBanners(dt) {
  for (const b of banners) {
    b.t -= dt;
    const t = b.t;
    if (t <= 0) continue;
    const scale = t > 2.1 ? 1 + (t - 2.1) * 8 : 1;
    const alpha = Math.min(1, t);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.translate(canvas.width / 2, canvas.height / 2 - 80);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 64px monospace';
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 30;
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.shadowBlur = 0;
      ctx.font = '18px monospace';
      ctx.fillStyle = '#e0e0e0';
      ctx.fillText(b.sub, 0, 36);
    }
    ctx.restore();
  }
  banners = banners.filter((b) => b.t > 0);
}

function drawHUD() {
  const p = game.player;
  const d = derived(char);
  const ws = weaponStats(char, p.weapon);
  const lv = level();
  ctx.save();
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';

  // health
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 20, 220, 18);
  ctx.fillStyle = p.hp > d.maxHp * 0.3 ? '#66bb6a' : '#ef5350';
  ctx.fillRect(20, 20, 220 * Math.max(0, p.hp / d.maxHp), 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.max(0, Math.ceil(p.hp))}/${d.maxHp}`, 26, 22);

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

  // xp bar + char level
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 94, 220, 10);
  ctx.fillStyle = '#ab47bc';
  ctx.fillRect(20, 94, 220 * Math.min(1, char.xp / xpForLevel(char.level)), 10);
  ctx.fillStyle = '#ce93d8';
  ctx.fillText(`LV ${char.level}` + (char.unspent > 0 ? `  +${char.unspent} pts [TAB]` : ''), 20, 108);

  // scrap
  ctx.fillStyle = '#ffb300';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`⚙ ${char.scrap}`, canvas.width - 24, 22);

  // weapon + ammo
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#fff';
  const ammoTxt = p.reloading > 0 ? 'RELOADING…' : `${p.mags[p.weapon]} / ${ws.magSize}`;
  const tierTxt = ws.tier > 0 ? ` MK${ws.tier + 1}` : '';
  ctx.fillText(`${ws.name}${tierTxt}  ${ammoTxt}`, canvas.width - 24, canvas.height - 70);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[1]PISTOL [2]RIFLE [3]SHOTGUN [4]SMG  [R]RELOAD  [TAB]CHARACTER', canvas.width - 24, canvas.height - 40);

  // wave + score + level name
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText(`${lv.name} — WAVE ${game.wave}/${lv.waves}`, canvas.width / 2, 22);
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.fillText(`SCORE ${game.score}   ZOMBIES ${game.zombies.length + game.spawnQueue.length}`, canvas.width / 2, 46);

  // hurt vignette
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(183,28,28,${p.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

function drawPanelButton(x, y, w, h, label, sub, cost, enabled, cb) {
  ctx.fillStyle = enabled ? 'rgba(30,34,40,0.92)' : 'rgba(20,22,25,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = enabled ? '#546e7a' : '#37474f';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = enabled ? '#fff' : '#616161';
  ctx.fillText(label, x + 12, y + 9);
  ctx.font = '12px monospace';
  ctx.fillStyle = enabled ? '#90a4ae' : '#4a4a4a';
  ctx.fillText(sub, x + 12, y + 30);
  if (cost != null) {
    ctx.textAlign = 'right';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = enabled ? '#ffb300' : '#5d4a1f';
    ctx.fillText(cost, x + w - 12, y + 9);
  }
  button(x, y, w, h, cb, enabled);
}

function drawCharSheet() {
  const d = derived(char);
  const w = Math.min(680, canvas.width - 60);
  const h = 460;
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(16,18,22,0.97)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#455a64';
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#ce93d8';
  ctx.fillText(`SURVIVOR — LEVEL ${char.level}`, x + 24, y + 20);
  ctx.font = '14px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText(`XP ${char.xp}/${xpForLevel(char.level)}   SCRAP ${char.scrap}   KILLS ${char.totalKills}`, x + 24, y + 52);
  ctx.fillStyle = char.unspent > 0 ? '#ffd54f' : '#616161';
  ctx.fillText(`UNSPENT POINTS: ${char.unspent}`, x + 24, y + 74);

  let yy = y + 104;
  for (const key of Object.keys(ATTRS)) {
    const a = ATTRS[key];
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${a.name}  ${char.attrs[key]}`, x + 24, yy + 8);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#90a4ae';
    ctx.fillText(a.desc, x + 24, yy + 28);
    const canAdd = char.unspent > 0;
    const bx = x + w - 70;
    ctx.fillStyle = canAdd ? '#2e7d32' : '#1b3a1d';
    ctx.fillRect(bx, yy, 46, 40);
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = canAdd ? '#fff' : '#4a4a4a';
    ctx.fillText('+', bx + 16, yy + 7);
    button(bx, yy, 46, 40, () => {
      if (char.unspent > 0) {
        char.attrs[key]++;
        char.unspent--;
        sfx.playPurchase();
        saveCharacter(char);
      } else sfx.playDenied();
    }, canAdd);
    yy += 56;
  }

  ctx.font = '13px monospace';
  ctx.fillStyle = '#80cbc4';
  ctx.fillText(
    `DMG x${d.damageMult.toFixed(2)}  SPD x${d.moveMult.toFixed(2)}  HP ${d.maxHp}  REGEN ${d.regen.toFixed(1)}/s  CRIT ${(d.critChance * 100).toFixed(0)}%  HIGGS ${d.higgsCooldown.toFixed(1)}s  ARMOR ${d.armor}`,
    x + 24, yy + 6
  );
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[TAB] close', x + 24, y + h - 28);
}

function drawShop() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const intro = getImage(level().intro);
  if (intro) drawCoverImage(intro, 0.25);

  const cx = canvas.width / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 44px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.shadowColor = '#ffd54f';
  ctx.shadowBlur = 18;
  ctx.fillText(`${level().name} CLEARED`, cx, 48);
  ctx.shadowBlur = 0;
  ctx.font = '16px monospace';
  ctx.fillStyle = '#e0e0e0';
  ctx.fillText(`REQUISITIONS — spend scrap before deploying    ⚙ ${char.scrap}`, cx, 104);

  const items = shopCatalog(char, char.hp ?? 0);
  const colW = 380, rowH = 58, gap = 14;
  const cols = canvas.width > 860 ? 2 : 1;
  const gridW = cols * colW + (cols - 1) * gap;
  const x0 = (canvas.width - gridW) / 2;
  const y0 = 150;
  items.forEach((item, i) => {
    const cxx = x0 + (i % cols) * (colW + gap);
    const cyy = y0 + Math.floor(i / cols) * (rowH + gap);
    const affordable = char.scrap >= item.cost && !item.maxed;
    drawPanelButton(
      cxx, cyy, colW, rowH,
      item.maxed ? `${item.name} (MAX)` : item.name,
      item.desc,
      item.maxed ? null : `⚙ ${item.cost}`,
      affordable,
      () => {
        if (item.maxed || char.scrap < item.cost) return sfx.playDenied();
        char.scrap -= item.cost;
        item.buy(char);
        if (item.id === 'medkit') char.hp = derived(char).maxHp;
        sfx.playPurchase();
        saveCharacter(char);
      }
    );
  });

  const lastLevel = char.campaignLevel >= LEVELS.length - 1;
  const deployY = y0 + Math.ceil(items.length / cols) * (rowH + gap) + 24;
  const dw = 420;
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#102316';
  ctx.fillRect(cx - dw / 2, deployY, dw, 54);
  ctx.strokeStyle = '#43a047';
  ctx.strokeRect(cx - dw / 2, deployY, dw, 54);
  ctx.fillStyle = '#a5d6a7';
  ctx.textAlign = 'center';
  ctx.fillText(lastLevel ? 'FINISH THE CAMPAIGN ▶' : `DEPLOY: ${LEVELS[char.campaignLevel + 1].name} ▶`, cx, deployY + 16);
  button(cx - dw / 2, deployY, dw, 54, () => {
    char.campaignLevel++;
    char.hp = Math.min(char.hp ?? derived(char).maxHp, derived(char).maxHp);
    saveCharacter(char);
    if (char.campaignLevel >= LEVELS.length) {
      state = 'victory';
      sfx.playFanfare();
    } else {
      enterLevelIntro();
    }
  });

  ctx.font = '13px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[TAB] character sheet — spend attribute points', cx, deployY + 70);
}

// total characters of story revealed so far (typewriter at 45 chars/s)
function briefingChars() {
  return Math.floor(((performance.now() - briefingStart) / 1000) * 45);
}

function briefingTotal() {
  return level().story.reduce((n, l) => n + l.length, 0);
}

function drawLevelIntro() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const lv = level();
  getImage(lv.ground); // prefetch so the arena ground is ready on deploy
  const intro = getImage(lv.intro);
  if (intro) drawCoverImage(intro);
  const panelH = 270;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, canvas.height - panelH, canvas.width, panelH);
  const cx = canvas.width / 2;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '16px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText(`LEVEL ${char.campaignLevel + 1} OF ${LEVELS.length}`, cx, canvas.height - panelH + 14);
  ctx.font = 'bold 44px monospace';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 22;
  ctx.fillText(lv.name, cx, canvas.height - panelH + 38);
  ctx.shadowBlur = 0;

  // story briefing, typewriter-revealed line by line
  let budget = briefingChars();
  let yy = canvas.height - panelH + 98;
  ctx.font = '15px monospace';
  for (const line of lv.story) {
    if (budget <= 0) break;
    const shown = line.slice(0, budget);
    budget -= line.length;
    ctx.fillStyle = line.startsWith('ECHO') || line.startsWith('"') ? '#80cbc4' : '#bdbdbd';
    ctx.fillText(shown + (budget < 0 ? '▌' : ''), cx, yy);
    yy += 24;
  }

  if (briefingChars() >= briefingTotal()) {
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 3)})`;
    ctx.fillText('CLICK TO DEPLOY', cx, canvas.height - 42);
  } else {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#757575';
    ctx.fillText('click to skip', cx, canvas.height - 36);
  }
  ctx.restore();
}

function drawTitle() {
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const t = performance.now() / 1000;

  if (titleArt.complete && titleArt.naturalWidth) {
    drawCoverImage(titleArt);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, canvas.height - 170, canvas.width, 170);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '15px monospace';
    ctx.fillStyle = '#cfcfcf';
    ctx.fillText('WASD move · SHIFT sprint · MOUSE aim/shoot · 1-4 weapons · R reload · E higgs field · TAB character', cx, canvas.height - 140);
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 3)})`;
    ctx.fillText(hasSave ? `CLICK TO CONTINUE — LV ${char.level}, ${level().name}` : 'CLICK TO ENTER', cx, canvas.height - 100);
    if (hasSave) {
      ctx.font = '13px monospace';
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText('[N] new campaign (wipes save)', cx, canvas.height - 60);
    }
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 96px monospace';
  ctx.fillStyle = '#b71c1c';
  ctx.shadowColor = '#ff1744';
  ctx.shadowBlur = 25 + Math.sin(t * 2) * 12;
  ctx.fillText('DEAD ZONE', cx, cy - 60);
  ctx.shadowBlur = 0;
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
  ctx.fillText('YOU DIED', cx, cy - 60);
  ctx.shadowBlur = 0;
  ctx.font = '20px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${level().name} — wave ${game.wave} · Score ${game.score}`, cx, cy - 4);
  ctx.font = '15px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText('Half your scrap was lost. Your level and gear survive.', cx, cy + 30);
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('CLICK TO RETRY THE LEVEL', cx, cy + 76);
  ctx.restore();
}

function drawVictory() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const art = getImage(VICTORY_ART);
  if (art) drawCoverImage(art);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, canvas.height - 280, canvas.width, 280);
  const cx = canvas.width / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 52px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.shadowColor = '#ffd54f';
  ctx.shadowBlur = 28;
  ctx.fillText('THE DEAD ZONE IS CLEAR', cx, canvas.height - 260);
  ctx.shadowBlur = 0;
  ctx.font = '15px monospace';
  let yy = canvas.height - 190;
  for (const line of EPILOGUE) {
    ctx.fillStyle = '#bdbdbd';
    ctx.fillText(line, cx, yy);
    yy += 24;
  }
  ctx.font = '17px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`Survivor level ${char.level} · ${char.totalKills} total kills · ⚙ ${char.scrap} scrap banked`, cx, yy + 12);
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('CLICK FOR NEW GAME+ — keep your survivor, restart the campaign', cx, yy + 48);
  ctx.restore();
}

// ---- render dispatch -------------------------------------------------------

let lastFrame = performance.now();

function render(dt) {
  uiButtons = [];
  if (state === 'title') return drawTitle();
  if (state === 'levelintro') return drawLevelIntro();
  if (state === 'victory') return drawVictory();
  if (state === 'shop') {
    drawShop();
    if (charSheetOpen) {
      uiButtons = []; // the sheet is modal — shop buttons behind it don't take clicks
      drawCharSheet();
    }
    return;
  }

  drawGround();
  drawHiggs();
  drawScraps();
  for (const z of game.zombies) drawZombie(z);
  for (const b of game.bullets) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.stroke();
  }
  drawPlayer();
  for (const pa of game.particles) {
    ctx.globalAlpha = Math.min(1, pa.life * 3);
    ctx.fillStyle = pa.color;
    ctx.fillRect(pa.x - pa.size / 2, pa.y - pa.size / 2, pa.size, pa.size);
  }
  ctx.globalAlpha = 1;
  for (const n of game.dmgNumbers) {
    ctx.globalAlpha = Math.min(1, n.life * 2.5);
    ctx.font = n.color === '#ffd740' ? 'bold 18px monospace' : 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = n.color;
    ctx.fillText(n.txt, n.x, n.y);
  }
  ctx.globalAlpha = 1;
  drawHUD();
  drawBanners(dt);
  if (charSheetOpen) {
    uiButtons = [];
    drawCharSheet();
  }
  if (state === 'gameover') drawGameOver();
}

// ---- main loop ---------------------------------------------------------------

function handleClicks() {
  if (!wasPressed('mouse')) return false;
  // later-drawn buttons sit on top, so test them first
  for (let i = uiButtons.length - 1; i >= 0; i--) {
    const b = uiButtons[i];
    const m = input.mouse;
    if (m.x >= b.x && m.x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h) {
      b.cb();
      return true;
    }
  }
  return false;
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  // UI clicks run against the buttons laid out last frame; a consumed click
  // must not leak into the state machine below (e.g. DEPLOY → instant start)
  const uiClicked = (charSheetOpen || state === 'shop') && handleClicks();
  if (uiClicked) input.pressed.delete('mouse');

  if (state === 'title') {
    if (wasPressed('n') && hasSave) {
      wipeSave();
      char = newCharacter();
      hasSave = false;
    }
    if (wasPressed('mouse')) {
      sfx.startMusic();
      // ?debug=shop|victory jumps straight to that screen (dev aid)
      const dbg = new URLSearchParams(location.search).get('debug');
      if (dbg === 'shop') {
        game = newGame();
        state = 'shop';
      } else if (dbg === 'victory') {
        state = 'victory';
      } else {
        enterLevelIntro();
      }
    }
  } else if (state === 'levelintro') {
    if (wasPressed('mouse')) {
      // first click fast-forwards the briefing, the next one deploys
      if (briefingChars() < briefingTotal()) briefingStart = -1e9;
      else startLevel();
    }
  } else if (state === 'playing') {
    if (wasPressed('tab')) charSheetOpen = !charSheetOpen;
    if (!charSheetOpen) update(dt); // char sheet pauses the game
  } else if (state === 'shop') {
    if (wasPressed('tab')) charSheetOpen = !charSheetOpen;
  } else if (state === 'gameover') {
    if (wasPressed('mouse')) enterLevelIntro();
  } else if (state === 'victory') {
    if (wasPressed('mouse')) {
      char.campaignLevel = 0;
      char.hp = derived(char).maxHp;
      saveCharacter(char);
      hasSave = true;
      state = 'title';
    }
  }
  render(dt);
  consumePressed();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
