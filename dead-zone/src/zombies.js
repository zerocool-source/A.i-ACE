// Zombie archetypes. Walkers from wave 1, Runners from wave 2, Brutes from
// wave 3, a Boss on wave 10 and every 5th wave after.
export const ZOMBIE_TYPES = {
  walker: {
    hp: 100, speed: 55, damage: 10, radius: 16, score: 10,
    color: '#4caf50', glow: 'rgba(76,175,80,0.45)',
  },
  runner: {
    hp: 60, speed: 145, damage: 8, radius: 12, score: 15,
    color: '#ff9800', glow: 'rgba(255,152,0,0.45)',
  },
  brute: {
    hp: 300, speed: 32, damage: 20, radius: 26, score: 40,
    color: '#e53935', glow: 'rgba(229,57,53,0.5)',
  },
  boss: {
    hp: 3000, speed: 42, damage: 35, radius: 44, score: 500,
    color: '#9c27b0', glow: 'rgba(156,39,176,0.6)',
  },
  spitter: {
    hp: 90, speed: 48, damage: 14, radius: 16, score: 25,
    color: '#cddc39', glow: 'rgba(205,220,57,0.45)',
    ranged: { range: 330, interval: 2.4, shotSpeed: 420 },
  },
  exploder: {
    hp: 55, speed: 125, damage: 45, radius: 14, score: 30,
    color: '#ff7043', glow: 'rgba(255,112,67,0.55)',
    explodes: { radius: 95 },
  },
  crawler: {
    hp: 35, speed: 150, damage: 7, radius: 9, score: 12,
    color: '#90a4ae', glow: 'rgba(144,164,174,0.4)',
    lunges: true, // bursts to 1.8x speed inside 160px
  },
  screamer: {
    hp: 75, speed: 50, damage: 8, radius: 14, score: 35,
    color: '#e0e0e0', glow: 'rgba(224,224,224,0.5)',
    screams: { radius: 360, interval: 6, boost: 3 }, // hastes nearby zombies
  },
  rogue: {
    hp: 130, speed: 95, damage: 16, radius: 13, score: 60,
    color: '#b0bec5', glow: 'rgba(244,67,54,0.35)',
    // rogue military: human, keeps distance and fires rifle bursts
    ranged: { range: 460, interval: 1.1, shotSpeed: 950, bullet: true },
    human: true,
  },
};

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
  };
}
