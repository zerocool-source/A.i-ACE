import { initInput, input, wasPressed, consumePressed } from './input.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { waveComposition, spawnZombie } from './zombies.js';
import { LEVELS, VICTORY_ART, EPILOGUE, PRE_CUTSCENES, VICTORY_SHOTS } from './levels.js';
import { HEROES, heroById, bonusText } from './heroes.js';
import {
  ATTRS, newCharacter, xpForLevel, grantXp, derived, weaponStats,
  shopCatalog, saveCharacter, loadCharacter, wipeSave,
} from './rpg.js';
import { pollGamepad, gpPressed, gamepad } from './gamepad.js';
import * as sfx from './audio.js';
import { asset } from './assets.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
initInput(canvas);

// persistent blood decals live on a world-sized offscreen canvas per level
let decalCanvas = document.createElement('canvas');
let decalCtx = decalCanvas.getContext('2d');

// ---- image cache ---------------------------------------------------------

const IMAGE_CACHE = new Map();
function getImage(url) {
  if (!IMAGE_CACHE.has(url)) {
    const entry = { img: null };
    const img = new Image();
    img.src = asset(url);
    img.onload = () => (entry.img = img);
    IMAGE_CACHE.set(url, entry);
  }
  return IMAGE_CACHE.get(url).img;
}

// Generated top-down sprites (all face right). Every draw call falls back to
// the procedural shapes until its sprite finishes loading / if it's missing.
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

for (const name of ['player', 'player_f', 'soldier', 'commander', 'medic', 'demo',
                    'civilian_m', 'civilian_f',
                    'hero_medic', 'hero_builder', 'hero_hacker', 'hero_cop', 'hero_biker',
                    'hero_engineer', 'hero_veteran', 'hero_athlete',
                    'walker', 'runner', 'brute', 'boss', 'spitter', 'exploder',
                    'crawler', 'screamer', 'rogue']) {
  const img = new Image();
  img.src = asset(`sprites/${name}.png`);
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
titleArt.src = asset('title-bg.png');

// ---- state -----------------------------------------------------------------

const HIGGS = { radius: 190, slowFactor: 0.25, slowDuration: 5, knockback: 420 };
const WORLD_BASE = { w: 2400, h: 1650 };

let state = 'title'; // title | charselect | cutscene | levelintro | playing | shop | gameover | victory
let char = loadCharacter();
let hasSave = !!char;
if (!char) char = newCharacter();
let game = null;
let charSheetOpen = false;
let banners = []; // {text, sub, t, color}
let briefingStart = 0; // typewriter clock for the level-intro story text
let screenBlood = []; // splatter stuck to the camera: {fx, fy, r, alpha}
let gpFocus = 0; // gamepad focus index into uiButtons
let cam = { x: 0, y: 0 };

function enterLevelIntro() {
  state = 'levelintro';
  briefingStart = performance.now();
}

// ---- cutscenes -------------------------------------------------------------
// Ken Burns shots over the generated art with letterbox + typewriter captions.
// Click advances to the next shot; finishing (or clicking through) calls onDone.

let cutscene = null; // { shots, idx, t, onDone }

const OPENING_SHOTS = [
  { img: null, duration: 5, lines: ['DAY 0.', 'The infection took the city in six hours.'] },
  { img: 'levels/city-intro.png', duration: 7, zoomFrom: 1.0, zoomTo: 1.18, lines: ['DAY 1. The evacuation convoys never came back.'] },
  { img: 'levels/hospital-intro.png', duration: 7, zoomFrom: 1.15, zoomTo: 1.0, lines: ['It started at St. Mercy Hospital.', 'Nobody ever checked out.'] },
  { img: 'levels/base-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.12, lines: ['DAY 2. The army fell back to Quarantine Base Delta.', 'Then the radio went quiet.'] },
  { img: 'title-bg.png', duration: 6, zoomFrom: 1.25, zoomTo: 1.0, lines: ['DAY 3. You stopped waiting for rescue.'] },
];

function startCutscene(shots, onDone) {
  for (const s of shots) if (s.img) getImage(s.img);
  cutscene = { shots, idx: 0, t: 0, onDone };
  state = 'cutscene';
}

function advanceCutscene() {
  cutscene.idx++;
  cutscene.t = 0;
  if (cutscene.idx >= cutscene.shots.length) {
    const done = cutscene.onDone;
    cutscene = null;
    done();
  }
}

function drawCutscene(dt) {
  cutscene.t += dt;
  const shot = cutscene.shots[cutscene.idx];
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const prog = Math.min(1, cutscene.t / shot.duration);

  if (shot.img) {
    const img = getImage(shot.img);
    if (img) {
      const zoom = (shot.zoomFrom ?? 1) + ((shot.zoomTo ?? 1.1) - (shot.zoomFrom ?? 1)) * prog;
      const s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight) * zoom;
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const fade = Math.min(1, cutscene.t / 0.8, (shot.duration - cutscene.t) / 0.8);
      ctx.globalAlpha = Math.max(0, fade);
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.globalAlpha = 1;
    }
  }

  const bar = Math.round(canvas.height * 0.11);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, bar);
  ctx.fillRect(0, canvas.height - bar, canvas.width, bar);

  let budget = Math.floor(cutscene.t * 40);
  let yy = canvas.height - bar + 18;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '17px monospace';
  for (const line of shot.lines) {
    if (budget <= 0) break;
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(line.slice(0, budget), canvas.width / 2, yy);
    budget -= line.length;
    yy += 24;
  }
  ctx.textAlign = 'right';
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('click / Ⓐ to skip ▸', canvas.width - 20, 12);
  ctx.restore();

  if (cutscene.t >= shot.duration) advanceCutscene();
}

// ---- UI buttons -------------------------------------------------------------

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

// ---- game setup --------------------------------------------------------------

// One squadmate joins after each level, each with their own special:
// soldier = sustained rifle DPS · medic = healing aura + mid-wave revives
// commander = piercing magnum · demo = grenades into the thickest cluster
// ---- level props: buildings & obstacles with collision -----------------------
// kind: building/car/crypt/grave/pipe/gurney/cabinet/bunker/sandbag/crate
// solid props block movement; low props let bullets fly over them.

function placeProps(lv, world) {
  const props = [];
  const cx = world.w / 2, cy = world.h / 2;
  const fits = (x, y, w, h) => {
    if (x < 20 || y < 20 || x + w > world.w - 20 || y + h > world.h - 20) return false;
    // keep the spawn area clear
    if (x < cx + 240 && x + w > cx - 240 && y < cy + 240 && y + h > cy - 240) return false;
    for (const p of props) {
      if (x < p.x + p.w + 30 && x + w + 30 > p.x && y < p.y + p.h + 30 && y + h + 30 > p.y) return false;
    }
    return true;
  };
  const scatter = (n, wMin, wMax, hMin, hMax, kind, low) => {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const w = wMin + Math.random() * (wMax - wMin);
      const h = hMin + Math.random() * (hMax - hMin);
      const x = 30 + Math.random() * (world.w - w - 60);
      const y = 30 + Math.random() * (world.h - h - 60);
      if (fits(x, y, w, h)) {
        props.push({ x, y, w, h, kind, low: !!low, seed: Math.random() });
        i++;
      }
    }
  };
  // apartment blocks / large structures hug the edges
  const edgeBlocks = (n, kind, bw, bh) => {
    for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
      const side = Math.floor(Math.random() * 4);
      const w = bw * (0.7 + Math.random() * 0.6);
      const h = bh * (0.7 + Math.random() * 0.6);
      let x, y;
      if (side === 0) { x = Math.random() * (world.w - w); y = 30 + Math.random() * 80; }
      else if (side === 1) { x = Math.random() * (world.w - w); y = world.h - h - 30 - Math.random() * 80; }
      else if (side === 2) { x = 30 + Math.random() * 80; y = Math.random() * (world.h - h); }
      else { x = world.w - w - 30 - Math.random() * 80; y = Math.random() * (world.h - h); }
      if (fits(x, y, w, h)) {
        props.push({ x, y, w, h, kind, low: false, seed: Math.random() });
        i++;
      }
    }
  };
  switch (lv.key) {
    case 'city':
      edgeBlocks(9, 'building', 280, 180);
      scatter(14, 64, 80, 32, 40, 'car');
      scatter(6, 36, 48, 36, 48, 'crate', true);
      break;
    case 'graveyard':
      edgeBlocks(4, 'crypt', 180, 130);
      scatter(42, 24, 30, 34, 42, 'grave', true);
      break;
    case 'sewer':
      edgeBlocks(6, 'pipe', 340, 60);
      scatter(10, 200, 320, 44, 60, 'pipe');
      scatter(8, 40, 56, 40, 56, 'crate', true);
      break;
    case 'hospital':
      edgeBlocks(7, 'building', 260, 170);
      scatter(16, 30, 40, 62, 80, 'gurney', true);
      scatter(8, 44, 56, 44, 56, 'cabinet');
      break;
    case 'base':
      edgeBlocks(6, 'bunker', 240, 160);
      scatter(18, 36, 110, 30, 44, 'sandbag', true);
      scatter(12, 40, 56, 40, 56, 'crate', true);
      break;
  }
  return props;
}

// push a circle entity out of solid props (slides along walls)
function collideProps(e) {
  for (const pr of game.props) {
    const px = Math.max(pr.x, Math.min(e.x, pr.x + pr.w));
    const py = Math.max(pr.y, Math.min(e.y, pr.y + pr.h));
    const dx = e.x - px, dy = e.y - py;
    const d2 = dx * dx + dy * dy;
    const r = e.radius;
    if (d2 < r * r) {
      if (d2 === 0) {
        e.x = pr.x - r; // degenerate: shove left
      } else {
        const d = Math.sqrt(d2);
        e.x = px + (dx / d) * r;
        e.y = py + (dy / d) * r;
      }
    }
  }
}

function shotBlocked(x, y) {
  for (const pr of game.props) {
    if (pr.low) continue;
    if (x >= pr.x && x <= pr.x + pr.w && y >= pr.y && y <= pr.y + pr.h) return true;
  }
  return false;
}

// ---- squad radio chatter -------------------------------------------------------

let radioLines = []; // {speaker, text, color, t}

const BANTER = {
  soldier: ['Contact! They keep coming!', 'Wave clear. Reloading.', 'I count more on the scope.', 'Nice shooting out there.'],
  medic: ['Anyone bleeding, come to me.', 'Stay inside my aura, people.', 'You\'re patched. Don\'t waste it.', 'I\'m not losing anyone else.'],
  commander: ['Delta held nine days. We hold longer.', 'Conserve ammo. Make them count.', 'I\'ve seen worse. Barely.', 'Push forward. Now.'],
  demo: ['Fire in the hole!', 'That cluster\'s gone. You\'re welcome.', 'I LOVE this job.', 'More grenades in the truck. Probably.'],
  echo: ['ECHO-6: Still reading you. Keep moving.', 'ECHO-6: Signal\'s holding. So are you.', 'ECHO-6: Watch your corners.', 'ECHO-6: Rogue units in your sector. They are NOT friendly.'],
};

function radio(speaker, text, color) {
  radioLines.push({ speaker, text, color, t: 5 });
  if (radioLines.length > 3) radioLines.shift();
}

function squadBanter() {
  const g = game;
  const pool = [['echo', '#80cbc4']];
  for (const a of g.allies) if (!a.down) pool.push([a.type, a.color]);
  const [who, color] = pool[Math.floor(Math.random() * pool.length)];
  const lines = BANTER[who];
  const name = who === 'echo' ? '' : ALLY_DEFS[who].name + ': ';
  const line = lines[Math.floor(Math.random() * lines.length)];
  radio(who, who === 'echo' ? line : `${name}"${line}"`, color);
}

const ALLY_DEFS = {
  soldier: { name: 'SGT. REYES', hp: 160, damage: 26, fireInterval: 0.22, range: 620, color: '#81c784' },
  medic: { name: 'DOC OKAFOR', hp: 140, damage: 18, fireInterval: 0.5, range: 420, color: '#f8bbd0', healAura: 220, healRate: 4 },
  commander: { name: 'CDR. HALE', hp: 220, damage: 60, fireInterval: 0.6, range: 700, color: '#ffcc80' },
  demo: { name: '"BOOM" OSORIO', hp: 200, damage: 20, fireInterval: 0.45, range: 520, color: '#ffab40', grenade: { interval: 4.5, radius: 95, damage: 130 } },
};
const SQUAD_JOIN = ['soldier', 'medic', 'commander', 'demo']; // index = level completed

function newGame() {
  const d = derived(char);
  const lv = level();
  const world = { w: Math.round(WORLD_BASE.w * lv.sizeMult), h: Math.round(WORLD_BASE.h * lv.sizeMult) };
  const g = {
    time: 0,
    score: 0,
    kills: 0,
    wave: 0,
    spawnQueue: [],
    spawnTimer: 0,
    intermission: 0,
    levelClearing: false,
    infectionBannerShown: false,
    world,
    player: {
      x: world.w / 2, y: world.h / 2,
      radius: 14,
      hp: Math.min(char.hp ?? d.maxHp, d.maxHp),
      speed: 220, sprintMult: 1.75,
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
    civilians: [],
    allies: [],
    bullets: [],
    enemyShots: [],
    explosions: [],
    pickups: [],
    casings: [],
    particles: [],
    gibs: [],
    corpses: [],
    scraps: [],
    dmgNumbers: [],
    buffs: { rage: 0, shield: 0 }, // seconds remaining
    higgs: { charge: 1, activeUntil: 0, ringT: -1 },
    props: placeProps(lv, world),
    rogueBannerShown: false,
  };
  // civilians scattered around the map, fleeing for their lives
  for (let i = 0; i < lv.civilians; i++) {
    g.civilians.push({
      x: 100 + Math.random() * (world.w - 200),
      y: 100 + Math.random() * (world.h - 200),
      hp: 30, radius: 11,
      speed: 110 + Math.random() * 50,
      angle: Math.random() * Math.PI * 2,
      wobble: Math.random() * Math.PI * 2,
      sprite: Math.random() < 0.5 ? 'civilian_m' : 'civilian_f',
      panicTimer: 0,
    });
  }
  // the squad grows by one member per level completed
  for (let i = 0; i < Math.min(char.campaignLevel, SQUAD_JOIN.length); i++) {
    g.allies.push(makeAlly(SQUAD_JOIN[i], world));
  }
  // the partner survivor picked at campaign start fights alongside you
  if (char.partnerId) {
    const ph = heroById(char.partnerId);
    const partner = makeAlly('soldier', world);
    partner.type = 'partner';
    partner.sprite = ph.sprite;
    partner.name = ph.name.split(' ')[0];
    partner.hp = partner.maxHp = 180;
    partner.damage = 24;
    partner.fireInterval = 0.26;
    partner.color = '#b39ddb';
    g.allies.push(partner);
  }
  return g;
}

function makeAlly(type, world) {
  const def = ALLY_DEFS[type];
  return {
    type, name: def.name,
    x: world.w / 2 + (Math.random() - 0.5) * 120,
    y: world.h / 2 + (Math.random() - 0.5) * 120,
    hp: def.hp, maxHp: def.hp,
    radius: 13,
    angle: 0,
    fireCooldown: 0,
    damage: def.damage,
    fireInterval: def.fireInterval,
    range: def.range,
    color: def.color,
    healAura: def.healAura, healRate: def.healRate,
    grenade: def.grenade, grenadeTimer: def.grenade ? def.grenade.interval : 0,
    reviveTimer: 0,
    down: false,
  };
}

function startLevel() {
  game = newGame();
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = game.world.w;
  decalCanvas.height = game.world.h;
  decalCtx = decalCanvas.getContext('2d');
  screenBlood = [];
  state = 'playing';
  charSheetOpen = false;
  const joinSubs = {
    soldier: 'sustained rifle fire', medic: 'healing aura — stay close to the cross',
    commander: 'her magnum pierces the horde', demo: 'grenades into the thickest cluster',
  };
  const joinIdx = char.campaignLevel - 1;
  if (joinIdx >= 0 && joinIdx < SQUAD_JOIN.length) {
    const type = SQUAD_JOIN[joinIdx];
    const flag = 'met_' + type;
    if (!char[flag]) {
      char[flag] = true;
      saveCharacter(char);
      banner(`${ALLY_DEFS[type].name} JOINS YOUR SQUAD`, joinSubs[type], ALLY_DEFS[type].color);
    }
  }
  if (char.campaignLevel === 0) banner('THE OUTBREAK', 'protect who you can', '#ef9a9a');
  // resume from the last checkpoint reached on this level
  if (char.checkpoint && char.checkpoint.lvl === char.campaignLevel && char.checkpoint.wave > 1) {
    game.wave = char.checkpoint.wave - 1;
    banner('CHECKPOINT', `resuming at wave ${char.checkpoint.wave}`, '#80cbc4');
  }
  nextWave();
}

function nextWave() {
  const lv = level();
  game.wave++;
  // revive downed squad members between waves
  for (const a of game.allies) {
    if (a.down) {
      a.down = false;
      a.hp = a.maxHp * 0.5;
    }
  }
  // save point every 3rd wave
  if (game.wave > 1 && (game.wave - 1) % 3 === 0) {
    char.checkpoint = { lvl: char.campaignLevel, wave: game.wave };
    char.hp = game.player.hp;
    saveCharacter(char);
    banner('CHECKPOINT REACHED', 'death returns you here', '#80cbc4');
  }
  const effW = char.campaignLevel * lv.waves + game.wave;
  let comp = waveComposition(effW);
  const extra = Math.floor(comp.length * (lv.countMult - 1));
  for (let i = 0; i < extra; i++) comp.push(comp[Math.floor(Math.random() * comp.length)]);
  // feral military units stalk the later levels
  if (char.campaignLevel >= 2 && game.wave >= 2) {
    for (let i = 0; i < Math.max(1, Math.floor(game.wave * 0.35)); i++) comp.push('rogue');
    if (!game.rogueBannerShown) {
      game.rogueBannerShown = true;
      banner('ROGUE MILITARY INBOUND', 'they shoot anything that moves — including you', '#ef5350');
      radio('echo', 'ECHO-6: Those are Delta deserters. The infection took their minds, not their trigger fingers.', '#80cbc4');
    }
  }
  if (game.wave === lv.waves) {
    for (let i = 0; i < lv.bosses; i++) comp.push('boss');
    banner(`WAVE ${game.wave}`, 'THE BOSS IS COMING');
  } else {
    banner(`WAVE ${game.wave}`, `${lv.name} — ${game.wave} / ${lv.waves}`);
  }
  if (game.wave > 1) squadBanter();
  game.spawnQueue = comp;
  game.spawnTimer = 0;
}

function spawnLevelZombie(type) {
  const lv = level();
  const g = game;
  const z = spawnZombie(type, g.world.w, g.world.h);
  // place on a ring just outside the camera view, clamped into the world
  const a = Math.random() * Math.PI * 2;
  const r = Math.max(canvas.width, canvas.height) * 0.62 + 100;
  z.x = Math.max(30, Math.min(g.world.w - 30, g.player.x + Math.cos(a) * r));
  z.y = Math.max(30, Math.min(g.world.h - 30, g.player.y + Math.sin(a) * r));
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
  char.checkpoint = null;
  saveCharacter(char);
  sfx.playFanfare();
  gpFocus = 0;
  state = 'shop';
}

// ---- gore --------------------------------------------------------------------

function spawnBlood(x, y, n, color, dirAngle = null) {
  for (let i = 0; i < n; i++) {
    const a = dirAngle != null ? dirAngle + (Math.random() - 0.5) * 1.1 : Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 260;
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.3 + Math.random() * 0.4, color,
      size: 2 + Math.random() * 3,
    });
  }
}

function spawnGibs(x, y, n, dirAngle = null) {
  const colors = ['#7b1d1d', '#5d1414', '#8e2a2a', '#4a3f3f'];
  for (let i = 0; i < n; i++) {
    const a = dirAngle != null ? dirAngle + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
    const s = 120 + Math.random() * 320;
    game.gibs.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 14,
      size: 3 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0.45 + Math.random() * 0.5,
    });
  }
}

function stampDecal(x, y, r, heavy = false) {
  decalCtx.fillStyle = heavy ? 'rgba(110, 10, 10, 0.7)' : 'rgba(90, 12, 12, 0.55)';
  const blots = heavy ? 14 : 7;
  for (let i = 0; i < blots; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * r * (heavy ? 2.2 : 1.4);
    const s = 3 + Math.random() * r * 0.6;
    decalCtx.beginPath();
    decalCtx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2);
    decalCtx.fill();
  }
}

function addScreenBlood(intensity = 1) {
  for (let i = 0; i < 2 + Math.round(Math.random() * 2 * intensity); i++) {
    screenBlood.push({
      fx: 0.1 + Math.random() * 0.8,
      fy: 0.1 + Math.random() * 0.8,
      r: 30 + Math.random() * 90 * intensity,
      alpha: 0.5 + Math.random() * 0.3,
    });
  }
}

// AoE blast used by exploder zombies and BOOM's grenades
function explode(x, y, radius, damage, hurtsPlayer) {
  const g = game;
  g.explosions.push({ x, y, r: radius, t: 0.45 });
  sfx.playHiggsWhomp();
  spawnBlood(x, y, 30, '#7b1d1d');
  spawnGibs(x, y, 14);
  stampDecal(x, y, radius * 0.5, true);
  for (const z of g.zombies) {
    if (z.hp <= 0) continue;
    const d = Math.hypot(z.x - x, z.y - y);
    if (d < radius + z.radius) {
      z.hp -= damage * (1 - d / (radius + z.radius) * 0.5);
      z.flash = 0.1;
      if (z.hp <= 0) killZombie(z, Math.atan2(z.y - y, z.x - x));
    }
  }
  if (hurtsPlayer) {
    const p = g.player;
    const dp = Math.hypot(p.x - x, p.y - y);
    if (dp < radius + p.radius) {
      const dmg = Math.max(1, Math.round(damage * 0.4) - effArmor());
      p.hp -= dmg;
      p.hurtFlash = 0.3;
      addScreenBlood(1.5);
      g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${dmg}`, color: '#ef5350', life: 0.8, vy: -50 });
    }
    for (const a of g.allies) {
      if (a.down) continue;
      if (Math.hypot(a.x - x, a.y - y) < radius + a.radius) a.hp -= damage * 0.4;
    }
    for (const c of g.civilians) {
      if (Math.hypot(c.x - x, c.y - y) < radius + c.radius) c.dead = true;
    }
  }
}

function effArmor() {
  return derived(char).armor + (game.buffs.shield > 0 ? 3 : 0);
}

const LOOT_TYPES = ['medkit', 'ammo', 'shield', 'rage'];

function dropLoot(x, y, guaranteed = false) {
  if (!guaranteed && Math.random() > 0.12) return;
  const type = LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)];
  game.pickups.push({ x, y, type, t: 25 });
}

function applyPickup(type) {
  const g = game;
  const d = derived(char);
  if (type === 'medkit') {
    g.player.hp = Math.min(d.maxHp, g.player.hp + 35);
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: '+35 HP', color: '#81c784', life: 1, vy: -50 });
  } else if (type === 'ammo') {
    for (const w of WEAPON_ORDER) g.player.mags[w] = weaponStats(char, w).magSize;
    g.player.reloading = 0;
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: 'AMMO REFILLED', color: '#ffe082', life: 1, vy: -50 });
  } else if (type === 'shield') {
    g.buffs.shield = 30;
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: '+3 ARMOR 30s', color: '#90caf9', life: 1, vy: -50 });
  } else if (type === 'rage') {
    g.buffs.rage = 15;
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: 'RAGE x2 DMG', color: '#ff8a80', life: 1, vy: -50 });
  }
  sfx.playPurchase();
}

function goreKill(x, y, radius, dirAngle, big) {
  sfx.playSquelch();
  spawnBlood(x, y, big ? 50 : 22, '#7b1d1d', dirAngle);
  spawnGibs(x, y, big ? 18 : 8, dirAngle);
  stampDecal(x, y, radius, true);
  const p = game.player;
  if (Math.hypot(p.x - x, p.y - y) < 140) addScreenBlood(big ? 1.5 : 0.8);
}

// ---- update -------------------------------------------------------------------

function ownedList() {
  return WEAPON_ORDER.filter((w) => char.ownedWeapons.includes(w));
}

function cycleWeapon(dir) {
  const owned = ownedList();
  const p = game.player;
  const i = owned.indexOf(p.weapon);
  p.weapon = owned[(i + dir + owned.length) % owned.length];
  p.reloading = 0;
  p.fireCooldown = Math.max(p.fireCooldown, 0.15);
}

function zombieTarget(z) {
  // nearest living thing: player, squad, civilians
  const g = game;
  let best = g.player;
  let bestD = Math.hypot(g.player.x - z.x, g.player.y - z.y) * 0.92; // slight pull toward the player
  for (const a of g.allies) {
    if (a.down) continue;
    const d = Math.hypot(a.x - z.x, a.y - z.y);
    if (d < bestD) { best = a; bestD = d; }
  }
  for (const c of g.civilians) {
    const d = Math.hypot(c.x - z.x, c.y - z.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  return { t: best, d: Math.hypot(best.x - z.x, best.y - z.y) };
}

function update(dt) {
  const g = game;
  const p = g.player;
  const d = derived(char);
  g.time += dt;

  // -- player movement (keyboard + left stick)
  let dx = 0, dy = 0;
  if (input.keys.has('w')) dy -= 1;
  if (input.keys.has('s')) dy += 1;
  if (input.keys.has('a')) dx -= 1;
  if (input.keys.has('d')) dx += 1;
  dx += gamepad.moveX;
  dy += gamepad.moveY;
  const moving = Math.hypot(dx, dy) > 0.01;
  const sprinting = (input.keys.has('shift') || gamepad.sprint) && moving && p.stamina > 0;
  if (sprinting) p.stamina = Math.max(0, p.stamina - dt / 2.5);
  else p.stamina = Math.min(1, p.stamina + dt / 4);
  const spd = p.speed * d.moveMult * (sprinting ? p.sprintMult : 1);
  if (moving) {
    const len = Math.max(1, Math.hypot(dx, dy));
    p.x += (dx / len) * spd * dt;
    p.y += (dy / len) * spd * dt;
  }
  p.x = Math.max(p.radius, Math.min(g.world.w - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(g.world.h - p.radius, p.y));
  collideProps(p);

  // -- aim: right stick wins, otherwise mouse (in world space)
  if (gamepad.aiming) {
    p.angle = Math.atan2(gamepad.aimY, gamepad.aimX);
  } else {
    p.angle = Math.atan2(input.mouse.y + cam.y - p.y, input.mouse.x + cam.x - p.x);
  }

  // -- regen
  p.hp = Math.min(d.maxHp, p.hp + d.regen * dt);

  // -- weapon switching (1-6 if owned, LB/RB cycles)
  for (const w of WEAPON_ORDER) {
    if (wasPressed(WEAPONS[w].key) && p.weapon !== w && char.ownedWeapons.includes(w)) {
      p.weapon = w;
      p.reloading = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
    }
  }
  if (gpPressed('lb')) cycleWeapon(-1);
  if (gpPressed('rb')) cycleWeapon(1);

  // -- reload
  const ws = weaponStats(char, p.weapon);
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) p.mags[p.weapon] = ws.magSize;
  } else if ((wasPressed('r') || gpPressed('x')) && p.mags[p.weapon] < ws.magSize) {
    p.reloading = ws.reloadTime;
    sfx.playReload();
  }

  // -- shooting (mouse or RT)
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
  const holdFire = input.mouse.down || gamepad.fire;
  const tapFire = wasPressed('mouse') || gpPressed('rt-tap'); // rt edge handled via holdFire for autos
  const wantsFire = ws.auto ? holdFire : (tapFire || (gamepad.fire && p.fireCooldown === 0 && !p._rtHeld));
  p._rtHeld = gamepad.fire;
  if (wantsFire && p.fireCooldown === 0 && p.reloading <= 0) {
    if (p.mags[p.weapon] <= 0) {
      sfx.playEmptyClick();
      p.fireCooldown = 0.25;
    } else {
      p.mags[p.weapon]--;
      p.fireCooldown = ws.fireInterval;
      p.muzzleFlash = 0.05;
      sfx.playGunshot(p.weapon);
      // eject a shell casing perpendicular to the barrel
      const ca = p.angle + Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      g.casings.push({
        x: p.x + Math.cos(p.angle) * p.radius, y: p.y + Math.sin(p.angle) * p.radius,
        vx: Math.cos(ca) * (120 + Math.random() * 80), vy: Math.sin(ca) * (120 + Math.random() * 80),
        rot: Math.random() * Math.PI, rotV: (Math.random() - 0.5) * 20, life: 0.6,
      });
      for (let i = 0; i < ws.pellets; i++) {
        const a = p.angle + (Math.random() - 0.5) * 2 * ws.spread;
        g.bullets.push({
          x: p.x + Math.cos(p.angle) * (p.radius + 10),
          y: p.y + Math.sin(p.angle) * (p.radius + 10),
          vx: Math.cos(a) * ws.bulletSpeed,
          vy: Math.sin(a) * ws.bulletSpeed,
          damage: ws.damage, color: ws.color, life: 1.2,
          pierce: ws.pierce ?? 1, hit: new Set(), friendly: false,
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
  if ((wasPressed('e') || gpPressed('y')) && h.charge >= 1) {
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
      // later waves dump zombies in pairs to keep the pressure up
      const burst = 1 + (g.wave > 3 ? 1 : 0);
      for (let i = 0; i < burst && g.spawnQueue.length; i++) {
        g.zombies.push(spawnLevelZombie(g.spawnQueue.shift()));
      }
      g.spawnTimer = Math.max(0.22, 1.3 - (char.campaignLevel * lv.waves + g.wave) * 0.05);
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
    const { t: target, d: distT } = zombieTarget(z);
    const distP = Math.hypot(p.x - z.x, p.y - z.y);
    if (fieldActive && distP < HIGGS.radius + z.radius) z.slowUntil = g.time + 0.3;
    const slowed = g.time < z.slowUntil;
    let spdZ = z.speed * (slowed ? HIGGS.slowFactor : 1);
    if (z.lunges && distT < 160) spdZ *= 1.8; // crawler pounce
    if (g.time < z.boostUntil) spdZ *= 1.5; // screamer haste
    z.wobble += dt * 5;
    z.flash = Math.max(0, z.flash - dt);
    const holdPosition = z.ranged && distT < z.ranged.range * 0.85;
    if (z.human) {
      // rogue military: hold ~380px, strafe, fall back when pressed
      const nx = (target.x - z.x) / Math.max(1, distT);
      const ny = (target.y - z.y) / Math.max(1, distT);
      let mx = 0, my = 0;
      if (distT > 460) { mx = nx; my = ny; }
      else if (distT < 280) { mx = -nx; my = -ny; }
      else {
        const sgn = Math.sin(z.wobble * 0.6) > 0 ? 1 : -1;
        mx = -ny * sgn;
        my = nx * sgn;
      }
      z.x += mx * spdZ * dt;
      z.y += my * spdZ * dt;
      z.x = Math.max(z.radius, Math.min(g.world.w - z.radius, z.x));
      z.y = Math.max(z.radius, Math.min(g.world.h - z.radius, z.y));
    } else if (distT > 1 && !holdPosition) {
      z.x += ((target.x - z.x) / distT) * spdZ * dt;
      z.y += ((target.y - z.y) / distT) * spdZ * dt;
      z.x += Math.cos(z.wobble) * 8 * dt;
      z.y += Math.sin(z.wobble * 1.3) * 8 * dt;
    }
    collideProps(z);
    // screamer: shriek hastes every zombie around it
    if (z.screams) {
      z.screamTimer -= dt;
      if (z.screamTimer <= 0) {
        z.screamTimer = z.screams.interval;
        sfx.playScream();
        g.explosions.push({ x: z.x, y: z.y, r: z.screams.radius, t: 0.45, scream: true });
        for (const z2 of g.zombies) {
          if (z2 === z || z2.human) continue;
          if (Math.hypot(z2.x - z.x, z2.y - z.y) < z.screams.radius) {
            z2.boostUntil = g.time + z.screams.boost;
          }
        }
      }
    }
    z.attackCooldown -= dt;
    if (distT < z.radius + (target.radius ?? 14) + 4 && z.attackCooldown <= 0) {
      z.attackCooldown = 0.8;
      if (target === p) {
        const dmg = Math.max(1, z.damage - effArmor());
        p.hp -= dmg;
        p.hurtFlash = 0.25;
        addScreenBlood(1);
        spawnBlood(p.x, p.y, 8, '#c62828');
        g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${dmg}`, color: '#ef5350', life: 0.8, vy: -50 });
      } else if (g.allies.includes(target)) {
        target.hp -= z.damage;
        spawnBlood(target.x, target.y, 6, '#c62828');
        if (target.hp <= 0 && !target.down) {
          target.down = true;
          banner(`${target.name} IS DOWN`, 'back up at the next wave', '#ef9a9a');
          goreKill(target.x, target.y, target.radius, null, false);
        }
      } else {
        // civilian mauled
        target.hp -= z.damage;
        if (target.hp <= 0) target.dead = true;
      }
    }
    // spitter: stop at range and lob acid at its target
    if (z.ranged && distT < z.ranged.range) {
      z.spitTimer -= dt;
      if (z.spitTimer <= 0) {
        z.spitTimer = z.ranged.interval;
        const sa = Math.atan2(target.y - z.y, target.x - z.x) + (Math.random() - 0.5) * 0.12;
        g.enemyShots.push({
          x: z.x, y: z.y,
          vx: Math.cos(sa) * z.ranged.shotSpeed, vy: Math.sin(sa) * z.ranged.shotSpeed,
          damage: z.damage, life: 1.6,
          kind: z.ranged.bullet ? 'bullet' : 'acid',
        });
      }
    }
    // exploder: detonate on contact
    if (z.explodes && distT < z.radius + (target.radius ?? 14) + 14 && z.hp > 0) {
      z.hp = 0;
      z._dead = true;
      explode(z.x, z.y, z.explodes.radius, z.damage * 2.2, true);
    }
    z.groanTimer -= dt;
    if (z.groanTimer <= 0) {
      z.groanTimer = 4 + Math.random() * 8;
      sfx.playGroan(Math.min(1, distP / 1100));
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

  // -- civilians: flee the nearest zombie, die horribly, rise again
  for (const c of g.civilians) {
    if (c.dead) continue;
    c.wobble += dt * 6;
    let nz = null, nd = 1e9;
    for (const z of g.zombies) {
      const dd = Math.hypot(z.x - c.x, z.y - c.y);
      if (dd < nd) { nd = dd; nz = z; }
    }
    if (nz && nd < 480) {
      c.angle = Math.atan2(c.y - nz.y, c.x - nz.x);
      c.x += Math.cos(c.angle) * c.speed * dt;
      c.y += Math.sin(c.angle) * c.speed * dt;
      c.panicTimer -= dt;
      if (c.panicTimer <= 0 && nd < 260) {
        c.panicTimer = 2 + Math.random() * 3;
        sfx.playScream();
      }
    } else {
      // nervous wandering
      c.angle += (Math.random() - 0.5) * dt * 3;
      c.x += Math.cos(c.angle) * c.speed * 0.25 * dt;
      c.y += Math.sin(c.angle) * c.speed * 0.25 * dt;
    }
    c.x = Math.max(c.radius, Math.min(g.world.w - c.radius, c.x));
    c.y = Math.max(c.radius, Math.min(g.world.h - c.radius, c.y));
    collideProps(c);
  }
  // the turned rise as walkers
  for (const c of g.civilians) {
    if (!c.dead) continue;
    sfx.playScream();
    goreKill(c.x, c.y, c.radius, null, false);
    const z = spawnLevelZombie('walker');
    z.x = c.x;
    z.y = c.y;
    g.zombies.push(z);
    if (!g.infectionBannerShown) {
      g.infectionBannerShown = true;
      banner('THE INFECTION SPREADS', 'the dead do not stay down', '#9ccc65');
    }
  }
  g.civilians = g.civilians.filter((c) => !c.dead);

  // -- squad AI: stick near the player, light up the nearest zombie
  for (const a of g.allies) {
    if (a.down) {
      // the medic can drag squadmates back onto their feet mid-wave
      const medic = g.allies.find((m) => m.healAura && !m.down);
      if (medic && Math.hypot(medic.x - a.x, medic.y - a.y) < medic.healAura) {
        a.reviveTimer += dt;
        if (a.reviveTimer > 6) {
          a.down = false;
          a.hp = a.maxHp * 0.4;
          a.reviveTimer = 0;
          banner(`${a.name} IS BACK UP`, 'patched by DOC OKAFOR', '#f8bbd0');
        }
      }
      continue;
    }
    const dp = Math.hypot(p.x - a.x, p.y - a.y);
    if (dp > 170) {
      a.x += ((p.x - a.x) / dp) * 200 * dt;
      a.y += ((p.y - a.y) / dp) * 200 * dt;
    }
    collideProps(a);
    let nz = null, nd = 1e9;
    for (const z of g.zombies) {
      const dd = Math.hypot(z.x - a.x, z.y - a.y);
      if (dd < nd) { nd = dd; nz = z; }
    }
    a.fireCooldown -= dt;
    if (nz && nd < a.range) {
      a.angle = Math.atan2(nz.y - a.y, nz.x - a.x);
      if (a.fireCooldown <= 0) {
        a.fireCooldown = a.fireInterval;
        sfx.playGunshot(a.type === 'commander' ? 'magnum' : 'rifle');
        const sp = a.angle + (Math.random() - 0.5) * 0.08;
        g.bullets.push({
          x: a.x + Math.cos(a.angle) * 20, y: a.y + Math.sin(a.angle) * 20,
          vx: Math.cos(sp) * 1200, vy: Math.sin(sp) * 1200,
          damage: a.damage, color: a.color, life: 1.0,
          pierce: a.type === 'commander' ? 2 : 1, hit: new Set(), friendly: true,
        });
      }
    } else {
      a.angle = p.angle;
    }
    // medic special: healing aura for the player and nearby squadmates
    if (a.healAura) {
      if (Math.hypot(p.x - a.x, p.y - a.y) < a.healAura) {
        p.hp = Math.min(d.maxHp, p.hp + a.healRate * dt);
      }
      for (const other of g.allies) {
        if (other === a || other.down) continue;
        if (Math.hypot(other.x - a.x, other.y - a.y) < a.healAura) {
          other.hp = Math.min(other.maxHp, other.hp + a.healRate * dt);
        }
      }
    }
    // demo special: grenade into the densest cluster in range
    if (a.grenade) {
      a.grenadeTimer -= dt;
      if (a.grenadeTimer <= 0 && nz && nd < a.range) {
        a.grenadeTimer = a.grenade.interval;
        explode(nz.x, nz.y, a.grenade.radius, a.grenade.damage, false);
      }
    }
    // squad slowly patches itself up between fights
    if (!nz || nd > 700) a.hp = Math.min(a.maxHp, a.hp + 4 * dt);
  }

  // -- spitter acid in flight
  for (const s of g.enemyShots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life > 0 && shotBlocked(s.x, s.y)) {
      s.life = 0;
      continue;
    }
    if (Math.hypot(p.x - s.x, p.y - s.y) < p.radius + 6) {
      const dmg = Math.max(1, s.damage - effArmor());
      p.hp -= dmg;
      p.hurtFlash = 0.2;
      addScreenBlood(0.6);
      g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${dmg}`, color: '#cddc39', life: 0.8, vy: -50 });
      s.life = 0;
    }
    for (const a of g.allies) {
      if (a.down || s.life <= 0) continue;
      if (Math.hypot(a.x - s.x, a.y - s.y) < a.radius + 6) {
        a.hp -= s.damage;
        s.life = 0;
        if (a.hp <= 0 && !a.down) {
          a.down = true;
          banner(`${a.name} IS DOWN`, 'the medic can revive them', '#ef9a9a');
        }
      }
    }
  }
  g.enemyShots = g.enemyShots.filter((s) => s.life > 0);

  // -- explosions animate
  for (const ex of g.explosions) ex.t -= dt;
  g.explosions = g.explosions.filter((ex) => ex.t > 0);

  // -- loot pickups
  for (const pk of g.pickups) {
    pk.t -= dt;
    if (Math.hypot(p.x - pk.x, p.y - pk.y) < p.radius + 14) {
      applyPickup(pk.type);
      pk.t = 0;
    }
  }
  g.pickups = g.pickups.filter((pk) => pk.t > 0);

  // -- buffs tick down
  g.buffs.rage = Math.max(0, g.buffs.rage - dt);
  g.buffs.shield = Math.max(0, g.buffs.shield - dt);

  // -- shell casings
  for (const cs of g.casings) {
    cs.x += cs.vx * dt;
    cs.y += cs.vy * dt;
    cs.vx *= 0.9;
    cs.vy *= 0.9;
    cs.rot += cs.rotV * dt;
    cs.life -= dt;
  }
  g.casings = g.casings.filter((cs) => cs.life > 0);

  // -- bullets
  for (const b of g.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life > 0 && shotBlocked(b.x, b.y)) {
      b.life = 0;
      spawnBlood(b.x, b.y, 3, '#9e9e9e'); // masonry dust
      continue;
    }
    const dir = Math.atan2(b.vy, b.vx);
    for (const z of g.zombies) {
      if (z.hp <= 0 || b.hit.has(z)) continue;
      if (Math.hypot(z.x - b.x, z.y - b.y) < z.radius + 3) {
        const crit = !b.friendly && Math.random() < d.critChance;
        const rage = !b.friendly && g.buffs.rage > 0 ? 2 : 1;
        const dmg = Math.round(b.damage * (crit ? 2 : 1) * rage);
        z.hp -= dmg;
        z.flash = 0.08;
        b.hit.add(z);
        if (b.hit.size >= b.pierce) b.life = 0;
        spawnBlood(b.x, b.y, 6, '#7b1d1d', dir);
        if (!b.friendly) {
          g.dmgNumbers.push({
            x: z.x + (Math.random() - 0.5) * 16, y: z.y - z.radius,
            txt: crit ? `${dmg}!` : `${dmg}`,
            color: crit ? '#ffd740' : '#fff',
            life: crit ? 1 : 0.7, vy: -60,
          });
        }
        if (z.hp <= 0) killZombie(z, dir);
        if (b.life <= 0) break;
      }
    }
    // stray player fire can hit civilians — gore, no reward
    if (!b.friendly && b.life > 0) {
      for (const c of g.civilians) {
        if (c.dead) continue;
        if (Math.hypot(c.x - b.x, c.y - b.y) < c.radius + 3) {
          c.hp -= b.damage;
          b.life = 0;
          spawnBlood(b.x, b.y, 6, '#c62828', dir);
          if (c.hp <= 0) {
            c.dead = true;
            g.score = Math.max(0, g.score - 50);
            g.dmgNumbers.push({ x: c.x, y: c.y - 16, txt: '-50 CIVILIAN', color: '#ef5350', life: 1.1, vy: -40 });
          }
          break;
        }
      }
    }
  }
  g.bullets = g.bullets.filter(
    (b) => b.life > 0 && b.x > -50 && b.x < g.world.w + 50 && b.y > -50 && b.y < g.world.h + 50
  );
  g.zombies = g.zombies.filter((z) => z.hp > 0);

  // -- scrap pickups
  for (const s of g.scraps) {
    const dist = Math.hypot(p.x - s.x, p.y - s.y);
    if (dist < 90) {
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

  // -- particles / gibs / corpses / damage numbers
  for (const pa of g.particles) {
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.vx *= 0.9;
    pa.vy *= 0.9;
    pa.life -= dt;
  }
  g.particles = g.particles.filter((pa) => pa.life > 0);
  for (const gb of g.gibs) {
    gb.x += gb.vx * dt;
    gb.y += gb.vy * dt;
    gb.vx *= 0.88;
    gb.vy *= 0.88;
    gb.rot += gb.rotV * dt;
    gb.life -= dt;
    if (gb.life <= 0) {
      decalCtx.fillStyle = 'rgba(80, 10, 10, 0.6)';
      decalCtx.fillRect(gb.x - gb.size / 2, gb.y - gb.size / 2, gb.size, gb.size);
    }
  }
  g.gibs = g.gibs.filter((gb) => gb.life > 0);
  for (const co of g.corpses) co.t -= dt;
  g.corpses = g.corpses.filter((co) => co.t > 0);
  for (const n of g.dmgNumbers) {
    n.y += n.vy * dt;
    n.life -= dt;
  }
  g.dmgNumbers = g.dmgNumbers.filter((n) => n.life > 0);
  for (const sb of screenBlood) sb.alpha -= dt * 0.12;
  screenBlood = screenBlood.filter((sb) => sb.alpha > 0.02);
  for (const rl of radioLines) rl.t -= dt;
  radioLines = radioLines.filter((rl) => rl.t > 0);

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

function killZombie(z, dirAngle) {
  const g = game;
  if (z._dead) return;
  z._dead = true;
  g.score += z.score;
  g.kills++;
  // 22% of kills pop the head clean off
  if (Math.random() < 0.22) {
    g.score += 5;
    g.dmgNumbers.push({ x: z.x, y: z.y - z.radius - 10, txt: 'HEADSHOT', color: '#ff5252', life: 1.1, vy: -55 });
    const ha = (dirAngle ?? 0) + (Math.random() - 0.5) * 0.8;
    g.gibs.push({
      x: z.x, y: z.y,
      vx: Math.cos(ha) * 420, vy: Math.sin(ha) * 420,
      rot: 0, rotV: 18, size: z.radius * 0.55, color: z.color,
      life: 0.9, head: true,
    });
    addScreenBlood(1.2);
    sfx.playSquelch();
  }
  // exploders go off when shot
  if (z.explodes) explode(z.x, z.y, z.explodes.radius, z.damage * 2.2, true);
  dropLoot(z.x, z.y, z.type === 'brute' || z.type === 'boss');
  goreKill(z.x, z.y, z.radius, dirAngle, z.type === 'boss' || z.type === 'brute');
  g.corpses.push({ x: z.x, y: z.y, angle: dirAngle ?? Math.random() * Math.PI * 2, type: z.type, radius: z.radius, t: 12 });
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
  const ups = grantXp(char, z.score);
  if (ups > 0) {
    sfx.playLevelUp();
    banner(`LEVEL ${char.level}`, `+${ups * 3} attribute points — press TAB`, '#64b5f6');
  }
}

// ---- render: world -------------------------------------------------------------

function updateCamera() {
  const g = game;
  cam.x = Math.max(0, Math.min(g.world.w - canvas.width, g.player.x - canvas.width / 2));
  cam.y = Math.max(0, Math.min(g.world.h - canvas.height, g.player.y - canvas.height / 2));
  if (g.world.w < canvas.width) cam.x = (g.world.w - canvas.width) / 2;
  if (g.world.h < canvas.height) cam.y = (g.world.h - canvas.height) / 2;
}

function drawCoverImage(img, alpha = 1) {
  const s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawGround() {
  const g = game;
  ctx.fillStyle = '#0b0d0e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ground = getImage(level().ground);
  const tile = 256;
  if (ground) {
    ctx.globalAlpha = 0.35;
    const x0 = Math.floor(cam.x / tile) * tile;
    const y0 = Math.floor(cam.y / tile) * tile;
    for (let x = x0; x < cam.x + canvas.width; x += tile)
      for (let y = y0; y < cam.y + canvas.height; y += tile)
        ctx.drawImage(ground, x, y, tile, tile);
    ctx.globalAlpha = 1;
  }
  // roads through the city / base
  const lv = level();
  if (lv.key === 'city' || lv.key === 'base') {
    const roadW = 150;
    ctx.fillStyle = 'rgba(24,26,30,0.85)';
    ctx.fillRect(0, g.world.h / 2 - roadW / 2, g.world.w, roadW);
    ctx.fillRect(g.world.w / 2 - roadW / 2, 0, roadW, g.world.h);
    // dashed lane markings
    ctx.fillStyle = 'rgba(201,180,88,0.5)';
    for (let x = 20; x < g.world.w; x += 90) ctx.fillRect(x, g.world.h / 2 - 3, 45, 6);
    for (let y = 20; y < g.world.h; y += 90) ctx.fillRect(g.world.w / 2 - 3, y, 6, 45);
  }
  // world boundary
  ctx.strokeStyle = 'rgba(229,57,53,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, g.world.w - 4, g.world.h - 4);
  ctx.drawImage(decalCanvas, 0, 0);
  drawProps();
}

const CAR_COLORS = ['#4e4448', '#3e4a55', '#5a4a3a', '#46524a', '#52404f'];

function drawProps() {
  for (const pr of game.props) {
    // skip props far outside the camera
    if (pr.x + pr.w < cam.x - 60 || pr.x > cam.x + canvas.width + 60 ||
        pr.y + pr.h < cam.y - 60 || pr.y > cam.y + canvas.height + 60) continue;
    // drop shadow sells the height of tall structures
    if (!pr.low) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(pr.x + 7, pr.y + 9, pr.w, pr.h);
    }
    if (pr.kind === 'building' || pr.kind === 'crypt' || pr.kind === 'bunker') {
      const body = { building: '#181c23', crypt: '#262b26', bunker: '#22281f' }[pr.kind];
      const edge = { building: '#39424e', crypt: '#3e463e', bunker: '#3c4434' }[pr.kind];
      ctx.fillStyle = body;
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 3;
      ctx.strokeRect(pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3);
      if (pr.kind === 'building') {
        // rooftop window/vent grid, a few windows still lit
        for (let wx = pr.x + 14; wx < pr.x + pr.w - 22; wx += 26) {
          for (let wy = pr.y + 14; wy < pr.y + pr.h - 22; wy += 26) {
            const lit = ((wx * 13 + wy * 7 + pr.seed * 1000) | 0) % 17 === 0;
            ctx.fillStyle = lit ? '#5d4a1e' : '#222a35';
            ctx.fillRect(wx, wy, 12, 12);
          }
        }
      } else if (pr.kind === 'crypt') {
        ctx.fillStyle = '#3e463e';
        ctx.fillRect(pr.x + pr.w / 2 - 4, pr.y + 12, 8, pr.h - 24);
        ctx.fillRect(pr.x + pr.w / 2 - 14, pr.y + 24, 28, 8);
      } else {
        ctx.fillStyle = 'rgba(255,193,7,0.25)';
        for (let i = 0; i < 4; i++) ctx.fillRect(pr.x + 6 + i * 16, pr.y + 6, 8, 8);
      }
    } else if (pr.kind === 'car') {
      ctx.fillStyle = CAR_COLORS[(pr.seed * CAR_COLORS.length) | 0];
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#11151a';
      const horizontal = pr.w > pr.h;
      if (horizontal) ctx.fillRect(pr.x + pr.w * 0.22, pr.y + 4, pr.w * 0.2, pr.h - 8);
      else ctx.fillRect(pr.x + 4, pr.y + pr.h * 0.22, pr.w - 8, pr.h * 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
    } else if (pr.kind === 'grave') {
      ctx.fillStyle = '#494f56';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#5b626a';
      ctx.fillRect(pr.x, pr.y, pr.w, 6);
    } else if (pr.kind === 'pipe') {
      ctx.fillStyle = '#34444c';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#46565e';
      const along = pr.w > pr.h;
      for (let i = 12; i < (along ? pr.w : pr.h) - 8; i += 34) {
        if (along) ctx.fillRect(pr.x + i, pr.y + 3, 5, pr.h - 6);
        else ctx.fillRect(pr.x + 3, pr.y + i, pr.w - 6, 5);
      }
    } else if (pr.kind === 'gurney') {
      ctx.fillStyle = '#7c858d';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#aeb6bd';
      ctx.fillRect(pr.x + 4, pr.y + 6, pr.w - 8, pr.h - 12);
      ctx.fillStyle = 'rgba(123,29,29,0.5)';
      ctx.fillRect(pr.x + 6, pr.y + pr.h * 0.3, pr.w - 12, 7);
    } else if (pr.kind === 'cabinet') {
      ctx.fillStyle = '#566270';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = '#3b4550';
      ctx.strokeRect(pr.x + 4, pr.y + 4, pr.w - 8, pr.h - 8);
    } else if (pr.kind === 'sandbag') {
      ctx.fillStyle = '#675c3d';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#776b48';
      const seg = 18;
      for (let i = 2; i < pr.w - 4; i += seg) ctx.fillRect(pr.x + i, pr.y + 3, seg - 5, pr.h - 6);
    } else if (pr.kind === 'crate') {
      ctx.fillStyle = '#594732';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = '#6f5a40';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x + pr.w, pr.y + pr.h);
      ctx.moveTo(pr.x + pr.w, pr.y);
      ctx.lineTo(pr.x, pr.y + pr.h);
      ctx.stroke();
      ctx.strokeRect(pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3);
    }
  }
}

function drawCorpse(co) {
  ctx.save();
  ctx.translate(co.x, co.y);
  ctx.rotate(co.angle);
  ctx.globalAlpha = Math.min(1, co.t / 2) * 0.8;
  const sprite = SPRITES[co.type];
  if (sprite) {
    ctx.filter = 'brightness(0.4) saturate(0.6)';
    drawSprite(sprite, co.radius * 3.0);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#3e2723';
    ctx.beginPath();
    ctx.ellipse(0, 0, co.radius, co.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
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
  const { t: target } = zombieTarget(z);
  const a = Math.atan2(target.y - z.y, target.x - z.x);
  const sprite = SPRITES[z.type];
  if (sprite) {
    ctx.save();
    ctx.rotate(a + Math.sin(z.wobble * 2) * 0.08);
    drawSprite(sprite, z.radius * 3.2);
    ctx.restore();
  } else {
    ctx.fillStyle = z.color;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (z.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${z.flash * 7})`;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();
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

function drawCivilian(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle + Math.sin(c.wobble * 2) * 0.1);
  const sprite = SPRITES[c.sprite];
  if (sprite) drawSprite(sprite, c.radius * 3.0);
  else {
    ctx.fillStyle = '#ffe0b2';
    ctx.beginPath();
    ctx.arc(0, 0, c.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawAlly(a) {
  // medic healing aura
  if (a.healAura && !a.down) {
    ctx.strokeStyle = 'rgba(248,187,208,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.healAura, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(a.x, a.y);
  if (a.down) {
    ctx.globalAlpha = 0.55;
    ctx.rotate(0.6);
    const sprite = SPRITES[a.sprite || a.type];
    if (sprite) {
      ctx.filter = 'brightness(0.5)';
      drawSprite(sprite, a.radius * 3.2);
      ctx.filter = 'none';
    }
    ctx.restore();
    return;
  }
  ctx.rotate(a.angle);
  const sprite = SPRITES[a.sprite || a.type];
  if (sprite) drawSprite(sprite, a.radius * 3.4);
  else {
    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(0, 0, a.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // name + health
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = a.color;
  ctx.fillText(a.name, 0, -a.radius - 16);
  const w = a.radius * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-w / 2, -a.radius - 12, w, 3);
  ctx.fillStyle = a.color;
  ctx.fillRect(-w / 2, -a.radius - 12, (w * a.hp) / a.maxHp, 3);
  ctx.restore();
}

function drawPlayer() {
  const p = game.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  const sprite = SPRITES[heroById(char.heroId).sprite] || SPRITES[char.gender === 'f' ? 'player_f' : 'player'];
  if (sprite) {
    drawSprite(sprite, p.radius * 3.6);
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

// ---- render: HUD + screens -------------------------------------------------------

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
    ctx.font = 'bold 58px monospace';
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

function drawScreenBlood() {
  const p = game.player;
  const d = derived(char);
  for (const sb of screenBlood) {
    const x = sb.fx * canvas.width;
    const y = sb.fy * canvas.height;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, sb.r);
    grad.addColorStop(0, `rgba(140,10,10,${sb.alpha})`);
    grad.addColorStop(0.6, `rgba(120,8,8,${sb.alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - sb.r, y - sb.r, sb.r * 2, sb.r * 2);
  }
  // low-HP pulsing red frame
  const frac = p.hp / d.maxHp;
  if (frac < 0.4) {
    const pulse = (0.4 - frac) * (1.4 + Math.sin(performance.now() / 180) * 0.5);
    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.3,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(150,0,0,${Math.min(0.7, pulse)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(183,28,28,${p.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawMinimap() {
  const g = game;
  const mw = 170, mh = Math.round(170 * (g.world.h / g.world.w));
  const mx = canvas.width - mw - 20, my = 40;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = '#37474f';
  ctx.strokeRect(mx, my, mw, mh);
  const sx = mw / g.world.w, sy = mh / g.world.h;
  const dot = (x, y, color, r = 2) => {
    ctx.fillStyle = color;
    ctx.fillRect(mx + x * sx - r / 2, my + y * sy - r / 2, r, r);
  };
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (const pr of g.props) {
    if (!pr.low) ctx.fillRect(mx + pr.x * sx, my + pr.y * sy, Math.max(1, pr.w * sx), Math.max(1, pr.h * sy));
  }
  for (const c of g.civilians) dot(c.x, c.y, '#ffe082');
  for (const a of g.allies) if (!a.down) dot(a.x, a.y, a.color, 3);
  for (const z of g.zombies) dot(z.x, z.y, z.type === 'boss' ? '#e040fb' : '#ef5350', z.type === 'boss' ? 4 : 2);
  dot(g.player.x, g.player.y, '#fff', 4);
  // camera view rect
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, canvas.width * sx, canvas.height * sy);
  ctx.restore();
}

function drawHUD() {
  const p = game.player;
  const d = derived(char);
  const ws = weaponStats(char, p.weapon);
  const lv = level();
  ctx.save();
  ctx.font = '14px monospace';
  ctx.textBaseline = 'top';

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 20, 220, 18);
  ctx.fillStyle = p.hp > d.maxHp * 0.3 ? '#66bb6a' : '#ef5350';
  ctx.fillRect(20, 20, 220 * Math.max(0, p.hp / d.maxHp), 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.max(0, Math.ceil(p.hp))}/${d.maxHp}`, 26, 22);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 44, 220, 8);
  ctx.fillStyle = '#ffee58';
  ctx.fillRect(20, 44, 220 * p.stamina, 8);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 58, 220, 10);
  ctx.fillStyle = game.higgs.charge >= 1 ? '#42a5f5' : '#1e5a8a';
  ctx.fillRect(20, 58, 220 * game.higgs.charge, 10);
  ctx.fillStyle = '#bbdefb';
  ctx.fillText(game.higgs.charge >= 1 ? 'HIGGS FIELD READY [E/Ⓨ]' : 'HIGGS CHARGING…', 20, 72);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 94, 220, 10);
  ctx.fillStyle = '#ab47bc';
  ctx.fillRect(20, 94, 220 * Math.min(1, char.xp / xpForLevel(char.level)), 10);
  ctx.fillStyle = '#ce93d8';
  ctx.fillText(`LV ${char.level}` + (char.unspent > 0 ? `  +${char.unspent} pts [TAB]` : ''), 20, 108);

  // squad readout
  let sy = 132;
  for (const a of game.allies) {
    ctx.fillStyle = a.down ? '#616161' : a.color;
    ctx.fillText(`${a.name} ${a.down ? 'DOWN' : Math.ceil(a.hp)}`, 20, sy);
    sy += 18;
  }

  ctx.fillStyle = '#ffb300';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`⚙ ${char.scrap}`, canvas.width - 24, 22);

  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#fff';
  const ammoTxt = p.reloading > 0 ? 'RELOADING…' : `${p.mags[p.weapon]} / ${ws.magSize}`;
  const tierTxt = ws.tier > 0 ? ` MK${ws.tier + 1}` : '';
  const favTxt = ws.favored ? '★' : '';
  ctx.fillText(`${favTxt}${ws.name}${tierTxt}  ${ammoTxt}`, canvas.width - 24, canvas.height - 70);
  // active loot buffs
  let bx = canvas.width - 24;
  if (game.buffs.rage > 0) {
    ctx.fillStyle = '#ff7043';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`RAGE ${Math.ceil(game.buffs.rage)}s`, bx, canvas.height - 96);
    bx -= 110;
  }
  if (game.buffs.shield > 0) {
    ctx.fillStyle = '#42a5f5';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`SHIELD ${Math.ceil(game.buffs.shield)}s`, bx, canvas.height - 96);
  }
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  const keys = ownedList().map((w) => `[${WEAPONS[w].key}]${WEAPONS[w].name}`).join(' ');
  ctx.fillText(`${keys}  [R]RELOAD [TAB]CHAR`, canvas.width - 24, canvas.height - 40);
  if (gamepad.connected) {
    ctx.fillStyle = '#80cbc4';
    ctx.fillText('🎮 controller connected — LS move · RS aim · RT fire · LB/RB weapons · Ⓧ reload · Ⓨ higgs', canvas.width - 24, canvas.height - 22);
  }

  ctx.textAlign = 'center';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText(`${lv.name} — WAVE ${game.wave}/${lv.waves}`, canvas.width / 2, 22);
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.fillText(`SCORE ${game.score}   ZOMBIES ${game.zombies.length + game.spawnQueue.length}   CIVILIANS ${game.civilians.length}`, canvas.width / 2, 46);
  // squad radio chatter, bottom-left
  ctx.textAlign = 'left';
  ctx.font = '13px monospace';
  let ry = canvas.height - 30;
  for (let i = radioLines.length - 1; i >= 0; i--) {
    const rl = radioLines[i];
    ctx.globalAlpha = Math.min(1, rl.t);
    ctx.fillStyle = rl.color;
    ctx.fillText(rl.text, 20, ry);
    ry -= 19;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  drawMinimap();
}

function drawPanelButton(x, y, w, h, label, sub, cost, enabled, cb) {
  const idx = uiButtons.length;
  const focused = gamepad.connected && idx === gpFocus;
  ctx.fillStyle = enabled ? 'rgba(30,34,40,0.92)' : 'rgba(20,22,25,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = focused ? '#ffd54f' : enabled ? '#546e7a' : '#37474f';
  ctx.lineWidth = focused ? 2 : 1;
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
  ctx.fillText(`${heroById(char.heroId).name} — LEVEL ${char.level}`, x + 24, y + 20);
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
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = canAdd ? '#2e7d32' : '#1b3a1d';
    ctx.fillRect(bx, yy, 46, 40);
    if (focused) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, yy, 46, 40);
    }
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
  ctx.fillText('[TAB/Ⓑ] close', x + 24, y + h - 28);
}

function drawShop() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const intro = getImage(level().intro);
  if (intro) drawCoverImage(intro, 0.25);

  const cx = canvas.width / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 40px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.shadowColor = '#ffd54f';
  ctx.shadowBlur = 18;
  ctx.fillText(`${level().name} CLEARED`, cx, 36);
  ctx.shadowBlur = 0;
  ctx.font = '15px monospace';
  ctx.fillStyle = '#e0e0e0';
  ctx.fillText(`REQUISITIONS — spend scrap before deploying    ⚙ ${char.scrap}`, cx, 88);

  const items = shopCatalog(char, char.hp ?? 0);
  const colW = 380, rowH = 56, gap = 11;
  const cols = canvas.width > 860 ? 2 : 1;
  const gridW = cols * colW + (cols - 1) * gap;
  const x0 = (canvas.width - gridW) / 2;
  const y0 = 122;
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
  const deployY = y0 + Math.ceil(items.length / cols) * (rowH + gap) + 18;
  const dw = 420;
  const idx = uiButtons.length;
  const focused = gamepad.connected && idx === gpFocus;
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#102316';
  ctx.fillRect(cx - dw / 2, deployY, dw, 54);
  ctx.strokeStyle = focused ? '#ffd54f' : '#43a047';
  ctx.lineWidth = focused ? 3 : 1;
  ctx.strokeRect(cx - dw / 2, deployY, dw, 54);
  ctx.fillStyle = '#a5d6a7';
  ctx.textAlign = 'center';
  ctx.fillText(lastLevel ? 'FINISH THE CAMPAIGN ▶' : `DEPLOY: ${LEVELS[char.campaignLevel + 1].name} ▶`, cx, deployY + 16);
  button(cx - dw / 2, deployY, dw, 54, () => {
    char.campaignLevel++;
    char.hp = Math.min(char.hp ?? derived(char).maxHp, derived(char).maxHp);
    saveCharacter(char);
    if (char.campaignLevel >= LEVELS.length) {
      startCutscene(VICTORY_SHOTS, () => {
        state = 'victory';
        sfx.playFanfare();
      });
    } else if (PRE_CUTSCENES[char.campaignLevel]) {
      startCutscene(PRE_CUTSCENES[char.campaignLevel], enterLevelIntro);
    } else {
      enterLevelIntro();
    }
  });

  ctx.font = '13px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[TAB] character sheet — 🎮 d-pad to browse, Ⓐ to buy', cx, deployY + 66);
}

let selectMode = 'hero'; // 'hero' picks the player, 'partner' picks the companion

function finishSelect() {
  // hero-aware opening: the cinematic closes on the survivor you chose
  const h = heroById(char.heroId);
  const heroShot = {
    img: 'title-bg.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.15,
    lines: [`${h.name} — ${h.role.toUpperCase()}.`, h.story],
  };
  startCutscene([...OPENING_SHOTS, heroShot], enterLevelIntro);
}

function drawCharSelect() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (titleArt.complete && titleArt.naturalWidth) drawCoverImage(titleArt, 0.18);
  const cx = canvas.width / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 34px monospace';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 18;
  ctx.fillText(selectMode === 'hero' ? 'CHOOSE YOUR SURVIVOR' : 'CHOOSE A PARTNER', cx, 34);
  ctx.shadowBlur = 0;

  // 5 x 2 roster grid, scaled to fit the window
  const cols = 5, rows = 2;
  const gap = 14;
  const cw = Math.min(215, (canvas.width - 80 - gap * (cols - 1)) / cols);
  const chh = Math.min(250, (canvas.height - 200 - gap) / rows);
  const gridW = cols * cw + (cols - 1) * gap;
  const x0 = (canvas.width - gridW) / 2;
  const y0 = 100;
  let hovered = null;
  HEROES.forEach((hero, i) => {
    const isOwnHero = selectMode === 'partner' && hero.id === char.heroId;
    const x = x0 + (i % cols) * (cw + gap);
    const y = y0 + Math.floor(i / cols) * (chh + gap);
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    const m = input.mouse;
    if (m.x >= x && m.x <= x + cw && m.y >= y && m.y <= y + chh) hovered = hero;
    ctx.fillStyle = isOwnHero ? 'rgba(12,14,17,0.94)' : 'rgba(20,24,30,0.94)';
    ctx.fillRect(x, y, cw, chh);
    ctx.strokeStyle = focused ? '#ffd54f' : isOwnHero ? '#2c343c' : '#546e7a';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(x, y, cw, chh);
    const sprite = SPRITES[hero.sprite];
    if (sprite) {
      // drawn upright (sprites face right), fitted inside the card
      ctx.save();
      ctx.translate(x + cw / 2, y + chh * 0.42);
      if (isOwnHero) ctx.globalAlpha = 0.3;
      drawSprite(sprite, Math.min(cw, chh) * 0.62);
      ctx.restore();
    } else {
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(x + cw / 2, y + chh * 0.42, 30, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = isOwnHero ? '#546e7a' : '#fff';
    ctx.fillText(isOwnHero ? 'YOU' : hero.name, x + cw / 2, y + chh - 56, cw - 10);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#90a4ae';
    ctx.fillText(hero.role, x + cw / 2, y + chh - 40, cw - 10);
    ctx.fillStyle = '#80cbc4';
    ctx.fillText(bonusText(hero), x + cw / 2, y + chh - 24, cw - 10);
    button(x, y, cw, chh, () => {
      if (selectMode === 'hero') {
        char.heroId = hero.id;
        char.gender = hero.sprite === 'player_f' ? 'f' : 'm';
        saveCharacter(char);
        selectMode = 'partner';
        gpFocus = 0;
      } else {
        char.partnerId = hero.id;
        saveCharacter(char);
        finishSelect();
      }
    }, !isOwnHero);
  });

  const footY = y0 + rows * chh + gap + 10;
  if (selectMode === 'partner') {
    // lone-wolf option
    const bw = 280;
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = 'rgba(30,22,22,0.94)';
    ctx.fillRect(cx - bw / 2, footY, bw, 40);
    ctx.strokeStyle = focused ? '#ffd54f' : '#7a5454';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(cx - bw / 2, footY, bw, 40);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ef9a9a';
    ctx.fillText('GO ALONE — LONE WOLF', cx, footY + 12);
    button(cx - bw / 2, footY, bw, 40, () => {
      char.partnerId = null;
      saveCharacter(char);
      finishSelect();
    });
  }

  // backstory panel for the hovered / focused survivor
  const detail = hovered || (gamepad.connected && HEROES[Math.min(gpFocus, HEROES.length - 1)]) || null;
  const panelY = footY + 48;
  if (detail) {
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(detail.name + ' — ' + detail.role.toUpperCase(), cx, panelY);
    ctx.font = '13px monospace';
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText(detail.story, cx, panelY + 20, canvas.width - 120);
  } else {
    ctx.font = '13px monospace';
    ctx.fillStyle = '#9e9e9e';
    ctx.fillText(
      selectMode === 'hero'
        ? 'hover a survivor for their story — bonuses are permanent, favored weapon +15% damage'
        : 'your partner fights beside you for the whole campaign',
      cx, panelY
    );
  }
  ctx.restore();
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
    const zoom = 1.06 + Math.sin(t * 0.15) * 0.05;
    const s = Math.max(canvas.width / titleArt.naturalWidth, canvas.height / titleArt.naturalHeight) * zoom;
    const w = titleArt.naturalWidth * s;
    const h = titleArt.naturalHeight * s;
    ctx.drawImage(titleArt, (canvas.width - w) / 2 + Math.sin(t * 0.1) * 18, (canvas.height - h) / 2, w, h);

    for (let i = 0; i < 5; i++) {
      const fx = ((t * 18 + i * 419) % (canvas.width + 500)) - 250;
      const fy = cy + Math.sin(t * 0.2 + i * 2.1) * canvas.height * 0.3;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, 260);
      grad.addColorStop(0, 'rgba(20,24,30,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const flicker = Math.sin(t * 1.7) > 0.96 ? 0.08 : 0;
    if (flicker) {
      ctx.fillStyle = `rgba(255,23,68,${flicker})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (SPRITES.walker) {
      ctx.save();
      ctx.filter = 'brightness(0)';
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 4; i++) {
        const zx = ((t * (22 + i * 7) + i * 457) % (canvas.width + 240)) - 120;
        const zy = canvas.height - 195 - (i % 2) * 14;
        const size = 64 + (i % 3) * 18;
        ctx.save();
        ctx.translate(zx, zy);
        ctx.rotate(Math.sin(t * 4 + i) * 0.05);
        drawSprite(SPRITES.walker, size);
        ctx.restore();
      }
      ctx.restore();
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, canvas.height - 170, canvas.width, 170);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '15px monospace';
    ctx.fillStyle = '#cfcfcf';
    ctx.fillText('WASD/LS move · mouse/RS aim · 1-6 weapons · R reload · E higgs · TAB character · 🎮 Xbox supported', cx, canvas.height - 140);
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

// ---- render dispatch -----------------------------------------------------------

let lastFrame = performance.now();

function render(dt) {
  uiButtons = [];
  if (state === 'title') return drawTitle();
  if (state === 'charselect') return drawCharSelect();
  if (state === 'cutscene') return drawCutscene(dt);
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

  updateCamera();
  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
  drawGround();
  for (const co of game.corpses) drawCorpse(co);
  drawHiggs();
  drawScraps();
  for (const c of game.civilians) drawCivilian(c);
  for (const a of game.allies) drawAlly(a);
  for (const z of game.zombies) drawZombie(z);
  for (const b of game.bullets) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
    ctx.stroke();
  }
  // spitter acid / rogue rifle fire
  for (const s of game.enemyShots) {
    if (s.kind === 'bullet') {
      ctx.strokeStyle = '#ff8a80';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.014, s.y - s.vy * 0.014);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#aeea00';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(174,234,0,0.35)';
    ctx.beginPath();
    ctx.arc(s.x - s.vx * 0.02, s.y - s.vy * 0.02, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // loot pickups (blinking when about to expire)
  for (const pk of game.pickups) {
    if (pk.t < 5 && Math.floor(pk.t * 6) % 2 === 0) continue;
    ctx.save();
    ctx.translate(pk.x, pk.y);
    const colors = { medkit: '#ef5350', ammo: '#ffca28', shield: '#42a5f5', rage: '#ff7043' };
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeStyle = colors[pk.type];
    ctx.strokeRect(-11, -11, 22, 22);
    ctx.fillStyle = colors[pk.type];
    if (pk.type === 'medkit') {
      ctx.fillRect(-7, -2, 14, 4);
      ctx.fillRect(-2, -7, 4, 14);
    } else if (pk.type === 'ammo') {
      ctx.fillRect(-6, -5, 4, 10);
      ctx.fillRect(-1, -5, 4, 10);
      ctx.fillRect(4, -5, 4, 10);
    } else if (pk.type === 'shield') {
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 1);
    }
    ctx.restore();
  }
  drawPlayer();
  // explosions: flash + expanding ring (screams are a pale ring only)
  for (const ex of game.explosions) {
    const t = 1 - ex.t / 0.45;
    if (ex.scream) {
      ctx.strokeStyle = `rgba(224,224,224,${(1 - t) * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.r * t, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = `rgba(255,171,64,${(1 - t) * 0.5})`;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.r * (0.4 + t * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,224,130,${1 - t})`;
    ctx.lineWidth = 6 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.r * (0.3 + t * 1.1), 0, Math.PI * 2);
    ctx.stroke();
  }
  // shell casings
  for (const cs of game.casings) {
    ctx.save();
    ctx.translate(cs.x, cs.y);
    ctx.rotate(cs.rot);
    ctx.globalAlpha = Math.min(1, cs.life * 3);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(-2.5, -1, 5, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const gb of game.gibs) {
    ctx.save();
    ctx.translate(gb.x, gb.y);
    ctx.rotate(gb.rot);
    ctx.fillStyle = gb.color;
    if (gb.head) {
      // a popped head tumbling away, trailing blood
      ctx.beginPath();
      ctx.arc(0, 0, gb.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7b1d1d';
      ctx.fillRect(-gb.size, -2, gb.size, 4);
    } else {
      ctx.fillRect(-gb.size / 2, -gb.size / 2, gb.size, gb.size);
    }
    ctx.restore();
  }
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
  ctx.restore();

  // screen-space layers
  if (level().tint) {
    ctx.fillStyle = level().tint;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawScreenBlood();
  drawHUD();
  drawBanners(dt);
  if (charSheetOpen) {
    uiButtons = [];
    drawCharSheet();
  }
  if (state === 'gameover') drawGameOver();
}

// ---- main loop --------------------------------------------------------------------

function handleClicks() {
  if (!wasPressed('mouse')) return false;
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
  pollGamepad();

  // gamepad UI focus: d-pad browses buttons laid out last frame, A activates
  const uiState = charSheetOpen || state === 'shop' || state === 'charselect';
  if (uiState && uiButtons.length) {
    if (gpPressed('down') || gpPressed('right')) gpFocus = (gpFocus + 1) % uiButtons.length;
    if (gpPressed('up') || gpPressed('left')) gpFocus = (gpFocus - 1 + uiButtons.length) % uiButtons.length;
    if (gpPressed('a')) {
      gpFocus = Math.min(gpFocus, uiButtons.length - 1);
      uiButtons[gpFocus]?.cb();
    }
  } else if (gpPressed('a')) {
    // A doubles as "click" on passive screens
    input.pressed.add('mouse');
  }
  if (gpPressed('b') && charSheetOpen) charSheetOpen = false;

  const uiClicked = uiState && handleClicks();
  if (uiClicked) input.pressed.delete('mouse');

  if (state === 'title') {
    if (wasPressed('n') && hasSave) {
      wipeSave();
      char = newCharacter();
      hasSave = false;
    }
    if (wasPressed('mouse')) {
      sfx.startMusic();
      const dbg = new URLSearchParams(location.search).get('debug');
      if (dbg === 'shop') {
        game = newGame();
        state = 'shop';
      } else if (dbg === 'victory') {
        state = 'victory';
      } else if (!char.seenIntro) {
        char.seenIntro = true;
        saveCharacter(char);
        gpFocus = 0;
        selectMode = 'hero';
        state = 'charselect';
      } else {
        enterLevelIntro();
      }
    }
  } else if (state === 'cutscene') {
    if (wasPressed('mouse')) advanceCutscene();
  } else if (state === 'levelintro') {
    if (wasPressed('mouse')) {
      if (briefingChars() < briefingTotal()) briefingStart = -1e9;
      else startLevel();
    }
  } else if (state === 'playing') {
    if (wasPressed('tab') || gpPressed('start')) charSheetOpen = !charSheetOpen;
    if (!charSheetOpen) update(dt); // char sheet pauses the game
  } else if (state === 'shop') {
    if (wasPressed('tab') || gpPressed('start')) charSheetOpen = !charSheetOpen;
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
