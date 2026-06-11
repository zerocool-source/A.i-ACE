// Enemy archetypes. The DEAD own waves 1-2; the MACHINES (bot_* types)
// arrive as the third-wave threat. Internal keys are stable data IDs;
// `label` is the player-facing designation. Color drives glow/minimap/HP.
export const ZOMBIE_TYPES = {
  walker: {
    label: 'WALKER',
    hp: 100, speed: 55, damage: 10, radius: 16, score: 10,
    color: '#4caf50', glow: 'rgba(76,175,80,0.45)',
  },
  runner: {
    label: 'RUNNER',
    hp: 60, speed: 145, damage: 8, radius: 12, score: 15,
    color: '#ff9800', glow: 'rgba(255,152,0,0.45)',
  },
  brute: {
    label: 'BRUTE',
    hp: 300, speed: 32, damage: 20, radius: 26, score: 40,
    color: '#e53935', glow: 'rgba(229,57,53,0.5)',
  },
  boss: {
    label: 'ABOMINATION',
    hp: 3000, speed: 42, damage: 35, radius: 44, score: 500,
    color: '#9c27b0', glow: 'rgba(156,39,176,0.6)',
  },
  spitter: {
    label: 'SPITTER',
    hp: 90, speed: 48, damage: 14, radius: 16, score: 25,
    color: '#cddc39', glow: 'rgba(205,220,57,0.45)',
    ranged: { range: 330, interval: 2.4, shotSpeed: 420 },
  },
  exploder: {
    label: 'EXPLODER',
    hp: 55, speed: 125, damage: 45, radius: 14, score: 30,
    color: '#ff7043', glow: 'rgba(255,112,67,0.55)',
    explodes: { radius: 95 },
  },
  crawler: {
    label: 'CRAWLER',
    hp: 35, speed: 150, damage: 7, radius: 9, score: 12,
    color: '#90a4ae', glow: 'rgba(144,164,174,0.4)',
    lunges: true, // bursts to 1.8x speed inside 160px
  },
  screamer: {
    label: 'SCREAMER',
    hp: 75, speed: 50, damage: 8, radius: 14, score: 35,
    color: '#e0e0e0', glow: 'rgba(224,224,224,0.5)',
    screams: { radius: 360, interval: 6, boost: 3 }, // hastes nearby zombies
  },
  rogue: {
    label: 'ROGUE MARKSMAN',
    hp: 130, speed: 95, damage: 16, radius: 13, score: 60,
    color: '#b0bec5', glow: 'rgba(244,67,54,0.35)',
    // rogue military: human, keeps distance and fires rifle bursts
    ranged: { range: 460, interval: 1.1, shotSpeed: 950, bullet: true },
    human: true,
  },
  granny: {
    label: 'GRANNY',
    // ambusher: lurks beside buildings, then sprints at you screaming
    hp: 200, speed: 165, damage: 14, radius: 13, score: 40,
    color: '#d7ccc8', glow: 'rgba(215,204,200,0.5)',
    ambush: { triggerRange: 380, screamEvery: 2 },
  },
  cop: {
    label: 'ZOMBIE COP',
    // zombie cop: still has the service pistol, still pulls the trigger
    hp: 150, speed: 60, damage: 13, radius: 15, score: 45,
    color: '#5c6bc0', glow: 'rgba(92,107,192,0.45)',
    ranged: { range: 420, interval: 1.7, shotSpeed: 800, bullet: true },
  },
  hazmat: {
    label: 'HAZMAT',
    // bloated suit full of ooze — pops like an exploder, but much bigger
    hp: 240, speed: 40, damage: 30, radius: 18, score: 50,
    color: '#fdd835', glow: 'rgba(253,216,53,0.5)',
    explodes: { radius: 130 },
  },
  butcher: {
    label: 'BUTCHER',
    hp: 420, speed: 72, damage: 32, radius: 22, score: 70,
    color: '#b71c1c', glow: 'rgba(183,28,28,0.55)',
  },
  dog: {
    label: 'HOUND',
    hp: 40, speed: 205, damage: 9, radius: 8, score: 18,
    color: '#8d6e63', glow: 'rgba(141,110,99,0.4)',
    lunges: true,
  },
  stalker: {
    label: 'STALKER',
    hp: 120, speed: 120, damage: 18, radius: 12, score: 35,
    color: '#90caf9', glow: 'rgba(144,202,249,0.4)',
    lunges: true,
  },

  // ---- THE MACHINES (wave-3 robot threat) --------------------------------
  bot_breacher: {
    label: 'BREACHER UNIT', hp: 160, speed: 70, damage: 14, radius: 16, score: 25,
    color: '#69f0ae', glow: 'rgba(105,240,174,0.5)',
  },
  bot_scout: {
    label: 'SCOUT UNIT', hp: 70, speed: 185, damage: 10, radius: 12, score: 25,
    color: '#ffab40', glow: 'rgba(255,171,64,0.5)', lunges: true,
  },
  bot_juggernaut: {
    label: 'JUGGERNAUT', hp: 650, speed: 36, damage: 30, radius: 26, score: 80,
    color: '#ff5252', glow: 'rgba(255,82,82,0.55)',
  },
  bot_kamikaze: {
    label: 'KAMIKAZE BOT', hp: 60, speed: 150, damage: 50, radius: 13, score: 35,
    color: '#ff7043', glow: 'rgba(255,112,67,0.6)', explodes: { radius: 110 },
  },
  bot_marksman: {
    label: 'MARKSMAN UNIT', hp: 140, speed: 55, damage: 20, radius: 13, score: 60,
    color: '#b0bec5', glow: 'rgba(128,216,255,0.4)',
    ranged: { range: 520, interval: 1.6, shotSpeed: 1100, bullet: true },
  },
  bot_enforcer: {
    label: 'ENFORCER UNIT', hp: 220, speed: 62, damage: 16, radius: 15, score: 50,
    color: '#5c6bc0', glow: 'rgba(92,107,192,0.5)',
    ranged: { range: 430, interval: 1.4, shotSpeed: 900, bullet: true },
  },
  bot_overseer: {
    label: 'OVERSEER', hp: 180, speed: 48, damage: 8, radius: 15, score: 70,
    color: '#e0e0e0', glow: 'rgba(224,224,224,0.55)',
    screams: { radius: 380, interval: 5, boost: 3 }, // overclock aura
  },
  bot_warframe: {
    label: 'WARFRAME', hp: 4000, speed: 45, damage: 38, radius: 42, score: 600,
    color: '#b388ff', glow: 'rgba(179,136,255,0.6)',
  },
};

// weighted machine picks for the robot wave (warframe is boss-spawn only)
const MIX_BOTS = [
  ['bot_breacher', 34], ['bot_scout', 22], ['bot_kamikaze', 12],
  ['bot_enforcer', 10], ['bot_marksman', 8], ['bot_juggernaut', 8],
  ['bot_overseer', 4],
];

export function randomBotType() {
  const total = MIX_BOTS.reduce((t, [, w]) => t + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of MIX_BOTS) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'bot_breacher';
}

export function waveComposition(wave) {
  const list = [];
  const walkers = 10 + Math.round(wave * 4.5);
  for (let i = 0; i < walkers; i++) list.push('walker');
  if (wave >= 2) for (let i = 0; i < Math.floor(wave * 2.5); i++) list.push('runner');
  if (wave >= 3) for (let i = 0; i < Math.floor(wave * 0.9); i++) list.push('brute');
  if (wave >= 3) for (let i = 0; i < Math.floor(wave * 1.2); i++) list.push('crawler');
  if (wave >= 4) for (let i = 0; i < Math.floor(wave * 0.6); i++) list.push('spitter');
  if (wave >= 5) for (let i = 0; i < Math.floor(wave * 0.55); i++) list.push('exploder');
  if (wave >= 6) for (let i = 0; i < Math.max(1, Math.floor(wave * 0.25)); i++) list.push('screamer');
  // every wave fields at least 100 zombies
  while (list.length < 100) list.push(Math.random() < 0.75 ? 'walker' : 'runner');
  return list;
}

export function spawnZombie(type, w, h) {
  const def = ZOMBIE_TYPES[type];
  // spawn just outside a random screen edge
  const edge = Math.floor(Math.random() * 4);
  const m = 60;
  let x, y;
  if (edge === 0) { x = Math.random() * w; y = -m; }
  else if (edge === 1) { x = w + m; y = Math.random() * h; }
  else if (edge === 2) { x = Math.random() * w; y = h + m; }
  else { x = -m; y = Math.random() * h; }
  return {
    type, x, y,
    hp: def.hp, maxHp: def.hp,
    speed: def.speed * (0.85 + Math.random() * 0.3),
    damage: def.damage, radius: def.radius,
    score: def.score, color: def.color, glow: def.glow,
    slowUntil: 0,        // higgs field timestamp
    attackCooldown: 0,
    wobble: Math.random() * Math.PI * 2,
    groanTimer: 1 + Math.random() * 6,
    minionTimer: 4,      // boss only
    spitTimer: 1 + Math.random() * 2, // spitter / rogue fire timer
    screamTimer: 2 + Math.random() * 3,
    boostUntil: 0,       // screamer haste
    flash: 0,            // white hit-flash timer
    ranged: def.ranged || null,
    explodes: def.explodes || null,
    lunges: def.lunges || false,
    screams: def.screams || null,
    human: def.human || false,
    ambush: def.ambush || null,
    lurking: !!def.ambush, // grannies wait until you're close
  };
}

// weighted random picks for big mixed drops. minTier gates the nasty types
// so early levels stay survivable: tier = campaign level index.
const MIX = [
  ['walker', 38, 0], ['runner', 18, 0], ['crawler', 10, 0], ['dog', 8, 1],
  ['stalker', 6, 2], ['brute', 5, 1], ['spitter', 4, 2], ['cop', 4, 3],
  ['granny', 8, 1], ['hazmat', 2, 4], ['butcher', 2, 4], ['exploder', 3, 3],
  ['screamer', 1, 3],
];

export function randomZombieType(tier = 99) {
  const pool = MIX.filter(([, , minTier]) => tier >= minTier);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [t, w] of pool) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'walker';
}
