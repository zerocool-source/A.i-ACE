import { initInput, input, wasPressed, consumePressed } from './input.js';
import { WEAPONS, WEAPON_ORDER, AMMO_RESERVE } from './weapons.js';
import { spawnZombie, randomZombieType, randomBotType } from './zombies.js';
import { LEVELS, VICTORY_ART, EPILOGUE, PRE_CUTSCENES, VICTORY_SHOTS } from './levels.js';
import { HEROES, heroById, bonusText } from './heroes.js';
import {
  ATTRS, newCharacter, xpForLevel, grantXp, derived, weaponStats,
  shopCatalog, saveCharacter, loadCharacter, wipeSave,
} from './rpg.js';
import { pollGamepad, gpPressed, gamepad, rumble } from './gamepad.js';
import * as sfx from './audio.js';
import { asset } from './assets.js';
import { settings, saveSettings, upscaleMode, UPSCALE_MODES, detectGPU } from './settings.js';
import { STORY_BEATS, OBJECTIVES, WHY } from './story.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// logical viewport — the canvas backing store renders at devicePixelRatio
// for crisp HiDPI/4K output; all game code works in logical pixels
const view = { w: window.innerWidth, h: window.innerHeight };
let dpr = Math.min(2, window.devicePixelRatio || 1);
// upscaling: the backing store renders at renderScale of the output, then
// the compositor stretches it to the display — DLSS/FSR architecture, sans
// the buffers a canvas-2D pipeline doesn't have (motion vectors / depth)
let renderScale = upscaleMode().scale;
const GPU = detectGPU();

function resize() {
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  renderScale = upscaleMode().scale;
  canvas.width = Math.max(2, Math.round(view.w * dpr * renderScale));
  canvas.height = Math.max(2, Math.round(view.h * dpr * renderScale));
  canvas.style.width = view.w + 'px';
  canvas.style.height = view.h + 'px';
  // RCAS-ish convolution sharpen recovers edge contrast lost to the stretch
  canvas.classList.toggle('upscale-sharpen', renderScale < 1 && settings.sharpen);
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
let spritesTotal = 0;
let spritesLoaded = 0;

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
                    ...['civilian_m', 'civilian_f'].flatMap((c2) => [`${c2}_s0`, `${c2}_s1`, `${c2}_s2`, `${c2}_s3`]),
                    'hero_medic', 'hero_builder', 'hero_hacker', 'hero_cop', 'hero_biker',
                    'hero_engineer', 'hero_veteran', 'hero_athlete',
                    'walker', 'runner', 'brute', 'boss', 'spitter', 'exploder',
                    'crawler', 'screamer', 'rogue', 'cache', 'wreck', 'statue',
                    'granny', 'cop', 'hazmat', 'butcher', 'dog', 'stalker',
                    'drive_sports', 'drive_taxi', 'drive_police', 'drive_armored',
                    'player_walk', 'player_f_walk', 'hero_medic_walk', 'hero_builder_walk',
                    'hero_hacker_walk', 'hero_cop_walk', 'hero_biker_walk', 'hero_engineer_walk',
                    'hero_veteran_walk', 'hero_athlete_walk',
                    'player_run', 'player_f_run', 'hero_medic_run', 'hero_builder_run',
                    'hero_hacker_run', 'hero_cop_run', 'hero_biker_run', 'hero_engineer_run',
                    'hero_veteran_run', 'hero_athlete_run',
                    'killx', 'killx2', 'comboskull', 'boom', 'walker_gore', 'runner_gore', 'brute_gore',
                    'granny_gore', 'cop_gore', 'butcher_gore', 'stalker_gore',
                    'gore_arm', 'gore_leg', 'gore_head', 'gore_torso', 'gore_chunk',
                    'splat1', 'splat2', 'splat3', 'scorch', 'fire', 'muzzle',
                    'corpsepile', 'ambulance', 'vending', 'dragtrail', 'entrails',
                    'bus', 'rubble', 'dumpster', 'barricade',
                    'fountain', 'kiosk', 'traincar', 'watchtower', 'container',
                    'crane', 'helipad', 'acunit', 'mausoleum', 'tank', 'tent',
                    'sewergrate', 'waterpool',
                    'killx3', 'bomber', 'flamecone', 'flamering', 'energyring',
                    'slashfx', 'roof1', 'roof2', 'roof3', 'roof4',
                    'supplydrop', 'streakflame', 'bonusstar',
                    'debris_plate', 'debris_gear', 'debris_arm', 'gunship',
                    'bot_breacher', 'bot_scout', 'bot_juggernaut', 'bot_kamikaze',
                    'bot_marksman', 'bot_enforcer', 'bot_overseer', 'bot_warframe',
                    'paratrooper', 'hackchip',
                    'nade_frag', 'nade_smoke', 'nade_decoy', 'nade_dyna',
                    'wic_rifle', 'wic_shotgun', 'wic_railgun',
                    'lootcrate', 'barrier_scifi', 'pylon',
                    'explosion_hd', 'fighterjet', 'helicopter', 'slash_fx', 'bloodburst',
                    'roof5', 'roof6',
                    'neon_kiosk', 'buzzsaw', 'severed_arm', 'severed_leg', 'blood_pool',
                    'generator',
                    ...['walker', 'runner', 'brute', 'exploder', 'cop', 'butcher',
                        'hazmat', 'screamer', 'spitter', 'crawler', 'granny',
                        'dog', 'stalker', 'boss', 'rogue',
                    ].flatMap((z) => [`${z}_s0`, `${z}_s1`, `${z}_s2`, `${z}_s3`]),
                    'boss_atk', 'butcher_atk', 'dog_atk', 'stalker_atk',
                    ...['bot_breacher', 'bot_scout', 'bot_juggernaut', 'bot_kamikaze',
                        'bot_marksman', 'bot_enforcer', 'bot_overseer', 'bot_warframe',
                    ].flatMap((z) => [`${z}_s0`, `${z}_s1`, `${z}_s2`, `${z}_s3`]),
                    ...['player', 'player_f', 'hero_medic', 'hero_builder',
                        'hero_hacker', 'hero_cop', 'hero_biker', 'hero_engineer',
                        'hero_veteran', 'hero_athlete',
                    ].flatMap((b) => [`${b}_s0`, `${b}_s1`, `${b}_s2`, `${b}_s3`])]) {
  const img = new Image();
  img.src = asset(`sprites/${name}.png`);
  spritesTotal++;
  img.onload = () => {
    SPRITES[name] = trimToAlphaBounds(img);
    spritesLoaded++;
  };
  img.onerror = () => {
    spritesLoaded++; // missing art falls back procedurally
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

// frame-jitter killer: each character's idle/walk/run art is trimmed to
// different bounds, so scaling them individually made walkers pulse in size.
// Padding every frame onto one shared canvas makes all frames scale identically.
const animCache = {};
function padFrames(frames) {
  const W = Math.max(...frames.map((f) => f.width));
  const H = Math.max(...frames.map((f) => f.height));
  return frames.map((f) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    cv.getContext('2d').drawImage(f, (W - f.width) / 2, (H - f.height) / 2);
    return cv;
  });
}
function animFrames(name) {
  if (animCache[name]) return animCache[name];
  // dedicated 4-pose sheet first: idle / left stride / pass / right stride
  const sh = [0, 1, 2, 3].map((i) => SPRITES[`${name}_s${i}`]);
  if (sh.every(Boolean)) {
    const pd = padFrames(sh);
    return (animCache[name] = {
      idle: pd[0],
      cycleWalk: [pd[1], pd[2], pd[3], pd[2]],
      cycleRun: [pd[1], pd[2], pd[3], pd[2]],
    });
  }
  const idle = SPRITES[name], walk = SPRITES[name + '_walk'];
  if (!idle || !walk) return null;
  const run = SPRITES[name + '_run'];
  const frames = run ? [idle, walk, run] : [idle, walk];
  const pad = padFrames(frames);
  // mirror each stride frame across the facing axis: instant opposite-leg
  // poses, turning a 3-frame sheet into a true alternating walk cycle
  const flip = (cv) => {
    const m = document.createElement('canvas');
    m.width = cv.width;
    m.height = cv.height;
    const mc = m.getContext('2d');
    mc.translate(0, cv.height);
    mc.scale(1, -1);
    mc.drawImage(cv, 0, 0);
    return m;
  };
  const runPad = pad[2] || pad[1];
  return (animCache[name] = {
    idle: pad[0],
    cycleWalk: [pad[1], pad[0], flip(pad[1]), pad[0]],
    cycleRun: [pad[1], runPad, flip(pad[1]), flip(runPad)],
  });
}

const titleArt = new Image();
titleArt.src = asset('title-bg.png');

// living title screen: the generated horde video loops behind the menu
// animated character select: each painted portrait gets a living video loop
const portraitVids = {};
function portraitVideo(id) {
  let v = portraitVids[id];
  if (!v) {
    v = document.createElement('video');
    v.src = asset(`portraits/${id}.mp4`);
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.onerror = () => { v._broken = true; };
    portraitVids[id] = v;
  }
  return v;
}

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
let videoOpen = false; // VIDEO / upscaling panel on the title screen
let paused = false; // in-game pause menu
let banners = []; // {text, sub, t, color}
let briefingStart = 0; // typewriter clock for the level-intro story text
let screenBlood = []; // splatter stuck to the camera: {fx, fy, r, alpha}
let gpFocus = 0; // gamepad focus index into uiButtons
let cam = { x: 0, y: 0 };
let shake = 0; // screen-shake magnitude, decays fast
let lastSpoke = 0;

const BARK_LINES = ['BOOM!', 'GET SOME!', 'EAT IT!', 'DOWN YOU GO!', 'HA!', 'NOT TODAY!', "WHO'S NEXT?!"];

// the survivor talks after crazy kills — bubble + actual voice
function bark(text) {
  if (!game) return;
  game.bark = { text, t: 1.3 };
  const now = performance.now();
  if (now - lastSpoke > 6000 && 'speechSynthesis' in window) {
    lastSpoke = now;
    try {
      const u = new SpeechSynthesisUtterance(text.toLowerCase().replace(/[!?]/g, ''));
      u.rate = 1.25;
      u.pitch = 0.6;
      u.volume = 0.85;
      speechSynthesis.speak(u);
    } catch { /* voice optional */ }
  }
}
let hitStopT = 0; // micro freeze-frames on big kills

function addShake(n) {
  shake = Math.min(34, shake + n * (settings.arcade ? 1.5 : 1));
}

// cached scanline strip for the arcade CRT grade (built once, tiled cheaply)
let scanlineCanvas = null;
function scanlines() {
  if (scanlineCanvas) return scanlineCanvas;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  const cc = c.getContext('2d');
  cc.fillStyle = 'rgba(0,0,0,0.10)';
  cc.fillRect(0, 0, 4, 2);
  scanlineCanvas = c;
  return c;
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
  banners.push({ text, sub, t: 2.0, color });
  if (banners.length > 4) banners.splice(1, banners.length - 4); // keep current + 3 queued
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
    // global declutter factor: cleaner composition, more readable fights
    const n = Math.round(n0 * af * 0.8);
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
      edgeBlocks(8, 'building', 280, 180);
      midBlocks(5, 'building', 280, 180);
      scatter(6, 64, 80, 32, 40, 'car');
      scatter(2, 36, 48, 36, 48, 'crate', true);
      scatter(1 / af, 140, 170, 140, 170, 'tent'); // abandoned triage post
      scatter(4, 34, 46, 34, 46, 'neon', true); // glowing street kiosks
      break;
    case 'graveyard':
      edgeBlocks(4, 'crypt', 180, 130);
      midBlocks(3, 'crypt', 180, 130);
      scatter(42, 24, 30, 34, 42, 'grave', true);
      scatter(2 / af, 150, 190, 150, 190, 'mausoleum');
      break;
    case 'sewer':
      edgeBlocks(6, 'pipe', 340, 60);
      scatter(10, 200, 320, 44, 60, 'pipe');
      scatter(8, 40, 56, 40, 56, 'crate', true);
      scatter(3, 110, 150, 110, 150, 'sewergrate', true);
      scatter(5, 90, 150, 70, 110, 'waterpool', true);
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
      scatter(1 / af, 210, 250, 110, 140, 'tank'); // knocked-out armor column
      scatter(2 / af, 140, 170, 140, 170, 'tent');
      break;
    case 'mall':
      edgeBlocks(8, 'building', 280, 190);
      midBlocks(7, 'building', 260, 180);
      scatter(10, 36, 52, 36, 52, 'crate', true);
      scatter(8, 30, 42, 60, 84, 'gurney', true);
      scatter(1 / af, 180, 210, 180, 210, 'fountain'); // the dead courtyard
      scatter(5, 70, 100, 70, 100, 'kiosk');
      break;
    case 'subway':
      edgeBlocks(5, 'pipe', 380, 64);
      midBlocks(4, 'building', 240, 150);
      scatter(12, 200, 340, 44, 60, 'pipe');
      scatter(8, 40, 56, 40, 56, 'crate', true);
      scatter(2 / af, 330, 390, 90, 115, 'traincar'); // the derailed 3:14
      break;
    case 'prison':
      edgeBlocks(8, 'bunker', 250, 170);
      midBlocks(5, 'bunker', 230, 150);
      scatter(16, 36, 110, 30, 44, 'sandbag', true);
      scatter(3 / af, 110, 145, 110, 145, 'watchtower');
      break;
    case 'docks':
      midBlocks(4, 'cabinet', 200, 90);
      scatter(12, 150, 220, 60, 90, 'container'); // real container yard
      scatter(1 / af, 230, 270, 230, 270, 'crane');
      scatter(14, 64, 90, 32, 44, 'car');
      scatter(12, 40, 60, 40, 60, 'crate', true);
      break;
    case 'rooftops':
      edgeBlocks(10, 'building', 300, 200);
      midBlocks(8, 'building', 260, 180);
      scatter(10, 36, 52, 36, 52, 'cabinet');
      scatter(1 / af, 210, 250, 210, 250, 'helipad', true); // last evac point
      scatter(8, 60, 90, 50, 70, 'acunit');
      break;
  }
  // street dressing — light touch on level 1, denser later
  const dress = lv.key === 'city' ? 0.5 : 1;
  if (['city', 'mall', 'prison', 'docks', 'base', 'rooftops'].includes(lv.key)) {
    scatter(Math.round(8 * dress), 40, 70, 40, 70, 'rubble', true);
    scatter(Math.round(4 * dress), 50, 64, 30, 40, 'dumpster');
    scatter(Math.round(5 * dress), 90, 130, 26, 36, 'barricade', true);
  }
  if (lv.key === 'city' || lv.key === 'docks') scatter(1 / af, 230, 270, 90, 110, 'bus');
  if (['hospital', 'mall', 'subway'].includes(lv.key)) {
    scatter(3, 60, 90, 50, 70, 'corpsepile', true);
    scatter(2, 40, 56, 56, 80, 'vending');
  }
  if (lv.key === 'city') scatter(1, 60, 90, 50, 70, 'corpsepile', true);
  if (lv.key === 'city' || lv.key === 'hospital') scatter(1 / af, 150, 180, 70, 90, 'ambulance');
  // one big landmark set-piece per map
  if (lv.key === 'city' || lv.key === 'base' || lv.key === 'docks') scatter(1 / af, 220, 260, 130, 160, 'wreck');
  if (lv.key === 'graveyard') scatter(1 / af, 120, 140, 120, 140, 'statue');
  return props;
}

// push a circle entity out of solid props (slides along walls)
const WALK_PROPS = new Set(['helipad', 'waterpool', 'sewergrate']);

function collideProps(e) {
  for (const pr of game.props) {
    if (pr.kind === 'floor' || WALK_PROPS.has(pr.kind)) continue; // walk-over art
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
  graveyard: ['ECHO-6: "Gravediggers\' kit. They were burying the fallen before anyone said the word \'uprising\'."', 'ECHO-6: "Someone was living out there between the crypts. Hope they made it."'],
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

// opening squad-banter scripts — a short radio scene plays as each level begins
const LEVEL_CHATS = {
  city: [
    ['partner', 'Streets are crawling. Watch the alleys, I\'ll watch your back.'],
    ['hero', 'Three days since the convoys stopped. WE are the rescue now.'],
    ['partner', 'Then let\'s make it count. On your lead.'],
  ],
  graveyard: [
    ['partner', 'A graveyard. The machines dig here at night. Fantastic.'],
    ['hero', 'Stay off the soft dirt. Some of these graves are... fresh.'],
    ['partner', 'That one just MOVED. Tell me that one didn\'t just move.'],
  ],
  sewer: [
    ['hero', 'Watch the waterline. The fast ones hunt in packs down here.'],
    ['partner', 'If it ripples, I shoot it. If it splashes, I shoot it twice.'],
    ['hero', 'And if the lights die — back to back, like we practiced.'],
  ],
  hospital: [
    ['partner', 'St. Mercy. Patient zero checked in right here.'],
    ['hero', 'Records are in the lab. Grab them and we burn our way out.'],
    ['partner', 'ECHO-6 said don\'t read the names. I\'m reading the names.'],
  ],
  base: [
    ['hero', 'Base Delta. The heart of the Dead Zone.'],
    ['partner', 'The whole army couldn\'t hold this place. Good thing we\'re not the army.'],
    ['hero', 'The nest can die. The files prove it. Let\'s go kill an idea.'],
  ],
  mall: [
    ['partner', 'Five thousand shoppers sealed in on day one. Hear that muzak?'],
    ['hero', 'Mall security is still broadcasting. That voice isn\'t human anymore.'],
    ['partner', 'ATTENTION SHOPPERS: we\'re here to close the store. Permanently.'],
  ],
  subway: [
    ['hero', 'The 3:14 never made its stop. Nine hundred souls still down here.'],
    ['partner', 'They go quiet when a train horn sounds. All of them. At once.'],
    ['hero', 'Then pray we don\'t hear a horn. Move.'],
  ],
  prison: [
    ['partner', 'Blackgate. Three thousand inmates, zero parole.'],
    ['hero', 'The warden welded solitary shut from the INSIDE. Think about that.'],
    ['partner', 'I\'m trying very hard not to. Cell blocks first?'],
  ],
  docks: [
    ['hero', 'The VERA brought the second outbreak in through this harbor.'],
    ['partner', 'Manifest said machine parts. The crates were breathing, ECHO said.'],
    ['hero', 'Burn the harbor. Leave nothing for the tide.'],
  ],
  rooftops: [
    ['partner', 'Top of the world. The dead learned to climb for this view.'],
    ['hero', 'The final nest is up here. After this... it\'s over.'],
    ['partner', 'Whatever happens — it\'s been an honor, you glorious lunatic.'],
  ],
};

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
    lights: [],
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
    slashFx: [],
    blackout: gameMode === 'blackout',
    survival: gameMode === 'blackout', // needs/injury sim rides with the dark
    needs: { hunger: 100, thirst: 100, fatigue: 100 },
    bleed: 0,
    supplies: { food: 2, water: 2, bandage: 3 },
    needWarnT: 0,
    buildMode: false,
    barricadeCost: 25,
    generators: [],
    storyBeats: [],
    storyLine: null,
    objective: '',
    blades: [],
    bladeUntil: 0,
    bladeCd: 0,
    combo: 0,
    comboT: 0,
    comboBest: 0,
    shots: 0,
    hits: 0,
    superBoss: null,
    fogs: Array.from({ length: 9 }, () => ({
      x: Math.random() * world.w, y: Math.random() * world.h,
      r: 180 + Math.random() * 220, vx: 6 + Math.random() * 10, a: 0.05 + Math.random() * 0.05,
    })),
    bombers: [],
    overclock: 0,
    robotWave: false,
    flybyT: 25 + Math.random() * 35,
    drops: [],
    supplyT: 35 + Math.random() * 25,
    cutin: null,
    comboFired: {},
    chatScript: null,
    chatT: 0,
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
  // the squad armory grows with you: every cleared level and every weapon
  // tier you buy filters down to their guns — damage, rate, range, mags, AP rounds
  const tiers = Object.values(char.weaponTiers || {});
  const avgTier = tiers.length ? tiers.reduce((sm, t) => sm + t, 0) / tiers.length : 0;
  const gear = 1 + (char.campaignLevel || 0) * 0.16 + avgTier * 0.25;
  return {
    type, name: def.name,
    x: world.w / 2 + (Math.random() - 0.5) * 120,
    y: world.h / 2 + (Math.random() - 0.5) * 120,
    hp: Math.round(def.hp * gear), maxHp: Math.round(def.hp * gear),
    radius: 13,
    angle: 0,
    fireCooldown: 0,
    damage: def.damage * gear,
    fireInterval: def.fireInterval / (1 + (char.campaignLevel || 0) * 0.04),
    range: def.range + (char.campaignLevel || 0) * 25,
    pierce: 1 + Math.floor((char.campaignLevel || 0) / 3),
    color: def.color,
    healAura: def.healAura, healRate: def.healRate ? def.healRate * gear : def.healRate,
    grenade: def.grenade ? { ...def.grenade, damage: def.grenade.damage * gear } : undefined,
    grenadeTimer: def.grenade ? def.grenade.interval : 0,
    mag: Math.round(def.mag * gear), magSize: Math.round(def.mag * gear), reloadTime: def.reloadTime, reloading: 0,
    reviveTimer: 0,
    down: false,
  };
}

// squad synergy: living squadmates near you sharpen your own fighting —
// the commander calls targets (+12% damage), the soldier tops your mags faster
function squadDmgMult() {
  for (const a of game.allies || []) {
    if (a.type === 'commander' && !a.down &&
        Math.hypot(a.x - game.player.x, a.y - game.player.y) < 320) return 1.12;
  }
  return 1;
}
function squadReloadMult() {
  for (const a of game.allies || []) {
    if (a.type === 'soldier' && !a.down &&
        Math.hypot(a.x - game.player.x, a.y - game.player.y) < 320) return 0.8;
  }
  return 1;
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
  // BLACKOUT: the grid is down. Scattered generators can be fuelled to light
  // a zone — but a running generator is loud and pulls the horde to it.
  if (game.blackout) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.random();
      const r = 420 + Math.random() * 620;
      game.generators.push({
        x: Math.max(80, Math.min(game.world.w - 80, game.world.w / 2 + Math.cos(a) * r)),
        y: Math.max(80, Math.min(game.world.h - 80, game.world.h / 2 + Math.sin(a) * r)),
        on: false, fuel: 0, cost: 60, radius: 300, noiseT: 0,
      });
    }
  }
  // the opening scene: your squad talks through the level as you deploy
  if (gameMode === 'campaign' && LEVEL_CHATS[level().key]) {
    game.chatScript = [...LEVEL_CHATS[level().key]];
    game.chatT = 2.5;
  }
  // STORY DIRECTOR: arm this level's in-combat narrative beats
  if (gameMode === 'campaign') {
    game.storyBeats = [...(STORY_BEATS[level().key] || [])];
    game.objective = OBJECTIVES[level().key] || '';
  }
  if (gameMode === 'drive') setupDrive();
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = Math.ceil(game.world.w * DECAL_SCALE);
  decalCanvas.height = Math.ceil(game.world.h * DECAL_SCALE);
  decalCtx = decalCanvas.getContext('2d');
  decalCtx.scale(DECAL_SCALE, DECAL_SCALE);
  screenBlood = [];
  // colored ambient light pools per level — the streets glow
  {
    const LIGHT_COLORS = {
      city: '255,190,90', graveyard: '120,230,130', sewer: '90,230,200',
      hospital: '150,210,255', base: '255,90,80', mall: '255,220,140',
      subway: '120,150,255', prison: '255,230,120', docks: '110,220,255',
      rooftops: '255,150,80',
    };
    const lc = LIGHT_COLORS[level().key] || '255,190,90';
    for (let i = 0; i < 12; i++) {
      game.lights.push({
        x: 150 + Math.random() * (game.world.w - 300),
        y: 150 + Math.random() * (game.world.h - 300),
        r: 150 + Math.random() * 130,
        c: lc,
        flicker: Math.random() * 6.28,
      });
    }
  }
  // lived-in streets: oil stains, scorch and grime baked in from the start
  for (let i = 0; i < (char.campaignLevel === 0 ? 45 : 90); i++) {
    const gx = Math.random() * game.world.w;
    const gy = Math.random() * game.world.h;
    decalCtx.fillStyle = Math.random() < 0.5 ? 'rgba(20,22,26,0.35)' : 'rgba(38,30,22,0.3)';
    decalCtx.beginPath();
    decalCtx.arc(gx, gy, 6 + Math.random() * 22, 0, Math.PI * 2);
    decalCtx.fill();
  }
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
    // WAVE 3: the dead go quiet — and the MACHINES wake up
    g.survivalT = 180;
    g.survivalPool = 5000;
    g.spawnQueue = [];
    g.robotWave = true;
    for (let i = 0; i < lv.bosses; i++) g.zombies.push(spawnLevelZombie('bot_warframe'));
    banner('⚠ ROBOT WAVE ⚠', 'THE MACHINES ARE AWAKE — SURVIVE 3:00', '#80d8ff');
    radio('echo', 'ECHO-6: "Steel signatures, thousands. The MACHINES are awake. Hold three minutes."', '#80cbc4');
    sfx.playScream();
    // REINFORCEMENTS: two survivors drop in with loaded supply crates
    const pool = HEROES.filter((h2) => h2.id !== char.heroId && h2.id !== char.partnerId);
    for (let i = 0; i < 2 && pool.length; i++) {
      const rh = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const rf = makeAlly('soldier', g.world);
      rf.type = 'reinforcement';
      rf.sprite = rh.sprite;
      rf.name = rh.name.split(' ')[0];
      rf.hp = rf.maxHp = 260;
      rf.damage *= 1.6;
      rf.color = '#80d8ff';
      rf.x = g.player.x + (Math.random() - 0.5) * 260;
      rf.y = g.player.y + (Math.random() - 0.5) * 260;
      rf.dropT = 2.2 + i * 0.6;
      g.allies.push(rf);
      g.drops.push({ x: rf.x + 50, y: rf.y + 50, landT: 2.6, life: 35 });
    }
    banner('REINFORCEMENTS INBOUND', 'two survivors dropping in — crates with them', '#80d8ff');
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
    z.radius = (big ? 24 : 19) + Math.random() * 2; // no small zombies
  }
  z.goreSkin = Math.random() < 0.4; // bloodied variant when the art exists
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
  // HD generated splats when available
  const splats = [SPRITES.splat1, SPRITES.splat2, SPRITES.splat3].filter(Boolean);
  if (splats.length) {
    const sp = splats[Math.floor(Math.random() * splats.length)];
    const size = r * (heavy ? 6 : 3.6);
    decalCtx.save();
    decalCtx.translate(x, y);
    decalCtx.rotate(Math.random() * 6.28);
    decalCtx.globalAlpha = heavy ? 0.8 : 0.6;
    decalCtx.drawImage(sp, -size / 2, -size / 2, size, size);
    decalCtx.restore();
    if (heavy && SPRITES.entrails && Math.random() < 0.25) {
      decalCtx.save();
      decalCtx.translate(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
      decalCtx.rotate(Math.random() * 6.28);
      decalCtx.globalAlpha = 0.85;
      decalCtx.drawImage(SPRITES.entrails, -r, -r, r * 2, r * 2);
      decalCtx.restore();
    }
    return;
  }
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
  const killsBefore = g.kills;
  g.explosions.push({ x, y, r: radius, t: 0.45, seed: Math.random() * 6.28 });
  rumble(0.45, 0.8, 130);
  if (SPRITES.scorch) {
    decalCtx.save();
    decalCtx.translate(x, y);
    decalCtx.rotate(Math.random() * 6.28);
    decalCtx.globalAlpha = 0.55;
    decalCtx.drawImage(SPRITES.scorch, -radius, -radius, radius * 2, radius * 2);
    decalCtx.restore();
  }
  // burning ground lingers after big blasts
  if (radius >= 110 && (g.fires || []).length < 10) {
    g.fires = g.fires || [];
    g.fires.push({ x, y, r: radius * 0.45, until: g.time + 3 });
  }
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
  if (g.kills - killsBefore >= 3) bark(BARK_LINES[Math.floor(Math.random() * BARK_LINES.length)]);
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
  rumble(0.8, 0.5, 140);
  g.streak = 0; // a hit to HEALTH resets the killstreak
  addScreenBlood(1);
  spawnBlood(p.x, p.y, 8, '#c62828');
  g.dmgNumbers.push({ x: p.x, y: p.y - 20, txt: `-${Math.round(dmg)}`, color: '#ef5350', life: 0.8, vy: -50 });
  // heavy hits open a bleeding wound — it keeps draining until you bandage it
  if (g.survival && dmg >= 12 && Math.random() < 0.45 && g.bleed < 3) {
    g.bleed++;
    banner('BLEEDING', `wound open ×${g.bleed} — [Y] to treat`, '#ef5350');
    g.dmgNumbers.push({ x: p.x, y: p.y - 40, txt: 'BLEEDING', color: '#ff1744', life: 1.4, vy: -55 });
  }
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

const LOOT_TYPES = ['medkit', 'ammo', 'ammo', 'shield', 'rage', 'nade', 'dyna', 'food', 'water', 'bandage'];

function dropLoot(x, y, guaranteed = false) {
  if (!guaranteed && Math.random() > 0.12) return;
  const type = LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)];
  game.pickups.push({ x, y, type, t: 25 });
}

function applyPickup(type) {
  const g = game;
  const d = derived(char);
  if (type === 'food' || type === 'water' || type === 'bandage') {
    const key = type === 'bandage' ? 'bandage' : type;
    g.supplies[key] = (g.supplies[key] || 0) + (type === 'bandage' ? 2 : 1);
    const label = { food: '+1 RATIONS', water: '+1 WATER', bandage: '+2 BANDAGES' }[type];
    const col = { food: '#aed581', water: '#4fc3f7', bandage: '#f8bbd0' }[type];
    g.dmgNumbers.push({ x: g.player.x, y: g.player.y - 24, txt: label, color: col, life: 1.1, vy: -50 });
    sfx.playScrapPickup();
    return;
  }
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

function goreKill(x, y, radius, dirAngle, big, robot = false) {
  const p = game.player;
  if (robot) {
    // --- ROBOT: armor plates, gears, servo arms + spark fountain + oil ---
    if (big && game.gibs.length < 260) {
      const parts = ['debris_plate', 'debris_gear', 'debris_arm'].filter((k) => SPRITES[k]);
      for (let i = 0; i < 5; i++) {
        const la = Math.random() * Math.PI * 2;
        game.gibs.push({
          x, y, vx: Math.cos(la) * (180 + Math.random() * 240), vy: Math.sin(la) * (180 + Math.random() * 240),
          rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 10, size: 9 + Math.random() * 7,
          color: '#3a4048', sprite: parts.length ? parts[Math.floor(Math.random() * parts.length)] : null,
          life: 0.7 + Math.random() * 0.4,
        });
      }
    }
    sfx.playSquelch();
    spawnBlood(x, y, big ? 34 : 14, '#23272e', dirAngle);
    for (let i = 0; i < (big ? 30 : 14) && game.particles.length < 1000; i++) {
      const sa = Math.random() * Math.PI * 2;
      game.particles.push({ x, y, vx: Math.cos(sa) * (160 + Math.random() * 340), vy: Math.sin(sa) * (160 + Math.random() * 340),
        life: 0.2 + Math.random() * 0.3, color: Math.random() < 0.6 ? '#ffd54f' : '#ff8a3d', size: 2.5 });
    }
    spawnGibs(x, y, big ? 14 : 6, dirAngle);
    stampDecal(x, y, radius, true);
    if (Math.hypot(p.x - x, p.y - y) < 140) addScreenBlood(big ? 1.0 : 0.5);
    return;
  }
  // --- FLESH: OVER-THE-TOP. Blood GUSHES, limbs fly, a pool stamps down ---
  sfx.playSquelch();
  // flying severed limbs on every kill (more on big ones)
  const limbs = ['severed_arm', 'severed_leg'].filter((k) => SPRITES[k]);
  const nLimb = big ? 5 : 2;
  if (game.gibs.length < 300) {
    for (let i = 0; i < nLimb; i++) {
      const la = Math.random() * Math.PI * 2;
      game.gibs.push({
        x, y, vx: Math.cos(la) * (200 + Math.random() * 260), vy: Math.sin(la) * (200 + Math.random() * 260),
        rot: Math.random() * 6.28, rotV: (Math.random() - 0.5) * 14, size: big ? 16 : 11,
        color: '#7b1d1d', sprite: limbs.length ? limbs[i % limbs.length] : null, life: 0.9 + Math.random() * 0.5,
      });
    }
  }
  // fountain of blood particles bursting outward
  for (let i = 0; i < (big ? 60 : 30) && game.particles.length < 1100; i++) {
    const sa = (dirAngle != null ? dirAngle : Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 2.4;
    const sp = 120 + Math.random() * 420;
    game.particles.push({ x, y, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp,
      life: 0.3 + Math.random() * 0.45, color: Math.random() < 0.7 ? '#8e0e0e' : '#c62828', size: 2 + Math.random() * 3 });
  }
  spawnBlood(x, y, big ? 60 : 28, '#7b1d1d', dirAngle);
  spawnGibs(x, y, big ? 22 : 10, dirAngle);
  // a bloodburst flash + a wet pool decal
  if (SPRITES.bloodburst) game.slashFx.push({ x, y, t: 0.35, sprite: 'bloodburst', r: radius * (big ? 4 : 2.6), rot: Math.random() * 6.28 });
  stampBloodPool(x, y, radius * (big ? 2.2 : 1.4));
  stampDecal(x, y, radius, true);
  addShake(big ? 5 : 2);
  if (Math.hypot(p.x - x, p.y - y) < 170) addScreenBlood(big ? 1.6 : 0.9);
}

// stamp a wet blood-pool sprite onto the persistent decal canvas
function stampBloodPool(x, y, r) {
  const sp = SPRITES.blood_pool;
  if (!sp) return;
  decalCtx.save();
  decalCtx.translate(x, y);
  decalCtx.rotate(Math.random() * 6.28);
  decalCtx.globalAlpha = 0.85;
  const k = (r * 2) / Math.max(sp.width, sp.height);
  decalCtx.drawImage(sp, -sp.width * k / 2, -sp.height * k / 2, sp.width * k, sp.height * k);
  decalCtx.restore();
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
  let survPen = 1;
  if (g.survival) {
    if (g.needs.thirst < 25) survPen *= 0.82;   // parched: heavy legs
    if (g.needs.fatigue < 25) survPen *= 0.88;  // exhausted
  }
  const spd = p.speed * d.moveMult * survPen * (sprinting ? p.sprintMult : 1);

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
  p.animDist = (p.animDist || 0) + speedMag * dt; // frames step by DISTANCE
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

  // -- WEAPON WHEEL: hold right-mouse to fan out owned guns, aim to a slot,
  // release to equip. Firing is suppressed while the wheel is open.
  const owned = ownedList();
  g.wheelOpen = input.mouse.right && owned.length > 1;
  if (g.wheelOpen) {
    const dx = input.mouse.x - view.w / 2;
    const dy = input.mouse.y - view.h / 2;
    if (Math.hypot(dx, dy) > 26) {
      // top slot = -90°; slots fan clockwise
      let ang = Math.atan2(dy, dx) + Math.PI / 2;
      if (ang < 0) ang += Math.PI * 2;
      g.wheelPick = Math.round(ang / (Math.PI * 2 / owned.length)) % owned.length;
    }
  } else if (wasPressed('wheel-release') && g.wheelPick != null) {
    const w = owned[g.wheelPick];
    if (w && p.weapon !== w) {
      p.weapon = w;
      p.reloading = 0;
      p.fireCooldown = Math.max(p.fireCooldown, 0.15);
      sfx.playReload();
    }
    g.wheelPick = null;
  }

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
    p.reloading = ws.reloadTime * squadReloadMult() * (g.survival && g.needs.fatigue < 25 ? 1.35 : 1);
    sfx.playReload();
  }

  // -- shooting (mouse or RT)
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.muzzleFlash = Math.max(0, p.muzzleFlash - dt);
  const holdFire = (input.mouse.down || gamepad.fire) && !game.wheelOpen && !g.buildMode;
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
        rumble(0.25, 0.6, 70);
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
          damage: ws.damage * squadDmgMult() * (1 + (g.overclock || 0)), color: ws.color,
          life: ws.flame ? 0.32 : ws.mortar ? (ws.rocket ? 1.4 : 0.85) : 1.2,
          pierce: ws.pierce ?? 1, hit: new Set(), friendly: false,
          mortar: !!ws.mortar, rocket: !!ws.rocket, flame: !!ws.flame,
        });
      }
      if (p.mags[p.weapon] === 0 && p.reserve[p.weapon] > 0) {
        p.reloading = ws.reloadTime * squadReloadMult() * (g.survival && g.needs.fatigue < 25 ? 1.35 : 1);
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
      rot: 0, spin: (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 8),
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
    tb.rot = (tb.rot || 0) + (tb.spin || 12) * dt;
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

  // -- GRAB & THROW [B]: seize a nearby zombie, then hurl it as a living
  // projectile — it bowls through the crowd dealing heavy chain damage
  if (wasPressed('b')) {
    if (g.heldZombie && g.heldZombie.hp > 0) {
      const hz = g.heldZombie;
      hz.grabbed = false;
      hz.thrown = { vx: Math.cos(p.angle) * 980, vy: Math.sin(p.angle) * 980, t: 0.55 };
      g.heldZombie = null;
      g.dmgNumbers.push({ x: p.x, y: p.y - 30, txt: 'HURLED!', color: '#ffd54f', life: 0.9, vy: -55 });
      sfx.playHiggsWhomp();
      addShake(4);
    } else if (!g.heldZombie) {
      let best = null, bd = 74;
      for (const z of g.zombies) {
        if (z.hp <= 0 || z.radius > 20 || z.super || z.waveBossName) continue; // too big to lift
        const d = Math.hypot(z.x - p.x, z.y - p.y);
        if (d < bd) { bd = d; best = z; }
      }
      if (best) {
        best.grabbed = true;
        best.grabT = 3;
        best.thrown = null;
        g.heldZombie = best;
        g.dmgNumbers.push({ x: p.x, y: p.y - 30, txt: 'GRABBED — [B] THROW', color: '#80cbc4', life: 1.1, vy: -45 });
        sfx.playSquelch();
      }
    }
  }
  if (g.heldZombie) {
    const hz = g.heldZombie;
    if (hz.hp <= 0) {
      g.heldZombie = null;
    } else {
      hz.grabT -= dt;
      hz.x = p.x + Math.cos(p.angle) * (p.radius + 30);
      hz.y = p.y + Math.sin(p.angle) * (p.radius + 30);
      if (hz.grabT <= 0) { // it wriggles free with a weak toss
        hz.grabbed = false;
        hz.thrown = { vx: Math.cos(p.angle) * 420, vy: Math.sin(p.angle) * 420, t: 0.35 };
        g.heldZombie = null;
      }
    }
  }

  // -- BLADESTORM [Z]: a ring of spinning razor discs orbits you, shredding
  // anything they touch — cuts weak zombies clean in half
  g.bladeCd = Math.max(0, (g.bladeCd || 0) - dt);
  if ((wasPressed('z') || gpPressed('l3')) && g.bladeCd <= 0) {
    g.bladeUntil = g.time + 8;
    g.bladeCd = 16;
    g.blades = [0, 1, 2, 3].map((i) => ({ a: (i / 4) * Math.PI * 2 }));
    banner('BLADESTORM', 'razor discs deployed — carve them up', '#e0e0e0');
    sfx.playHiggsWhomp();
  }
  if (g.time < g.bladeUntil) {
    const orbit = 96, bladeDmg = 90 * dt * 60 / 60; // dps applied per contact tick
    for (const bl of g.blades) {
      bl.a += dt * 7; // fast spin around you
      bl.x = p.x + Math.cos(bl.a) * orbit;
      bl.y = p.y + Math.sin(bl.a) * orbit;
      for (const z of g.zombies) {
        if (z.hp <= 0) continue;
        if (Math.hypot(z.x - bl.x, z.y - bl.y) < z.radius + 20) {
          z.hp -= 55 * dt * 8; // heavy shred
          z.flash = 0.1;
          if (Math.random() < dt * 20) spawnBlood(z.x, z.y, 3, '#8e0e0e');
          if (z.hp <= 0) killZombie(z, bl.a);
        }
      }
    }
  } else {
    g.blades = [];
  }

  // gore flash sprites (bloodburst) fade fast
  for (const sf of g.slashFx) sf.t -= dt;
  g.slashFx = g.slashFx.filter((sf) => sf.t > 0);

  // -- STORY DIRECTOR: one dramatic beat at a time, typed out mid-combat
  if (g.storyLine) {
    g.storyLine.t += dt;
    if (g.storyLine.t > g.storyLine.dur) g.storyLine = null;
  } else if (g.storyBeats.length) {
    const b = g.storyBeats[0];
    const w = b.when || {};
    const hit = (w.at != null && g.time >= w.at) ||
      (w.kills != null && g.kills >= w.kills) ||
      (w.wave != null && g.wave >= w.wave);
    if (hit) {
      g.storyBeats.shift();
      g.storyLine = { ...b, t: 0, dur: 5.6 };
      if (b.objective) g.objective = b.objective;
      if (b.fx === 'shake') addShake(9);
      else if (b.fx === 'flare') { g.hurtVoiceFlash = 0.5; addShake(5); sfx.playScream(); }
      else if (b.fx === 'horde') { for (let i = 0; i < 20; i++) g.zombies.push(spawnLevelZombie(randomZombieType(char.campaignLevel))); }
      else if (b.fx === 'strike') { for (let i = 0; i < 4; i++) g.strikes.push({ x: p.x + (Math.random() - 0.5) * 500, y: p.y + (Math.random() - 0.5) * 500, t: 0.4 + i * 0.3 }); }
    }
  }
  if (g.hurtVoiceFlash > 0) g.hurtVoiceFlash -= dt;

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
        // flame core: everything inside catches fire and burns down
        z.hp -= 70 * dt;
        z.burnUntil = Math.max(z.burnUntil || 0, g.time + 1.2);
        if (Math.random() < dt * 6) spawnBlood(z.x, z.y, 2, '#ff7043');
        if (z.hp <= 0) killZombie(z, Math.atan2(z.y - p.y, z.x - p.x));
      } else if (char.shieldType === 'blue') {
        // blue core: a physical wall — the horde gets shoved off you
        const push = 260 * dt / Math.max(dist, 20);
        z.x += (z.x - p.x) * push;
        z.y += (z.y - p.y) * push;
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
      g.zombies.push(spawnLevelZombie(g.robotWave ? randomBotType() : randomZombieType(char.campaignLevel)));
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
      banner('MACHINE WAVE BROKEN', 'but something bigger is coming…', '#ffd54f');
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
      g.bossIntroT = 2.4;
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
    if (g.wave < lv.waves && !(g.waveBossDone || {})[g.wave]) {
      // every wave ends in a BOSS FIGHT — clear it to advance
      g.waveBossDone = g.waveBossDone || {};
      g.waveBossDone[g.wave] = true;
      const names = WAVE_BOSSES[lv.key] || ['THE BRUTE LORD', 'THE BRUTE LORD'];
      const bn = names[(g.wave - 1) % names.length];
      const wb = spawnLevelZombie('boss');
      wb.hp = wb.maxHp = Math.round(wb.maxHp * (0.5 + g.wave * 0.25));
      wb.radius = Math.round(wb.radius * 1.1);
      wb.waveBossName = bn;
      g.zombies.push(wb);
      for (let i = 0; i < 4 + g.wave * 2; i++) g.zombies.push(spawnLevelZombie(randomZombieType(char.campaignLevel)));
      banner(`WAVE ${g.wave} BOSS`, bn, '#ff1744');
      radio('echo', `ECHO-6: "Big contact. That's ${bn}. Put it DOWN."`, '#ff8a80');
      sfx.playScream();
      addShake(6);
    } else if (g.wave >= lv.waves) {
      if (gameMode === 'campaign' && !g.extract) {
        // ALL waves down: EVAC-1 comes for you — hold the LZ and board
        g.extract = { phase: 'inbound', t: 0, gunT: 0, tracerT: 0, alt: 1,
          x: p.x - view.w * 0.9, y: p.y - view.h * 0.9,
          tx: p.x + 40, ty: p.y - 30, ang: 0 };
        banner('EXTRACTION INBOUND', 'EVAC-1 en route — hold the LZ', '#80cbc4');
        radio('echo', 'ECHO-6: "EVAC-1 inbound, door gunner\'s hot. One last push — GO LOUD."', '#80cbc4');
        // the horde makes one final play for the landing zone
        for (let i = 0; i < 12 + char.campaignLevel * 2; i++) {
          g.zombies.push(spawnLevelZombie(randomZombieType(char.campaignLevel)));
        }
        sfx.playScream();
      } else if (gameMode !== 'campaign') {
        if (!g.levelClearing) {
          g.levelClearing = true;
          banner('LEVEL CLEARED', `+${lv.scrapBonus} scrap bonus`, '#ffd54f');
        }
        g.intermission += dt;
        if (g.intermission > 2) completeLevel();
      }
    } else {
      g.intermission += dt;
      if (g.intermission > 3) {
        g.intermission = 0;
        nextWave();
      }
    }
  }

  // -- EXTRACTION: EVAC-1 flies in, guns the horde, lands, pulls you out
  if (g.extract) updateExtract(dt);

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
    // on fire: damage over time + ember spray until the burn runs out
    if (z.burnUntil && g.time < z.burnUntil && z.hp > 0) {
      z.hp -= 32 * dt;
      if (Math.random() < dt * 9) {
        g.particles.push({
          x: z.x + (Math.random() - 0.5) * z.radius * 2, y: z.y + (Math.random() - 0.5) * z.radius * 2,
          vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 60,
          life: 0.3 + Math.random() * 0.25, color: Math.random() < 0.5 ? '#ffab40' : '#ff7043', size: 3,
        });
      }
      if (z.hp <= 0) { killZombie(z, Math.random() * 6.28); continue; }
    }
    if (z.grabbed) { // pinned in your grip: no AI, just squirming
      z.flash = Math.max(0, z.flash - dt);
      continue;
    }
    if (z.thrown) { // airborne battering ram
      z.thrown.t -= dt;
      z.x += z.thrown.vx * dt;
      z.y += z.thrown.vy * dt;
      z.thrown.vx *= 0.97;
      z.thrown.vy *= 0.97;
      for (const z2 of g.zombies) {
        if (z2 === z || z2.hp <= 0 || z2.grabbed) continue;
        if (Math.hypot(z2.x - z.x, z2.y - z.y) < z2.radius + z.radius) {
          z2.hp -= 95;
          z2.flash = 0.1;
          spawnBlood(z.x, z.y, 8, '#8e0e0e');
          const ka = Math.atan2(z2.y - z.y, z2.x - z.x);
          z2.x += Math.cos(ka) * 26;
          z2.y += Math.sin(ka) * 26;
          if (z2.hp <= 0) killZombie(z2, ka);
        }
      }
      if (z.thrown.t <= 0) { // hard landing
        const la = Math.atan2(z.thrown.vy, z.thrown.vx);
        z.thrown = null;
        z.hp -= 130;
        z.flash = 0.15;
        spawnBlood(z.x, z.y, 12, '#8e0e0e', la);
        addShake(2);
        if (z.hp <= 0) killZombie(z, la);
      }
      collideProps(z);
      continue;
    }
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
      z.walking = spdZ; // remember it moved this frame
      z.animDist = (z.animDist || 0) + spdZ * dt;
    }
    if (!(distT > 1 && !holdPosition)) z.walking = 0;
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
        // barricades in the way get torn apart first
        let smashed = false;
        for (let bi = g.props.length - 1; bi >= 0; bi--) {
          const br = g.props[bi];
          if (br.kind !== 'barricade_built') continue;
          const cxp = Math.max(br.x, Math.min(z.x, br.x + br.w));
          const cyp = Math.max(br.y, Math.min(z.y, br.y + br.h));
          if (Math.hypot(z.x - cxp, z.y - cyp) < z.radius + 12) {
            br.hp -= z.damage * 1.6;
            z.attackCooldown = 0.8;
            smashed = true;
            for (let k = 0; k < 4; k++) {
              const sa = Math.random() * Math.PI * 2;
              g.particles.push({ x: cxp, y: cyp, vx: Math.cos(sa) * 120, vy: Math.sin(sa) * 120,
                life: 0.25, color: '#a1887f', size: 2.5 });
            }
            if (br.hp <= 0) {
              g.props.splice(bi, 1);
              addShake(3);
              banner('BARRICADE DOWN', 'they are through', '#ef5350');
            }
            break;
          }
        }
        if (smashed) { z.flash = Math.max(z.flash, 0.05); }
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
    if (a.dropT > 0) { a.dropT -= dt; continue; } // still on the chute
    const dp = Math.hypot(p.x - a.x, p.y - a.y);
    if (a.type === 'partner') {
      // the sidekick has a mind of its own: roams and picks its own fights,
      // unless you call it back with Q
      a.shieldHitT = (a.shieldHitT ?? 99) + dt;
      if (a.shieldMax && a.shield < a.shieldMax && a.shieldHitT > 3) {
        a.shield = Math.min(a.shieldMax, a.shield + 10 * dt);
      }
      const called = g.time < (a.followUntil || 0);
      if (called || dp > 620) {
        // recalled (or drifting too far): hustle back — the sidekick FLOWS with you
        if (dp > 110) {
          a.x += ((p.x - a.x) / dp) * 260 * dt;
          a.y += ((p.y - a.y) / dp) * 260 * dt;
          a.walkPhase = (a.walkPhase || 0) + 260 * dt * 0.05;
        }
      } else {
        a.roamT = (a.roamT || 0) - dt;
        if (a.roamT <= 0 || !a.roamTarget) {
          a.roamT = 5 + Math.random() * 4;
          a.roamTarget = {
            x: Math.max(40, Math.min(g.world.w - 40, p.x + (Math.random() - 0.5) * 700)),
            y: Math.max(40, Math.min(g.world.h - 40, p.y + (Math.random() - 0.5) * 700)),
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
            damage: mirror ? mirror.damage * 0.75 : a.damage,
            color: mirror ? mirror.color : a.color, life: 1.0,
            pierce: Math.max(mirror ? mirror.pierce || 1 : 1, a.pierce || 1, a.type === 'commander' ? 2 : 1),
            hit: new Set(), friendly: true,
          });
        }
      }
    } else {
      a.angle = p.angle;
    }
    // sidekick chatter brain: a tiny rule-based AI that reads the fight
    if (a.type === 'partner') {
      a.brainT = (a.brainT || 4) - dt;
      if (a.hp < a.maxHp * 0.3 && g.time > (a.helpAt || 0)) {
        a.helpAt = g.time + 10;
        radio(a.name, `${a.name}: "I NEED HELP OVER HERE!"`, '#ef9a9a');
        sfx.playScream();
      } else if (a.brainT <= 0) {
        a.brainT = 9 + Math.random() * 6;
        const near = g.zombies.filter((zz) => Math.hypot(zz.x - a.x, zz.y - a.y) < 400).length;
        let line;
        if (g.superBoss && g.superBoss.hp > 0) line = 'That thing is HUGE. Aim for the glow!';
        else if (near > 25) line = "They're everywhere — back to back!";
        else if (p.hp < derived(char).maxHp * 0.3) line = "You're bleeding bad. Find a medkit!";
        else if (g.player.reserve[p.weapon] !== Infinity && g.player.reserve[p.weapon] < 10) line = 'Running dry? Ammo crates on the map!';
        else if (g.combo >= 25) line = 'LOOK AT YOU GO!';
        else line = ['Clear so far.', 'Stay sharp.', 'Nice shooting.', 'I count more coming.'][Math.floor(Math.random() * 4)];
        radio(a.name, `${a.name}: "${line}"`, a.color);
      }
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

  // -- ground fire burns whatever stands in it
  g.fires = (g.fires || []).filter((f2) => g.time < f2.until);
  for (const f2 of g.fires) {
    for (const z of g.zombies) {
      if (z.hp <= 0) continue;
      if (Math.hypot(z.x - f2.x, z.y - f2.y) < f2.r + z.radius) {
        z.hp -= 35 * dt;
        if (z.hp <= 0) killZombie(z, Math.atan2(z.y - f2.y, z.x - f2.x));
      }
    }
  }

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

  // -- BONUS SUPPLY DROPS: a crate parachutes in near the fight
  if (gameMode === 'campaign') {
    g.supplyT = (g.supplyT ?? 40) - dt;
    if (g.supplyT <= 0) {
      g.supplyT = 45 + Math.random() * 30;
      const a2 = Math.random() * Math.PI * 2;
      const r2 = 260 + Math.random() * 320;
      g.drops.push({
        x: Math.max(60, Math.min(g.world.w - 60, p.x + Math.cos(a2) * r2)),
        y: Math.max(60, Math.min(g.world.h - 60, p.y + Math.sin(a2) * r2)),
        landT: 2.6, life: 30,
      });
      banner('SUPPLY DROP INBOUND', 'grab the crate — big bonus inside', '#ffd54f');
      sfx.playFanfare();
    }
  }
  for (const dr of g.drops || []) {
    if (dr.landT > 0) { dr.landT -= dt; continue; }
    dr.life -= dt;
    if (Math.hypot(p.x - dr.x, p.y - dr.y) < 34) {
      dr.life = 0;
      const lacks = ['flamer', 'minigun'].filter((w3) => !char.ownedWeapons.includes(w3));
      const roll = Math.random();
      if (lacks.length && roll < 0.45) {
        // WEAPON CACHE: the drop crews hand out the heavy stuff
        const w3 = lacks[0];
        char.ownedWeapons.push(w3);
        p.mags[w3] = weaponStats(char, w3).magSize;
        p.reserve[w3] = AMMO_RESERVE[w3];
        saveCharacter(char);
        banner('WEAPON CACHE', `${WEAPONS[w3].name} UNLOCKED — courtesy of the drop crews`, '#ffd54f');
        g.dmgNumbers.push({ x: dr.x, y: dr.y - 20, txt: `★ ${WEAPONS[w3].name}`, color: '#ffd54f', life: 1.8, vy: -45 });
      } else if (roll < 0.22) {
        const amt = 150 + Math.floor(Math.random() * 250);
        char.scrap += amt;
        g.dmgNumbers.push({ x: dr.x, y: dr.y - 20, txt: `★ BONUS +⚙${amt}`, color: '#ffd740', life: 1.6, vy: -45 });
      } else if (roll < 0.44) {
        for (const w2 of Object.keys(p.reserve)) if (p.reserve[w2] !== Infinity) p.reserve[w2] += Math.round(AMMO_RESERVE[w2] * 0.5);
        g.dmgNumbers.push({ x: dr.x, y: dr.y - 20, txt: '★ AMMO RESUPPLY', color: '#80d8ff', life: 1.6, vy: -45 });
      } else if (roll < 0.62) {
        char.nades.frag += 2;
        char.dynamite = (char.dynamite || 0) + 1;
        g.buffs.rage = Math.max(g.buffs.rage, 6);
        g.dmgNumbers.push({ x: dr.x, y: dr.y - 20, txt: '★ ORDNANCE + RAGE', color: '#ff7043', life: 1.6, vy: -45 });
      } else if (roll < 0.82) {
        // HACK CHIP: every chip overclocks your guns further — they stack
        g.overclock = Math.min(1.0, (g.overclock || 0) + 0.1);
        g.dmgNumbers.push({ x: dr.x, y: dr.y - 20, txt: `⚡ HACK CHIP — OVERCLOCK +${Math.round(g.overclock * 100)}%`, color: '#69f0ae', life: 1.8, vy: -45 });
        banner('GUNS OVERCLOCKED', `weapon damage +${Math.round(g.overclock * 100)}% this level`, '#69f0ae');
      } else {
        // INSTANT AIRSTRIKE around your position
        for (let i2 = 0; i2 < 10; i2++) {
          const a3 = Math.random() * Math.PI * 2;
          const r3 = 130 + Math.random() * 380;
          g.strikes.push({ x: p.x + Math.cos(a3) * r3, y: p.y + Math.sin(a3) * r3, t: 0.3 + i2 * 0.2 });
        }
        banner('AIRSTRIKE PACKAGE', 'danger close', '#ff8a3d');
      }
      if (roll >= 0.45 || !lacks.length) banner('SUPPLY SECURED', 'the drop crews still love you', '#ffd54f');
      sfx.playPurchase();
      addShake(3);
    }
  }
  g.drops = (g.drops || []).filter((dr) => dr.life > 0);

  // -- FLYBY EVENTS: allied gunships patrol overhead on a timer; on later
  // levels some swing low and strafe the swarm (suggested SFX: rotor whump
  // doppler pass + cannon burr on strafing runs)
  if (gameMode === 'campaign') {
    g.flybyT = (g.flybyT ?? 40) - dt;
    if (g.flybyT <= 0) {
      g.flybyT = 55 + Math.random() * 45;
      const strafing = char.campaignLevel >= 3 && Math.random() < 0.35;
      const dir2 = Math.random() < 0.5 ? 1 : -1;
      g.bombers.push({
        x: p.x - dir2 * 950, y: p.y + (Math.random() - 0.5) * 360,
        vx: dir2 * (700 + Math.random() * 200),
        dropT: 0.5, drops: strafing ? 3 : 0, life: 2.9, sp: SPRITES.fighterjet ? 'fighterjet' : 'gunship',
      });
      if (strafing) {
        banner('GUNSHIP ON STATION', 'danger close — strafing run', '#80cbc4');
        radio('echo', 'ECHO-6: "Friendly air. Keep your head down."', '#80cbc4');
      }
    }
  }
  // -- combo air support: the jet streaks past, bombs walking beneath it
  for (const bm of g.bombers || []) {
    bm.x += bm.vx * dt;
    bm.life -= dt;
    bm.dropT -= dt;
    if (bm.dropT <= 0 && bm.drops > 0) {
      bm.drops--;
      bm.dropT = 0.16;
      g.strikes.push({ x: bm.x + 60, y: bm.y + 40 + (Math.random() - 0.5) * 120, t: 0.35 });
    }
  }
  g.bombers = (g.bombers || []).filter((bm) => bm.life > 0);

  // -- BUILD MODE [N]: fortify. Place wooden barricades for scrap; the
  // infected have to chew through them, which buys you the seconds that
  // decide a night. Blocks your own line too — funnel them, don't wall in.
  if (wasPressed('n')) {
    g.buildMode = !g.buildMode;
    banner(g.buildMode ? 'BUILD MODE' : 'BUILD MODE OFF',
      g.buildMode ? `click to raise a barricade · ⚙${g.barricadeCost} · [N] exit` : 'back to fighting', '#a1887f');
  }
  if (g.buildMode && wasPressed('mouse')) {
    const wx = cam.x + input.mouse.x, wy = cam.y + input.mouse.y;
    const near = Math.hypot(wx - p.x, wy - p.y) < 300;
    if (!near) {
      g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'TOO FAR', color: '#ef5350', life: 0.9, vy: -45 });
    } else if (char.scrap < g.barricadeCost) {
      sfx.playDenied();
      g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: `NEED ⚙${g.barricadeCost}`, color: '#ef5350', life: 1, vy: -45 });
    } else {
      char.scrap -= g.barricadeCost;
      saveCharacter(char);
      // orient the plank across your facing so it blocks the way you're looking
      const horiz = Math.abs(Math.cos(p.angle)) < 0.5;
      const bw = horiz ? 96 : 20, bh = horiz ? 20 : 96;
      g.props.push({
        x: wx - bw / 2, y: wy - bh / 2, w: bw, h: bh,
        kind: 'barricade_built', low: false, seed: Math.random(),
        hp: 320, maxHp: 320,
      });
      sfx.playReload();
      g.dmgNumbers.push({ x: wx, y: wy - 20, txt: 'BARRICADE UP', color: '#a1887f', life: 1, vy: -40 });
    }
  }

  // -- SURVIVAL SIM: needs decay, wounds bleed, [Y] uses the right supply
  if (g.survival) {
    const n = g.needs;
    n.hunger = Math.max(0, n.hunger - dt * 0.42);
    n.thirst = Math.max(0, n.thirst - dt * 0.62);
    n.fatigue = Math.max(0, n.fatigue - dt * 0.33);
    if (g.bleed > 0) {
      p.hp -= g.bleed * 1.5 * dt;
      if (Math.random() < dt * 3.5) spawnBlood(p.x, p.y, 1, '#8e0e0e');
    }
    if (n.hunger <= 0 || n.thirst <= 0) p.hp -= 1.4 * dt;
    if (wasPressed('y')) {
      const sup = g.supplies;
      if (g.bleed > 0 && sup.bandage > 0) {
        sup.bandage--; g.bleed--;
        g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'WOUND BANDAGED', color: '#81c784', life: 1.2, vy: -50 });
        sfx.playPurchase();
      } else if (n.thirst < n.hunger && sup.water > 0) {
        sup.water--; n.thirst = Math.min(100, n.thirst + 55);
        g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'WATER +55', color: '#4fc3f7', life: 1.1, vy: -50 });
        sfx.playScrapPickup();
      } else if (sup.food > 0) {
        sup.food--; n.hunger = Math.min(100, n.hunger + 60); n.fatigue = Math.min(100, n.fatigue + 15);
        g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'RATIONS +60', color: '#aed581', life: 1.1, vy: -50 });
        sfx.playScrapPickup();
      } else {
        sfx.playDenied();
        g.dmgNumbers.push({ x: p.x, y: p.y - 26, txt: 'NO SUPPLIES', color: '#ef5350', life: 1, vy: -45 });
      }
    }
    g.needWarnT -= dt;
    if (g.needWarnT <= 0) {
      g.needWarnT = 22;
      if (n.thirst < 22) radio('echo', 'ECHO-6: "You sound dry. Find water before it starts costing you."', '#4fc3f7');
      else if (n.hunger < 22) radio('echo', 'ECHO-6: "You have not eaten. That shake in your hands is real."', '#aed581');
      else if (n.fatigue < 22) radio('echo', 'ECHO-6: "You are running on empty. Slow down or you will make a mistake."', '#ce93d8');
    }
  }

  // -- GENERATORS: pay scrap to fuel one; it lights a zone while it burns,
  // but the engine noise drags every nearby infected straight to it
  for (const gen of g.generators || []) {
    const near = Math.hypot(p.x - gen.x, p.y - gen.y) < 80;
    if (near && !gen.on && (wasPressed('f') || gpPressed('a'))) {
      if (char.scrap >= gen.cost) {
        char.scrap -= gen.cost;
        saveCharacter(char);
        gen.on = true;
        gen.fuel = 45;
        sfx.playPurchase();
        banner('GENERATOR ONLINE', 'light up — but they HEAR it', '#ffd54f');
        radio('echo', 'ECHO-6: "Power\'s up on your position. So is every ear in the county."', '#80cbc4');
      } else {
        sfx.playDenied();
        g.dmgNumbers.push({ x: p.x, y: p.y - 24, txt: `NEED ⚙${gen.cost}`, color: '#ef5350', life: 1, vy: -40 });
      }
    }
    if (gen.on) {
      gen.fuel -= dt;
      if (gen.fuel <= 0) {
        gen.on = false;
        banner('GENERATOR DRY', 'the dark comes back', '#90a4ae');
      }
      // engine noise: periodically drag nearby infected toward the sound
      gen.noiseT -= dt;
      if (gen.noiseT <= 0) {
        gen.noiseT = 1.2;
        for (const z of g.zombies) {
          if (z.hp <= 0) continue;
          const d = Math.hypot(z.x - gen.x, z.y - gen.y);
          if (d < 900 && d > 1) {
            z.x += ((gen.x - z.x) / d) * 26;
            z.y += ((gen.y - z.y) / d) * 26;
          }
        }
      }
    }
  }

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
        banner('STASH BREACHED', 'jackpot inside', '#ffd54f');
        // RICH interior loot: a burst of scrap, multiple pickups, a cache,
        // and a chance at a free weapon cache the deeper the level
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * Math.PI * 2;
          g.scraps.push({ x: pr.lootX, y: pr.lootY, vx: Math.cos(a) * (60 + Math.random() * 110), vy: Math.sin(a) * (60 + Math.random() * 110), amount: 20 + Math.floor(Math.random() * 35) });
        }
        dropLoot(pr.lootX + 26, pr.lootY, true);
        dropLoot(pr.lootX - 26, pr.lootY, true);
        dropLoot(pr.lootX, pr.lootY - 26, true);
        g.caches.push({ x: pr.lootX, y: pr.lootY + 30, radius: 16, taken: false, pulse: 0 });
        const lacks = ['flamer', 'minigun', 'railgun', 'sniper'].filter((w3) => !char.ownedWeapons.includes(w3));
        if (lacks.length && Math.random() < 0.3 + char.campaignLevel * 0.05) {
          const w3 = lacks[Math.floor(Math.random() * lacks.length)];
          char.ownedWeapons.push(w3);
          p.mags[w3] = weaponStats(char, w3).magSize;
          p.reserve[w3] = AMMO_RESERVE[w3];
          banner('WEAPON IN THE STASH', `${WEAPONS[w3].name} UNLOCKED`, '#ffd54f');
        }
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
        if (b.flame) z.burnUntil = Math.max(z.burnUntil || 0, g.time + 2); // catches fire
        b.hit.add(z);
        if (!b.friendly) g.hits++;
        // white impact sparks, SYNTHETIK flash
        for (let sp2 = 0; sp2 < 3; sp2++) {
          const sa2 = dir + Math.PI + (Math.random() - 0.5) * 1.4;
          g.particles.push({
            x: b.x, y: b.y,
            vx: Math.cos(sa2) * (140 + Math.random() * 160),
            vy: Math.sin(sa2) * (140 + Math.random() * 160),
            life: 0.12 + Math.random() * 0.1, color: Math.random() < 0.5 ? '#fff' : '#ffd54f', size: 2.5,
          });
        }
        if (g.time - (g.lastTick || 0) > 0.05) {
          g.lastTick = g.time;
          sfx.playHitTick();
        }
        if (b.hit.size >= b.pierce) b.life = 0;
        spawnBlood(b.x, b.y, 7, '#2a2e36', dir); // oil spray
        if (crit) spawnBlood(b.x, b.y, 8, '#ffb74d', dir); // crit = molten spray
        if (!b.friendly) {
          // damage tiers paint the numbers: white -> yellow -> orange -> red
          const tierColor = crit ? '#ffd740' : dmg < 25 ? '#e8e8e8' : dmg < 60 ? '#ffee58' : dmg < 150 ? '#ff9100' : '#ff5252';
          g.dmgNumbers.push({
            x: z.x + (Math.random() - 0.5) * 16, y: z.y - z.radius,
            txt: crit ? `${dmg}!` : `${dmg}`,
            color: tierColor,
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
    if (b.rocket && Math.random() < 0.8) {
      g.particles.push({
        x: b.x - b.vx * 0.015, y: b.y - b.vy * 0.015,
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        life: 0.3 + Math.random() * 0.2, color: 'rgba(160,160,160,0.5)', size: 5,
      });
    }
    if (b.mortar && b.life <= 0 && !b.boomed) {
      b.boomed = true;
      explode(b.x, b.y, b.rocket ? 175 : 95, b.rocket ? 360 : 170, false);
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
  // old blood and scorch fades away so long fights don't drown the map
  g.decalFadeT = (g.decalFadeT ?? 1.5) - dt;
  if (g.decalFadeT <= 0) {
    g.decalFadeT = 1.5;
    decalCtx.save();
    decalCtx.setTransform(1, 0, 0, 1, 0, 0);
    decalCtx.globalCompositeOperation = 'destination-out';
    decalCtx.globalAlpha = 0.045;
    decalCtx.fillStyle = '#000';
    decalCtx.fillRect(0, 0, decalCanvas.width, decalCanvas.height);
    decalCtx.restore();
  }
  if (g.combo > 0) {
    g.comboT -= dt;
    if (g.comboT <= 0) {
      if (g.combo >= 10) {
        const bonus = g.combo * 2;
        char.scrap += bonus;
        g.dmgNumbers.push({ x: p.x, y: p.y - 30, txt: `COMBO ×${g.combo} BANKED +⚙${bonus}`, color: '#ffd740', life: 1.3, vy: -40 });
      }
      g.combo = 0;
      g.comboFired = {};
    }
  }
  for (const sb of screenBlood) sb.alpha -= dt * 0.3;
  screenBlood = screenBlood.filter((sb) => sb.alpha > 0.02);
  for (const rl of radioLines) rl.t -= dt;
  radioLines = radioLines.filter((rl) => rl.t > 0);
  // opening level banter: hero and partner talk the situation through
  if (g.chatScript && g.chatScript.length && g.time >= g.chatT) {
    const [who, line] = g.chatScript.shift();
    const hname = heroById(char.heroId).name.split(' ')[0];
    const pname = char.partnerId ? heroById(char.partnerId).name.split(' ')[0]
      : (g.allies[0] ? g.allies[0].name : 'ECHO-6');
    const nm = who === 'hero' ? hname : pname;
    radio(nm, `${nm}: "${line}"`, who === 'hero' ? '#80cbc4' : '#b39ddb');
    g.chatT = g.time + 4.4;
  }

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
  bot_breacher: [6, 4], bot_scout: [6, 4], bot_juggernaut: [18, 8],
  bot_kamikaze: [7, 4], bot_marksman: [12, 6], bot_enforcer: [10, 5],
  bot_overseer: [14, 6], bot_warframe: [120, 60],
};

function killZombie(z, dirAngle) {
  const g = game;
  if (z._dead) return;
  z._dead = true;
  // COMBO: chain kills inside 2.2s for multiplied score + scrap
  g.combo++;
  g.comboT = 2.2;
  g.comboBest = Math.max(g.comboBest, g.combo);
  const HYPE = { 10: 'RAMPAGE!', 25: 'MASSACRE!', 50: 'UNSTOPPABLE!', 100: 'GODLIKE!' };
  if (HYPE[g.combo]) {
    bark(HYPE[g.combo]);
    banner(HYPE[g.combo], `COMBO ×${g.combo} — +${g.combo * 10} SCORE`, '#ffd740');
    g.score += g.combo * 10;
    g.hypeFlash = 0.3;
    sfx.playFanfare();
    addShake(8);
  }
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
  addShake(2.2);
  // kills right next to you can paint the camera lens (throttled)
  if (Math.hypot(z.x - g.player.x, z.y - g.player.y) < 110 &&
      g.time > (g.lensBloodAt || 0)) {
    g.lensBloodAt = g.time + 2.5;
    addScreenBlood(0.5);
  }
  const bigKill = z.radius > 19 || z.super;
  // kill X grows with your combo — at high chains they get HUGE
  const xr = (bigKill ? 26 : 13) * (1 + Math.min(2.2, g.combo * 0.045));
  g.killMarks.push({ x: z.x, y: z.y, t: 0.65, big: bigKill, r: Math.max(24, xr), rot: (Math.random() - 0.5) * 0.7 });
  // deep combos stamp extra X's around the kill — the screen reads CARNAGE
  if (g.combo >= 10) {
    const extra = Math.min(3, 1 + ((g.combo / 15) | 0));
    for (let xi = 0; xi < extra; xi++) {
      g.killMarks.push({
        x: z.x + (Math.random() - 0.5) * 70, y: z.y + (Math.random() - 0.5) * 70,
        t: 0.45 + Math.random() * 0.3, big: false,
        r: 12 + Math.random() * 14, rot: (Math.random() - 0.5) * 1.2,
      });
    }
  }
  g.comboFired = g.comboFired || {};
  // KILL MODE: a hero cut-in slashes across the screen
  if (g.combo >= 30 && !g.comboFired[30]) {
    g.comboFired[30] = true;
    g.cutin = { t: 1.7, hero: char.heroId };
    bark('KILL MODE!');
    sfx.playFanfare();
    addShake(10);
  }
  // combo 40: attack jet flyover carpets the area ahead of you
  if (g.combo >= 40 && !g.comboFired[40]) {
    g.comboFired[40] = true;
    banner('COMBO ×40', 'AIR SUPPORT ON STATION', '#ffd740');
    g.bombers.push({
      x: g.player.x - 900, y: g.player.y - 110 + (Math.random() - 0.5) * 160,
      vx: 950, dropT: 0.3, drops: 9, life: 2.4,
    });
  }
  // the combo number itself pops at the kill site
  if (g.combo >= 2) {
    // rainbow chain numbers past 25
    const cc = g.combo >= 25 ? `hsl(${(g.combo * 24) % 360},100%,62%)` : '#ff9100';
    g.dmgNumbers.push({ x: z.x, y: z.y + 14, txt: `×${g.combo}`, color: cc, life: 0.7, vy: -34 });
  }
  if (bigKill) {
    hitStopT = Math.max(hitStopT, 0.08);
    addShake(7);
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
  }
  if (g.streak >= 100 && !g.streakFired[100]) {
    g.streakFired[100] = true;
    banner('☢ TACTICAL NUKE ☢', 'the screen goes white', '#fff');
    sfx.playHiggsWhomp();
    sfx.playFanfare();
    g.nukeFlash = 0.8;
    addShake(24);
    hitStopT = Math.max(hitStopT, 0.1);
    for (const zz of [...g.zombies]) {
      if (zz.hp <= 0) continue;
      if (zz.super) { zz.hp -= 1500; zz.flash = 0.2; if (zz.hp <= 0) killZombie(zz, Math.random() * 6.28); }
      else { zz.hp = 0; killZombie(zz, Math.random() * 6.28); }
    }
  }
  if (g.streak >= 150 && !g.streakFired[150]) {
    g.streakFired[150] = true;
    banner('⚡ OVERDRIVE ⚡', '10 seconds of godhood', '#ffd740');
    sfx.playFanfare();
    g.player.invulnUntil = g.time + 10;
    g.buffs.rage = Math.max(g.buffs.rage, 10);
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
    if (Math.random() < 0.3) bark(BARK_LINES[Math.floor(Math.random() * BARK_LINES.length)]);
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
  goreKill(z.x, z.y, z.radius, dirAngle, z.type === 'boss' || z.type === 'brute' || z.type === 'butcher' || z.super, !!z.type && z.type.startsWith('bot_'));
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
    g.player.hp = derived(char).maxHp; // LEVEL UP = full restore
    g.player.armorHP = g.player.armorMax;
    banner(`LEVEL ${char.level}`, `FULL RESTORE · +${ups * 3} points — press TAB`, '#64b5f6');
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
    ctx.globalAlpha = 0.42;
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
  // light pools wash the streets in the level's color
  ctx.globalCompositeOperation = 'lighter';
  for (const li of g.lights || []) {
    if (li.x + li.r < cam.x || li.x - li.r > cam.x + view.w || li.y + li.r < cam.y || li.y - li.r > cam.y + view.h) continue;
    const fl = 0.1 + 0.035 * Math.sin(performance.now() / 600 + li.flicker);
    const lg = ctx.createRadialGradient(li.x, li.y, 8, li.x, li.y, li.r);
    lg.addColorStop(0, `rgba(${li.c},${fl})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(li.x - li.r, li.y - li.r, li.r * 2, li.r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  // drifting smoke banks roll slowly across the ruins
  for (const fg of g.fogs || []) {
    fg.x += fg.vx * 0.016;
    if (fg.x - fg.r > g.world.w) fg.x = -fg.r;
    if (fg.x + fg.r < cam.x || fg.x - fg.r > cam.x + view.w || fg.y + fg.r < cam.y || fg.y - fg.r > cam.y + view.h) continue;
    const fgrad = ctx.createRadialGradient(fg.x, fg.y, fg.r * 0.2, fg.x, fg.y, fg.r);
    fgrad.addColorStop(0, `rgba(150,160,170,${fg.a})`);
    fgrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fgrad;
    ctx.fillRect(fg.x - fg.r, fg.y - fg.r, fg.r * 2, fg.r * 2);
  }
}

const CAR_COLORS = ['#4e4448', '#3e4a55', '#5a4a3a', '#46524a', '#52404f'];

// prop kinds rendered with generated hi-fi art (procedural box fallback)
const SPRITE_PROPS = new Set([
  'wreck', 'statue', 'bus', 'rubble', 'dumpster', 'barricade',
  'corpsepile', 'ambulance', 'vending',
  'fountain', 'kiosk', 'traincar', 'watchtower', 'container', 'crane',
  'helipad', 'acunit', 'mausoleum', 'tank', 'tent', 'sewergrate', 'waterpool',
  'neon',
]);
// prop-kind -> sprite override (defaults to SPRITES[kind])
const PROP_SPRITE = { neon: 'neon_kiosk' };

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
    } else if (pr.kind === 'barricade_built') {
      const frac = Math.max(0, pr.hp / pr.maxHp);
      ctx.fillStyle = '#5d4433';
      ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
      // plank lines
      ctx.strokeStyle = '#7a5a42';
      ctx.lineWidth = 2;
      const horiz = pr.w > pr.h;
      for (let k = 1; k < 3; k++) {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(pr.x, pr.y + (pr.h * k) / 3); ctx.lineTo(pr.x + pr.w, pr.y + (pr.h * k) / 3); }
        else { ctx.moveTo(pr.x + (pr.w * k) / 3, pr.y); ctx.lineTo(pr.x + (pr.w * k) / 3, pr.y + pr.h); }
        ctx.stroke();
      }
      ctx.strokeStyle = '#3e2d22';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(pr.x, pr.y, pr.w, pr.h);
      // damage: splinter cracks + a health pip
      if (frac < 1) {
        ctx.fillStyle = `rgba(20,12,8,${(1 - frac) * 0.55})`;
        ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(pr.x, pr.y - 6, pr.w, 3);
        ctx.fillStyle = frac > 0.5 ? '#aed581' : frac > 0.25 ? '#ffca28' : '#ef5350';
        ctx.fillRect(pr.x, pr.y - 6, pr.w * frac, 3);
      }
    } else if (SPRITE_PROPS.has(pr.kind)) {
      const sp = SPRITES[PROP_SPRITE[pr.kind] || pr.kind];
      if (sp) {
        ctx.save();
        ctx.translate(pr.x + pr.w / 2, pr.y + pr.h / 2);
        drawSpriteFit(sp, pr.w * 1.25, pr.h * 1.25);
        ctx.restore();
      } else {
        ctx.fillStyle = { wreck: '#2e2a26', statue: '#3c4038', bus: '#36424e', rubble: '#4a4640', dumpster: '#2f4a35', barricade: '#5d4a32', container: '#7a4030', traincar: '#5a3030', watchtower: '#3a4046', tank: '#3c4434', tent: '#44503c', fountain: '#3a4248', kiosk: '#4c4438', mausoleum: '#3e463e', crane: '#6a5a20', acunit: '#454f5a', helipad: '#2c3136', sewergrate: '#33393c', waterpool: '#1e4034' }[pr.kind] || '#3c4038';
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
      const roofSp = pr.kind === 'building' ? SPRITES['roof' + (1 + (Math.floor(pr.seed * 6) % 6))] : null;
      if (roofSp) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pr.x + 1.5, pr.y + 1.5, pr.w - 3, pr.h - 3);
        ctx.clip();
        ctx.drawImage(roofSp, pr.x, pr.y, pr.w, pr.h);
        ctx.restore();
      } else if (pr.kind === 'building') {
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

function entityShadow(r) {
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(2, r * 0.55, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

// EVAC-1: the extraction bird's whole life — approach, land, door-gun, dust-off
function updateExtract(dt) {
  const g = game, p = g.player, ex = g.extract;
  ex.t += dt;
  if (ex.phase === 'inbound') {
    const dx = ex.tx - ex.x, dy = ex.ty - ex.y;
    const d = Math.hypot(dx, dy);
    ex.ang = Math.atan2(dy, dx);
    if (d > 16) { ex.x += (dx / d) * 460 * dt; ex.y += (dy / d) * 460 * dt; }
    else { ex.phase = 'landing'; ex.t = 0; radio('partner', '"EVAC-1 on final. Clear the pad!"', '#80cbc4'); }
  } else if (ex.phase === 'landing') {
    ex.alt = Math.max(0, 1 - ex.t / 2.2);
    if (ex.t > 2.4) {
      ex.phase = 'landed'; ex.t = 0;
      banner('BOARD THE HELICOPTER', 'run to EVAC-1 — the door is open', '#ffd54f');
      radio('echo', 'ECHO-6: "GET ABOARD. We are NOT losing you at the finish line."', '#80cbc4');
    }
  } else if (ex.phase === 'landed') {
    ex.alt = 0;
    if (Math.hypot(p.x - ex.x, p.y - ex.y) < 115) {
      ex.phase = 'depart'; ex.t = 0;
      banner('WHEELS UP', 'extraction complete', '#ffd54f');
      addShake(5);
    }
  } else if (ex.phase === 'depart') {
    ex.alt = Math.min(1.5, (ex.t / 1.8) * 1.5);
    ex.x += 340 * dt * Math.min(1, ex.t * 0.8);
    ex.y -= 130 * dt * Math.min(1, ex.t * 0.8);
    // the hero rides the bird out
    p.x = ex.x; p.y = ex.y;
    p.invulnUntil = g.time + 3;
    if (ex.t > 2.4) { g.extract = null; completeLevel(); return; }
  }
  // rotor wash kicks up dust while the bird is low
  if (Math.random() < dt * 30 && ex.alt < 0.9) {
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 50;
    g.particles.push({ x: ex.x + Math.cos(a) * r, y: ex.y + Math.sin(a) * r,
      vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, size: 3, color: '#8d8578', life: 0.35 });
  }
  // door gunner shreds anything that gets near the bird
  ex.gunT -= dt;
  ex.tracerT -= dt;
  if (ex.phase !== 'depart' && ex.gunT <= 0) {
    let best = null, bd = 430;
    for (const z of g.zombies) {
      const d2 = Math.hypot(z.x - ex.x, z.y - ex.y);
      if (d2 < bd) { bd = d2; best = z; }
    }
    if (best) {
      ex.gunT = 0.11;
      ex.tracer = { x: best.x, y: best.y };
      ex.tracerT = 0.08;
      best.hp -= 40;
      best.flash = 0.1;
      spawnBlood(best.x, best.y, 2);
      if (best.hp <= 0) killZombie(best, Math.atan2(best.y - ex.y, best.x - ex.x));
    }
  }
}

function drawZombie(z) {
  const slowed = game.time < z.slowUntil;
  ctx.save();
  ctx.translate(z.x, z.y);
  entityShadow(z.radius);
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
  // real walk cycle: a 4-pose sheet if the type has one, stepping by distance
  const zaf = animFrames(z.type);
  let sprite = SPRITES[z.type];
  const moving = (z.walking || 0) > 4;
  if (z.windup && SPRITES[`${z.type}_atk`]) {
    sprite = SPRITES[`${z.type}_atk`]; // dedicated strike pose
  } else if (zaf && moving) {
    const ph = Math.floor((z.animDist || 0) / 20) % 4;
    sprite = zaf.cycleWalk[ph];
  } else if (zaf) {
    sprite = zaf.idle;
  }
  if (sprite) {
    ctx.save();
    const rear = z.windup ? -0.3 * Math.sin((0.33 - z.windup) / 0.33 * Math.PI) : 0;
    // lurching walk: a side-to-side waddle + a plodding step-bob, both driven
    // by how far it's actually travelled so it truly reads as WALKING
    const step = (z.animDist || 0) * 0.09;
    const waddle = moving ? Math.sin(step) * 0.12 : Math.sin(z.wobble * 2) * 0.04;
    const bob = moving ? 1 + Math.abs(Math.sin(step)) * 0.09 : 1;
    // overhead art rotates to face its target like a proper top-down shooter
    ctx.rotate(a + waddle + rear);
    const zsq = Math.sin(step * 2) * (moving ? 0.06 : 0.03);
    const wScale = (z.windup ? 1.12 : 1) * bob;
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
  if (z.type && z.type.startsWith('bot_')) {
    // mechanical optic: a hot core pulse the player can track in a swarm
    const op = 0.55 + 0.45 * Math.sin(performance.now() / 180 + z.wobble * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const og = ctx.createRadialGradient(0, 0, 0, 0, 0, z.radius * 0.9);
    og.addColorStop(0, z.color);
    og.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = op * 0.8;
    ctx.fillStyle = og;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (z.burnUntil && game.time < z.burnUntil && SPRITES.fire) {
    const fl = 0.85 + 0.3 * Math.sin(performance.now() / 55 + z.wobble * 9);
    ctx.globalAlpha = 0.85;
    drawSpriteFit(SPRITES.fire, z.radius * 2.6 * fl, z.radius * 2.6 * fl);
    ctx.globalAlpha = 1;
  }
  if (z.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${z.flash * 7})`;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (z.waveBossName) {
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(z.waveBossName, 0, -z.radius - 22);
    ctx.fillStyle = '#ff5252';
    ctx.fillText(z.waveBossName, 0, -z.radius - 22);
    const bw3 = z.radius * 2.4;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(-bw3 / 2, -z.radius - 16, bw3, 5);
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(-bw3 / 2, -z.radius - 16, bw3 * Math.max(0, z.hp / z.maxHp), 5);
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
  entityShadow(c.radius);
  ctx.rotate(c.angle + Math.sin(c.wobble * 2.4) * 0.16);
  const sq = Math.sin(c.wobble * 4.8) * 0.04;
  ctx.scale(1 + sq, 1 - sq);
  const cAf = animFrames(c.sprite);
  const sprite = cAf ? cAf.cycleWalk[Math.floor(c.wobble * 1.6) % 4] : SPRITES[c.sprite];
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
  if (a.dropT > 0) {
    // descending under canopy: shadow shrinks as the chute comes down
    const k3 = a.dropT / 2.8;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 14, 22 * (1 - k3 * 0.5), 10 * (1 - k3 * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const sc3 = 1 + k3 * 1.1;
    if (SPRITES.paratrooper) drawSpriteFit(SPRITES.paratrooper, 78 * sc3, 78 * sc3);
    else {
      ctx.fillStyle = '#80d8ff';
      ctx.beginPath();
      ctx.arc(0, 0, 16 * sc3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (a.down) {
    ctx.globalAlpha = 0.55;
    ctx.rotate(0.6);
    const sprite = SPRITES[a.sprite || a.type];
    if (sprite) {
      ctx.filter = 'brightness(0.5)';
      drawSprite(sprite, a.radius * 3.8);
      ctx.filter = 'none';
    }
    ctx.restore();
    return;
  }
  entityShadow(a.radius);
  ctx.rotate(a.angle + Math.sin(a.walkPhase || 0) * 0.07);
  const sq = Math.sin((a.walkPhase || 0) * 2) * 0.03;
  ctx.scale(1 + sq, 1 - sq);
  const aBase = a.sprite || a.type;
  const aAf = animFrames(aBase);
  const aMoving = (a.walkPhase || 0) !== (a._lastWP || 0);
  a._lastWP = a.walkPhase || 0;
  // ally stride: walkPhase is distance*0.05, so /1.5 ≈ one frame per 30px
  const sprite = aAf
    ? (aMoving ? aAf.cycleWalk[Math.floor((a.walkPhase || 0) / 1.5) % 4] : aAf.idle)
    : SPRITES[aBase];
  if (sprite) drawSprite(sprite, a.radius * 4.2);
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
  ctx.save();
  ctx.translate(p.x, p.y);
  entityShadow(p.radius);
  ctx.restore();
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
  // gait: step-synced bounce + lean into the stride; frames carry the legs
  const strideT = ((p.animDist || 0) % 30) / 30;
  const hop = 1 + Math.abs(Math.sin(strideT * Math.PI)) * 0.05 * Math.min(1, Math.hypot(p.vx, p.vy) / 220);
  const rock = Math.sin(p.walkPhase) * 0.02;
  if (game.time < p.invulnUntil) ctx.globalAlpha = 0.55; // dash ghosting
  ctx.save();
  // overhead art rotates with the aim like a proper top-down shooter
  ctx.rotate(p.angle + rock);
  ctx.scale(hop, hop);
  const spriteName = heroById(char.heroId).sprite;
  const spd2 = Math.hypot(p.vx, p.vy);
  const af = animFrames(spriteName);
  // 4-pose alternating-leg cycle (left stride / pass / right stride / pass);
  // every frame is the same padded canvas size, so the body never jitters
  let sprite = af ? af.idle : SPRITES[spriteName];
  if (spd2 > 40 && af) {
    // one pose per ~22px travelled — correct cadence at every speed
    const ph = Math.floor((p.animDist || 0) / 22) % 4;
    sprite = (spd2 > 300 ? af.cycleRun : af.cycleWalk)[ph];
  }
  sprite = sprite || SPRITES[char.gender === 'f' ? 'player_f' : 'player'];
  if (sprite) {
    drawSprite(sprite, p.radius * 4.4); // heroes read big on screen
  } else {
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#90a4ae';
    ctx.fillRect(p.radius - 4, -3, 18, 6);
  }
  ctx.restore();
  if (p.muzzleFlash > 0) {
    ctx.rotate(p.angle); // the flash still tracks the aim; only the body stays upright
    if (p.weapon === 'flamer' && SPRITES.flamecone) {
      const ff = 0.9 + 0.25 * Math.sin(performance.now() / 35);
      ctx.save();
      ctx.translate(p.radius + 64, 0);
      ctx.globalAlpha = 0.92;
      drawSpriteFit(SPRITES.flamecone, 120 * ff, 64 * ff);
      ctx.restore();
    } else if (SPRITES.muzzle) {
      ctx.save();
      ctx.translate(p.radius + 24, 0);
      drawSpriteFit(SPRITES.muzzle, settings.arcade ? 52 : 34, settings.arcade ? 36 : 24);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ffe082';
      ctx.beginPath();
      ctx.arc(p.radius + 18, 0, 7, 0, Math.PI * 2);
      ctx.fill();
    }
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
    const ringSp = char.shieldType === 'flame' ? SPRITES.flamering
      : char.shieldType === 'blue' ? SPRITES.energyring : null;
    if (ringSp) {
      ctx.save();
      ctx.rotate(game.time * (char.shieldType === 'flame' ? 1.1 : -0.7));
      ctx.globalAlpha = 0.85;
      drawSpriteFit(ringSp, HIGGS.radius * 2.2, HIGGS.radius * 2.2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
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
      drawSpriteFit(SPRITES.lootcrate || SPRITES.cache, 48, 48);
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
  // ONE banner at a time — the rest queue behind it, no overlap
  const b = banners[0];
  if (!b) return;
  b.t -= dt;
  if (b.t <= 0) {
    banners.shift();
    return;
  }
  const t = b.t;
  const scale = t > 1.7 ? 1 + (t - 1.7) * 8 : 1;
  const alpha = Math.min(1, t * 1.4);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.translate(view.w / 2, view.h / 2 - 80);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  const fiery = /KILLSTREAK|COMBO|RAMPAGE|MASSACRE|UNSTOPPABLE|GODLIKE|BOSS/.test(b.text);
  if (fiery && SPRITES.streakflame) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.9;
    ctx.translate(0, -14);
    drawSpriteFit(SPRITES.streakflame, 620, 170);
    ctx.restore();
  }
  ctx.font = 'bold 58px monospace';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(b.text, 0, 0);
  ctx.fillStyle = b.color;
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 30;
  ctx.fillText(b.text, 0, 0);
  if (b.sub) {
    ctx.shadowBlur = 0;
    ctx.font = '18px monospace';
    ctx.lineWidth = 5;
    ctx.strokeText(b.sub, 0, 36);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(b.sub, 0, 36);
  }
  ctx.restore();
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

// build-mode ghost: shows exactly where the next barricade lands, green when
// affordable and in range, red when not
function drawBuildGhost() {
  const p = game.player;
  const mx = input.mouse.x, my = input.mouse.y;
  const wx = cam.x + mx, wy = cam.y + my;
  const inRange = Math.hypot(wx - p.x, wy - p.y) < 300;
  const afford = char.scrap >= game.barricadeCost;
  const ok = inRange && afford;
  const horiz = Math.abs(Math.cos(p.angle)) < 0.5;
  const bw = horiz ? 96 : 20, bh = horiz ? 20 : 96;
  ctx.save();
  // range ring around you
  ctx.strokeStyle = 'rgba(161,136,127,0.35)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.arc(p.x - cam.x, p.y - cam.y, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // the plank itself
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = ok ? '#8d6e63' : '#b71c1c';
  ctx.fillRect(mx - bw / 2, my - bh / 2, bw, bh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ok ? '#aed581' : '#ef5350';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - bw / 2, my - bh / 2, bw, bh);
  // banner
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = ok ? '#aed581' : '#ef5350';
  ctx.fillText(!afford ? `NEED ⚙${game.barricadeCost}` : !inRange ? 'TOO FAR' : `BUILD ⚙${game.barricadeCost}`, mx, my - bh / 2 - 10);
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#a1887f';
  ctx.fillText('◧ BUILD MODE — click to place · [N] exit', view.w / 2, view.h - 200);
  ctx.restore();
}

// BLACKOUT light mask: fill the screen with night, then punch holes in it
// for every light source. Light = safety, but generators scream your location.
function drawBlackoutMask() {
  const p = game.player;
  const px = p.x - cam.x, py = p.y - cam.y;
  ctx.save();
  ctx.fillStyle = 'rgba(3,4,9,0.86)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.globalCompositeOperation = 'destination-out';
  // flashlight cone along your aim
  const reach = 460, spread = 0.42;
  const grad = ctx.createRadialGradient(px, py, 20, px, py, reach);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.85)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, reach, p.angle - spread, p.angle + spread);
  ctx.closePath();
  ctx.fill();
  // a small always-on pool so you can see your own feet
  const near = ctx.createRadialGradient(px, py, 6, px, py, 92);
  near.addColorStop(0, 'rgba(0,0,0,0.95)');
  near.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = near;
  ctx.fillRect(px - 92, py - 92, 184, 184);
  // running generators light their zone
  for (const gen of game.generators || []) {
    if (!gen.on) continue;
    const gx = gen.x - cam.x, gy = gen.y - cam.y;
    if (gx < -gen.radius || gx > view.w + gen.radius || gy < -gen.radius || gy > view.h + gen.radius) continue;
    const flick = 1 + 0.04 * Math.sin(performance.now() / 70);
    const gg = ctx.createRadialGradient(gx, gy, 10, gx, gy, gen.radius * flick);
    gg.addColorStop(0, 'rgba(0,0,0,0.96)');
    gg.addColorStop(0.6, 'rgba(0,0,0,0.6)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(gx - gen.radius, gy - gen.radius, gen.radius * 2, gen.radius * 2);
  }
  // fires and explosions throw their own light
  for (const f2 of game.fires || []) {
    const fx = f2.x - cam.x, fy = f2.y - cam.y, fr = f2.r * 2.6;
    const fg = ctx.createRadialGradient(fx, fy, 4, fx, fy, fr);
    fg.addColorStop(0, 'rgba(0,0,0,0.9)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }
  for (const ex of game.explosions) {
    const exx = ex.x - cam.x, exy = ex.y - cam.y, er = ex.r * 2.2;
    const eg = ctx.createRadialGradient(exx, exy, 4, exx, exy, er);
    eg.addColorStop(0, 'rgba(0,0,0,1)');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(exx - er, exy - er, er * 2, er * 2);
  }
  // muzzle flash briefly lights the room
  if (p.muzzleFlash > 0) {
    const mr = 240;
    const mg = ctx.createRadialGradient(px, py, 8, px, py, mr);
    mg.addColorStop(0, 'rgba(0,0,0,0.8)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(px - mr, py - mr, mr * 2, mr * 2);
  }
  // additive pass: lit areas actually glow warm instead of just being less black
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createRadialGradient(px, py, 14, px, py, reach * 0.92);
  beam.addColorStop(0, 'rgba(255,236,190,0.20)');
  beam.addColorStop(0.5, 'rgba(255,226,160,0.09)');
  beam.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, reach * 0.92, p.angle - spread, p.angle + spread);
  ctx.closePath();
  ctx.fill();
  for (const gen of game.generators || []) {
    if (!gen.on) continue;
    const gx = gen.x - cam.x, gy = gen.y - cam.y;
    const gl = ctx.createRadialGradient(gx, gy, 8, gx, gy, gen.radius);
    gl.addColorStop(0, 'rgba(255,214,130,0.22)');
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(gx - gen.radius, gy - gen.radius, gen.radius * 2, gen.radius * 2);
  }
  ctx.restore();
}

// STORY CARD: a cinematic letterboxed strip that types a beat out mid-fight.
// The enemy VOICE gets a glitchy red card; allies get cool steel.
const STORY_SPEAKERS = {
  echo: { name: 'ECHO-6', color: '#80cbc4' },
  voice: { name: '??? ', color: '#ff1744' },
  partner: { name: 'PARTNER', color: '#b39ddb' },
  hero: { name: 'YOU', color: '#ffd54f' },
  squad: { name: 'SQUAD', color: '#81c784' },
};
function drawStoryCard() {
  const sl = game.storyLine;
  if (!sl || state !== 'playing') return;
  const spk = STORY_SPEAKERS[sl.speaker] || STORY_SPEAKERS.echo;
  let name = spk.name;
  if (sl.speaker === 'hero') name = heroById(char.heroId).name.split(' ')[0].toUpperCase();
  if (sl.speaker === 'partner' && char.partnerId) name = heroById(char.partnerId).name.split(' ')[0].toUpperCase();
  const isVoice = sl.speaker === 'voice';
  const fadeIn = Math.min(1, sl.t * 4);
  const fadeOut = Math.min(1, (sl.dur - sl.t) * 2);
  const alpha = Math.min(fadeIn, fadeOut);
  const w = Math.min(760, view.w - 60);
  const x = (view.w - w) / 2;
  const y = view.h - 224;
  ctx.save();
  ctx.globalAlpha = alpha;
  // card
  ctx.fillStyle = isVoice ? 'rgba(26,4,8,0.93)' : 'rgba(8,12,18,0.93)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, 64, 8); ctx.fill(); }
  else ctx.fillRect(x, y, w, 64);
  // accent bar + border
  ctx.fillStyle = spk.color;
  ctx.fillRect(x, y, 5, 64);
  ctx.strokeStyle = isVoice ? 'rgba(255,23,68,0.7)' : 'rgba(120,150,170,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, 64);
  // portrait chip for hero/partner
  let tx = x + 18;
  const pid = sl.speaker === 'hero' ? char.heroId : sl.speaker === 'partner' ? char.partnerId : null;
  if (pid) {
    const port = getImage(`portraits/${pid}.png`);
    if (port) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 12, y + 8, 48, 48);
      ctx.clip();
      ctx.drawImage(port, x + 12, y + 8, 48, 48);
      ctx.restore();
      ctx.strokeStyle = spk.color;
      ctx.strokeRect(x + 12, y + 8, 48, 48);
      tx = x + 72;
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = spk.color;
  // the VOICE glitches: its name jitters
  const jx = isVoice ? (Math.random() - 0.5) * 2 : 0;
  ctx.fillText(name, tx + jx, y + 10);
  // typewriter body
  const chars = Math.floor(sl.t * 55);
  const shown = sl.text.slice(0, chars);
  ctx.font = isVoice ? 'bold 14px monospace' : '14px monospace';
  ctx.fillStyle = isVoice ? '#ff8a80' : '#e0e6ea';
  // wrap to two lines
  const maxW = w - (tx - x) - 20;
  let line1 = shown, line2 = '';
  if (ctx.measureText(shown).width > maxW) {
    let cut = shown.length;
    while (cut > 0 && ctx.measureText(shown.slice(0, cut)).width > maxW) cut--;
    const sp = shown.lastIndexOf(' ', cut);
    line1 = shown.slice(0, sp > 0 ? sp : cut);
    line2 = shown.slice(sp > 0 ? sp + 1 : cut);
  }
  ctx.fillText(line1, tx + jx, y + 28);
  if (line2) ctx.fillText(line2, tx + jx, y + 44);
  ctx.restore();
}

// off-screen threat arrows: chevrons pinned to the screen edge pointing at
// nearby enemies you can't see yet — bosses always flagged, big ones too
function drawEnemyArrows() {
  if (state !== 'playing' || paused) return;
  const p = game.player;
  const cx = view.w / 2, cy = view.h / 2;
  const margin = 46;
  // rank: bosses/supers first, then nearest — cap the count so it stays clean
  const off = [];
  for (const z of game.zombies) {
    if (z.hp <= 0) continue;
    const sx = z.x - cam.x, sy = z.y - cam.y;
    if (sx > -30 && sx < view.w + 30 && sy > -30 && sy < view.h + 30) continue; // on-screen
    const d = Math.hypot(z.x - p.x, z.y - p.y);
    const boss = z.type === 'boss' || z.type === 'bot_warframe' || z.super;
    if (!boss && d > 1500) continue; // only flag reasonably close rank-and-file
    off.push({ z, d, boss });
  }
  off.sort((a, b) => (b.boss - a.boss) || (a.d - b.d));
  const shown = off.slice(0, 10);
  for (const { z, boss } of shown) {
    const ang = Math.atan2(z.y - (cam.y + cy), z.x - (cam.x + cx));
    // project the direction onto the screen-edge rectangle
    const hw = view.w / 2 - margin, hh = view.h / 2 - margin;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const tx = Math.abs(dx) < 1e-3 ? Infinity : hw / Math.abs(dx);
    const ty = Math.abs(dy) < 1e-3 ? Infinity : hh / Math.abs(dy);
    const tt = Math.min(tx, ty);
    const ex = cx + dx * tt, ey = cy + dy * tt;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    const col = boss ? '#e040fb' : z.color || '#ef5350';
    const scale = boss ? 1.5 : 1;
    const pulse = boss ? 0.7 + 0.3 * Math.sin(performance.now() / 150) : 0.85;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = boss ? 12 : 6;
    ctx.beginPath();
    ctx.moveTo(14 * scale, 0);
    ctx.lineTo(-6 * scale, -9 * scale);
    ctx.lineTo(-6 * scale, 9 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// radial gun selector: a fan of owned-weapon slots around screen centre,
// the aimed slot lit up; release right-mouse to equip it
const WEAPON_ICON = { rifle: 'wic_rifle', shotgun: 'wic_shotgun', railgun: 'wic_railgun' };

// full-screen pause menu: resume / restart / arcade toggle / quit
function drawPauseMenu() {
  ctx.save();
  ctx.fillStyle = 'rgba(4,6,10,0.78)';
  ctx.fillRect(0, 0, view.w, view.h);
  if (settings.arcade) {
    ctx.fillStyle = ctx.createPattern(scanlines(), 'repeat');
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const cx = view.w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.min(72, view.w / 12)}px monospace`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.strokeText('PAUSED', cx, view.h * 0.24);
  ctx.fillStyle = '#ff5252';
  ctx.shadowColor = '#ff1744';
  ctx.shadowBlur = 26;
  ctx.fillText('PAUSED', cx, view.h * 0.24);
  ctx.shadowBlur = 0;
  ctx.font = '13px monospace';
  ctx.fillStyle = '#78909c';
  ctx.fillText(`${level().name}  ·  WAVE ${game.wave}/${level().waves}  ·  SCORE ${game.score}`, cx, view.h * 0.24 + 54);

  const items = [
    ['▶  RESUME', () => { paused = false; }],
    ['↻  RESTART LEVEL', () => { paused = false; startLevel(); }],
    ['⚙  ' + (settings.arcade ? 'ARCADE FX: ON' : 'ARCADE FX: OFF'), () => { settings.arcade = !settings.arcade; saveSettings(); }],
    ['✕  QUIT TO MENU', () => { paused = false; char.hp = derived(char).maxHp; saveCharacter(char); hasSave = true; state = 'title'; }],
  ];
  const bw = Math.min(360, view.w - 80), bh = 52, gap = 14;
  let by = view.h * 0.42;
  items.forEach(([label, cb], i) => {
    const bx = cx - bw / 2;
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    const m = input.mouse;
    const hov = m.x >= bx && m.x <= bx + bw && m.y >= by && m.y <= by + bh;
    ctx.fillStyle = hov || focused ? 'rgba(40,52,64,0.96)' : 'rgba(16,20,26,0.92)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill(); }
    else ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = hov || focused ? '#ffd54f' : '#546e7a';
    ctx.lineWidth = hov || focused ? 2.5 : 1.5;
    ctx.stroke();
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = hov || focused ? '#fff' : '#cfd8dc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, by + bh / 2);
    button(bx, by, bw, bh, cb);
    by += bh + gap;
  });
  ctx.font = '12px monospace';
  ctx.fillStyle = '#607d8b';
  ctx.fillText('[ESC] resume  ·  [TAB] character sheet', cx, by + 10);
  ctx.restore();
}

function drawWeaponWheel() {
  const owned = ownedList();
  const cx = view.w / 2, cy = view.h / 2;
  const R = Math.min(220, view.h * 0.32);
  ctx.save();
  // dim the field so the wheel pops
  ctx.fillStyle = 'rgba(4,6,9,0.55)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  owned.forEach((w, i) => {
    const ang = -Math.PI / 2 + i * (Math.PI * 2 / owned.length);
    const x = cx + Math.cos(ang) * R;
    const y = cy + Math.sin(ang) * R;
    const sel = i === game.wheelPick;
    const cur = w === game.player.weapon;
    ctx.beginPath();
    ctx.arc(x, y, sel ? 46 : 38, 0, Math.PI * 2);
    ctx.fillStyle = sel ? 'rgba(255,171,64,0.28)' : 'rgba(10,14,18,0.85)';
    ctx.fill();
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? '#ffab40' : cur ? '#80cbc4' : '#546e7a';
    ctx.stroke();
    const icon = SPRITES[WEAPON_ICON[w]];
    if (icon) {
      ctx.save();
      ctx.translate(x, y - 6);
      drawSpriteFit(icon, 52, 34);
      ctx.restore();
    }
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = sel ? '#fff' : '#b0bec5';
    ctx.fillText(WEAPONS[w].name, x, y + 24);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#78909c';
    ctx.fillText(`[${WEAPONS[w].key.toUpperCase()}]`, x, y + 36);
  });
  // hub
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,14,18,0.9)';
  ctx.fill();
  ctx.strokeStyle = '#ffab40';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffab40';
  ctx.font = 'bold 12px monospace';
  ctx.fillText('SWAP', cx, cy);
  // pointer to the aimed slot
  if (game.wheelPick != null) {
    const a2 = -Math.PI / 2 + game.wheelPick * (Math.PI * 2 / owned.length);
    ctx.strokeStyle = '#ffab40';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a2) * 32, cy + Math.sin(a2) * 32);
    ctx.lineTo(cx + Math.cos(a2) * (R - 48), cy + Math.sin(a2) * (R - 48));
    ctx.stroke();
  }
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

  // survival readout: needs bars, carried supplies, bleeding alarm
  if (game.survival) {
    const n = game.needs;
    const rows = [
      ['HUNGER', n.hunger, '#aed581'],
      ['THIRST', n.thirst, '#4fc3f7'],
      ['ENERGY', n.fatigue, '#ce93d8'],
    ];
    let ny = 132;
    glass(12, ny - 8, 240, 96, 'rgba(120,150,170,0.35)');
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (const [label, val, col] of rows) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(70, ny + 2, 170, 8);
      ctx.fillStyle = val < 25 ? '#ef5350' : col;
      ctx.fillRect(70, ny + 2, 170 * Math.max(0, val / 100), 8);
      ctx.fillStyle = val < 25 ? '#ff8a80' : '#b0bec5';
      ctx.fillText(label, 20, ny + 1);
      ny += 16;
    }
    const sup = game.supplies;
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#cfd8dc';
    ctx.fillText(`🥫${sup.food}  💧${sup.water}  🩹${sup.bandage}   [Y] USE`, 20, ny + 4);
    if (game.bleed > 0) {
      ctx.fillStyle = Math.floor(performance.now() / 300) % 2 ? '#ff1744' : '#ef9a9a';
      ctx.fillText(`⚠ BLEEDING ×${game.bleed}`, 20, ny + 20);
    }
  }
  // squad readout
  let sy = game.survival ? 236 : 132;
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
  // throwable tray: icon cells with live counts, selected one ringed
  const tray = [
    { key: 'frag', sp: 'nade_frag', n: char.nades.frag || 0, sel: game.nadeSel === 'frag' },
    { key: 'smoke', sp: 'nade_smoke', n: char.nades.smoke || 0, sel: game.nadeSel === 'smoke' },
    { key: 'decoy', sp: 'nade_decoy', n: char.nades.decoy || 0, sel: game.nadeSel === 'decoy' },
    { key: 'dyna', sp: 'nade_dyna', n: char.dynamite || 0, sel: false },
  ];
  const cellW = 46, cellH = 44, trayY = view.h - 138;
  let tx = view.w - 24 - tray.length * (cellW + 4) + cellW;
  for (const it of tray) {
    const cx0 = tx - cellW;
    ctx.fillStyle = it.sel ? 'rgba(120,216,140,0.18)' : 'rgba(8,12,16,0.7)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(cx0, trayY, cellW, cellH, 6); ctx.fill(); }
    else ctx.fillRect(cx0, trayY, cellW, cellH);
    ctx.strokeStyle = it.sel ? '#aed581' : it.n > 0 ? '#546e7a' : '#37474f';
    ctx.lineWidth = it.sel ? 2 : 1;
    ctx.stroke();
    const sp = SPRITES[it.sp];
    ctx.globalAlpha = it.n > 0 ? 1 : 0.32;
    if (sp) {
      ctx.save();
      ctx.translate(cx0 + cellW / 2, trayY + 17);
      drawSpriteFit(sp, 26, 26);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = it.n > 0 ? '#fff' : '#616161';
    ctx.textAlign = 'right';
    ctx.fillText(`×${it.n}`, cx0 + cellW - 5, trayY + cellH - 15);
    ctx.font = '8px monospace';
    ctx.fillStyle = it.key === 'dyna' ? '#ff8a65' : '#90a4ae';
    ctx.textAlign = 'center';
    ctx.fillText(it.key === 'dyna' ? '[H]' : it.sel ? '[G]' : '', cx0 + cellW / 2, trayY + cellH - 11);
    tx -= cellW + 4;
  }
  ctx.textAlign = 'right';
  ctx.font = '9px monospace';
  ctx.fillStyle = '#607d8b';
  ctx.fillText('[T] cycle · [Q] recall', view.w - 24, trayY - 12);
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
    bx -= 120;
  }
  if (game.overclock > 0) {
    ctx.fillStyle = '#69f0ae';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`⚡ OVERCLOCK +${Math.round(game.overclock * 100)}%`, bx, view.h - 96);
  }
  ctx.font = '12px monospace';
  ctx.fillStyle = '#9e9e9e';
  const keys = ownedList().map((w) => `[${WEAPONS[w].key}]${WEAPONS[w].name}`).join(' ');
  ctx.fillText(`${keys}  [R]RELOAD [SPACE]DASH [B]GRAB [Z]BLADES [N]BUILD [TAB]CHAR`, view.w - 24, view.h - 40);
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
  if (game.blackout) {
    const lit = (game.generators || []).filter((gn) => gn.on).length;
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = lit ? '#ffd54f' : '#78909c';
    ctx.fillText(`🔦 BLACKOUT — GENERATORS RUNNING ${lit}/${(game.generators || []).length}  ·  [F] to fuel`, view.w / 2, 62);
  }
  if (gameMode === 'campaign' && game.objective) {
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ffca28';
    ctx.fillText(`◆ OBJECTIVE: ${game.objective}`, view.w / 2, 62);
  }
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
  ctx.fillText(`SCORE ${game.score}   HOSTILES ${game.zombies.length + game.spawnQueue.length}   CIVILIANS ${game.civilians.length}`, view.w / 2, 46);
  // combo meter — PUNCHES bigger on every kill, skull at 25+
  if (game.combo >= 2) {
    if (game.combo !== game._lastComboHud) {
      game._lastComboHud = game.combo;
      game._comboPop = 0.22; // scale punch on increment
    }
    game._comboPop = Math.max(0, (game._comboPop || 0) - 0.016);
    const punch = 1 + (game._comboPop || 0) * 2.4;
    const baseSize = Math.min(46, 22 + game.combo * 0.35);
    ctx.font = `bold ${Math.round(baseSize * punch)}px monospace`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(`×${game.combo}`, view.w / 2, 64);
    ctx.fillStyle = game.combo >= 25 ? '#ff9100' : '#ffd740';
    ctx.fillText(`×${game.combo}`, view.w / 2, 64);
    if (game.combo >= 25 && SPRITES.comboskull) {
      ctx.save();
      ctx.translate(view.w / 2 - baseSize * 1.6, 64 + baseSize * 0.55);
      const wob = 1 + Math.sin(performance.now() / 110) * 0.08;
      drawSpriteFit(SPRITES.comboskull, 44 * wob, 44 * wob);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(view.w / 2 - 60, 64 + baseSize + 6, 120, 5);
    ctx.fillStyle = '#ffd740';
    ctx.fillRect(view.w / 2 - 60, 64 + baseSize + 6, 120 * Math.max(0, game.comboT / 2.2), 5);
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
    ctx.fillText(`SWARM REMAINING: ${game.survivalPool + game.zombies.length}`, view.w / 2, 124);
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
  const w = Math.min(780, view.w - 50);
  const h = Math.min(540, view.h - 30);
  const x = (view.w - w) / 2;
  const y = (view.h - h) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.fillStyle = 'rgba(14,16,20,0.97)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ce93d8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  // right column: portrait + derived stats
  const colW = 220;
  const rx = x + w - colW;
  ctx.fillStyle = 'rgba(22,18,28,0.9)';
  ctx.fillRect(rx, y, colW, h);
  const cport = getImage(`portraits/${char.heroId}.png`);
  const psz = colW - 36;
  if (cport) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx + 18, y + 18, psz, psz);
    ctx.clip();
    ctx.drawImage(cport, rx + 18, y + 18, psz, psz);
    ctx.restore();
    ctx.strokeStyle = '#ce93d8';
    ctx.strokeRect(rx + 18, y + 18, psz, psz);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 16px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(heroById(char.heroId).name, rx + colW / 2, y + psz + 28, colW - 20);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#ce93d8';
  ctx.fillText(`LEVEL ${char.level} SURVIVOR`, rx + colW / 2, y + psz + 48);
  // derived stat readout, one per line
  const dstats = [
    ['DAMAGE', `x${d.damageMult.toFixed(2)}`], ['SPEED', `x${d.moveMult.toFixed(2)}`],
    ['MAX HP', `${d.maxHp}`], ['REGEN', `${d.regen.toFixed(1)}/s`],
    ['CRIT', `${(d.critChance * 100).toFixed(0)}%`], ['HIGGS CD', `${d.higgsCooldown.toFixed(1)}s`],
    ['ARMOR', `${d.armor}`],
  ];
  let dy = y + psz + 74;
  ctx.font = '13px monospace';
  for (const [k, v] of dstats) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#78909c';
    ctx.fillText(k, rx + 20, dy);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#80cbc4';
    ctx.fillText(v, rx + colW - 20, dy);
    dy += 21;
  }
  // left column: identity + attributes
  ctx.textAlign = 'left';
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(`CHARACTER SHEET`, x + 26, y + 20);
  ctx.font = '13px monospace';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText(`XP ${char.xp}/${xpForLevel(char.level)}   ⚙ ${char.scrap}   KILLS ${char.totalKills}`, x + 26, y + 50);
  // xp progress bar
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x + 26, y + 70, w - colW - 52, 8);
  ctx.fillStyle = '#ab47bc';
  ctx.fillRect(x + 26, y + 70, (w - colW - 52) * Math.min(1, char.xp / xpForLevel(char.level)), 8);
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = char.unspent > 0 ? '#ffd54f' : '#616161';
  ctx.fillText(char.unspent > 0 ? `◆ ${char.unspent} POINTS TO SPEND` : 'NO UNSPENT POINTS', x + 26, y + 86);

  let yy = y + 114;
  const rowW = w - colW - 52;
  for (const key of Object.keys(ATTRS)) {
    const a = ATTRS[key];
    ctx.fillStyle = 'rgba(28,32,40,0.85)';
    ctx.fillRect(x + 26, yy, rowW, 56);
    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${a.name}`, x + 38, yy + 9);
    // allocation pips make growth readable at a glance
    const pips = Math.min(20, char.attrs[key]);
    for (let pi = 0; pi < 20; pi++) {
      ctx.fillStyle = pi < pips ? '#80cbc4' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 150 + pi * 9, yy + 12, 6, 10);
    }
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#80cbc4';
    ctx.textAlign = 'right';
    ctx.fillText(`${char.attrs[key]}`, x + 26 + rowW - 64, yy + 9);
    ctx.textAlign = 'left';
    ctx.font = '11px monospace';
    ctx.fillStyle = '#90a4ae';
    ctx.fillText(a.desc, x + 38, yy + 33);
    const canAdd = char.unspent > 0;
    const bx = x + 26 + rowW - 50;
    const idx = uiButtons.length;
    const focused = gamepad.connected && idx === gpFocus;
    ctx.fillStyle = canAdd ? '#2e7d32' : '#1b3a1d';
    ctx.fillRect(bx, yy + 8, 40, 40);
    if (focused) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, yy + 8, 40, 40);
    }
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = canAdd ? '#fff' : '#4a4a4a';
    ctx.fillText('+', bx + 13, yy + 14);
    button(bx, yy + 8, 40, 40, () => {
      if (char.unspent > 0) {
        char.attrs[key]++;
        char.unspent--;
        sfx.playPurchase();
        saveCharacter(char);
      } else sfx.playDenied();
    }, canAdd);
    yy += 66;
  }
  // special skills, breathing room between lines
  yy += 4;
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#ffd54f';
  ctx.fillText('SPECIAL SKILLS', x + 26, yy);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#cfd8dc';
  const shieldsTxt = char.shields.map((sh) => sh.toUpperCase()).join(' / ');
  ctx.fillText(`SHIELDS: ${shieldsTxt} (active ${char.shieldType.toUpperCase()}) · DASH [SPACE] · STREAKS 25/50/75/100`, x + 26, yy + 20);
  ctx.fillText(`THROWABLES: FRAG ×${char.nades.frag} · SMOKE ×${char.nades.smoke} · DECOY ×${char.nades.decoy} · DYNAMITE ×${char.dynamite}`, x + 26, yy + 38);
  ctx.fillStyle = '#a5d6a7';
  ctx.fillText(`HEALTH POINTS: +5 max HP every level (LV ${char.level} = +${(char.level - 1) * 5})`, x + 26, yy + 56);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText('[TAB/Ⓑ] close', x + w - colW - 26, y + h - 26);
  ctx.textAlign = 'left';
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
  { id: 'blackout', label: '🔦 BLACKOUT', desc: 'county-wide dark · run generators' },
];

// named mini-bosses cap waves 1 and 2 of every level (the SUPERBOSS owns wave 3)
const WAVE_BOSSES = {
  city: ['THE BULLDOZER', 'SIREN EATER'],
  graveyard: ['THE GRAVE WARDEN', 'MOURNING MOTHER'],
  sewer: ['THE DROWNED ONE', 'PIPE KING'],
  hospital: ['HEAD SURGEON', 'THE NIGHT NURSE'],
  base: ['SGT. SLAUGHTER', 'THE QUARTERMASTER'],
  mall: ['STORE MANAGER', 'SECURITY CHIEF-9'],
  subway: ['THE CONDUCTOR', 'THIRD RAIL'],
  prison: ['THE WARDEN', 'BLOCK D BUTCHER'],
  docks: ['THE HARBORMASTER', 'CARGO HULK'],
  rooftops: ['THE FALLEN ANGEL', 'NEST GUARDIAN'],
};

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
  ctx.fillText('CAMPAIGN — OPERATIONS', cx, 22);
  ctx.shadowBlur = 0;
  ctx.font = '12px monospace';
  ctx.fillStyle = '#78909c';
  ctx.fillText('BLACKOUT COUNTY  ·  SELECT YOUR DEPLOYMENT', cx, 56);

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
    // dossier grade: darken toward the bottom for the text block
    const cg = ctx.createLinearGradient(0, yRow, 0, yRow + chh);
    cg.addColorStop(0, 'rgba(4,5,9,0.18)');
    cg.addColorStop(0.55, 'rgba(4,5,9,0.30)');
    cg.addColorStop(1, 'rgba(4,5,9,0.92)');
    ctx.fillStyle = cg;
    ctx.fillRect(x, yRow, cw, chh);
    // MISSION tag, top-left
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = unlocked ? '#ef5350' : '#546e7a';
    ctx.fillText(`MISSION ${String(i + 1).padStart(2, '0')}`, x + 8, yRow + 8);
    // cleared stamp
    const cleared = i < (char.maxCampaign || 0);
    if (cleared) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#66bb6a';
      ctx.fillText('✓ CLEARED', x + cw - 8, yRow + 8);
    }
    ctx.restore();
    // frame + red accent underline on focus
    ctx.strokeStyle = focused ? '#ffd54f' : unlocked ? '#4a5560' : '#242b32';
    ctx.lineWidth = focused ? 3 : 1;
    ctx.strokeRect(x, yRow, cw, chh);
    if (focused) {
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(x, yRow + chh - 3, cw, 3);
    }
    // operation codename + name + threat blocks
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = unlocked ? '#ffca28' : '#546e7a';
    ctx.fillText(unlocked ? (OP_NAMES[lv.key] || 'OPERATION') : '🔒 CLASSIFIED', x + 8, yRow + chh - 58, cw - 16);
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = unlocked ? '#fff' : '#546e7a';
    ctx.fillText(unlocked ? lv.name : 'LOCKED', x + 8, yRow + chh - 43, cw - 16);
    if (unlocked) {
      ctx.font = '9px monospace';
      ctx.fillStyle = '#90a4ae';
      ctx.fillText(`${lv.waves} WAVES · ${lv.bosses} BOSS${lv.bosses > 1 ? 'ES' : ''}`, x + 8, yRow + chh - 27);
      // threat density blocks, bottom-right
      const th = Math.min(5, Math.round(lv.countMult * 2));
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ef5350';
      ctx.font = '9px monospace';
      ctx.fillText('█'.repeat(th) + '░'.repeat(5 - th), x + cw - 8, yRow + chh - 27);
    }
    ctx.textAlign = 'center';
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
    '⚄ RANDOM LEVEL — unlocked ops only', () => {
      gameMode = 'campaign';
      // random redeploy respects the campaign locks — cleared ground only
      const open = Math.min(LEVELS.length - 1, char.maxCampaign || 0);
      char.campaignLevel = Math.floor(Math.random() * (open + 1));
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
    // living hero portrait: video loop when ready, painted still, sprite fallback
    const portrait = getImage(`portraits/${hero.id}.png`);
    const pv = portraitVideo(hero.id);
    if (!pv._broken && pv.paused) pv.play().catch(() => {});
    const useVid = !pv._broken && pv.readyState >= 2 && pv.videoWidth > 0;
    if (portrait || useVid) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, cw - 4, chh - 58);
      ctx.clip();
      if (isOwnHero) ctx.globalAlpha = 0.3;
      const src = useVid ? pv : portrait;
      const iw = useVid ? pv.videoWidth : portrait.naturalWidth;
      const ih = useVid ? pv.videoHeight : portrait.naturalHeight;
      const ps = Math.max((cw - 4) / iw, (chh - 58) / ih);
      ctx.drawImage(src, x + cw / 2 - (iw * ps) / 2, y + 2, iw * ps, ih * ps);
      const fg = ctx.createLinearGradient(0, y + chh - 110, 0, y + chh - 56);
      fg.addColorStop(0, 'rgba(10,12,16,0)');
      fg.addColorStop(1, 'rgba(10,12,16,0.95)');
      ctx.fillStyle = fg;
      ctx.fillRect(x + 2, y + chh - 110, cw - 4, 54);
      ctx.restore();
    } else if (SPRITES[hero.sprite]) {
      ctx.save();
      ctx.translate(px, py);
      if (isOwnHero) ctx.globalAlpha = 0.3;
      drawSpriteFit(SPRITES[hero.sprite], cw * 0.66, (chh - 64) * 0.86);
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

// ---- CALL-OF-DUTY STYLE DEPLOYMENT / LOADING SCREEN -----------------------
// Full-bleed mission art, an intel dossier that types itself out, the squad
// roster with portraits, live asset-loading progress and a rotating tip rail.
const ACTS = [
  { name: 'ACT I — THE LIGHTS GO OUT', levels: [0, 1] },
  { name: 'ACT II — DEAD AIR', levels: [2, 3] },
  { name: 'ACT III — THE COUNTY BELOW', levels: [4, 5] },
  { name: 'ACT IV — THE LONG NIGHT', levels: [6, 7] },
  { name: 'ACT V — THE LAST SIGNAL', levels: [8, 9] },
];
function actForLevel(i) {
  return ACTS.find((a) => a.levels.includes(i)) || ACTS[0];
}

const OP_NAMES = {
  city: 'OPERATION FIRST LIGHT', graveyard: 'OPERATION COLD GROUND',
  sewer: 'OPERATION UNDERTOW', hospital: 'OPERATION PATIENT ZERO',
  base: 'OPERATION LAST STAND', mall: 'OPERATION CLEARANCE',
  subway: 'OPERATION THIRD RAIL', prison: 'OPERATION LOCKDOWN',
  docks: 'OPERATION HIGH TIDE', rooftops: 'OPERATION DAYBREAK',
};
const LOAD_TIPS = [
  'Hold [RMB] to open the weapon wheel — swapping mid-reload cancels it.',
  '[B] grabs a zombie. [B] again hurls it — thrown bodies bowl through the crowd.',
  '[Z] deploys BLADESTORM: razor discs orbit you and shred anything they touch.',
  'Generators light a zone — and the engine noise drags every infected to it.',
  'Combo x30 triggers KILL MODE. Combo x40 calls in air support.',
  '[N] enters BUILD MODE. Barricades buy you seconds, and seconds decide nights.',
  'Fight near CDR. HALE for +12% damage; near SGT. REYES for faster reloads.',
  'Armor plates soak damage before your health does. Buy them early.',
  '[Y] triages: bandages a wound first, then water or rations — whichever is worse.',
  'Supply crates parachute in every 45-75s. Hack chips stack weapon damage.',
];

function drawLevelIntro() {
  const lv = level();
  const cx = view.w / 2;
  const t = performance.now() / 1000;
  getImage(lv.ground); // prefetch the arena ground so deploy is instant
  const intro = getImage(lv.intro);

  // hard clear: wipe the whole backing store so nothing from the previous
  // screen can ghost through the mission art
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  if (intro) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawCoverImage(intro);
    ctx.restore();
  }
  // cinematic grade: darken the edges, lift the centre
  const vg = ctx.createLinearGradient(0, 0, 0, view.h);
  vg.addColorStop(0, 'rgba(4,5,9,0.82)');
  vg.addColorStop(0.42, 'rgba(4,5,9,0.35)');
  vg.addColorStop(1, 'rgba(4,5,9,0.95)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.save();
  ctx.textBaseline = 'top';

  // ---- header: operation codename + location strip ----
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#ef5350';
  ctx.fillText(`${actForLevel(char.campaignLevel).name}   ·   MISSION ${String(char.campaignLevel + 1).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`, 44, 40);
  ctx.font = `bold ${Math.min(46, view.w / 22)}px monospace`;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#d32f2f';
  ctx.shadowBlur = 20;
  ctx.fillText(OP_NAMES[lv.key] || 'OPERATION BLACKOUT', 44, 58);
  ctx.shadowBlur = 0;
  ctx.font = '14px monospace';
  ctx.fillStyle = '#b0bec5';
  ctx.fillText(`${lv.name.toUpperCase()}  ·  BLACKOUT COUNTY  ·  0817 HOURS`, 46, 58 + Math.min(46, view.w / 22) + 8);
  // red rule
  ctx.fillStyle = '#d32f2f';
  ctx.fillRect(44, 58 + Math.min(46, view.w / 22) + 30, 260, 3);

  // ---- left: intel dossier, typed out ----
  const dossierY = 58 + Math.min(46, view.w / 22) + 52;
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#ffca28';
  ctx.fillText('◆ OBJECTIVE', 44, dossierY);
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText(OBJECTIVES[lv.key] || 'SURVIVE', 44, dossierY + 18);

  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#80cbc4';
  ctx.fillText('◆ INTEL', 44, dossierY + 50);
  let budget = briefingChars();
  let yy = dossierY + 70;
  ctx.font = '14px monospace';
  const maxTextW = Math.min(620, view.w * 0.52);
  // the WHY leads the dossier — every op states its reason before its intel
  const briefLines = [...(WHY[lv.key] ? ['WHY WE FIGHT: ' + WHY[lv.key]] : []), ...lv.story];
  for (const line of briefLines) {
    if (budget <= 0) break;
    const shown = line.slice(0, budget);
    budget -= line.length;
    ctx.fillStyle = line.startsWith('WHY') ? '#ffca28'
      : line.startsWith('ECHO') || line.startsWith('"') ? '#80cbc4' : '#cfd8dc';
    // wrap long intel lines inside the dossier column
    let rest = shown + (budget < 0 ? '▌' : '');
    while (rest.length) {
      let cut = rest.length;
      while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxTextW) cut--;
      if (cut < rest.length) {
        const sp = rest.lastIndexOf(' ', cut);
        if (sp > 12) cut = sp;
      }
      ctx.fillText(rest.slice(0, cut), 44, yy);
      rest = rest.slice(cut).trimStart();
      yy += 21;
    }
    yy += 4;
  }

  // ---- threat readout ----
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = '#ef5350';
  ctx.fillText('◆ THREAT ASSESSMENT', 44, view.h - 190);
  ctx.font = '13px monospace';
  ctx.fillStyle = '#cfd8dc';
  ctx.fillText(`${lv.waves} WAVES   ·   ${lv.bosses} BOSS CONTACT${lv.bosses > 1 ? 'S' : ''}   ·   HOSTILE DENSITY ${'█'.repeat(Math.min(5, Math.round(lv.countMult * 2)))}`, 44, view.h - 170);

  // ---- right: squad roster ----
  const rx = view.w - 300;
  if (view.w > 900) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#b39ddb';
    ctx.fillText('◆ DEPLOYING SQUAD', rx, dossierY);
    const roster = [{ id: char.heroId, tag: 'OPERATOR' }];
    if (char.partnerId) roster.push({ id: char.partnerId, tag: 'PARTNER' });
    let ry = dossierY + 20;
    for (const r of roster) {
      const hero = heroById(r.id);
      const port = getImage(`portraits/${r.id}.png`);
      ctx.fillStyle = 'rgba(10,14,20,0.75)';
      ctx.fillRect(rx, ry, 256, 62);
      ctx.strokeStyle = '#4a5560';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, ry, 256, 62);
      if (port) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx + 5, ry + 5, 52, 52);
        ctx.clip();
        ctx.drawImage(port, rx + 5, ry + 5, 52, 52);
        ctx.restore();
      }
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(hero.name, rx + 68, ry + 12);
      ctx.font = '11px monospace';
      ctx.fillStyle = '#80cbc4';
      ctx.fillText(r.tag, rx + 68, ry + 30);
      ctx.fillStyle = '#90a4ae';
      ctx.fillText(hero.role, rx + 68, ry + 44);
      ry += 70;
    }
    // squadmates earned so far
    const joined = SQUAD_JOIN.slice(0, Math.min(char.campaignLevel, SQUAD_JOIN.length));
    if (joined.length) {
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#81c784';
      ctx.fillText('ATTACHED', rx, ry + 4);
      ctx.font = '12px monospace';
      ctx.fillStyle = '#cfd8dc';
      joined.forEach((jt, ji) => ctx.fillText(`· ${ALLY_DEFS[jt].name}`, rx, ry + 22 + ji * 16));
    }
  }

  // ---- shield loadout chips ----
  if (char.shields.length > 1) {
    const sw = 122, sh2 = 32, sg = 10;
    const sx0 = 44;
    const byy = view.h - 138;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#90a4ae';
    ctx.fillText('◆ SHIELD CORE', sx0, byy - 16);
    char.shields.forEach((core, ci) => {
      const bx = sx0 + ci * (sw + sg);
      const active = char.shieldType === core;
      ctx.fillStyle = active ? 'rgba(20,42,32,0.95)' : 'rgba(14,17,22,0.9)';
      ctx.fillRect(bx, byy, sw, sh2);
      ctx.strokeStyle = active ? SHIELD_COLORS[core] : '#3c4650';
      ctx.lineWidth = active ? 2.5 : 1;
      ctx.strokeRect(bx, byy, sw, sh2);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = SHIELD_COLORS[core];
      ctx.textAlign = 'center';
      ctx.fillText((core === 'health' ? 'GREEN' : core.toUpperCase()) + (active ? ' ✓' : ''), bx + sw / 2, byy + 10);
      button(bx, byy, sw, sh2, () => {
        char.shieldType = core;
        saveCharacter(char);
      });
    });
  }

  // ---- bottom: loading bar + tip rail (the COD signature) ----
  const barY = view.h - 76;
  const barW = view.w - 88;
  const assetFrac = spritesTotal ? spritesLoaded / spritesTotal : 1;
  const textFrac = briefingTotal() ? Math.min(1, briefingChars() / briefingTotal()) : 1;
  const frac = Math.min(assetFrac, textFrac);
  const ready = frac >= 1;
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#78909c';
  const tip = LOAD_TIPS[Math.floor(t / 5) % LOAD_TIPS.length];
  ctx.fillText(`TIP  ·  ${tip}`, 44, barY - 22);
  // track
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(44, barY, barW, 6);
  // fill
  ctx.fillStyle = ready ? '#66bb6a' : '#d32f2f';
  ctx.fillRect(44, barY, barW * frac, 6);
  // moving scan highlight while loading
  if (!ready) {
    const sx = 44 + ((t * 260) % Math.max(1, barW * frac));
    const sg2 = ctx.createLinearGradient(sx - 40, 0, sx + 40, 0);
    sg2.addColorStop(0, 'rgba(255,255,255,0)');
    sg2.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    sg2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg2;
    ctx.fillRect(Math.max(44, sx - 40), barY, 80, 6);
  }
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = ready ? '#a5d6a7' : '#ef9a9a';
  ctx.fillText(ready ? 'DEPLOYMENT READY' : `LOADING MISSION DATA  ${Math.round(frac * 100)}%`, 44, barY + 14);
  ctx.textAlign = 'right';
  if (ready) {
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * Math.sin(t * 3)})`;
    ctx.fillText('CLICK TO DEPLOY  ▸', view.w - 44, barY + 8);
  } else {
    ctx.font = '12px monospace';
    ctx.fillStyle = '#757575';
    ctx.fillText('click to skip briefing', view.w - 44, barY + 12);
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
    if (spritesLoaded < spritesTotal) {
      const frac = spritesLoaded / Math.max(1, spritesTotal);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - 160, view.h - 196, 320, 20);
      ctx.fillStyle = '#43a047';
      ctx.fillRect(cx - 158, view.h - 194, 316 * frac, 16);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(`LOADING ASSETS ${Math.round(frac * 100)}%`, cx, view.h - 192);
    }
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
    drawVideoSettings();
}

// ---- VIDEO / upscaling panel -------------------------------------------------
// FSR-style spatial upscaling: pick an internal render scale, the compositor
// stretches to output, an optional convolution sharpen restores edge bite.
function drawVideoSettings() {
  ctx.save();
  ctx.textBaseline = 'top';
  // gear button, top-right
  const gw = 150, gh = 34, gx = view.w - gw - 16, gy = 14;
  ctx.fillStyle = videoOpen ? 'rgba(40,48,60,0.95)' : 'rgba(18,22,28,0.85)';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.strokeStyle = '#546e7a';
  ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy, gw, gh);
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#cfd8dc';
  ctx.textAlign = 'center';
  ctx.fillText('⚙ VIDEO', gx + gw / 2, gy + 9);
  button(gx, gy, gw, gh, () => { videoOpen = !videoOpen; });
  if (!videoOpen) {
    if (renderScale < 1) {
      ctx.font = '11px monospace';
      ctx.fillStyle = '#80cbc4';
      ctx.fillText(`UPSCALING: ${upscaleMode().name}`, gx + gw / 2, gy + gh + 6);
    }
    ctx.restore();
    return;
  }
  const pw = Math.min(560, view.w - 60);
  const ph = 396;
  const px = (view.w - pw) / 2;
  const py = (view.h - ph) / 2 - 20;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.fillStyle = 'rgba(13,16,21,0.97)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#80cbc4';
  ctx.strokeRect(px, py, pw, ph);
  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('VIDEO — RESOLUTION UPSCALING', px + pw / 2, py + 16);
  ctx.font = '11px monospace';
  ctx.fillStyle = '#78909c';
  ctx.fillText('renders internally at lower resolution, upscales to your display (FSR-style)', px + pw / 2, py + 42);
  let by = py + 64;
  for (const m of UPSCALE_MODES) {
    const active = settings.upscale === m.id;
    ctx.fillStyle = active ? 'rgba(38,82,75,0.95)' : 'rgba(26,32,40,0.95)';
    ctx.fillRect(px + 24, by, pw - 48, 40);
    ctx.strokeStyle = active ? '#80cbc4' : '#37474f';
    ctx.strokeRect(px + 24, by, pw - 48, 40);
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = active ? '#80cbc4' : '#cfd8dc';
    ctx.fillText(m.name, px + 40, by + 6);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#78909c';
    ctx.fillText(m.desc, px + 40, by + 24);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#9e9e9e';
    ctx.fillText(`${Math.round(view.w * dpr * m.scale)}×${Math.round(view.h * dpr * m.scale)}`, px + pw - 40, by + 13);
    ctx.textAlign = 'center';
    button(px + 24, by, pw - 48, 40, () => {
      settings.upscale = m.id;
      saveSettings();
      resize();
    });
    by += 46;
  }
  // sharpen toggle
  const shOn = settings.sharpen;
  ctx.fillStyle = shOn ? 'rgba(38,82,75,0.95)' : 'rgba(26,32,40,0.95)';
  ctx.fillRect(px + 24, by, pw - 48, 32);
  ctx.strokeStyle = shOn ? '#80cbc4' : '#37474f';
  ctx.strokeRect(px + 24, by, pw - 48, 32);
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = shOn ? '#80cbc4' : '#9e9e9e';
  ctx.fillText(`SHARPEN PASS: ${shOn ? 'ON' : 'OFF'} (recovers edge contrast when upscaling)`, px + pw / 2, by + 9);
  button(px + 24, by, pw - 48, 32, () => {
    settings.sharpen = !settings.sharpen;
    saveSettings();
    resize();
  });
  by += 38;
  const arOn = settings.arcade;
  ctx.fillStyle = arOn ? 'rgba(82,60,30,0.95)' : 'rgba(26,32,40,0.95)';
  ctx.fillRect(px + 24, by, pw - 48, 32);
  ctx.strokeStyle = arOn ? '#ffab40' : '#37474f';
  ctx.strokeRect(px + 24, by, pw - 48, 32);
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = arOn ? '#ffab40' : '#9e9e9e';
  ctx.textAlign = 'center';
  ctx.fillText(`ARCADE MODE: ${arOn ? 'ON' : 'OFF'} (neon trails, scanlines, extra juice)`, px + pw / 2, by + 9);
  button(px + 24, by, pw - 48, 32, () => {
    settings.arcade = !settings.arcade;
    saveSettings();
  });
  by += 42;
  ctx.font = '11px monospace';
  ctx.fillStyle = '#607d8b';
  ctx.fillText(`GPU: ${GPU.vendor} — ${GPU.renderer}`, px + pw / 2, by);
  ctx.fillText(`output ${Math.round(view.w * dpr)}×${Math.round(view.h * dpr)} · internal ${canvas.width}×${canvas.height}`, px + pw / 2, by + 16);
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
  ctx.setTransform(dpr * renderScale, 0, 0, dpr * renderScale, 0, 0);
  uiButtons = [];
  if (state === 'title') return drawTitle();
  if (state === 'levelselect') return drawLevelSelect();
  if (state === 'charselect') return drawCharSelect();
  for (const v of Object.values(portraitVids)) if (!v.paused) v.pause();
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
  // generators: dark and silent, or humming with a lit halo
  for (const gen of game.generators || []) {
    ctx.save();
    ctx.translate(gen.x, gen.y);
    if (gen.on) {
      const hum = 1 + 0.05 * Math.sin(performance.now() / 90);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(0, 0, 4, 0, 0, 70);
      gg.addColorStop(0, 'rgba(255,214,120,0.35)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(-70, -70, 140, 140);
      ctx.restore();
      ctx.scale(hum, hum);
    }
    if (SPRITES.generator) drawSpriteFit(SPRITES.generator, 54, 54);
    else {
      ctx.fillStyle = gen.on ? '#c9a227' : '#4a4a3a';
      ctx.fillRect(-18, -14, 36, 28);
    }
    ctx.restore();
    // prompt + fuel bar
    const dp2 = Math.hypot(game.player.x - gen.x, game.player.y - gen.y);
    if (dp2 < 150) {
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = gen.on ? '#aed581' : char.scrap >= gen.cost ? '#ffd54f' : '#ef5350';
      ctx.fillText(gen.on ? `RUNNING ${Math.ceil(gen.fuel)}s` : `[F] FUEL ⚙${gen.cost}`, gen.x, gen.y - 34);
    }
  }
  // supply crates: drifting down under canopy, then beckoning on the ground
  for (const dr of game.drops || []) {
    ctx.save();
    ctx.translate(dr.x, dr.y);
    if (dr.landT > 0) {
      const k2 = dr.landT / 2.6;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(0, 12, 26 * (1 - k2 * 0.5), 12 * (1 - k2 * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      const sc2 = 1 + k2 * 0.9;
      if (SPRITES.supplydrop) drawSpriteFit(SPRITES.supplydrop, 86 * sc2, 86 * sc2);
    } else {
      const pulse2 = 1 + 0.08 * Math.sin(performance.now() / 200);
      if (SPRITES.supplydrop) drawSpriteFit(SPRITES.supplydrop, 70 * pulse2, 70 * pulse2);
      else {
        ctx.fillStyle = '#5d4a26';
        ctx.fillRect(-16, -12, 32, 24);
      }
      if (SPRITES.bonusstar) {
        ctx.globalAlpha = 0.55 + 0.4 * Math.sin(performance.now() / 250);
        drawSpriteFit(SPRITES.bonusstar, 30, 30);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
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
  if (settings.arcade) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of game.bullets) {
      const tx = b.x - b.vx * 0.02, ty = b.y - b.vy * 0.02;
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.35; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.01, b.y - b.vy * 0.01); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  } else {
    for (const b of game.bullets) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      ctx.stroke();
    }
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
    const colors = { medkit: '#ef5350', ammo: '#ffca28', shield: '#42a5f5', rage: '#ff7043', nade: '#9ccc65', dyna: '#ff7043', food: '#aed581', water: '#4fc3f7', bandage: '#f8bbd0' };
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
  // burning ground
  for (const f2 of game.fires || []) {
    const flick = 1 + Math.sin(performance.now() / 70 + f2.x) * 0.12;
    if (SPRITES.fire) {
      ctx.save();
      ctx.translate(f2.x, f2.y);
      ctx.globalAlpha = Math.min(1, (f2.until - game.time) / 0.6);
      drawSpriteFit(SPRITES.fire, f2.r * 2.4 * flick, f2.r * 2.4 * flick);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = `rgba(255,140,0,${0.25 * flick})`;
      ctx.beginPath();
      ctx.arc(f2.x, f2.y, f2.r * flick, 0, Math.PI * 2);
      ctx.fill();
    }
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
  // throwables in flight: spin, drop shadow, arming-glow pulse near detonation
  const NADE_SPRITE = { frag: 'nade_frag', smoke: 'nade_smoke', decoy: 'nade_decoy', dyna: 'nade_dyna' };
  const NADE_GLOW = { frag: '255,82,82', smoke: '176,190,197', decoy: '38,198,218', dyna: '255,112,67' };
  for (const tb of game.throwables) {
    ctx.save();
    ctx.translate(tb.x, tb.y);
    // shadow under the arc
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // arming glow swells as the fuse runs out
    const armP = 1 - Math.min(1, tb.fuse / 1.2);
    const glow = NADE_GLOW[tb.kind] || '255,82,82';
    const pulse = 0.4 + armP * (0.6 + 0.4 * Math.sin(performance.now() / 60));
    const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 16 + armP * 10);
    gr.addColorStop(0, `rgba(${glow},${pulse * 0.7})`);
    gr.addColorStop(1, `rgba(${glow},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(-26, -26, 52, 52);
    const sp = SPRITES[NADE_SPRITE[tb.kind]];
    if (sp) {
      ctx.rotate(tb.rot || 0);
      drawSpriteFit(sp, 22, 22);
    } else {
      ctx.fillStyle = tb.kind === 'frag' ? '#558b2f' : tb.kind === 'smoke' ? '#90a4ae' : tb.kind === 'decoy' ? '#26c6da' : '#d84315';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
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
  // speech bubble bark
  if (game.bark && game.bark.t > 0) {
    game.bark.t -= dt;
    const p2 = game.player;
    ctx.font = 'bold 14px monospace';
    const bw3 = ctx.measureText(game.bark.text).width + 26;
    ctx.save();
    ctx.globalAlpha = Math.min(1, game.bark.t * 3);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(p2.x - bw3 / 2, p2.y - p2.radius - 52, bw3, 26, 8);
    else ctx.rect(p2.x - bw3 / 2, p2.y - p2.radius - 52, bw3, 26);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p2.x - 5, p2.y - p2.radius - 27);
    ctx.lineTo(p2.x + 6, p2.y - p2.radius - 27);
    ctx.lineTo(p2.x, p2.y - p2.radius - 18);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#111';
    ctx.fillText(game.bark.text, p2.x, p2.y - p2.radius - 39);
    ctx.restore();
  }
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
    const boomSp = SPRITES.explosion_hd || SPRITES.boom;
    if (boomSp) {
      ctx.save();
      ctx.translate(ex.x, ex.y);
      ctx.globalCompositeOperation = 'lighter';
      const sc = ex.r * 2.6 * (0.5 + t * 0.95);
      ctx.globalAlpha = Math.max(0, 1 - t * 1.1);
      ctx.rotate((ex.seed || 0) + t * 0.5);
      drawSpriteFit(boomSp, sc, sc);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // white-hot expanding shockwave ring for extra HD punch
    if (t < 0.6) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.6 - t) * 1.3})`;
      ctx.lineWidth = 5 * (0.6 - t) + 1;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.r * (0.5 + t * 1.6), 0, Math.PI * 2);
      ctx.stroke();
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
    if (gb.sprite && SPRITES[gb.sprite]) {
      drawSpriteFit(SPRITES[gb.sprite], gb.size * 3, gb.size * 3);
      ctx.restore();
      continue;
    }
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
  // combo air support streaking overhead
  for (const bm of game.bombers || []) {
    ctx.save();
    ctx.translate(bm.x, bm.y);
    const planeSp = SPRITES[bm.sp || 'bomber'];
    if (planeSp) {
      const fly = Math.atan2(bm.vy || 0, bm.vx); // art faces right → nose = travel dir
      ctx.save();
      ctx.translate(22, 78); // shadow cast below the airframe
      ctx.rotate(fly);
      ctx.globalAlpha = 0.3;
      ctx.filter = 'brightness(0)';
      drawSpriteFit(planeSp, 168, 168);
      ctx.filter = 'none';
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.rotate(fly);
      drawSpriteFit(planeSp, 168, 168);
    } else {
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.moveTo(60, 0);
      ctx.lineTo(-40, -34);
      ctx.lineTo(-40, 34);
      ctx.fill();
    }
    ctx.restore();
  }
  // EVAC-1 — the extraction bird
  if (game.extract) {
    const ex = game.extract;
    const alt = ex.alt == null ? 1 : ex.alt;
    ctx.save();
    ctx.translate(ex.x, ex.y);
    // altitude shadow drifts away as it climbs
    ctx.save();
    ctx.translate(26 * alt + 6, 80 * alt + 10);
    ctx.rotate(ex.ang || 0);
    ctx.globalAlpha = 0.3;
    ctx.filter = 'brightness(0)';
    if (SPRITES.helicopter) drawSpriteFit(SPRITES.helicopter, 240, 240);
    else { ctx.fillRect(-80, -26, 150, 52); }
    ctx.filter = 'none';
    ctx.restore();
    ctx.globalAlpha = 1;
    const sc = 1 + alt * 0.3;
    ctx.rotate(ex.ang || 0);
    ctx.scale(sc, sc);
    if (SPRITES.helicopter) drawSpriteFit(SPRITES.helicopter, 240, 240);
    else {
      ctx.fillStyle = '#4a5548';
      ctx.fillRect(-80, -26, 150, 52);
      ctx.fillRect(-130, -8, 60, 16);
      ctx.fillStyle = '#232b25';
      ctx.fillRect(30, -20, 40, 40);
    }
    // spinning main rotor
    ctx.save();
    ctx.translate(10, 0);
    ctx.rotate(performance.now() / 26);
    ctx.strokeStyle = 'rgba(225,228,232,0.5)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-98, 0); ctx.lineTo(98, 0);
    ctx.moveTo(0, -98); ctx.lineTo(0, 98);
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(0, 0, 99, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    // door-gun tracer
    if (ex.tracer && ex.tracerT > 0) {
      ctx.strokeStyle = 'rgba(255,224,130,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex.x, ex.y);
      ctx.lineTo(ex.tracer.x, ex.tracer.y);
      ctx.stroke();
      ctx.fillStyle = '#ffe082';
      ctx.beginPath();
      ctx.arc(ex.tracer.x, ex.tracer.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // gore flash sprites (bloodburst on kills)
  for (const sf of game.slashFx) {
    const sp = SPRITES[sf.sprite];
    if (!sp) continue;
    ctx.save();
    ctx.translate(sf.x, sf.y);
    ctx.rotate(sf.rot || 0);
    ctx.globalAlpha = Math.min(1, sf.t * 3);
    drawSpriteFit(sp, sf.r * 2, sf.r * 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // BLADESTORM razor discs orbiting the player
  if (game.time < game.bladeUntil) {
    for (const bl of game.blades) {
      ctx.save();
      ctx.translate(bl.x, bl.y);
      ctx.rotate((bl.a || 0) * 4);
      if (SPRITES.buzzsaw) drawSpriteFit(SPRITES.buzzsaw, 42, 42);
      else {
        ctx.fillStyle = '#cfd8dc';
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const rr = i % 2 ? 20 : 12;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
  // red kill X's, SYNTHETIK style
  for (const km of game.killMarks) {
    const t = km.t / 0.65;
    const r = (km.r || (km.big ? 26 : 13)) * (1.7 - t * 0.7);
    const xSprite = SPRITES.killx3 || SPRITES.killx2 || SPRITES.killx;
    if (xSprite) {
      ctx.save();
      ctx.translate(km.x, km.y);
      ctx.rotate(km.rot || 0);
      ctx.globalAlpha = t;
      drawSpriteFit(xSprite, r * 2.6, r * 2.6);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = `rgba(244,67,54,${t})`;
      ctx.lineWidth = km.big ? 6 : 3.5;
      ctx.beginPath();
      ctx.moveTo(km.x - r, km.y - r);
      ctx.lineTo(km.x + r, km.y + r);
      ctx.moveTo(km.x + r, km.y - r);
      ctx.lineTo(km.x - r, km.y + r);
      ctx.stroke();
    }
  }
  for (const n of game.dmgNumbers) {
    const crit = n.color === '#ffd740' || n.color.startsWith('hsl');
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

  // BLACKOUT: the county is dark. Paint darkness, then carve light out of it
  // with the flashlight cone, running generators, fires and muzzle flash.
  if (game.blackout) drawBlackoutMask();
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
  // grimdark grade: a heavy cold vignette + a bruised red-black edge wash
  {
    const vg = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.7, 'rgba(6,4,10,0.28)');
    vg.addColorStop(1, 'rgba(2,0,4,0.62)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);
    // a whisper of blood-red at the very corners for the twisted mood
    const rv = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.55, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.78);
    rv.addColorStop(0, 'rgba(0,0,0,0)');
    rv.addColorStop(1, 'rgba(60,4,10,0.22)');
    ctx.fillStyle = rv;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (settings.arcade) {
    // CRT scanline overlay + a hotter combo-driven vignette pulse
    const pat = ctx.createPattern(scanlines(), 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, view.w, view.h);
    if (game.combo >= 10) {
      const cv = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.34, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72);
      const hot = Math.min(0.4, game.combo * 0.006);
      cv.addColorStop(0, 'rgba(0,0,0,0)');
      cv.addColorStop(1, `rgba(255,140,40,${hot})`);
      ctx.fillStyle = cv;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  }
  if (game.hurtVoiceFlash > 0) {
    const vf = game.hurtVoiceFlash * (0.5 + 0.5 * Math.sin(performance.now() / 70));
    ctx.fillStyle = `rgba(160,10,20,${Math.min(0.32, vf * 0.5)})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (game.nukeFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.95, game.nukeFlash)})`;
    ctx.fillRect(0, 0, view.w, view.h);
    game.nukeFlash -= dt * 1.4;
  }
  if (game.hypeFlash > 0) {
    ctx.fillStyle = `rgba(255,215,64,${game.hypeFlash * 0.3})`;
    ctx.fillRect(0, 0, view.w, view.h);
    game.hypeFlash -= dt * 1.4;
  }
  // boss-intro cinematic: letterbox bars + the name card
  if (game.bossIntroT > 0) {
    game.bossIntroT -= dt;
    const k = Math.min(1, (2.4 - game.bossIntroT) * 2.5);
    const barH = Math.round(view.h * 0.12 * k);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, view.w, barH);
    ctx.fillRect(0, view.h - barH, view.w, barH);
    if (game.superBoss) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 44px monospace';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.strokeText(game.superBoss.super, view.w / 2, view.h * 0.78);
      ctx.fillStyle = '#ffd700';
      ctx.fillText(game.superBoss.super, view.w / 2, view.h * 0.78);
    }
  }
  if (game.buildMode) drawBuildGhost();
  drawScreenBlood();
  drawEnemyArrows();
  drawHUD();
  drawStoryCard(dt);
  if (game.wheelOpen) drawWeaponWheel();
  if (paused && state === 'playing') drawPauseMenu();
  // KILL MODE cut-in: the hero's portrait rides a slash streak across screen
  if (game.cutin) {
    const ci = game.cutin;
    ci.t -= dt || 0.016;
    if (ci.t <= 0) {
      game.cutin = null;
    } else {
      const k = 1 - ci.t / 1.7;
      const sx = view.w * (-0.35 + k * 1.7);
      ctx.save();
      ctx.globalAlpha = Math.min(1, ci.t * 3) * 0.95;
      if (SPRITES.slashfx) {
        ctx.save();
        ctx.translate(sx, view.h * 0.4);
        drawSpriteFit(SPRITES.slashfx, view.w * 0.95, view.h * 0.55);
        ctx.restore();
      }
      const port = getImage(`portraits/${ci.hero}.png`);
      if (port) {
        const ps2 = view.h * 0.44;
        ctx.save();
        ctx.translate(sx, view.h * 0.4);
        ctx.rotate(-0.06);
        ctx.drawImage(port, -ps2 / 2, -ps2 / 2, ps2, ps2);
        ctx.strokeStyle = '#ff1744';
        ctx.lineWidth = 4;
        ctx.strokeRect(-ps2 / 2, -ps2 / 2, ps2, ps2);
        ctx.restore();
      }
      ctx.font = `bold ${Math.round(view.h / 9)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#000';
      ctx.strokeText('KILL MODE', view.w / 2, view.h * 0.76);
      ctx.fillStyle = '#ff1744';
      ctx.fillText('KILL MODE', view.w / 2, view.h * 0.76);
      ctx.restore();
    }
  }
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
  const uiState = paused || charSheetOpen || state === 'shop' || state === 'charselect' || state === 'levelselect' || state === 'gameover' || state === 'levelintro' || state === 'title';
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
    if (videoOpen) input.pressed.delete('mouse'); // panel modal: clicks stay inside
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
    if (wasPressed('escape') || gpPressed('back')) paused = !paused;
    if (wasPressed('tab') || gpPressed('start')) charSheetOpen = !charSheetOpen;
    if (!charSheetOpen && !paused) {
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

// UAT/debug handle: read-only introspection for automated tests
window.__dz = {
  state: () => state,
  props: () => (game && game.props ? game.props.length : -1),
  barricades: () => (game && game.props ? game.props.filter((p2) => p2.kind === 'barricade_built').length : -1),
  scrap: () => char.scrap,
  zombies: () => (game && game.zombies ? game.zombies.length : -1),
  blackout: () => !!(game && game.blackout),
  paused: () => paused,
  extract: () => (game && game.extract ? game.extract.phase : null),
  forceLastWave: () => {
    if (!game) return false;
    game.wave = level().waves;
    game.zombies.length = 0;
    game.spawnQueue.length = 0;
    return true;
  },
};
