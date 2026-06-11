import { initInput, input, wasPressed, consumePressed } from './input.js';
import { WEAPONS, WEAPON_ORDER, AMMO_RESERVE } from './weapons.js';
import { spawnZombie, randomZombieType } from './zombies.js';
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

// logical viewport — the canvas backing store renders at devicePixelRatio
// for crisp HiDPI/4K output; all game code works in logical pixels
const view = { w: window.innerWidth, h: window.innerHeight };
let dpr = Math.min(2, window.devicePixelRatio || 1);

function resize() {
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
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
                    'crawler', 'screamer', 'rogue', 'cache', 'wreck', 'statue',
                    'granny', 'cop', 'hazmat', 'butcher', 'dog', 'stalker',
                    'drive_sports', 'drive_taxi', 'drive_police', 'drive_armored']) {
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

// draws a trimmed sprite centered at the origin, contained in maxW x maxH —
// keeps differently-shaped cutouts looking the same size on UI cards
function drawSpriteFit(sp, maxW, maxH) {
  const k = Math.min(maxW / sp.width, maxH / sp.height);
  ctx.drawImage(sp, (-sp.width * k) / 2, (-sp.height * k) / 2, sp.width * k, sp.height * k);
}

const titleArt = new Image();
titleArt.src = asset('title-bg.png');

// living title screen: the generated horde video loops behind the menu
const titleVideo = document.createElement('video');
titleVideo.src = asset('levels/horde-video.mp4');
titleVideo.muted = true;
titleVideo.loop = true;
titleVideo.playsInline = true;
titleVideo.play().catch(() => {});

// ---- state -----------------------------------------------------------------

const HIGGS = { radius: 190, slowFactor: 0.25, slowDuration: 5, knockback: 420 };
const SHIELD_COLORS = { blue: '#42a5f5', flame: '#ff7043', health: '#66bb6a' };
const WORLD_BASE = { w: 3400, h: 2300 };
// blood decals render at half resolution so huge worlds stay light on memory
const DECAL_SCALE = 0.5;

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
let shake = 0; // screen-shake magnitude, decays fast
let hitStopT = 0; // micro freeze-frames on big kills

function addShake(n) {
  shake = Math.min(24, shake + n);
}

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
  ctx.fillRect(0, 0, view.w, view.h);
  const prog = Math.min(1, cutscene.t / shot.duration);

  if (shot.img) {
    const img = getImage(shot.img);
    if (img) {
      const zoom = (shot.zoomFrom ?? 1) + ((shot.zoomTo ?? 1.1) - (shot.zoomFrom ?? 1)) * prog;
      const s = Math.max(view.w / img.naturalWidth, view.h / img.naturalHeight) * zoom;
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      const fade = Math.min(1, cutscene.t / 0.8, (shot.duration - cutscene.t) / 0.8);
      ctx.globalAlpha = Math.max(0, fade);
      ctx.drawImage(img, (view.w - w) / 2, (view.h - h) / 2, w, h);
      ctx.globalAlpha = 1;
    }
  }

  const bar = Math.round(view.h * 0.11);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, view.w, bar);
  ctx.fillRect(0, view.h - bar, view.w, bar);

  let budget = Math.floor(cutscene.t * 40);
  let yy = view.h - bar + 18;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '17px monospace';
  for (const line of shot.lines) {
    if (budget <= 0) break;
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(line.slice(0, budget), view.w / 2, yy);
    budget -= line.length;
    yy += 24;
  }
  ctx.textAlign = 'right';
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('click / Ⓐ to skip ▸', view.w - 20, 12);
  ctx.restore();

  if (cutscene.t >= shot.duration) advanceCutscene();
}

// ---- UI buttons -------------------------------------------------------------

let uiButtons = [];
function button(x, y, w, h, cb, enabled = true) {
  uiButtons.push({ x, y, w, h, cb, enabled });
}

function level() {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, char.campaignLevel | 0))];
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
  // prop counts scale with map area so huge maps stay dense
  const af = Math.min(3, (world.w * world.h) / (2400 * 1650));
  const doorCost = 40 + LEVELS.indexOf(lv) * 35;
  const fits = (x, y, w, h) => {
    if (x < 20 || y < 20 || x + w > world.w - 20 || y + h > world.h - 20) return false;
    // keep the spawn area clear
    if (x < cx + 240 && x + w > cx - 240 && y < cy + 240 && y + h > cy - 240) return false;
    for (const p of props) {
      if (x < p.x + p.w + 30 && x + w + 30 > p.x && y < p.y + p.h + 30 && y + h + 30 > p.y) return false;
    }
    return true;
  };
  const scatter = (n0, wMin, wMax, hMin, hMax, kind, low) => {
    const n = Math.round(n0 * af);
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
  // buildings you can walk into: floor + four walls with a paid door in the gap
  const emitEnterable = (x, y, w, h, kind) => {
    const T = 16; // wall thickness
    const doorW = 56;
    props.push({ x, y, w, h, kind: 'floor', low: true, seed: Math.random() });
    // the doorway needs a wall long enough to cut a gap into
    const validSides = [];
    if (w >= 170) validSides.push(0, 1);
    if (h >= 170) validSides.push(2, 3);
    if (!validSides.length) validSides.push(0);
    const side = validSides[Math.floor(Math.random() * validSides.length)];
    const gapAt = (len) => T + 20 + Math.random() * (len - doorW - 2 * T - 40);
    // top, bottom, left, right walls — one gets a doorway
    const walls = [];
    if (side === 0) {
      const g0 = x + gapAt(w);
      walls.push({ x, y, w: g0 - x, h: T }, { x: g0 + doorW, y, w: x + w - g0 - doorW, h: T });
      props.push({ x: g0, y, w: doorW, h: T, kind: 'door', locked: true, cost: doorCost, lootX: x + w / 2, lootY: y + h / 2 });
    } else walls.push({ x, y, w, h: T });
    if (side === 1) {
      const g0 = x + gapAt(w);
      walls.push({ x, y: y + h - T, w: g0 - x, h: T }, { x: g0 + doorW, y: y + h - T, w: x + w - g0 - doorW, h: T });
      props.push({ x: g0, y: y + h - T, w: doorW, h: T, kind: 'door', locked: true, cost: doorCost, lootX: x + w / 2, lootY: y + h / 2 });
    } else walls.push({ x, y: y + h - T, w, h: T });
    if (side === 2) {
      const g0 = y + gapAt(h);
      walls.push({ x, y, w: T, h: g0 - y }, { x, y: g0 + doorW, w: T, h: y + h - g0 - doorW });
      props.push({ x, y: g0, w: T, h: doorW, kind: 'door', locked: true, cost: doorCost, lootX: x + w / 2, lootY: y + h / 2 });
    } else walls.push({ x, y, w: T, h });
    if (side === 3) {
      const g0 = y + gapAt(h);
      walls.push({ x: x + w - T, y, w: T, h: g0 - y }, { x: x + w - T, y: g0 + doorW, w: T, h: y + h - g0 - doorW });
      props.push({ x: x + w - T, y: g0, w: T, h: doorW, kind: 'door', locked: true, cost: doorCost, lootX: x + w / 2, lootY: y + h / 2 });
    } else walls.push({ x: x + w - T, y, w: T, h });
    for (const wl of walls) {
      if (wl.w > 0 && wl.h > 0) props.push({ ...wl, kind: 'wall', low: false, seed: Math.random() });
    }
  };

  // apartment blocks / large structures hug the edges
  const edgeBlocks = (n0, kind, bw, bh) => {
    const n = Math.round(n0 * af);
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
        placeBlock(x, y, w, h, kind);
        i++;
      }
    }
  };
  // most buildings can be unlocked and looted
  const placeBlock = (x, y, w, h, kind) => {
    if ((kind === 'building' || kind === 'bunker' || kind === 'crypt') && Math.random() < 0.6) {
      emitEnterable(x, y, w, h, kind);
    } else {
      props.push({ x, y, w, h, kind, low: false, seed: Math.random() });
    }
  };
  // city blocks through the MIDDLE of the map, not just the edges
  const midBlocks = (n0, kind, bw, bh) => {
    const n = Math.round(n0 * af);
    for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
      const w = bw * (0.7 + Math.random() * 0.6);
      const h = bh * (0.7 + Math.random() * 0.6);
      const x = 120 + Math.random() * (world.w - w - 240);
      const y = 120 + Math.random() * (world.h - h - 240);
      if (fits(x, y, w, h)) {
        placeBlock(x, y, w, h, kind);
        i++;
      }
    }
  };
  switch (lv.key) {
    case 'city':
      edgeBlocks(9, 'building', 280, 180);
      midBlocks(7, 'building', 280, 180);
      scatter(16, 64, 80, 32, 40, 'car');
      scatter(6, 36, 48, 36, 48, 'crate', true);
      break;
    case 'graveyard':
      edgeBlocks(4, 'crypt', 180, 130);
      midBlocks(3, 'crypt', 180, 130);
      scatter(42, 24, 30, 34, 42, 'grave', true);
      break;
    case 'sewer':
      edgeBlocks(6, 'pipe', 340, 60);
      scatter(10, 200, 320, 44, 60, 'pipe');
      scatter(8, 40, 56, 40, 56, 'crate', true);
      break;
    case 'hospital':
      edgeBlocks(7, 'building', 260, 170);
      midBlocks(5, 'building', 260, 170);
      scatter(16, 30, 40, 62, 80, 'gurney', true);
      scatter(8, 44, 56, 44, 56, 'cabinet');
      break;
    case 'base':
      edgeBlocks(6, 'bunker', 240, 160);
      midBlocks(4, 'bunker', 240, 160);
      scatter(18, 36, 110, 30, 44, 'sandbag', true);
      scatter(12, 40, 56, 40, 56, 'crate', true);
      break;
    case 'mall':
      edgeBlocks(8, 'building', 280, 190);
      midBlocks(7, 'building', 260, 180);
      scatter(10, 36, 52, 36, 52, 'crate', true);
      scatter(8, 30, 42, 60, 84, 'gurney', true);
      break;
    case 'subway':
      edgeBlocks(5, 'pipe', 380, 64);
      midBlocks(4, 'building', 240, 150);
      scatter(12, 200, 340, 44, 60, 'pipe');
      scatter(8, 40, 56, 40, 56, 'crate', true);
      break;
    case 'prison':
      edgeBlocks(8, 'bunker', 250, 170);
      midBlocks(5, 'bunker', 230, 150);
      scatter(16, 36, 110, 30, 44, 'sandbag', true);
      break;
    case 'docks':
      midBlocks(9, 'cabinet', 200, 90); // container stacks
      scatter(14, 64, 90, 32, 44, 'car');
      scatter(12, 40, 60, 40, 60, 'crate', true);
      break;
    case 'rooftops':
      edgeBlocks(10, 'building', 300, 200);
      midBlocks(8, 'building', 260, 180);
      scatter(10, 36, 52, 36, 52, 'cabinet');
      break;
  }
  // one big landmark set-piece per map
  if (lv.key === 'city' || lv.key === 'base' || lv.key === 'docks') scatter(1 / af, 220, 260, 130, 160, 'wreck');
  if (lv.key === 'graveyard') scatter(1 / af, 120, 140, 120, 140, 'statue');
  return props;
}

// push a circle entity out of solid props (slides along walls)
function collideProps(e) {
  for (const pr of game.props) {
    if (pr.kind === 'floor') continue; // interiors are walkable
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

const PARTNER_LINES = ['Right behind you.', 'They just keep coming, huh.', 'Watch your six!', 'We make a good team.'];

// lore drops from secret caches, per level
const CACHE_LORE = {
  city: ['ECHO-6: "That stash... evac teams left those for survivors. Most never got opened."', 'ECHO-6: "Supply drop marker. Day one they thought this would be over in a week."'],
  graveyard: ['ECHO-6: "Gravediggers\' kit. They were burying the bitten before anyone said the word \'zombie\'."', 'ECHO-6: "Someone was living out there between the crypts. Hope they made it."'],
  sewer: ['ECHO-6: "Maintenance crews stashed gear down there when the tunnels were still safe."', 'ECHO-6: "That\'s a smuggler cache. The sewers were a highway before the runners moved in."'],
  hospital: ['ECHO-6: "Med supplies. St. Mercy staff hid them from the panic looting."', 'ECHO-6: "A nurse\'s go-bag. They stayed. All of them stayed."'],
  base: ['ECHO-6: "Delta\'s last requisitions. They never got to use them."', 'ECHO-6: "Hale\'s unit hid ammo dumps before the wall fell. She\'ll be glad you found one."'],
};

function squadBanter() {
  const g = game;
  const pool = [{ name: '', lines: BANTER.echo, color: '#80cbc4', echo: true }];
  for (const a of g.allies) {
    if (a.down) continue;
    pool.push({ name: a.name, lines: BANTER[a.type] || PARTNER_LINES, color: a.color });
  }
  const who = pool[Math.floor(Math.random() * pool.length)];
  const line = who.lines[Math.floor(Math.random() * who.lines.length)];
  radio(who.name, who.echo ? line : `${who.name}: "${line}"`, who.color);
}

// mid-game story drip: a line at each wave start, keyed by level
const LEVEL_RADIO = {
  city: ['ECHO-6: "Your block went dark last Tuesday. You\'re the first signal since."', 'ECHO-6: "There\'s a kid\'s bike on every lawn down there. Don\'t look too long."'],
  graveyard: ['ECHO-6: "Old Harrow\'s caretaker buried 300 in a week. Then he buried himself."', 'ECHO-6: "The chapel bell rings sometimes. Nobody\'s in the tower."'],
  sewer: ['ECHO-6: "Maintenance crew 9 went down there day two. Their radios still click."', 'ECHO-6: "The runners learned the tunnels faster than we mapped them."'],
  hospital: ['ECHO-6: "Patient zero\'s chart just says \'bite, canine?\'. It wasn\'t canine."', 'ECHO-6: "The ICU generators are still running. Someone keeps fueling them."'],
  base: ['ECHO-6: "Delta\'s last order was \'hold\'. They held for nine days."', 'ECHO-6: "I\'m in the comms tower. If this goes wrong... it was good working with you."'],
  mall: ['ECHO-6: "Mall security broadcast loops every hour. It\'s started adding words."', 'ECHO-6: "Food court\'s a nest. The fountain... don\'t drink the fountain."'],
  subway: ['ECHO-6: "The 3:14 to Riverside never made its stop. It\'s still moving somewhere."', 'ECHO-6: "They go quiet when a train horn echoes. All of them. At once."'],
  prison: ['ECHO-6: "Blackgate\'s warden filed one last report: \'they remember their cells\'."', 'ECHO-6: "Solitary wing is welded shut from the INSIDE."'],
  docks: ['ECHO-6: "The VERA\'s manifest listed machine parts. The crates were breathing."', 'ECHO-6: "Coast guard scuttled three ships at the mouth. It wasn\'t enough."'],
  rooftops: ['ECHO-6: "Survivors on the north tower spotted the nest. Then it spotted them."', 'ECHO-6: "After this... I\'m coming down from this tower. Save me a rooftop."'],
};

const ALLY_DEFS = {
  soldier: { name: 'SGT. REYES', hp: 160, damage: 26, fireInterval: 0.22, range: 620, color: '#81c784', mag: 30, reloadTime: 2.2 },
  medic: { name: 'DOC OKAFOR', hp: 140, damage: 18, fireInterval: 0.5, range: 420, color: '#f8bbd0', healAura: 220, healRate: 4, mag: 12, reloadTime: 1.8 },
  commander: { name: 'CDR. HALE', hp: 220, damage: 60, fireInterval: 0.6, range: 700, color: '#ffcc80', mag: 6, reloadTime: 2.4 },
  demo: { name: '"BOOM" OSORIO', hp: 200, damage: 20, fireInterval: 0.45, range: 520, color: '#ffab40', grenade: { interval: 4.5, radius: 95, damage: 130 }, mag: 10, reloadTime: 2.0 },
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
      reserve: { ...AMMO_RESERVE },
      armorHP: derived(char).armor * 40,
      armorMax: Math.max(1, derived(char).armor * 40),
      fireCooldown: 0,
      reloading: 0,
      muzzleFlash: 0,
      hurtFlash: 0,
      angle: 0,
      vx: 0, vy: 0,
      dashT: 0, dashCooldown: 0, invulnUntil: 0,
      walkPhase: 0, stepAcc: 0,
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
    caches: [],
    rogueBannerShown: false,
    frenzyTimer: 23,
    frenzyUntil: 0,
    throwables: [],
    strikes: [],
    lastStandUsed: false,
    meleeGraceUntil: 0,
    driveStart: 0,
    driveCars: [],
    driveTimer: 8 + Math.random() * 10,
    smokes: [],
    decoy: null,
    streak: 0,
    streakFired: {},
    nadeSel: 'frag',
    killT: 0,
    killMarks: [],
    combo: 0,
    comboT: 0,
    comboBest: 0,
    shots: 0,
    hits: 0,
    superBoss: null,
    survivalT: null, // wave-3 countdown
    survivalPool: 0, // how many of the 5,000 are still unspawned
    hordeEventAt: -1,
  };
  // hidden supply caches tucked far from the spawn — explore to find them
  for (let i = 0; i < 3; i++) {
    let x, y, tries = 0;
    do {
      x = 120 + Math.random() * (world.w - 240);
      y = 120 + Math.random() * (world.h - 240);
      tries++;
    } while (Math.hypot(x - world.w / 2, y - world.h / 2) < 700 && tries < 40);
    const cache = { x, y, radius: 16, taken: false, pulse: Math.random() * Math.PI * 2 };
    g.caches.push(cache);
  }
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
    partner.mag = partner.magSize = 24;
    partner.color = '#b39ddb';
    partner.shield = 80;
    partner.shieldMax = 80;
    partner.shieldHitT = 99;
    partner.followUntil = 0;
    partner.roamT = 0;
    partner.roamTarget = null;
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
    mag: def.mag, magSize: def.mag, reloadTime: def.reloadTime, reloading: 0,
    reviveTimer: 0,
    down: false,
  };
}

function setupDrive() {
  const g = game;
  g.world = { w: 1100, h: 16000 };
  g.allies = [];
  g.civilians = [];
  g.caches = [];
  g.pickups = [];
  // roadside blocks + wreck obstacles down the strip
  g.props = [];
  for (let y = 200; y < g.world.h - 400; y += 260 + Math.random() * 200) {
    g.props.push({ x: 10, y, w: 130 + Math.random() * 60, h: 180, kind: 'building', low: false, seed: Math.random() });
    g.props.push({ x: g.world.w - 200, y: y + 130, w: 130 + Math.random() * 60, h: 180, kind: 'building', low: false, seed: Math.random() });
    if (Math.random() < 0.75) {
      g.props.push({ x: 260 + Math.random() * 560, y: y + Math.random() * 160, w: 78, h: 38, kind: 'car', low: false, seed: Math.random() });
    }
    if (Math.random() < 0.4) {
      g.pickups.push({ x: 280 + Math.random() * 540, y: y + 60, type: Math.random() < 0.6 ? 'ammo' : 'medkit', t: 9999, radius: 10 });
    }
  }
  g.player.x = g.world.w / 2;
  g.player.y = g.world.h - 320;
  g.driveStart = g.player.y;
}

function startLevel() {
  game = newGame();
  if (gameMode === 'drive') setupDrive();
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = Math.ceil(game.world.w * DECAL_SCALE);
  decalCanvas.height = Math.ceil(game.world.h * DECAL_SCALE);
  decalCtx = decalCanvas.getContext('2d');
  decalCtx.scale(DECAL_SCALE, DECAL_SCALE);
  screenBlood = [];
  state = 'playing';
  charSheetOpen = false;
  Object.assign(cam, cameraTarget()); // snap, don't pan in from the old level
  // supplies scattered across the map — ammo, explosives, medkits
  const scatterPk = (n, type) => {
    for (let i = 0; i < n; i++) {
      const pk = {
        x: 80 + Math.random() * (game.world.w - 160),
        y: 80 + Math.random() * (game.world.h - 160),
        type, t: 9999, radius: 10,
      };
      collideProps(pk);
      game.pickups.push(pk);
    }
  };
  scatterPk(10, 'ammo');
  scatterPk(4, 'nade');
  scatterPk(2, 'dyna');
  scatterPk(3, 'medkit');
  if (gameMode !== 'campaign') {
    hordeRound = 1;
    game.wave = 1;
    if (gameMode === 'drive') {
      banner('DRIVE', 'A/D steer · SPACE nitro · mouse shoots · RAM EVERYTHING', '#ffd54f');
    } else if (gameMode === 'horde') {
      spawnHorde();
      banner('HORDE MODE', '200 of them. All of them want YOU.', '#ff1744');
    } else if (gameMode === 'extreme') {
      spawnHorde();
      banner('ALL-HORDE EXTREME', '300 of EVERYTHING at 8x. good luck.', '#ff1744');
    } else if (gameMode === 'kill') {
      game.killT = 90;
      for (const w of WEAPON_ORDER) game.player.reserve[w] = Infinity;
      banner('KILL MODE', '90 seconds · unlimited ammo · double damage', '#ff1744');
    } else if (gameMode === 'die') {
      game.player.hp = 1;
      banner('DIE MODE', 'one touch kills you · 3x scrap', '#ff1744');
    } else if (gameMode === 'tenk') {
      game.survivalPool = 10000;
      banner('10,000', 'kill EVERY LAST ONE', '#ff1744');
    }
    sfx.playScream();
    return;
  }
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
  if (char.checkpoint && char.checkpoint.lvl === char.campaignLevel &&
      char.checkpoint.wave > 1 && char.checkpoint.wave <= level().waves) {
    game.wave = char.checkpoint.wave - 1;
    banner('CHECKPOINT', `resuming at wave ${char.checkpoint.wave}`, '#80cbc4');
  }
  nextWave();
}

function nextWave() {
  const lv = level();
  const g = game;
  g.wave++;
  // revive downed squad members between waves (the partner stays down —
  // only the medic can drag them back up)
  for (const a of g.allies) {
    if (a.down && a.type !== 'partner') {
      a.down = false;
      a.hp = a.maxHp * 0.5;
    }
  }
  // 3-wave structure: 100 → 300 → 3-minute stand against the 5,000
  if (g.wave >= lv.waves) {
    g.survivalT = 180;
    g.survivalPool = 5000;
    g.spawnQueue = [];
    for (let i = 0; i < lv.bosses; i++) g.zombies.push(spawnLevelZombie('boss'));
    banner('SURVIVE 3:00', '5,000 OF THEM ARE COMING', '#ff1744');
    radio('echo', 'ECHO-6: Reading a mass signature. All of them. RUN OR HOLD — THREE MINUTES.', '#80cbc4');
    sfx.playScream();
    return;
  }
  if (g.wave > 1) {
    const d0 = derived(char);
    g.player.hp = Math.min(d0.maxHp, g.player.hp + 25);
    g.player.armorHP = Math.min(g.player.armorMax, g.player.armorHP + 25);
  }
  const count = g.wave === 1 ? 100 : 300;
  const comp = [];
  for (let i = 0; i < Math.round(count * lv.countMult); i++) comp.push(randomZombieType(char.campaignLevel));
  // feral military units stalk the later levels
  if (char.campaignLevel >= 2 && g.wave >= 2) {
    for (let i = 0; i < 4 + char.campaignLevel; i++) comp.push('rogue');
    if (!g.rogueBannerShown) {
      g.rogueBannerShown = true;
      banner('ROGUE MILITARY INBOUND', 'they shoot anything that moves — including you', '#ef5350');
      radio('echo', 'ECHO-6: Those are Delta deserters. The infection took their minds, not their trigger fingers.', '#80cbc4');
    }
  }
  banner(`WAVE ${g.wave}`, `${count * lv.countMult | 0} INBOUND — ${lv.name}`);
  if (g.wave > 1) squadBanter();
  const lore = LEVEL_RADIO[lv.key];
  if (lore) radio('echo', lore[(g.wave - 1) % lore.length], '#80cbc4');
  g.spawnQueue = comp;
  g.spawnTimer = 0;
  // a random HORDE EVENT can hit any wave: 8x-speed sprinters, all at once
  g.hordeEventAt = char.campaignLevel >= 1 && Math.random() < 0.35 ? g.time + 12 + Math.random() * 20 : -1;
  // dump an opening surge so the wave hits immediately
  const surge = Math.min(30, 15 + g.wave * 5);
  for (let i = 0; i < surge && g.spawnQueue.length; i++) {
    g.zombies.push(spawnLevelZombie(g.spawnQueue.shift()));
  }
}

function spawnLevelZombie(type) {
  const lv = level();
  const g = game;
  const z = spawnZombie(type, g.world.w, g.world.h);
  // place on a ring just outside the camera view, clamped into the world
  const a = Math.random() * Math.PI * 2;
  const r = Math.max(view.w, view.h) * 0.62 + 100;
  z.x = Math.max(30, Math.min(g.world.w - 30, g.player.x + Math.cos(a) * r));
  z.y = Math.max(30, Math.min(g.world.h - 30, g.player.y + Math.sin(a) * r));
  // grannies hide flush against a structure and wait
  if (type === 'granny' && g.props.length) {
    const candidates = g.props.filter((pr) => pr.kind !== 'floor' && pr.kind !== 'door');
    if (candidates.length) {
      const pr = candidates[Math.floor(Math.random() * candidates.length)];
      z.x = Math.max(30, Math.min(g.world.w - 30, pr.x + pr.w / 2 + (Math.random() < 0.5 ? -(pr.w / 2 + 22) : pr.w / 2 + 22)));
      z.y = Math.max(30, Math.min(g.world.h - 30, pr.y + pr.h / 2 + (Math.random() - 0.5) * pr.h));
    }
  }
  // one uniform 'decent' size for the horde (small per-spawn variance only);
  // brutes/butchers read bigger, bosses tower
  if (type !== 'boss') {
    const big = type === 'brute' || type === 'butcher';
    z.radius = (big ? 21 : 17) + Math.random() * 2;
  }
  z.hp = z.maxHp = Math.round(z.hp * lv.hpMult);
  z.speed *= lv.speedMult;
  z.damage = Math.round(z.damage * (1 + char.campaignLevel * 0.25));
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
  if (game.particles.length > 900) return;
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
  if (game.gibs.length > 260) return;
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
  addShake(Math.min(10, radius * 0.07));
  for (let sp3 = 0; sp3 < 8; sp3++) {
    const a3 = Math.random() * Math.PI * 2;
    g.particles.push({
      x, y,
      vx: Math.cos(a3) * (220 + Math.random() * 260),
      vy: Math.sin(a3) * (220 + Math.random() * 260),
      life: 0.15 + Math.random() * 0.15, color: sp3 % 2 ? '#fff' : '#ffe082', size: 3,
    });
  }
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
      damagePlayer(Math.round(damage * 0.4));
    }
    for (const a of g.allies) {
      if (a.down) continue;
      if (Math.hypot(a.x - x, a.y - y) < radius + a.radius) damageAlly(a, damage * 0.4);
    }
    for (const c of g.civilians) {
      if (Math.hypot(c.x - x, c.y - y) < radius + c.radius) c.dead = true;
    }
  }
}

function effArmor() {
  return derived(char).armor + (game.buffs.shield > 0 ? 3 : 0);
}

// armor depletes FIRST, then health; armor hits don't break your killstreak
function damagePlayer(dmg) {
  const g = game;
  const p = g.player;
  if (g.time < p.invulnUntil) return;
  if (g.buffs.shield > 0) dmg = Math.max(1, dmg - 3);
  if (p.armorHP > 0) {
    const a = Math.min(p.armorHP, dmg);
    p.armorHP -= a;
    dmg -= a;
    p.hurtFlash = Math.max(p.hurtFlash, 0.12);
  }
  if (dmg <= 0) return;
  p.hp -= dmg;
  p.hurtFlash = 0.25;
  addShake(5);
  g.streak = 0; // a hit to HEALTH resets the killstreak
  addScreenBlood(1);
  spawnBlood(p.x, p.y, 8, '#c62828');
  g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${Math.round(dmg)}`, color: '#ef5350', life: 0.8, vy: -50 });
}

// route ally damage through the partner's energy shield
function damageAlly(a, dmg) {
  if (a.down) return;
  if (a.shieldMax && a.shield > 0) {
    const absorbed = Math.min(a.shield, dmg);
    a.shield -= absorbed;
    dmg -= absorbed;
    a.shieldHitT = 0;
  }
  if (dmg <= 0) return;
  a.hp -= dmg;
  spawnBlood(a.x, a.y, 5, '#c62828');
  if (a.hp <= 0 && !a.down) {
    a.down = true;
    banner(`${a.name} IS DOWN`, a.type === 'partner' ? 'only the medic can revive your partner' : 'back up at the next wave', '#ef9a9a');
    goreKill(a.x, a.y, a.radius, null, false);
  }
}

const LOOT_TYPES = ['medkit', 'ammo', 'ammo', 'shield', 'rage', 'nade', 'dyna'];

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
    for (const w of WEAPON_ORDER) {
      if (g.player.reserve[w] === Infinity) continue;
      g.player.reserve[w] = Math.min(AMMO_RESERVE[w] * 2, g.player.reserve[w] + Math.ceil(AMMO_RESERVE[w] * 0.4));
    }
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: '+AMMO RESERVES', color: '#ffe082', life: 1, vy: -50 });
  } else if (type === 'nade') {
    const kinds = ['frag', 'frag', 'smoke', 'decoy'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    char.nades[k] = (char.nades[k] || 0) + 2;
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: `+2 ${k.toUpperCase()} [G]`, color: '#aed581', life: 1, vy: -50 });
  } else if (type === 'dyna') {
    char.dynamite = (char.dynamite || 0) + 1;
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: '+1 DYNAMITE [H]', color: '#ff8a65', life: 1, vy: -50 });
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
  // a live decoy outranks the player for everything non-human
  const dc = game.decoy;
  if (dc && !z.human && game.time < dc.until) {
    return { t: { x: dc.x, y: dc.y, radius: 6 }, d: Math.hypot(dc.x - z.x, dc.y - z.y) };
  }
  const p = game.player;
  return { t: p, d: Math.hypot(p.x - z.x, p.y - z.y) };
}

function update(dt) {
  const g = game;
  const p = g.player;
  const d = derived(char);
  g.time += dt;

  const driving = gameMode === 'drive';
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

  if (driving) {
    // the car drives itself forward — you steer and floor the nitro
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    let nitro = 1;
    if ((wasPressed(' ') || gpPressed('b')) && p.dashCooldown <= 0) {
      p.dashCooldown = 3;
      p.dashT = 1.0;
      sfx.playHiggsWhomp();
    }
    if (p.dashT > 0) { p.dashT -= dt; nitro = 1.8; }
    p.vy = -560 * nitro;
    const steer = (input.keys.has('a') ? -1 : 0) + (input.keys.has('d') ? 1 : 0) + gamepad.moveX;
    p.vx += (steer * 460 - p.vx) * (1 - Math.exp(-10 * dt));
    const beforeX = p.x, beforeY = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(190, Math.min(g.world.w - 190, p.x));
    p.y = Math.max(60, Math.min(g.world.h - 60, p.y));
    collideProps(p);
    // crashing into wrecks hurts
    if (Math.hypot(p.x - (beforeX + p.vx * dt), p.y - (beforeY + p.vy * dt)) > 6 && g.time > (p.crashCool || 0)) {
      p.crashCool = g.time + 0.7;
      damagePlayer(12);
      sfx.playSquelch();
    }
    p.angle = Math.atan2(input.mouse.y + cam.y - p.y, input.mouse.x + cam.x - p.x);
    // endless oncoming dead
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      g.spawnTimer = 0.34;
      if (g.zombies.length < 120) {
        const z = spawnLevelZombie(Math.random() < 0.75 ? 'walker' : 'runner');
        z.x = 240 + Math.random() * (g.world.w - 480);
        z.y = p.y - 720 - Math.random() * 500;
        g.zombies.push(z);
      }
    }
    // stage goal
    const dist = Math.round((g.driveStart - p.y) / 10);
    if (p.y <= 400) {
      overTitle = `STAGE REACHED — ${dist}m · +800 SCRAP`;
      overDied = false;
      char.scrap += 800;
      saveCharacter(char);
      state = 'gameover';
      sfx.playFanfare();
    }
  } else {
  // dodge dash: SPACE / Ⓑ — burst of speed with brief invulnerability
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  if ((wasPressed(' ') || gpPressed('b') || gpPressed('l3')) && !charSheetOpen && p.dashCooldown <= 0 && p.stamina > 0.2) {
    const len = Math.max(0.01, Math.hypot(dx, dy));
    const ang = moving ? Math.atan2(dy / len, dx / len) : p.angle;
    p.vx = Math.cos(ang) * spd * 3.1;
    p.vy = Math.sin(ang) * spd * 3.1;
    p.dashT = 0.18;
    p.dashCooldown = 1.5;
    p.invulnUntil = g.time + 0.35;
    p.stamina -= 0.2;
    for (let i = 0; i < 5; i++) {
      g.particles.push({
        x: p.x, y: p.y,
        vx: -Math.cos(ang) * 60 * i, vy: -Math.sin(ang) * 60 * i,
        life: 0.25, color: 'rgba(207,216,220,0.7)', size: 5,
      });
    }
    sfx.playEmptyClick();
  }

  // acceleration-based movement: snappy but smooth
  if (p.dashT > 0) {
    p.dashT -= dt;
  } else {
    const accel = 1 - Math.exp(-14 * dt);
    const len = Math.max(0.01, Math.hypot(dx, dy));
    const tvx = moving ? (dx / len) * spd : 0;
    const tvy = moving ? (dy / len) * spd : 0;
    p.vx += (tvx - p.vx) * accel;
    p.vy += (tvy - p.vy) * accel;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.x = Math.max(p.radius, Math.min(g.world.w - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(g.world.h - p.radius, p.y));
  collideProps(p);

  }
  // walk cycle + footstep dust, driven by real velocity
  const speedMag = Math.hypot(p.vx, p.vy);
  p.walkPhase += speedMag * dt * 0.05;
  p.stepAcc += speedMag * dt;
  if (p.stepAcc > 85 && speedMag > 40) {
    p.stepAcc = 0;
    g.particles.push({
      x: p.x - (p.vx / speedMag) * 10, y: p.y - (p.vy / speedMag) * 10,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
      life: 0.35, color: 'rgba(160,160,150,0.4)', size: 4,
    });
  }

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
    if (p.reloading <= 0) {
      // reloading pulls from finite reserve ammo
      const need = ws.magSize - p.mags[p.weapon];
      const take = Math.min(need, p.reserve[p.weapon]);
      p.mags[p.weapon] += take;
      if (p.reserve[p.weapon] !== Infinity) p.reserve[p.weapon] -= take;
    }
  } else if ((wasPressed('r') || gpPressed('x')) && p.mags[p.weapon] < ws.magSize && p.reserve[p.weapon] > 0) {
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
      // dry on this gun entirely? fall back to the trusty pistol
      if (p.reserve[p.weapon] <= 0 && p.weapon !== 'pistol') {
        g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'OUT OF AMMO', color: '#ef5350', life: 0.9, vy: -45 });
        p.weapon = 'pistol';
      }
    } else {
      p.mags[p.weapon]--;
      p.fireCooldown = ws.fireInterval;
      p.muzzleFlash = 0.05;
      sfx.playGunshot(p.weapon);
      g.shots += ws.pellets;
      // recoil + kick: heavy guns shove you and rattle the camera
      const heavy = ['shotgun', 'magnum', 'flak', 'railgun', 'sniper', 'mortar', 'glauncher'].includes(p.weapon);
      if (heavy) {
        p.vx -= Math.cos(p.angle) * 130;
        p.vy -= Math.sin(p.angle) * 130;
        addShake(3);
      } else {
        addShake(0.5);
      }
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
          damage: ws.damage, color: ws.color, life: ws.mortar ? 0.85 : 1.2,
          pierce: ws.pierce ?? 1, hit: new Set(), friendly: false,
          mortar: !!ws.mortar,
        });
      }
      if (p.mags[p.weapon] === 0 && p.reserve[p.weapon] > 0) {
        p.reloading = ws.reloadTime;
        sfx.playReload();
      }
    }
  }

  // -- throwables: grenades [G] and dynamite [H]
  const lob = (kind) => {
    const speed = kind === 'dyna' ? 420 : 540;
    g.throwables.push({
      x: p.x, y: p.y,
      vx: Math.cos(p.angle) * speed, vy: Math.sin(p.angle) * speed,
      fuse: kind === 'nade' ? 0.9 : 1.5, kind,
    });
    sfx.playEmptyClick();
    saveCharacter(char);
  };
  if (wasPressed('t') || gpPressed('left')) {
    const order = ['frag', 'smoke', 'decoy'];
    g.nadeSel = order[(order.indexOf(g.nadeSel) + 1) % order.length];
    g.dmgNumbers.push({ x: p.x, y: p.y - 28, txt: g.nadeSel.toUpperCase() + ` ×${char.nades[g.nadeSel]}`, color: '#aed581', life: 0.9, vy: -45 });
  }
  if ((wasPressed('g') || gpPressed('up')) && char.nades[g.nadeSel] > 0) {
    char.nades[g.nadeSel]--;
    lob(g.nadeSel);
  }
  if ((wasPressed('h') || gpPressed('down')) && char.dynamite > 0) {
    char.dynamite--;
    lob('dyna');
  }
  for (const tb of g.throwables) {
    tb.x += tb.vx * dt;
    tb.y += tb.vy * dt;
    tb.vx *= 0.93;
    tb.vy *= 0.93;
    tb.fuse -= dt;
    if (tb.fuse <= 0) {
      if (tb.kind === 'frag') explode(tb.x, tb.y, 110, 170, false);
      else if (tb.kind === 'dyna') explode(tb.x, tb.y, 180, 340, false);
      else if (tb.kind === 'smoke') {
        g.smokes.push({ x: tb.x, y: tb.y, r: 140, until: g.time + 7 });
        sfx.playEmptyClick();
      } else if (tb.kind === 'decoy') {
        g.decoy = { x: tb.x, y: tb.y, until: g.time + 6 };
        radio('', 'decoy out — they took the bait', '#aed581');
      }
    }
  }
  g.throwables = g.throwables.filter((tb) => tb.fuse > 0);

  // -- airstrike beacon [X]
  if ((wasPressed('x') || gpPressed('r3')) && (char.airstrikes || 0) > 0) {
    char.airstrikes--;
    saveCharacter(char);
    banner('AIRSTRIKE INBOUND', 'danger close', '#ffd54f');
    sfx.playHiggsWhomp();
    const targets = g.zombies.filter((zz) => zz.hp > 0 && Math.hypot(zz.x - p.x, zz.y - p.y) < 800);
    for (let i = 0; i < 7; i++) {
      const tz = targets[Math.floor(Math.random() * Math.max(1, targets.length))];
      g.strikes.push({
        x: tz ? tz.x : p.x + (Math.random() - 0.5) * 600,
        y: tz ? tz.y : p.y + (Math.random() - 0.5) * 600,
        t: 0.5 + i * 0.28,
      });
    }
  }

  // -- call the sidekick back to your side
  if (wasPressed('q') || gpPressed('back')) {
    for (const a of g.allies) {
      if (a.type === 'partner' && !a.down) {
        a.followUntil = g.time + 8;
        radio(a.name, `${a.name}: "On my way!"`, a.color);
      }
    }
  }

  // -- higgs field
  const h = g.higgs;
  h.charge = Math.min(1, h.charge + dt / d.higgsCooldown);
  if (h.ringT >= 0) h.ringT += dt;
  // C swaps between owned shield cores
  if ((wasPressed('c') || gpPressed('right')) && char.shields.length > 1) {
    const i = char.shields.indexOf(char.shieldType);
    char.shieldType = char.shields[(i + 1) % char.shields.length];
    saveCharacter(char);
    g.dmgNumbers.push({ x: p.x, y: p.y - 28, txt: char.shieldType.toUpperCase() + ' SHIELD', color: SHIELD_COLORS[char.shieldType], life: 1, vy: -45 });
  }
  if ((wasPressed('e') || gpPressed('y')) && h.charge >= 1) {
    h.charge = 0;
    h.activeUntil = g.time + HIGGS.slowDuration;
    h.ringT = 0;
    sfx.playHiggsWhomp();
    // GREEN core: full invincibility while the bubble holds
    if (char.shieldType === 'health') p.invulnUntil = Math.max(p.invulnUntil, h.activeUntil);
    for (const z of g.zombies) {
      const dist = Math.hypot(z.x - p.x, z.y - p.y);
      if (dist < HIGGS.radius + z.radius) {
        z.slowUntil = g.time + HIGGS.slowDuration;
        // BLUE pulse: the first wave caught in the blast just dies
        if (char.shieldType === 'blue' && dist < 140) {
          z.hp -= 400;
          z.flash = 0.1;
          if (z.hp <= 0) killZombie(z, Math.atan2(z.y - p.y, z.x - p.x));
        }
        const k = HIGGS.knockback / Math.max(dist, 30);
        z.x += (z.x - p.x) * k * 0.2;
        z.y += (z.y - p.y) * k * 0.2;
      }
    }
  }
  // active shield aura effects
  if (g.time < h.activeUntil) {
    for (const z of g.zombies) {
      const dist = Math.hypot(z.x - p.x, z.y - p.y);
      if (dist >= HIGGS.radius + z.radius) continue;
      if (char.shieldType === 'flame') {
        // flame core: everything inside burns
        z.hp -= 70 * dt;
        if (Math.random() < dt * 6) spawnBlood(z.x, z.y, 2, '#ff7043');
        if (z.hp <= 0) killZombie(z, Math.atan2(z.y - p.y, z.x - p.x));
      } else if (char.shieldType === 'health') {
        // health core: constant repulsion
        const push = 170 * dt / Math.max(dist, 20);
        z.x += (z.x - p.x) * push;
        z.y += (z.y - p.y) * push;
      }
    }
    if (char.shieldType === 'health') p.hp = Math.min(d.maxHp, p.hp + 8 * dt);
  }

  // -- spawning / wave progression
  const lv = level();
  // random HORDE EVENT: a pack of 8x-speed sprinters drops all at once
  if (gameMode === 'campaign' && g.hordeEventAt > 0 && g.time >= g.hordeEventAt) {
    g.hordeEventAt = -1;
    banner('⚠ HORDE EVENT ⚠', 'EIGHT TIMES FASTER — RUN', '#ff1744');
    sfx.playScream();
    sfx.playHiggsWhomp();
    for (let i = 0; i < 80; i++) {
      const z = spawnLevelZombie('walker');
      z.fast8 = true;
      g.zombies.push(z);
    }
  }
  if (gameMode === 'drive') {
    // handled in the driving block above
  } else if (gameMode === 'horde' || gameMode === 'extreme') {
    if (!g.zombies.length) {
      hordeRound++;
      spawnHorde();
      banner(`ROUND ${hordeRound}`, 'they keep coming', '#ff1744');
      sfx.playFanfare();
    }
  } else if (gameMode === 'kill') {
    g.killT -= dt;
    g.buffs.rage = 10; // permanent rampage
    let kb = 0;
    while (g.zombies.length < 250 && kb++ < 8) g.zombies.push(spawnLevelZombie(randomZombieType()));
    if (g.killT <= 0) {
      overTitle = `TIME! ${g.kills} KILLS`;
      overDied = false;
      char.scrap += g.kills * 2;
      saveCharacter(char);
      state = 'gameover';
      sfx.playFanfare();
    }
  } else if (gameMode === 'die') {
    p.hp = Math.min(p.hp, 1); // one touch and it's over
    let db = 0;
    while (g.zombies.length < 200 && db++ < 6) g.zombies.push(spawnLevelZombie(randomZombieType()));
  } else if (gameMode === 'tenk') {
    let tb = 0;
    while (g.survivalPool > 0 && g.zombies.length < 320 && tb++ < 8) {
      g.zombies.push(spawnLevelZombie(randomZombieType()));
      g.survivalPool--;
    }
    if (!g.survivalPool && !g.zombies.length) {
      overTitle = 'ALL 10,000 DESTROYED';
      overDied = false;
      char.scrap += 2000;
      saveCharacter(char);
      state = 'gameover';
      sfx.playFanfare();
    }
  } else if (g.survivalT != null) {
    // the 3-minute stand: a 5,000-strong flood, capped live for performance
    g.survivalT -= dt;
    if (g.survivalT < 120 && !g.sv120) { g.sv120 = true; radio('echo', 'ECHO-6: "Two minutes. The flood is THICKENING. Hold."', '#80cbc4'); }
    if (g.survivalT < 60 && !g.sv60) { g.sv60 = true; radio('echo', 'ECHO-6: "One minute! Whatever you\'re doing — KEEP DOING IT."', '#80cbc4'); }
    if (g.survivalT < 15 && !g.sv15) { g.sv15 = true; radio('echo', 'ECHO-6: "FIFTEEN SECONDS. SOMETHING BIG IS MOVING UNDER THEM—"', '#ff8a80'); }
    let burst = 0;
    while (g.survivalPool > 0 && g.zombies.length < 320 && burst < 8) {
      g.zombies.push(spawnLevelZombie(randomZombieType(char.campaignLevel)));
      g.survivalPool--;
      burst++;
    }
    if (g.survivalT <= 0) {
      for (const z of g.zombies) {
        spawnBlood(z.x, z.y, 4, '#7b1d1d');
        stampDecal(z.x, z.y, z.radius);
      }
      g.zombies = [];
      g.survivalPool = 0;
      g.survivalT = null;
      banner('YOU SURVIVED THE 5,000', 'but something bigger is coming…', '#ffd54f');
      sfx.playFanfare();
      p.hp = derived(char).maxHp; // full restore before the boss
      p.armorHP = p.armorMax;
      // …and now the SUPER BOSS, with its goon army
      const sb = SUPERBOSSES[char.campaignLevel % SUPERBOSSES.length]; // unique boss per level
      const bz = spawnLevelZombie('boss');
      bz.hp = bz.maxHp = bz.hp * 4;
      bz.radius = 54;
      bz.super = sb.name;
      bz.score = 2000;
      g.zombies.push(bz);
      g.superBoss = bz;
      for (let i = 0; i < sb.goons[1]; i++) g.zombies.push(spawnLevelZombie(sb.goons[0]));
      setTimeout(() => banner('SUPER BOSS', sb.name, '#ffd700'), 1600);
      sfx.playScream();
    }
  } else if (g.spawnQueue.length) {
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      // pressure ramps: pairs early, triples from wave 6
      const burst = 1 + (g.wave > 2 ? 1 : 0) + (g.wave > 6 ? 1 : 0);
      for (let i = 0; i < burst && g.spawnQueue.length; i++) {
        g.zombies.push(spawnLevelZombie(g.spawnQueue.shift()));
      }
      g.spawnTimer = Math.max(0.18, 1.2 - (char.campaignLevel * lv.waves + g.wave) * 0.05);
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

  // -- FRENZY: every 23 seconds the entire horde surges at 3x speed
  if (g.zombies.length && gameMode === 'campaign' && (g.wave > 1 || char.campaignLevel > 0)) {
    g.frenzyTimer -= dt;
    if (g.frenzyTimer <= 0) {
      g.frenzyTimer = 23;
      g.frenzyUntil = g.time + (char.campaignLevel === 0 ? 2.5 : 4);
      banner('FRENZY', 'THE HORDE SURGES — RUN', '#ff1744');
      sfx.playScream();
      sfx.playHiggsWhomp();
    }
  }
  const frenzy = g.time < g.frenzyUntil;

  // -- zombies
  const fieldActive = g.time < h.activeUntil;
  for (const z of g.zombies) {
    const { t: target, d: distT } = zombieTarget(z);
    const distP = Math.hypot(p.x - z.x, p.y - z.y);
    if (fieldActive && distP < HIGGS.radius + z.radius) z.slowUntil = g.time + 0.3;
    const slowed = g.time < z.slowUntil;
    // the blue core stops zombies dead inside the live bubble
    const stopFactor = fieldActive && char.shieldType === 'blue' && distP < HIGGS.radius + z.radius ? 0.02 : HIGGS.slowFactor;
    let spdZ = z.speed * (slowed ? stopFactor : 1);
    for (const sm of g.smokes) {
      if (Math.hypot(z.x - sm.x, z.y - sm.y) < sm.r) { spdZ *= 0.35; break; }
    }
    if (z.lunges && distT < 160) spdZ *= 1.8; // crawler pounce
    if (g.time < z.boostUntil) spdZ *= 1.5; // screamer haste
    if (frenzy && !z.human) spdZ *= 3; // FRENZY surge
    if (gameMode === 'horde') spdZ *= 5;
    else if (gameMode === 'extreme') spdZ *= 8;
    else if (gameMode === 'kill') spdZ *= 1.5;
    if (z.fast8) spdZ *= 8; // horde-event sprinters
    // granny lurks beside a building until you get close — then she SCREAMS
    if (z.lurking) {
      if (distT < z.ambush.triggerRange) {
        z.lurking = false;
        z.screamT = 0;
        sfx.playScream();
      } else {
        z.flash = Math.max(0, z.flash - dt);
        continue; // frozen in her hiding spot
      }
    }
    if (z.ambush && !z.lurking && distT < 700) {
      z.screamT = (z.screamT ?? 0) - dt;
      if (z.screamT <= 0) {
        z.screamT = z.ambush.screamEvery;
        sfx.playScream();
      }
    }
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
    if (z.attackCooldown <= 0) {
      if (distT < z.radius + p.radius + 10) {
        if (gameMode === 'drive') {
          z.attackCooldown = 0.8;
          // RAM. the car wins
          z.hp = 0;
          killZombie(z, Math.atan2(z.y - p.y, z.x - p.x));
          addScreenBlood(0.5);
          if (z.radius > 19) damagePlayer(8); // only the big ones dent you
        } else if (!z.windup) {
          // telegraphed attack: rear back for a third of a second first
          z.windup = 0.33;
          z.attackCooldown = 0.9;
        }
      } else {
        // opportunistic swipes at anything that blunders into reach
        let swiped = false;
        for (const a of g.allies) {
          if (a.down) continue;
          if (Math.hypot(a.x - z.x, a.y - z.y) < z.radius + a.radius + 4) {
            z.attackCooldown = 0.8;
            damageAlly(a, z.damage);
            swiped = true;
            break;
          }
        }
        if (!swiped) {
          for (const c of g.civilians) {
            if (c.dead) continue;
            if (Math.hypot(c.x - z.x, c.y - z.y) < z.radius + c.radius + 4) {
              z.attackCooldown = 0.8;
              c.hp -= z.damage;
              if (c.hp <= 0) c.dead = true;
              break;
            }
          }
        }
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
    // windup resolves: still in reach -> the swipe lands; dodged -> whiff
    if (z.windup) {
      z.windup -= dt;
      if (z.windup <= 0) {
        z.windup = 0;
        const reach = z.radius + p.radius + 16;
        if (distP < reach && g.time >= g.meleeGraceUntil) {
          g.meleeGraceUntil = g.time + 0.4;
          damagePlayer(z.damage);
          // little forward hop with the hit
          z.x += ((p.x - z.x) / Math.max(1, distP)) * 10;
          z.y += ((p.y - z.y) / Math.max(1, distP)) * 10;
        }
      }
    }
    z.groanTimer -= dt;
    if (z.groanTimer <= 0) {
      z.groanTimer = 4 + Math.random() * 8;
      if (g.time - (g.lastGroan || 0) > 0.35 && distP < 900) {
        g.lastGroan = g.time;
        sfx.playGroan(Math.min(1, distP / 1100));
      }
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
      // the medic can drag squadmates back onto their feet mid-wave —
      // and YOU can revive anyone by standing over them
      const medic = g.allies.find((m) => m.healAura && !m.down);
      const medicClose = medic && Math.hypot(medic.x - a.x, medic.y - a.y) < medic.healAura;
      const playerClose = Math.hypot(p.x - a.x, p.y - a.y) < 56;
      if (medicClose || playerClose) {
        a.reviveTimer += dt * (playerClose ? 2 : 1);
        if (a.reviveTimer > 6) {
          a.down = false;
          a.hp = a.maxHp * 0.4;
          if (a.shieldMax) a.shield = a.shieldMax * 0.5;
          a.reviveTimer = 0;
          banner(`${a.name} IS BACK UP`, playerClose ? 'you got them on their feet' : 'patched by DOC OKAFOR', '#f8bbd0');
        }
      } else {
        a.reviveTimer = Math.max(0, a.reviveTimer - dt * 0.5);
      }
      continue;
    }
    const dp = Math.hypot(p.x - a.x, p.y - a.y);
    if (a.type === 'partner') {
      // the sidekick has a mind of its own: roams and picks its own fights,
      // unless you call it back with Q
      a.shieldHitT = (a.shieldHitT ?? 99) + dt;
      if (a.shieldMax && a.shield < a.shieldMax && a.shieldHitT > 3) {
        a.shield = Math.min(a.shieldMax, a.shield + 10 * dt);
      }
      const called = g.time < (a.followUntil || 0);
      if (called || dp > 1000) {
        // recalled (or way out of range): hustle back to the player
        if (dp > 110) {
          a.x += ((p.x - a.x) / dp) * 240 * dt;
          a.y += ((p.y - a.y) / dp) * 240 * dt;
          a.walkPhase = (a.walkPhase || 0) + 240 * dt * 0.05;
        }
      } else {
        a.roamT = (a.roamT || 0) - dt;
        if (a.roamT <= 0 || !a.roamTarget) {
          a.roamT = 5 + Math.random() * 4;
          a.roamTarget = {
            x: Math.max(40, Math.min(g.world.w - 40, p.x + (Math.random() - 0.5) * 1400)),
            y: Math.max(40, Math.min(g.world.h - 40, p.y + (Math.random() - 0.5) * 1400)),
          };
        }
        const dr = Math.hypot(a.roamTarget.x - a.x, a.roamTarget.y - a.y);
        if (dr > 30) {
          a.x += ((a.roamTarget.x - a.x) / dr) * 170 * dt;
          a.y += ((a.roamTarget.y - a.y) / dr) * 170 * dt;
          a.walkPhase = (a.walkPhase || 0) + 170 * dt * 0.05;
        }
      }
    } else {
      // each squadmate holds a slot on a slowly-rotating ring around you —
      // spread out, covering different directions
      const living = g.allies.filter((x) => !x.down && x.type !== 'partner');
      const slot = living.indexOf(a);
      const ringA = (slot / Math.max(1, living.length)) * Math.PI * 2 + g.time * 0.15;
      const tx = p.x + Math.cos(ringA) * 150;
      const ty = p.y + Math.sin(ringA) * 150;
      const dd = Math.hypot(tx - a.x, ty - a.y);
      if (dd > 26) {
        const spd2 = dd > 320 ? 230 : 150;
        a.x += ((tx - a.x) / dd) * spd2 * dt;
        a.y += ((ty - a.y) / dd) * spd2 * dt;
        a.walkPhase = (a.walkPhase || 0) + spd2 * dt * 0.05;
      }
    }
    collideProps(a);
    let nz = null, nd = 1e9;
    for (const z of g.zombies) {
      const dd = Math.hypot(z.x - a.x, z.y - a.y);
      if (dd < nd) { nd = dd; nz = z; }
    }
    a.fireCooldown -= dt;
    // squad guns run dry and need reloading, just like yours
    if (a.reloading > 0) {
      a.reloading -= dt;
      if (a.reloading <= 0) a.mag = a.magSize;
    }
    if (nz && nd < a.range) {
      a.angle = Math.atan2(nz.y - a.y, nz.x - a.x);
      if (a.fireCooldown <= 0 && a.reloading <= 0) {
        if (a.mag <= 0) {
          a.reloading = a.reloadTime;
        } else {
          a.mag--;
          // the partner runs whatever YOU are running
          const mirror = a.type === 'partner' ? weaponStats(char, p.weapon) : null;
          a.fireCooldown = mirror ? Math.max(0.12, mirror.fireInterval * 1.5) : a.fireInterval;
          sfx.playGunshot(mirror ? p.weapon : a.type === 'commander' ? 'magnum' : 'rifle');
          const sp = a.angle + (Math.random() - 0.5) * 0.08;
          g.bullets.push({
            x: a.x + Math.cos(a.angle) * 20, y: a.y + Math.sin(a.angle) * 20,
            vx: Math.cos(sp) * 1200, vy: Math.sin(sp) * 1200,
            damage: mirror ? mirror.damage * 0.6 : a.damage,
            color: mirror ? mirror.color : a.color, life: 1.0,
            pierce: mirror ? mirror.pierce : a.type === 'commander' ? 2 : 1, hit: new Set(), friendly: true,
          });
        }
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
      damagePlayer(s.damage);
      s.life = 0;
    }
    for (const a of g.allies) {
      if (a.down || s.life <= 0) continue;
      if (Math.hypot(a.x - s.x, a.y - s.y) < a.radius + 6) {
        damageAlly(a, s.damage);
        s.life = 0;
      }
    }
  }
  g.enemyShots = g.enemyShots.filter((s) => s.life > 0);

  // -- explosions animate
  for (const ex of g.explosions) ex.t -= dt;
  g.explosions = g.explosions.filter((ex) => ex.t > 0);

  // -- smoke clouds dissipate, decoy expires
  g.smokes = g.smokes.filter((sm) => g.time < sm.until);
  if (g.decoy && g.time >= g.decoy.until) g.decoy = null;

  // -- ambient drive-bys: survivors flooring it down the road, plowing the horde
  if ((lv.key === 'city' || lv.key === 'base' || lv.key === 'docks') && gameMode === 'campaign') {
    g.driveTimer -= dt;
    if (g.driveTimer <= 0) {
      g.driveTimer = 14 + Math.random() * 16;
      const ltr = Math.random() < 0.5;
      g.driveCars.push({
        x: ltr ? -120 : g.world.w + 120,
        y: g.world.h / 2 + (Math.random() - 0.5) * 60,
        vx: (ltr ? 1 : -1) * (820 + Math.random() * 250),
        sprite: ['drive_sports', 'drive_taxi', 'drive_police'][Math.floor(Math.random() * 3)],
      });
    }
  }
  for (const car of g.driveCars) {
    car.x += car.vx * dt;
    for (const z of g.zombies) {
      if (z.hp <= 0) continue;
      if (Math.abs(z.y - car.y) < 26 && Math.abs(z.x - car.x) < 50) {
        z.hp = 0;
        killZombie(z, Math.atan2(0, Math.sign(car.vx)));
      }
    }
    if (Math.abs(p.y - car.y) < 24 && Math.abs(p.x - car.x) < 48) {
      damagePlayer(20);
      p.vx += Math.sign(car.vx) * 600;
    }
  }
  g.driveCars = g.driveCars.filter((c2) => c2.x > -200 && c2.x < g.world.w + 200);

  // -- queued air support detonates
  for (const st of g.strikes) {
    st.t -= dt;
    if (st.t <= 0) explode(st.x, st.y, 100, 220, false);
  }
  g.strikes = g.strikes.filter((st) => st.t > 0);

  // -- locked doors: pay scrap to open, loot waits inside
  for (let i = g.props.length - 1; i >= 0; i--) {
    const pr = g.props[i];
    if (pr.kind !== 'door') continue;
    const dx = Math.max(pr.x, Math.min(p.x, pr.x + pr.w)) - p.x;
    const dy = Math.max(pr.y, Math.min(p.y, pr.y + pr.h)) - p.y;
    if (dx * dx + dy * dy < 70 * 70 && (wasPressed('f') || gpPressed('a'))) {
      if (char.scrap >= pr.cost) {
        char.scrap -= pr.cost;
        saveCharacter(char);
        g.props.splice(i, 1); // the door swings open
        sfx.playPurchase();
        banner('DOOR UNLOCKED', 'something useful inside', '#ffd54f');
        // interior loot
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * Math.PI * 2;
          g.scraps.push({ x: pr.lootX, y: pr.lootY, vx: Math.cos(a) * 100, vy: Math.sin(a) * 100, amount: 15 + Math.floor(Math.random() * 25) });
        }
        dropLoot(pr.lootX + 24, pr.lootY, true);
        dropLoot(pr.lootX - 24, pr.lootY, true);
        if (Math.random() < 0.25) g.caches.push({ x: pr.lootX, y: pr.lootY + 30, radius: 16, taken: false, pulse: 0 });
      } else {
        sfx.playDenied();
        g.dmgNumbers.push({ x: p.x, y: p.y - 24, txt: `NEED ⚙${pr.cost}`, color: '#ef5350', life: 1, vy: -40 });
      }
    }
  }

  // -- secret caches
  for (const ca of g.caches) {
    if (ca.taken) continue;
    collideProps(ca);
    if (Math.hypot(p.x - ca.x, p.y - ca.y) < p.radius + ca.radius + 6) {
      ca.taken = true;
      const reward = 150 + char.campaignLevel * 100;
      char.scrap += reward;
      char.secretsFound = (char.secretsFound || 0) + 1;
      saveCharacter(char);
      dropLoot(ca.x + 20, ca.y, true);
      dropLoot(ca.x - 20, ca.y, true);
      banner('SECRET CACHE FOUND', `+${reward} scrap`, '#ffd54f');
      const lore = CACHE_LORE[level().key];
      if (lore) radio('echo', lore[(char.secretsFound - 1) % lore.length], '#80cbc4');
      sfx.playFanfare();
    }
  }

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
        if (!b.friendly) g.hits++;
        // white impact sparks, SYNTHETIK flash
        for (let sp2 = 0; sp2 < 3; sp2++) {
          const sa2 = dir + Math.PI + (Math.random() - 0.5) * 1.4;
          g.particles.push({
            x: b.x, y: b.y,
            vx: Math.cos(sa2) * (140 + Math.random() * 160),
            vy: Math.sin(sa2) * (140 + Math.random() * 160),
            life: 0.12 + Math.random() * 0.1, color: '#fff', size: 2.5,
          });
        }
        if (g.time - (g.lastTick || 0) > 0.05) {
          g.lastTick = g.time;
          sfx.playHitTick();
        }
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
  for (const b of g.bullets) {
    if (b.mortar && b.life <= 0 && !b.boomed) {
      b.boomed = true;
      explode(b.x, b.y, 95, 170, false); // every mortar round detonates
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
  for (const km of g.killMarks) km.t -= dt;
  g.killMarks = g.killMarks.filter((km) => km.t > 0);
  if (g.combo > 0) {
    g.comboT -= dt;
    if (g.comboT <= 0) {
      if (g.combo >= 10) {
        const bonus = g.combo * 2;
        char.scrap += bonus;
        g.dmgNumbers.push({ x: p.x, y: p.y - 30, txt: `COMBO ×${g.combo} BANKED +⚙${bonus}`, color: '#ffd740', life: 1.3, vy: -40 });
      }
      g.combo = 0;
    }
  }
  for (const sb of screenBlood) sb.alpha -= dt * 0.12;
  screenBlood = screenBlood.filter((sb) => sb.alpha > 0.02);
  for (const rl of radioLines) rl.t -= dt;
  radioLines = radioLines.filter((rl) => rl.t > 0);

  p.hurtFlash = Math.max(0, p.hurtFlash - dt);

  if (p.hp <= 0 && !g.lastStandUsed && gameMode === 'campaign') {
    // LAST STAND: your first death each level is a refusal
    g.lastStandUsed = true;
    p.hp = derived(char).maxHp * 0.5;
    p.armorHP = p.armorMax;
    p.invulnUntil = g.time + 3;
    g.buffs.rage = Math.max(g.buffs.rage, 5);
    banner('LAST STAND', 'not today — 3s invulnerable', '#ffd54f');
    sfx.playFanfare();
    addScreenBlood(2);
  }
  if (p.hp <= 0) {
    overTitle = 'YOU DIED';
    overDied = true;
    state = 'gameover';
    char.scrap = Math.floor(char.scrap * 0.5);
    char.hp = derived(char).maxHp;
    char.totalKills += g.kills;
    saveCharacter(char);
    sfx.playGameOverSting();
  }
}

const SCRAP_DROPS = {
  walker: [3, 3], runner: [5, 3], brute: [12, 6], boss: [80, 40],
  crawler: [2, 3], spitter: [6, 4], exploder: [6, 4], screamer: [8, 5],
  rogue: [10, 6], granny: [8, 5], cop: [8, 5], hazmat: [9, 5],
  butcher: [14, 8], dog: [2, 3], stalker: [6, 4],
};

function killZombie(z, dirAngle) {
  const g = game;
  if (z._dead) return;
  z._dead = true;
  // COMBO: chain kills inside 2.2s for multiplied score + scrap
  g.combo++;
  g.comboT = 2.2;
  g.comboBest = Math.max(g.comboBest, g.combo);
  const mult = Math.min(5, 1 + g.combo * 0.1);
  const gained = Math.round(z.score * mult);
  g.score += gained - z.score; // base z.score added below as before
  g.dmgNumbers.push({
    x: z.x, y: z.y - z.radius - 4,
    txt: `+${gained}`, color: '#ffd740',
    life: g.combo >= 8 ? 1.1 : 0.8, vy: -70,
  });
  if (z.super) {
    g.superBoss = null;
    banner('SUPER BOSS DOWN', z.super, '#ffd700');
    addScreenBlood(2);
  }
  // SYNTHETIK-style kill feedback
  sfx.playKillThud();
  addShake(1.1);
  const bigKill = z.radius > 19 || z.super;
  g.killMarks.push({ x: z.x, y: z.y, t: 0.4, big: bigKill });
  if (bigKill) {
    hitStopT = Math.max(hitStopT, 0.06);
    addShake(4);
  }
  // killstreaks: build kills without your HEALTH being hit
  g.streak++;
  if (g.streak >= 25 && !g.streakFired[25]) {
    g.streakFired[25] = true;
    banner('KILLSTREAK ×25', 'AIRSTRIKE INBOUND', '#ffd54f');
    sfx.playFanfare();
    const targets = g.zombies.filter((zz) => zz.hp > 0 && Math.hypot(zz.x - g.player.x, zz.y - g.player.y) < 700);
    for (let i = 0; i < 6; i++) {
      const tz = targets[Math.floor(Math.random() * Math.max(1, targets.length))];
      g.strikes.push({
        x: tz ? tz.x : g.player.x + (Math.random() - 0.5) * 500,
        y: tz ? tz.y : g.player.y + (Math.random() - 0.5) * 500,
        t: 0.5 + i * 0.3,
      });
    }
  }
  if (g.streak >= 50 && !g.streakFired[50]) {
    g.streakFired[50] = true;
    banner('KILLSTREAK ×50', 'MORTAR BARRAGE', '#ffd54f');
    sfx.playFanfare();
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * 480;
      g.strikes.push({ x: g.player.x + Math.cos(a) * r, y: g.player.y + Math.sin(a) * r, t: 0.4 + i * 0.25 });
    }
  }
  if (g.streak >= 75 && !g.streakFired[75]) {
    g.streakFired[75] = true;
    banner('KILLSTREAK ×75', 'FULL RESTORE + ARMOR', '#ffd54f');
    sfx.playFanfare();
    g.player.hp = derived(char).maxHp;
    g.player.armorHP = g.player.armorMax;
    g.streak = 0;
    g.streakFired = {};
  }
  g.score += z.score;
  g.kills++;
  // 22% of kills pop the head clean off
  if (Math.random() < 0.22) {
    g.score += 5;
    hitStopT = Math.max(hitStopT, 0.05);
    addShake(3);
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
  if (g.corpses.length < 140) {
    g.corpses.push({ x: z.x, y: z.y, angle: dirAngle ?? Math.random() * Math.PI * 2, type: z.type, radius: z.radius, t: 12 });
  }
  if (g.dmgNumbers.length > 90) g.dmgNumbers.splice(0, g.dmgNumbers.length - 90);
  const [base, rand] = SCRAP_DROPS[z.type] || [4, 4];
  const total = base + Math.floor(Math.random() * rand);
  const piles = z.type === 'boss' ? 6 : 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < piles; i++) {
    const a = Math.random() * Math.PI * 2;
    g.scraps.push({
      x: z.x, y: z.y,
      vx: Math.cos(a) * 120, vy: Math.sin(a) * 120,
      amount: Math.max(1, Math.round(total / piles)) * (gameMode === 'die' ? 3 : 1),
    });
  }
  const ups = grantXp(char, z.score);
  if (ups > 0) {
    sfx.playLevelUp();
    banner(`LEVEL ${char.level}`, `+${ups * 3} attribute points — press TAB`, '#64b5f6');
  }
}

// ---- render: world -------------------------------------------------------------

function cameraTarget() {
  const g = game;
  const p = g.player;
  // lead the camera a touch toward where you're aiming
  const tx = p.x + Math.cos(p.angle) * 70 - view.w / 2;
  const ty = p.y + Math.sin(p.angle) * 70 - view.h / 2;
  return {
    x: g.world.w < view.w ? (g.world.w - view.w) / 2 : Math.max(0, Math.min(g.world.w - view.w, tx)),
    y: g.world.h < view.h ? (g.world.h - view.h) / 2 : Math.max(0, Math.min(g.world.h - view.h, ty)),
  };
}

function updateCamera(dt) {
  const t = cameraTarget();
  const k = 1 - Math.exp(-8 * (dt || 1 / 60));
  cam.x += (t.x - cam.x) * k;
  cam.y += (t.y - cam.y) * k;
}

function drawCoverImage(img, alpha = 1) {
  const s = Math.max(view.w / img.naturalWidth, view.h / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (view.w - w) / 2, (view.h - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

function drawGround() {
  const g = game;
  ctx.fillStyle = '#0b0d0e';
  ctx.fillRect(0, 0, view.w, view.h);
  const ground = getImage(level().ground);
  const tile = 256;
  if (ground) {
    ctx.globalAlpha = 0.35;
    const x0 = Math.floor(cam.x / tile) * tile;
    const y0 = Math.floor(cam.y / tile) * tile;
    for (let x = x0; x < cam.x + view.w; x += tile)
      for (let y = y0; y < cam.y + view.h; y += tile)
        ctx.drawImage(ground, x, y, tile, tile);
    ctx.globalAlpha = 1;
  }
  // roads through the city / base
  const lv = level();
  if (lv.key === 'city' || lv.key === 'base' || gameMode === 'drive') {
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
  ctx.drawImage(decalCanvas, 0, 0, g.world.w, g.world.h);
  drawProps();
}

const CAR_COLORS = ['#4e4448', '#3e4a55', '#5a4a3a', '#46524a', '#52404f'];

function drawProps() {
  for (const pr of game.props) {
    // skip props far outside the camera
    if (pr.x + pr.w < cam.x - 60 || pr.x > cam.x + view.w + 60 ||
        pr.y + pr.h < cam.y - 60 || pr.y > cam.y + view.h + 60) continue;
    // drop shadow sells the height of tall structures
    if (!pr.low) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(pr.x + 7, pr.y + 9, pr.w, pr.h);
    }
    if (pr.kind === 'floor') {
      ctx.fillStyle = 'rgba(14,16,20,0.88)';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = 'rgba(80,90,100,0.25)';
      for (let gx = pr.x + 24; gx < pr.x + pr.w; gx += 48) {
        ctx.beginPath();
        ctx.moveTo(gx, pr.y);
        ctx.lineTo(gx, pr.y + pr.h);
        ctx.stroke();
      }
    } else if (pr.kind === 'wall') {
      ctx.fillStyle = '#262c35';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = '#3d4754';
      ctx.lineWidth = 2;
      ctx.strokeRect(pr.x + 1, pr.y + 1, pr.w - 2, pr.h - 2);
    } else if (pr.kind === 'door') {
      ctx.fillStyle = '#5d4326';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(pr.x + 1, pr.y + 1, pr.w - 2, pr.h - 2);
      // cost label when the player is close
      const p = game.player;
      const dcx = pr.x + pr.w / 2, dcy = pr.y + pr.h / 2;
      if (Math.hypot(p.x - dcx, p.y - dcy) < 140) {
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = char.scrap >= pr.cost ? '#ffd54f' : '#ef5350';
        ctx.fillText(`[F] UNLOCK ⚙${pr.cost}`, dcx, dcy - 16);
        ctx.textBaseline = 'top';
      }
    } else if (pr.kind === 'wreck' || pr.kind === 'statue') {
      const sp = SPRITES[pr.kind];
      if (sp) {
        ctx.save();
        ctx.translate(pr.x + pr.w / 2, pr.y + pr.h / 2);
        drawSpriteFit(sp, pr.w * 1.25, pr.h * 1.25);
        ctx.restore();
      } else {
        ctx.fillStyle = pr.kind === 'wreck' ? '#2e2a26' : '#3c4038';
        ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      }
    } else if (pr.kind === 'building' || pr.kind === 'crypt' || pr.kind === 'bunker') {
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
        // rooftop furniture: AC units + an antenna, varied per building
        if (pr.seed > 0.35) {
          const ax = pr.x + 10 + (pr.seed * 97 % 1) * (pr.w - 48);
          const ay = pr.y + 10 + (pr.seed * 53 % 1) * (pr.h - 40);
          ctx.fillStyle = '#454f5a';
          ctx.fillRect(ax, ay, 30, 22);
          ctx.strokeStyle = '#5d6873';
          ctx.strokeRect(ax + 3, ay + 3, 24, 16);
          ctx.beginPath();
          ctx.arc(ax + 15, ay + 11, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (pr.seed > 0.6) {
          const tx = pr.x + pr.w - 26;
          const ty = pr.y + 18;
          ctx.strokeStyle = '#6b7782';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty + 16);
          ctx.lineTo(tx, ty);
          ctx.moveTo(tx - 7, ty + 6);
          ctx.lineTo(tx + 7, ty + 6);
          ctx.stroke();
          ctx.fillStyle = '#ef5350';
          ctx.beginPath();
          ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
          ctx.fill();
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
      const burning = pr.seed < 0.35;
      // a chunk of parked cars use the generated car sprites
      const parkedSp = !burning && pr.seed > 0.65
        ? SPRITES[['drive_sports', 'drive_taxi', 'drive_police'][((pr.seed * 100) | 0) % 3]]
        : null;
      if (parkedSp) {
        ctx.save();
        ctx.translate(pr.x + pr.w / 2, pr.y + pr.h / 2);
        if (pr.h > pr.w) ctx.rotate(Math.PI / 2);
        drawSpriteFit(parkedSp, Math.max(pr.w, pr.h) * 1.1, Math.min(pr.w, pr.h) * 1.25);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = burning ? '#26211d' : CAR_COLORS[(pr.seed * CAR_COLORS.length) | 0];
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      ctx.fillStyle = '#11151a';
      const horizontal = pr.w > pr.h;
      if (horizontal) ctx.fillRect(pr.x + pr.w * 0.22, pr.y + 4, pr.w * 0.2, pr.h - 8);
      else ctx.fillRect(pr.x + 4, pr.y + pr.h * 0.22, pr.w - 8, pr.h * 0.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
      if (burning) {
        // licking flames + glow + drifting smoke
        const t = performance.now() / 1000 + pr.seed * 17;
        const fx = pr.x + pr.w / 2, fy = pr.y + pr.h / 2;
        const glow = ctx.createRadialGradient(fx, fy, 4, fx, fy, 70);
        glow.addColorStop(0, 'rgba(255,140,0,0.35)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(fx - 70, fy - 70, 140, 140);
        for (let i = 0; i < 3; i++) {
          const fl = Math.sin(t * (7 + i * 3) + i * 2.1);
          ctx.fillStyle = i === 0 ? '#ff6f00' : i === 1 ? '#ffa726' : '#ffe082';
          ctx.beginPath();
          ctx.ellipse(
            fx + Math.sin(t * 5 + i * 2) * 7,
            fy - 4 - i * 4 + fl * 3,
            7 - i * 1.6, 12 - i * 2.5 + fl * 2, Math.sin(t * 3 + i) * 0.3, 0, Math.PI * 2
          );
          ctx.fill();
        }
        for (let i = 0; i < 2; i++) {
          const st = (t * 0.6 + i * 0.5) % 1;
          ctx.fillStyle = `rgba(60,60,60,${0.3 * (1 - st)})`;
          ctx.beginPath();
          ctx.arc(fx - st * 24 + Math.sin(t + i) * 4, fy - 14 - st * 44, 6 + st * 12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
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
  // per-zombie gradient glows get expensive past ~150 on screen
  if (game.zombies.length < 150) {
    const grad = ctx.createRadialGradient(0, 0, z.radius * 0.3, 0, 0, z.radius * 2.2);
    grad.addColorStop(0, z.glow);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = z.glow;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const { t: target } = zombieTarget(z);
  const a = Math.atan2(target.y - z.y, target.x - z.x);
  const sprite = SPRITES[z.type];
  if (sprite) {
    ctx.save();
    const rear = z.windup ? -0.3 * Math.sin((0.33 - z.windup) / 0.33 * Math.PI) : 0;
    ctx.rotate(a + Math.sin(z.wobble * 2) * 0.09 + rear);
    const zsq = Math.sin(z.wobble * 4) * 0.04;
    const wScale = z.windup ? 1.12 : 1;
    ctx.scale((1 + zsq) * wScale, (1 - zsq) * wScale);
    drawSprite(sprite, z.radius * 3.2);
    ctx.restore();
    if (z.windup) {
      ctx.strokeStyle = `rgba(255,82,82,${0.4 + 0.5 * Math.sin(performance.now() / 60)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, z.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
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
  if (z.super) {
    ctx.strokeStyle = `rgba(255,215,0,${0.5 + 0.3 * Math.sin(performance.now() / 200)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius + 8, 0, Math.PI * 2);
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
  ctx.rotate(c.angle + Math.sin(c.wobble * 2.4) * 0.16);
  const sq = Math.sin(c.wobble * 4.8) * 0.04;
  ctx.scale(1 + sq, 1 - sq);
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
  ctx.rotate(a.angle + Math.sin(a.walkPhase || 0) * 0.07);
  const sq = Math.sin((a.walkPhase || 0) * 2) * 0.03;
  ctx.scale(1 + sq, 1 - sq);
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
  ctx.fillText(a.reloading > 0 ? `${a.name} ⟳` : a.name, 0, -a.radius - 16);
  const w = a.radius * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-w / 2, -a.radius - 12, w, 3);
  ctx.fillStyle = a.color;
  ctx.fillRect(-w / 2, -a.radius - 12, (w * a.hp) / a.maxHp, 3);
  if (a.shieldMax) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w / 2, -a.radius - 9, w, 2);
    ctx.fillStyle = '#40c4ff';
    ctx.fillRect(-w / 2, -a.radius - 9, (w * a.shield) / a.shieldMax, 2);
  }
  ctx.restore();
}

function drawPlayer() {
  const p = game.player;
  if (gameMode === 'drive') {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-Math.PI / 2); // sprites face right; the car drives up
    const carSp = SPRITES.drive_armored || SPRITES.drive_sports;
    if (carSp) drawSpriteFit(carSp, 110, 60);
    else {
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(-50, -24, 100, 48);
    }
    // nitro flames
    if (p.dashT > 0) {
      ctx.fillStyle = Math.floor(performance.now() / 60) % 2 ? '#ffa726' : '#ffe082';
      ctx.beginPath();
      ctx.moveTo(-52, -10);
      ctx.lineTo(-86 - Math.random() * 18, 0);
      ctx.lineTo(-52, 10);
      ctx.fill();
    }
    ctx.restore();
    // turret muzzle flash
    if (p.muzzleFlash > 0) {
      ctx.fillStyle = '#ffe082';
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(p.angle) * 40, p.y + Math.sin(p.angle) * 40, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  // gait: rock around the aim axis + squash-stretch step bounce
  const rock = Math.sin(p.walkPhase) * 0.07;
  const squish = Math.sin(p.walkPhase * 2) * 0.035;
  ctx.rotate(p.angle + rock);
  ctx.scale(1 + squish, 1 - squish);
  if (game.time < p.invulnUntil) ctx.globalAlpha = 0.55; // dash ghosting
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
    const rgbMap = { blue: '33,150,243', flame: '255,112,67', health: '102,187,106' };
    const rgb = rgbMap[char.shieldType] || rgbMap.blue;
    const grad = ctx.createRadialGradient(0, 0, HIGGS.radius * 0.6, 0, 0, HIGGS.radius);
    grad.addColorStop(0, `rgba(${rgb},0.04)`);
    grad.addColorStop(1, `rgba(${rgb},0.2)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, HIGGS.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},0.75)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const a = game.time * 1.5 + (i * Math.PI * 2) / 10;
      const r = HIGGS.radius * (0.92 + 0.05 * Math.sin(game.time * 3 + i));
      ctx.fillStyle = SHIELD_COLORS[char.shieldType] || '#90caf9';
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

function drawCaches() {
  const p = game.player;
  for (const ca of game.caches) {
    if (ca.taken) continue;
    // secrets only shimmer into view when you're close
    const d = Math.hypot(p.x - ca.x, p.y - ca.y);
    if (d > 460) continue;
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + ca.pulse);
    const grad = ctx.createRadialGradient(ca.x, ca.y, 4, ca.x, ca.y, 46 + pulse * 14);
    grad.addColorStop(0, `rgba(255,213,79,${0.35 * pulse + 0.15})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ca.x, ca.y, 60, 0, Math.PI * 2);
    ctx.fill();
    if (SPRITES.cache) {
      ctx.save();
      ctx.translate(ca.x, ca.y);
      drawSpriteFit(SPRITES.cache, 44, 44);
      ctx.restore();
    } else {
      ctx.fillStyle = '#8d6e2f';
      ctx.fillRect(ca.x - 14, ca.y - 11, 28, 22);
      ctx.strokeStyle = '#ffd54f';
      ctx.strokeRect(ca.x - 14, ca.y - 11, 28, 22);
    }
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

// rounded glass panel — the UI overhaul backbone
function glass(x, y, w, h, accent = '#37474f') {
  ctx.save();
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = 'rgba(8,12,16,0.72)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 2);
  ctx.lineTo(x + w - 8, y + 2);
  ctx.stroke();
  ctx.restore();
}

function drawBanners(dt) {
  for (const b of banners) {
    b.t -= dt;
    const t = b.t;
    if (t <= 0) continue;
    const scale = t > 2.1 ? 1 + (t - 2.1) * 8 : 1;
    const alpha = Math.min(1, t);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.translate(view.w / 2, view.h / 2 - 80);
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
    const x = sb.fx * view.w;
    const y = sb.fy * view.h;
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
      view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3,
      view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.7
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(150,0,0,${Math.min(0.7, pulse)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (p.hurtFlash > 0) {
    ctx.fillStyle = `rgba(183,28,28,${p.hurtFlash * 0.8})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function drawMinimap() {
  const g = game;
  const mw = 170, mh = Math.round(170 * (g.world.h / g.world.w));
  const mx = view.w - mw - 20, my = 40;
  ctx.save();
  glass(mx - 4, my - 4, mw + 8, mh + 8, 'rgba(120,150,170,0.4)');
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(mx, my, mw, mh);
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
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, view.w * sx, view.h * sy);
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

  glass(12, 12, 240, 116, 'rgba(120,150,170,0.45)');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 20, 220, 18);
  ctx.fillStyle = p.hp > d.maxHp * 0.3 ? '#66bb6a' : '#ef5350';
  ctx.fillRect(20, 20, 220 * Math.max(0, p.hp / d.maxHp), 18);
  ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.max(0, Math.ceil(p.hp))}/${d.maxHp}`, 26, 22);

  // armor pool depletes before health
  if (p.armorMax > 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(20, 40, 220, 6);
    ctx.fillStyle = '#b0bec5';
    ctx.fillRect(20, 40, 220 * Math.max(0, p.armorHP / p.armorMax), 6);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 48, 220, 6);
  ctx.fillStyle = '#ffee58';
  ctx.fillRect(20, 48, 220 * p.stamina, 6);

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(20, 58, 220, 10);
  ctx.fillStyle = game.higgs.charge >= 1 ? '#42a5f5' : '#1e5a8a';
  ctx.fillRect(20, 58, 220 * game.higgs.charge, 10);
  ctx.fillStyle = SHIELD_COLORS[char.shieldType] || '#bbdefb';
  const shieldName = char.shieldType.toUpperCase();
  ctx.fillText(game.higgs.charge >= 1 ? `${shieldName} SHIELD READY [E]` + (char.shields.length > 1 ? ' · [C] swap' : '') : `${shieldName} SHIELD CHARGING…`, 20, 72);

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
  ctx.fillText(`⚙ ${char.scrap}`, view.w - 24, 22);

  glass(view.w - 360, view.h - 84, 336, 60, 'rgba(255,213,121,0.35)');
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#fff';
  const res = p.reserve[p.weapon];
  const ammoTxt = p.reloading > 0 ? 'RELOADING…' : `${p.mags[p.weapon]}/${ws.magSize} [${res === Infinity ? '∞' : res}]`;
  const tierTxt = ws.tier > 0 ? ` MK${ws.tier + 1}` : '';
  const favTxt = ws.favored ? '★' : '';
  ctx.fillText(`${favTxt}${ws.name}${tierTxt}  ${ammoTxt}`, view.w - 24, view.h - 70);
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#aed581';
  const ns = game.nadeSel.toUpperCase();
  ctx.fillText(`[G] ${ns} ×${char.nades[game.nadeSel] || 0} ([T] cycle)   [H] DYNAMITE ×${char.dynamite || 0}   [Q] RECALL`, view.w - 24, view.h - 130);
  if (game.streak >= 5) {
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#ffd54f';
    const next = game.streak < 25 ? 25 : game.streak < 50 ? 50 : 75;
    ctx.fillText(`🔥 KILLSTREAK ${game.streak} → ${next}`, view.w - 24, view.h - 148);
  }
  // active loot buffs
  let bx = view.w - 24;
  if (game.buffs.rage > 0) {
    ctx.fillStyle = '#ff7043';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`RAGE ${Math.ceil(game.buffs.rage)}s`, bx, view.h - 96);
    bx -= 110;
  }
  if (game.buffs.shield > 0) {
    ctx.fillStyle = '#42a5f5';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`SHIELD ${Math.ceil(game.buffs.shield)}s`, bx, view.h - 96);
  }
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  const keys = ownedList().map((w) => `[${WEAPONS[w].key}]${WEAPONS[w].name}`).join(' ');
  ctx.fillText(`${keys}  [R]RELOAD [SPACE]DASH [TAB]CHAR`, view.w - 24, view.h - 40);
  // dash cooldown pip
  ctx.fillStyle = p.dashCooldown <= 0 ? '#80cbc4' : '#37474f';
  ctx.fillText(p.dashCooldown <= 0 ? 'DASH READY' : `DASH ${p.dashCooldown.toFixed(1)}s`, view.w - 24, view.h - 112);
  if (gamepad.connected) {
    ctx.fillStyle = '#80cbc4';
    ctx.fillText('🎮 LS move·RS aim·RT fire·LB/RB guns·Ⓧ reload·Ⓨ shield·Ⓑ/L3 dash·R3 airstrike·◄nade ►core', view.w - 24, view.h - 22);
  }

  ctx.textAlign = 'center';
  glass(view.w / 2 - 250, 10, 500, 48, gameMode !== 'campaign' ? 'rgba(255,23,68,0.5)' : 'rgba(229,57,53,0.35)');
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = gameMode !== 'campaign' ? '#ff1744' : '#ef9a9a';
  const topLine =
    gameMode === 'drive' ? `🚗 DRIVE — ${Math.round((game.driveStart - p.y) / 10)}m / ${Math.round((game.driveStart - 400) / 10)}m · HOLD THE ROAD` :
    gameMode === 'horde' ? `☠ HORDE — ROUND ${hordeRound} ☠` :
    gameMode === 'extreme' ? `☠☠ ALL-HORDE EXTREME — ROUND ${hordeRound} ☠☠` :
    gameMode === 'kill' ? `🔪 KILL MODE — ${Math.max(0, Math.ceil(game.killT || 0))}s — ${game.kills} KILLS` :
    gameMode === 'die' ? `💀 DIE MODE — ${game.kills} KILLS — DON'T GET TOUCHED` :
    gameMode === 'tenk' ? `10,000 — ${game.survivalPool + game.zombies.length} LEFT` :
    `${lv.name} — WAVE ${game.wave}/${lv.waves}`;
  ctx.fillText(topLine, view.w / 2, 22);
  // super boss health bar
  if (game.superBoss && game.superBoss.hp > 0) {
    const bw2 = Math.min(440, view.w - 200);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(view.w / 2 - bw2 / 2, 130, bw2, 14);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(view.w / 2 - bw2 / 2, 130, bw2 * Math.max(0, game.superBoss.hp / game.superBoss.maxHp), 14);
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(game.superBoss.super, view.w / 2, 148);
  }
  ctx.fillStyle = '#fff';
  ctx.font = '14px monospace';
  ctx.fillText(`SCORE ${game.score}   ZOMBIES ${game.zombies.length + game.spawnQueue.length}   CIVILIANS ${game.civilians.length}`, view.w / 2, 46);
  // combo meter
  if (game.combo >= 3) {
    const pulse2 = 1 + Math.min(0.3, game.combo * 0.01) * Math.sin(performance.now() / 90);
    ctx.font = `bold ${Math.round(24 * pulse2)}px monospace`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(`COMBO ×${game.combo}`, view.w / 2, 64);
    ctx.fillStyle = '#ffd740';
    ctx.fillText(`COMBO ×${game.combo}`, view.w / 2, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(view.w / 2 - 60, 94, 120, 5);
    ctx.fillStyle = '#ffd740';
    ctx.fillRect(view.w / 2 - 60, 94, 120 * Math.max(0, game.comboT / 2.2), 5);
  }
  // survival countdown
  if (game.survivalT != null) {
    const m = Math.floor(Math.max(0, game.survivalT) / 60);
    const s = Math.floor(Math.max(0, game.survivalT) % 60).toString().padStart(2, '0');
    ctx.font = 'bold 34px monospace';
    ctx.fillStyle = game.survivalT < 30 ? '#ff1744' : '#ffd54f';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 14;
    ctx.fillText(`SURVIVE ${m}:${s}`, view.w / 2, 86);
    ctx.shadowBlur = 0;
    ctx.font = '13px monospace';
    ctx.fillStyle = '#ef9a9a';
    ctx.fillText(`HORDE REMAINING: ${game.survivalPool + game.zombies.length}`, view.w / 2, 124);
  }
  // frenzy warning
  if (game.time < game.frenzyUntil) {
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = Math.floor(performance.now() / 150) % 2 ? '#ff1744' : '#fff';
    ctx.fillText('⚠ FRENZY ⚠', view.w / 2, 68);
  } else if (game.frenzyTimer < 6 && game.zombies.length) {
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ff8a80';
    ctx.fillText(`FRENZY IN ${Math.ceil(game.frenzyTimer)}`, view.w / 2, 68);
  }
  // squad radio chatter, bottom-left
  ctx.textAlign = 'left';
  ctx.font = '13px monospace';
  let ry = view.h - 30;
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
  const w = Math.min(680, view.w - 60);
  const h = 460;
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, view.w, view.h);
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
  // special skills readout
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText('SPECIAL SKILLS', x + 24, yy + 28);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#cfd8dc';
  const shieldsTxt = char.shields.map((sh) => sh.toUpperCase()).join(' / ');
  ctx.fillText(`SHIELD CORES: ${shieldsTxt} (active: ${char.shieldType.toUpperCase()}) · DASH [SPACE] · KILLSTREAKS 25/50/75`, x + 24, yy + 46);
  ctx.fillText(`THROWABLES: FRAG ×${char.nades.frag} · SMOKE ×${char.nades.smoke} · DECOY ×${char.nades.decoy} · DYNAMITE ×${char.dynamite}`, x + 24, yy + 62);
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[TAB/Ⓑ] close', x + 24, y + h - 28);
}

function drawShop() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, view.w, view.h);
  const intro = getImage(level().intro);
  if (intro) drawCoverImage(intro, 0.25);

  const cx = view.w / 2;
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
  const cols = view.w > 860 ? 2 : 1;
  const gridW = cols * colW + (cols - 1) * gap;
  const x0 = (view.w - gridW) / 2;
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
    char.maxCampaign = Math.max(char.maxCampaign || 0, char.campaignLevel);
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
let reSelecting = false; // changing survivor from the menu skips the cinematic
let gameMode = 'campaign'; // campaign | horde | extreme | kill | die | tenk
let hordeRound = 0;
let overTitle = 'YOU DIED';
let overDied = true;

const MODES = [
  { id: 'drive', label: '🚗 DRIVE', desc: 'ram through to the next stage' },
  { id: 'horde', label: '☠ HORDE', desc: '200 at once · 5x speed' },
  { id: 'extreme', label: '☠☠ EXTREME', desc: 'ALL types · 8x speed' },
  { id: 'kill', label: '🔪 KILL MODE', desc: '90s · ∞ ammo · 2x dmg' },
  { id: 'die', label: '💀 DIE MODE', desc: '1 HP · 3x scrap' },
  { id: 'tenk', label: '10,000', desc: 'kill every last one' },
];

const SUPERBOSSES = [
  { name: 'DON MARROW — MOB BOSS', goons: ['walker', 100] },
  { name: 'THE GRAVELORD', goons: ['runner', 60] },
  { name: 'SEWER KING', goons: ['spitter', 40] },
  { name: 'HEAD SURGEON', goons: ['crawler', 80] },
  { name: 'GENERAL ROT', goons: ['rogue', 30] },
  { name: 'THE MANNEQUIN', goons: ['dog', 60] },
  { name: 'THE CONDUCTOR', goons: ['runner', 90] },
  { name: 'WARDEN MAXIMUS', goons: ['butcher', 22] },
  { name: 'THE HARBORMASTER', goons: ['hazmat', 30] },
  { name: 'THE LAST NEST', goons: ['exploder', 50] },
];

function spawnHorde() {
  const g = game;
  const count = gameMode === 'extreme' ? 300 : 200;
  for (let i = 0; i < count; i++) {
    const z = spawnLevelZombie(gameMode === 'extreme' ? randomZombieType() : 'walker');
    // spread the drop over a wide ring so 200 don't stack on one pixel
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(view.w, view.h) * 0.62 + 100 + Math.random() * 700;
    z.x = Math.max(30, Math.min(g.world.w - 30, g.player.x + Math.cos(a) * r));
    z.y = Math.max(30, Math.min(g.world.h - 30, g.player.y + Math.sin(a) * r));
    z.hp = z.maxHp = Math.round(z.hp * (1 + (hordeRound - 1) * (gameMode === 'extreme' ? 0.2 : 0.15)));
    g.zombies.push(z);
  }
}

function drawLevelSelect() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, view.w, view.h);
  if (titleArt.complete && titleArt.naturalWidth) drawCoverImage(titleArt, 0.15);
  const cx = view.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 32px monospace';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 18;
  ctx.fillText('SELECT DEPLOYMENT', cx, 28);
  ctx.shadowBlur = 0;

  const n = LEVELS.length;
  const cols = 5;
  const rows = Math.ceil(n / cols);
  const gap = 12;
  const cw = Math.min(230, (view.w - 70 - gap * (cols - 1)) / cols);
  const chh = Math.min(150, (view.h - 320 - gap * (rows - 1)) / rows);
  const x0 = (view.w - (cols * cw + (cols - 1) * gap)) / 2;
  const y0 = 76;
  LEVELS.forEach((lv, i) => {
    const unlocked = i <= (char.maxCampaign || 0);
    const x = x0 + (i % cols) * (cw + gap);
    const yRow = y0 + Math.floor(i / cols) * (chh + gap);
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, yRow, cw, chh);
    ctx.clip();
    const art = getImage(lv.intro);
    if (art) {
      const s = Math.max(cw / art.naturalWidth, chh / art.naturalHeight);
      ctx.globalAlpha = unlocked ? 1 : 0.25;
      ctx.drawImage(art, x + cw / 2 - (art.naturalWidth * s) / 2, yRow + chh / 2 - (art.naturalHeight * s) / 2, art.naturalWidth * s, art.naturalHeight * s);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, yRow + chh - 74, cw, 74);
    ctx.restore();
    ctx.strokeStyle = focused ? '#ffd54f' : unlocked ? '#546e7a' : '#2c343c';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(x, yRow, cw, chh);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = unlocked ? '#fff' : '#546e7a';
    ctx.fillText(`LEVEL ${i + 1}`, x + cw / 2, yRow + chh - 64);
    ctx.font = 'bold 12px monospace';
    ctx.fillText(unlocked ? lv.name : '🔒 LOCKED', x + cw / 2, yRow + chh - 47, cw - 10);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#90a4ae';
    if (unlocked) ctx.fillText(`${lv.waves} waves · ${lv.bosses} boss${lv.bosses > 1 ? 'es' : ''} · 3 secrets`, x + cw / 2, yRow + chh - 28, cw - 10);
    button(x, yRow, cw, chh, () => {
      gameMode = 'campaign';
      char.campaignLevel = i;
      char.checkpoint = null;
      saveCharacter(char);
      enterLevelIntro();
    }, unlocked);
  });

  // row 1: survivor select + random deploy
  const bw = 350, bh2 = 44, bgap = 22;
  const by = y0 + rows * chh + (rows - 1) * gap + 14;
  const rowBtn = (bx, w, fill, stroke, textColor, label, cb) => {
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = fill;
    ctx.fillRect(bx, by2cur, w, bh2);
    ctx.strokeStyle = focused ? '#ffd54f' : stroke;
    ctx.lineWidth = focused ? 3 : 2;
    ctx.strokeRect(bx, by2cur, w, bh2);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = textColor;
    ctx.fillText(label, bx + w / 2, by2cur + 14, w - 14);
    button(bx, by2cur, w, bh2, cb);
  };
  let by2cur = by;
  rowBtn(cx - bw - bgap / 2, bw, 'rgba(18,30,33,0.95)', '#80cbc4', '#80cbc4',
    `★ SELECT SURVIVOR — ${heroById(char.heroId).name}`, () => {
      reSelecting = true;
      selectMode = 'hero';
      gpFocus = 0;
      state = 'charselect';
    });
  rowBtn(cx + bgap / 2, bw, 'rgba(24,24,36,0.95)', '#b39ddb', '#b39ddb',
    '⚄ RANDOM LEVEL — deploy anywhere', () => {
      gameMode = 'campaign';
      char.campaignLevel = Math.floor(Math.random() * LEVELS.length);
      char.checkpoint = null;
      saveCharacter(char);
      enterLevelIntro();
    });
  // row 2: the crazy modes
  by2cur = by + bh2 + 12;
  const nM = MODES.length;
  const mw = Math.min(176, (view.w - 80 - (nM - 1) * 10) / nM);
  const mx0 = cx - (mw * nM + 10 * (nM - 1)) / 2;
  MODES.forEach((m, i) => {
    const bx = mx0 + i * (mw + 10);
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = 'rgba(40,12,16,0.95)';
    ctx.fillRect(bx, by2cur, mw, bh2);
    ctx.strokeStyle = focused ? '#ffd54f' : '#ff1744';
    ctx.lineWidth = focused ? 3 : 2;
    ctx.strokeRect(bx, by2cur, mw, bh2);
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ff5252';
    ctx.fillText(m.label, bx + mw / 2, by2cur + 8, mw - 10);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#ef9a9a';
    ctx.fillText(m.desc, bx + mw / 2, by2cur + 26, mw - 10);
    button(bx, by2cur, mw, bh2, () => {
      gameMode = m.id;
      char.checkpoint = null;
      startLevel();
    });
  });
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText(`LV ${char.level} · ⚙ ${char.scrap} · ${char.totalKills} kills · secrets found ${char.secretsFound || 0}`, cx, by2cur + bh2 + 12);
  ctx.restore();
}

function finishSelect() {
  if (reSelecting) {
    // survivor swap from the menu — no cinematic replay
    reSelecting = false;
    gpFocus = 0;
    state = 'levelselect';
    return;
  }
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
  ctx.fillRect(0, 0, view.w, view.h);
  if (titleArt.complete && titleArt.naturalWidth) drawCoverImage(titleArt, 0.18);
  const cx = view.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 30px monospace';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 18;
  ctx.fillText(selectMode === 'hero' ? 'CHOOSE YOUR SURVIVOR' : 'CHOOSE A PARTNER', cx, 22);
  ctx.shadowBlur = 0;

  // 5 x 2 roster grid sized so grid + footer + story bar always fit on screen
  const cols = 5, rows = 2;
  const gap = 12;
  const y0 = 70;
  const reservedBottom = selectMode === 'partner' ? 150 : 100; // footer + story bar
  const cw = Math.min(215, (view.w - 70 - gap * (cols - 1)) / cols);
  const chh = Math.max(150, Math.min(250, (view.h - y0 - reservedBottom - gap) / rows));
  const gridW = cols * cw + (cols - 1) * gap;
  const x0 = (view.w - gridW) / 2;
  let hovered = null;
  HEROES.forEach((hero, i) => {
    const isOwnHero = selectMode === 'partner' && hero.id === char.heroId;
    const x = x0 + (i % cols) * (cw + gap);
    const y = y0 + Math.floor(i / cols) * (chh + gap);
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    const m = input.mouse;
    if (m.x >= x && m.x <= x + cw && m.y >= y && m.y <= y + chh) hovered = hero;
    const isHovered = hovered === hero && !isOwnHero;
    ctx.fillStyle = isOwnHero ? 'rgba(12,14,17,0.94)' : isHovered ? 'rgba(30,36,44,0.96)' : 'rgba(20,24,30,0.94)';
    ctx.fillRect(x, y, cw, chh);
    ctx.strokeStyle = focused || isHovered ? '#ffd54f' : isOwnHero ? '#2c343c' : '#546e7a';
    ctx.lineWidth = focused || isHovered ? 2.5 : 1;
    ctx.strokeRect(x, y, cw, chh);
    // pedestal glow lifts dark sprites and keeps every portrait the same scale
    const px = x + cw / 2;
    const py = y + (chh - 54) / 2 + 6;
    const grad = ctx.createRadialGradient(px, py, 6, px, py, cw * 0.42);
    grad.addColorStop(0, 'rgba(120,140,160,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 4, y + 4, cw - 8, chh - 58);
    const sprite = SPRITES[hero.sprite];
    if (sprite) {
      // drawn upright (sprites face right), contained in a uniform box
      ctx.save();
      ctx.translate(px, py);
      if (isOwnHero) ctx.globalAlpha = 0.3;
      drawSpriteFit(sprite, cw * 0.66, (chh - 64) * 0.86);
      ctx.restore();
    } else {
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(px, py, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = isOwnHero ? '#546e7a' : '#fff';
    ctx.fillText(isOwnHero ? 'YOU' : hero.name, px, y + chh - 48, cw - 12);
    ctx.font = '10px monospace';
    ctx.fillStyle = '#90a4ae';
    ctx.fillText(hero.role, px, y + chh - 33, cw - 12);
    ctx.fillStyle = '#80cbc4';
    ctx.fillText(bonusText(hero), px, y + chh - 18, cw - 12);
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

  if (selectMode === 'partner') {
    // lone-wolf option directly under the grid
    const footY = y0 + rows * chh + gap + 6;
    const bw = 280;
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = 'rgba(30,22,22,0.94)';
    ctx.fillRect(cx - bw / 2, footY, bw, 38);
    ctx.strokeStyle = focused ? '#ffd54f' : '#7a5454';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(cx - bw / 2, footY, bw, 38);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#ef9a9a';
    ctx.fillText('GO ALONE — LONE WOLF', cx, footY + 11);
    button(cx - bw / 2, footY, bw, 38, () => {
      char.partnerId = null;
      saveCharacter(char);
      finishSelect();
    });
  }

  // backstory bar pinned to the bottom of the screen so it never clips
  const detail = hovered || (gamepad.connected && HEROES[Math.min(gpFocus, HEROES.length - 1)]) || null;
  const barH = 64;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, view.h - barH, view.w, barH);
  ctx.strokeStyle = '#2c343c';
  ctx.beginPath();
  ctx.moveTo(0, view.h - barH);
  ctx.lineTo(view.w, view.h - barH);
  ctx.stroke();
  if (detail) {
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(detail.name + ' — ' + detail.role.toUpperCase(), cx, view.h - barH + 10);
    // wrap the story onto up to two lines
    ctx.font = '13px monospace';
    ctx.fillStyle = '#cfd8dc';
    const maxW = view.w - 100;
    const words = detail.story.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    lines.push(line);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, view.h - barH + 28 + i * 17));
  } else {
    ctx.font = '13px monospace';
    ctx.fillStyle = '#9e9e9e';
    ctx.fillText(
      selectMode === 'hero'
        ? 'hover a survivor for their story — bonuses are permanent, favored weapon +15% damage'
        : 'your partner fights beside you for the whole campaign — or go in alone',
      cx, view.h - barH + 24
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
  ctx.fillRect(0, 0, view.w, view.h);
  const lv = level();
  getImage(lv.ground); // prefetch so the arena ground is ready on deploy
  const intro = getImage(lv.intro);
  if (intro) drawCoverImage(intro);
  const panelH = 270;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, view.h - panelH, view.w, panelH);
  const cx = view.w / 2;
  const t = performance.now() / 1000;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '16px monospace';
  ctx.fillStyle = '#ef9a9a';
  ctx.fillText(`LEVEL ${char.campaignLevel + 1} OF ${LEVELS.length}`, cx, view.h - panelH + 14);
  ctx.font = 'bold 44px monospace';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 22;
  ctx.fillText(lv.name, cx, view.h - panelH + 38);
  ctx.shadowBlur = 0;

  let budget = briefingChars();
  let yy = view.h - panelH + 98;
  ctx.font = '15px monospace';
  for (const line of lv.story) {
    if (budget <= 0) break;
    const shown = line.slice(0, budget);
    budget -= line.length;
    ctx.fillStyle = line.startsWith('ECHO') || line.startsWith('"') ? '#80cbc4' : '#bdbdbd';
    ctx.fillText(shown + (budget < 0 ? '▌' : ''), cx, yy);
    yy += 24;
  }

  // shield loadout: pick your core before deploying
  if (char.shields.length > 1) {
    const sw = 130, sh2 = 34, sg = 10;
    const sx0 = cx - (char.shields.length * sw + (char.shields.length - 1) * sg) / 2;
    char.shields.forEach((core, ci) => {
      const bx = sx0 + ci * (sw + sg);
      const byy = view.h - panelH - 46;
      const active = char.shieldType === core;
      ctx.fillStyle = active ? 'rgba(20,40,30,0.95)' : 'rgba(16,18,22,0.9)';
      ctx.fillRect(bx, byy, sw, sh2);
      ctx.strokeStyle = active ? SHIELD_COLORS[core] : '#3c4650';
      ctx.lineWidth = active ? 3 : 1;
      ctx.strokeRect(bx, byy, sw, sh2);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = SHIELD_COLORS[core];
      ctx.textAlign = 'center';
      ctx.fillText((core === 'health' ? 'GREEN' : core.toUpperCase()) + (active ? ' ✓' : ''), bx + sw / 2, byy + 11);
      button(bx, byy, sw, sh2, () => {
        char.shieldType = core;
        saveCharacter(char);
      });
    });
  }
  if (briefingChars() >= briefingTotal()) {
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 3)})`;
    ctx.fillText('CLICK TO DEPLOY', cx, view.h - 42);
  } else {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#757575';
    ctx.fillText('click to skip', cx, view.h - 36);
  }
  ctx.restore();
}

function drawTitle() {
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, view.w, view.h);
  const cx = view.w / 2;
  const cy = view.h / 2;
  const t = performance.now() / 1000;

  // animated horde video background when it's ready, Ken Burns art otherwise
  if (titleVideo.readyState >= 2 && titleVideo.videoWidth) {
    if (titleVideo.paused) titleVideo.play().catch(() => {});
    const s = Math.max(view.w / titleVideo.videoWidth, view.h / titleVideo.videoHeight);
    const w = titleVideo.videoWidth * s;
    const h = titleVideo.videoHeight * s;
    ctx.drawImage(titleVideo, (view.w - w) / 2, (view.h - h) / 2, w, h);
    // dim the video so the UI reads, then a heavy outlined logo
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.min(120, view.w / 9)}px monospace`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#000';
    ctx.strokeText('DEAD ZONE', cx, view.h * 0.3);
    ctx.fillStyle = '#d32f2f';
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = 30 + Math.sin(t * 2) * 10;
    ctx.fillText('DEAD ZONE', cx, view.h * 0.3);
    ctx.restore();
    drawTitleOverlay(t, cx);
    return;
  } else if (titleArt.complete && titleArt.naturalWidth) {
    const zoom = 1.06 + Math.sin(t * 0.15) * 0.05;
    const s = Math.max(view.w / titleArt.naturalWidth, view.h / titleArt.naturalHeight) * zoom;
    const w = titleArt.naturalWidth * s;
    const h = titleArt.naturalHeight * s;
    ctx.drawImage(titleArt, (view.w - w) / 2 + Math.sin(t * 0.1) * 18, (view.h - h) / 2, w, h);

    for (let i = 0; i < 5; i++) {
      const fx = ((t * 18 + i * 419) % (view.w + 500)) - 250;
      const fy = cy + Math.sin(t * 0.2 + i * 2.1) * view.h * 0.3;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, 260);
      grad.addColorStop(0, 'rgba(20,24,30,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, view.w, view.h);
    }

    const flicker = Math.sin(t * 1.7) > 0.96 ? 0.08 : 0;
    if (flicker) {
      ctx.fillStyle = `rgba(255,23,68,${flicker})`;
      ctx.fillRect(0, 0, view.w, view.h);
    }

    if (SPRITES.walker) {
      ctx.save();
      ctx.filter = 'brightness(0)';
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 4; i++) {
        const zx = ((t * (22 + i * 7) + i * 457) % (view.w + 240)) - 120;
        const zy = view.h - 195 - (i % 2) * 14;
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

    drawTitleOverlay(t, cx);
    return;
  }

  drawTitleFallback(t, cx, cy);
}

function drawTitleOverlay(t, cx) {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(0, view.h - 170, view.w, 170);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '15px monospace';
    ctx.fillStyle = '#cfcfcf';
    ctx.fillText('WASD/LS move · mouse/RS aim · 1-8 weapons · R reload · SPACE dash · E higgs · TAB character', cx, view.h - 152);
    // live controller status so USB/Bluetooth detection is visible at a glance
    ctx.font = 'bold 13px monospace';
    if (gamepad.connected) {
      ctx.fillStyle = '#69f0ae';
      ctx.fillText(`🎮 CONNECTED: ${gamepad.id.slice(0, 60)}${gamepad.standard ? '' : ' (non-standard layout — fallback controls)'}`, cx, view.h - 128);
    } else {
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText('🎮 no controller detected — plug in USB or pair Bluetooth, then PRESS ANY BUTTON on the pad', cx, view.h - 128);
    }
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 3)})`;
    ctx.fillText(hasSave ? `CLICK TO CONTINUE — LV ${char.level}, ${level().name}` : 'CLICK TO ENTER', cx, view.h - 98);
    if (hasSave) {
      ctx.font = '13px monospace';
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText('[N] new campaign (wipes save)', cx, view.h - 58);
    }
    ctx.restore();
}

function drawTitleFallback(t, cx, cy) {
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
  if (gameMode !== 'campaign') {
    const art = getImage('levels/horde.png');
    if (art) drawCoverImage(art, 0.5);
  }
  ctx.fillStyle = 'rgba(6,6,8,0.6)';
  ctx.fillRect(0, 0, view.w, view.h);
  const cx = view.w / 2;
  const cy = view.h / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 72px monospace';
  ctx.fillStyle = '#b71c1c';
  ctx.shadowColor = '#ff1744';
  ctx.shadowBlur = 30;
  ctx.fillText(overTitle, cx, cy - 60);
  ctx.shadowBlur = 0;
  ctx.font = '20px monospace';
  ctx.fillStyle = '#fff';
  const acc = game.shots > 0 ? Math.round((game.hits / game.shots) * 100) : 0;
  ctx.fillText(`${level().name} — wave ${game.wave} · Score ${game.score}`, cx, cy - 4);
  ctx.font = '15px monospace';
  ctx.fillStyle = '#ffd740';
  ctx.fillText(`${game.kills} kills · ${acc}% accuracy · best combo ×${game.comboBest}`, cx, cy + 52);
  ctx.font = '15px monospace';
  ctx.fillStyle = overDied ? '#ef9a9a' : '#ffd54f';
  ctx.fillText(overDied ? 'Half your scrap was lost. Your level and gear survive.' : 'Scrap bonus banked. The Dead Zone remembers.', cx, cy + 30);
  ctx.restore();
  // death menu: retry, deployment menu, title
  const bw = 250, bh = 46, gap = 18;
  const by = cy + 70;
  const buttons3 = [
    ['↻ RETRY', () => { if (gameMode !== 'campaign') startLevel(); else enterLevelIntro(); }],
    ['☰ MAIN MENU', () => { gameMode = 'campaign'; gpFocus = 0; state = 'levelselect'; }],
    ['⌂ TITLE', () => { gameMode = 'campaign'; state = 'title'; }],
  ];
  buttons3.forEach(([label, cb], i) => {
    const x = cx - (bw * 3 + gap * 2) / 2 + i * (bw + gap);
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = 'rgba(20,24,30,0.95)';
    ctx.fillRect(x, by, bw, bh);
    ctx.strokeStyle = focused ? '#ffd54f' : '#546e7a';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(x, by, bw, bh);
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + bw / 2, by + 14);
    button(x, by, bw, bh, cb);
  });
}

function drawVictory() {
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, view.w, view.h);
  const art = getImage(VICTORY_ART);
  if (art) drawCoverImage(art);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, view.h - 280, view.w, 280);
  const cx = view.w / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 52px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.shadowColor = '#ffd54f';
  ctx.shadowBlur = 28;
  ctx.fillText('THE DEAD ZONE IS CLEAR', cx, view.h - 260);
  ctx.shadowBlur = 0;
  ctx.font = '15px monospace';
  let yy = view.h - 190;
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  uiButtons = [];
  if (state === 'title') return drawTitle();
  if (state === 'levelselect') return drawLevelSelect();
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

  updateCamera(dt);
  shake *= Math.exp(-7 * (dt || 0.016));
  const jx = (Math.random() - 0.5) * shake;
  const jy = (Math.random() - 0.5) * shake;
  ctx.save();
  ctx.translate(-Math.round(cam.x + jx), -Math.round(cam.y + jy));
  drawGround();
  for (const co of game.corpses) {
    if (co.x < cam.x - 80 || co.x > cam.x + view.w + 80 || co.y < cam.y - 80 || co.y > cam.y + view.h + 80) continue;
    drawCorpse(co);
  }
  drawHiggs();
  drawCaches();
  drawScraps();
  for (const c of game.civilians) {
    if (c.x < cam.x - 60 || c.x > cam.x + view.w + 60 || c.y < cam.y - 60 || c.y > cam.y + view.h + 60) continue;
    drawCivilian(c);
  }
  for (const a of game.allies) drawAlly(a);
  for (const z of game.zombies) {
    if (z.x < cam.x - 120 || z.x > cam.x + view.w + 120 || z.y < cam.y - 120 || z.y > cam.y + view.h + 120) continue;
    drawZombie(z);
  }
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
    const colors = { medkit: '#ef5350', ammo: '#ffca28', shield: '#42a5f5', rage: '#ff7043', nade: '#9ccc65', dyna: '#ff7043' };
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
    } else if (pk.type === 'nade') {
      ctx.beginPath();
      ctx.arc(0, 1, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-2, -9, 4, 4);
    } else if (pk.type === 'dyna') {
      ctx.fillRect(-7, -5, 4, 11);
      ctx.fillRect(-2, -6, 4, 12);
      ctx.fillRect(3, -5, 4, 11);
    } else {
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 1);
    }
    ctx.restore();
  }
  // smoke clouds
  for (const sm of game.smokes) {
    const left = Math.min(1, (sm.until - game.time) / 1.5);
    for (let i = 0; i < 5; i++) {
      const a = performance.now() / 2400 + i * 1.3;
      ctx.fillStyle = `rgba(140,150,160,${0.16 * left})`;
      ctx.beginPath();
      ctx.arc(sm.x + Math.cos(a) * sm.r * 0.35, sm.y + Math.sin(a) * sm.r * 0.35, sm.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // decoy beacon
  if (game.decoy) {
    const blink = Math.floor(performance.now() / 200) % 2 === 0;
    ctx.fillStyle = blink ? '#ffd54f' : '#8d6e2f';
    ctx.beginPath();
    ctx.arc(game.decoy.x, game.decoy.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,213,79,0.4)';
    ctx.beginPath();
    ctx.arc(game.decoy.x, game.decoy.y, 18 + Math.sin(performance.now() / 150) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  // throwables in flight, blinking as the fuse burns down
  for (const tb of game.throwables) {
    ctx.save();
    ctx.translate(tb.x, tb.y);
    const blink = tb.fuse < 0.4 && Math.floor(performance.now() / 80) % 2 === 0;
    if (tb.kind === 'frag' || tb.kind === 'smoke' || tb.kind === 'decoy') {
      ctx.fillStyle = blink ? '#fff' : tb.kind === 'frag' ? '#558b2f' : tb.kind === 'smoke' ? '#90a4ae' : '#ffd54f';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = blink ? '#fff' : '#d84315';
      ctx.fillRect(-6, -4, 12, 8);
    }
    ctx.restore();
  }
  for (const car of game.driveCars) {
    ctx.save();
    ctx.translate(car.x, car.y);
    if (car.vx < 0) ctx.scale(-1, 1);
    const sp = SPRITES[car.sprite];
    if (sp) drawSpriteFit(sp, 96, 48);
    else {
      ctx.fillStyle = '#b71c1c';
      ctx.fillRect(-44, -18, 88, 36);
      ctx.fillStyle = '#11151a';
      ctx.fillRect(-12, -14, 26, 28);
    }
    // headlights + motion streaks
    ctx.fillStyle = 'rgba(255,236,150,0.5)';
    ctx.beginPath();
    ctx.moveTo(44, -10);
    ctx.lineTo(150, -26);
    ctx.lineTo(150, 26);
    ctx.lineTo(44, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-50, -10 + i * 10);
      ctx.lineTo(-110, -10 + i * 10);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawPlayer();
  // explosions: flash + expanding ring (screams are a pale ring only)
  // (world entities above are culled to the camera; effects below are cheap)
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
  // red kill X's, SYNTHETIK style
  for (const km of game.killMarks) {
    const t = km.t / 0.4;
    const r = (km.big ? 26 : 13) * (1.6 - t * 0.6);
    ctx.strokeStyle = `rgba(244,67,54,${t})`;
    ctx.lineWidth = km.big ? 6 : 3.5;
    ctx.beginPath();
    ctx.moveTo(km.x - r, km.y - r);
    ctx.lineTo(km.x + r, km.y + r);
    ctx.moveTo(km.x + r, km.y - r);
    ctx.lineTo(km.x - r, km.y + r);
    ctx.stroke();
  }
  for (const n of game.dmgNumbers) {
    const crit = n.color === '#ffd740';
    const pop = 1 + Math.max(0, n.life - (crit ? 0.7 : 0.5)) * 2.2; // punchy scale-in
    ctx.globalAlpha = Math.min(1, n.life * 2.5);
    ctx.font = `bold ${Math.round((crit ? 26 : 16) * pop)}px monospace`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(n.txt, n.x, n.y);
    ctx.fillStyle = n.color;
    ctx.fillText(n.txt, n.x, n.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // screen-space layers
  if (level().tint) {
    ctx.fillStyle = level().tint;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (game.time < game.frenzyUntil) {
    const pulse = 0.05 + 0.04 * Math.sin(performance.now() / 90);
    ctx.fillStyle = `rgba(255,23,68,${pulse})`;
    ctx.fillRect(0, 0, view.w, view.h);
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

let wasGpConnected = false;

function frame(now) {
  try {
    frameInner(now);
  } catch (err) {
    console.error('frame error (recovered):', err);
  }
  requestAnimationFrame(frame);
}

function frameInner(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  pollGamepad();
  if (gamepad.connected && !wasGpConnected) {
    banner('🎮 CONTROLLER CONNECTED', 'LS move · RS aim · RT fire · LT sprint · Ⓑ dash · Ⓧ reload · Ⓨ higgs', '#80cbc4');
  }
  wasGpConnected = gamepad.connected;

  // gamepad UI focus: d-pad browses buttons laid out last frame, A activates
  const uiState = charSheetOpen || state === 'shop' || state === 'charselect' || state === 'levelselect' || state === 'gameover' || state === 'levelintro';
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
        gpFocus = 0;
        state = 'levelselect';
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
    if (!charSheetOpen) {
      if (hitStopT > 0) hitStopT -= dt; // freeze-frame: render, don't simulate
      else update(dt);
    }
  } else if (state === 'shop') {
    if (wasPressed('tab') || gpPressed('start')) charSheetOpen = !charSheetOpen;
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
}
requestAnimationFrame(frame);
