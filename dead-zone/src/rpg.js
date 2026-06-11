// RPG layer: character XP/levels, four allocatable attributes, scrap currency,
// weapon upgrade tiers, gear — persisted to localStorage between sessions.
import { WEAPONS, WEAPON_ORDER, STARTING_WEAPONS } from './weapons.js';
import { heroById } from './heroes.js';

const SAVE_KEY = 'deadzone-save-v1';

export const ATTRS = {
  str: { name: 'STRENGTH', desc: '+4% weapon damage per point' },
  agi: { name: 'AGILITY', desc: '+2% move speed, +1.5% reload speed per point' },
  vit: { name: 'VITALITY', desc: '+10 max HP, +0.2 HP/s regen per point' },
  tech: { name: 'TECH', desc: '+1% crit chance, -3% Higgs cooldown per point' },
};

export function newCharacter() {
  return {
    level: 1,
    xp: 0,
    unspent: 0,
    attrs: { str: 0, agi: 0, vit: 0, tech: 0 },
    scrap: 0,
    weaponTiers: Object.fromEntries(WEAPON_ORDER.map((w) => [w, 0])),
    ownedWeapons: [...STARTING_WEAPONS],
    heroId: 'jack',
    gender: 'm',
    armor: 0,
    higgsBatteries: 0,
    grenades: 3,
    dynamite: 1,
    nades: { frag: 3, smoke: 2, decoy: 2 },
    shields: ['blue'],
    shieldType: 'blue',
    campaignLevel: 0, // index into LEVELS
    maxCampaign: 0, // highest level unlocked (for level select)
    totalKills: 0,
  };
}

export function xpForLevel(level) {
  return Math.round(100 * Math.pow(level, 1.45));
}

// returns number of level-ups gained
export function grantXp(char, amount) {
  char.xp += amount;
  let ups = 0;
  while (char.xp >= xpForLevel(char.level)) {
    char.xp -= xpForLevel(char.level);
    char.level++;
    char.unspent += 3;
    ups++;
  }
  return ups;
}

// ---- derived stats ------------------------------------------------------

// allocated points plus the hero's permanent bonus
export function effAttrs(char) {
  const h = heroById(char.heroId);
  const out = { ...char.attrs };
  for (const [k, v] of Object.entries(h.bonus)) out[k] = (out[k] || 0) + v;
  return out;
}

export function derived(char) {
  const a = effAttrs(char);
  return {
    damageMult: 1 + a.str * 0.04,
    moveMult: 1 + a.agi * 0.02,
    reloadMult: Math.max(0.4, 1 - a.agi * 0.015),
    maxHp: 100 + a.vit * 10,
    regen: a.vit * 0.2,
    critChance: 0.05 + a.tech * 0.01,
    higgsCooldown: Math.max(5, 15 * (1 - a.tech * 0.03) - char.higgsBatteries * 2),
    armor: char.armor,
  };
}

export function weaponStats(char, weaponKey) {
  const base = WEAPONS[weaponKey];
  const tier = char.weaponTiers[weaponKey];
  const d = derived(char);
  const favored = heroById(char.heroId).favored === weaponKey ? 1.15 : 1;
  return {
    ...base,
    damage: base.damage * (1 + tier * 0.15) * d.damageMult * favored,
    magSize: Math.round(base.magSize * (1 + tier * 0.2)),
    reloadTime: base.reloadTime * d.reloadMult,
    tier,
    favored: favored > 1,
  };
}

// ---- shop ---------------------------------------------------------------

export const MAX_WEAPON_TIER = 5;
export const MAX_ARMOR = 10;
export const MAX_BATTERIES = 3;

export function shopCatalog(char, playerHp) {
  const d = derived(char);
  const items = [];
  // unowned store guns first — buying unlocks the weapon slot
  for (const w of WEAPON_ORDER) {
    if (char.ownedWeapons.includes(w)) continue;
    const descs = {
      magnum: 'Hand cannon — pierces 3 zombies per shot [5]',
      minigun: 'Bullet hose — 120-round drum [6]',
      flak: 'Wall of shrapnel — 12 pellets per blast [7]',
      railgun: 'Pierces an entire horde in a straight line [8]',
      sniper: 'One shot, five kills, across the whole map [9]',
      mortar: 'Lobbed explosive shells — every round detonates [0]',
    };
    items.push({
      id: 'buy-' + w,
      name: `★ BUY ${WEAPONS[w].name}`,
      desc: descs[w] || 'New weapon',
      cost: WEAPONS[w].price,
      maxed: false,
      buy: (c) => c.ownedWeapons.push(w),
    });
  }
  for (const w of WEAPON_ORDER) {
    if (!char.ownedWeapons.includes(w)) continue;
    const t = char.weaponTiers[w];
    items.push({
      id: 'wep-' + w,
      name: `${WEAPONS[w].name} MK${t + 2}`,
      desc: '+15% damage, +20% mag size',
      cost: 60 * (t + 1) + 40,
      maxed: t >= MAX_WEAPON_TIER,
      buy: (c) => c.weaponTiers[w]++,
    });
  }
  items.push({
    id: 'armor',
    name: `ARMOR PLATE ${char.armor + 1}`,
    desc: '-1 damage from every hit',
    cost: 80 * (char.armor + 1),
    maxed: char.armor >= MAX_ARMOR,
    buy: (c) => c.armor++,
  });
  items.push({
    id: 'battery',
    name: 'HIGGS BATTERY',
    desc: '-2s Higgs Field cooldown',
    cost: 150,
    maxed: char.higgsBatteries >= MAX_BATTERIES,
    buy: (c) => c.higgsBatteries++,
  });
  if (!char.shields.includes('flame')) {
    items.push({
      id: 'shield-flame',
      name: '★ FLAME SHIELD CORE',
      desc: 'Higgs variant: burns everything inside the bubble [C swaps]',
      cost: 600, maxed: false,
      buy: (c) => c.shields.push('flame'),
    });
  }
  if (!char.shields.includes('health')) {
    items.push({
      id: 'shield-health',
      name: '★ HEALTH SHIELD CORE',
      desc: 'Higgs variant: heals you and repels the horde [C swaps]',
      cost: 600, maxed: false,
      buy: (c) => c.shields.push('health'),
    });
  }
  items.push({
    id: 'nades',
    name: 'GRENADE PACK',
    desc: '+2 frag, +1 smoke, +1 decoy — [G] throw, [T] cycle',
    cost: 140,
    maxed: (char.nades?.frag || 0) >= 12,
    buy: (c) => {
      c.nades.frag += 2;
      c.nades.smoke += 1;
      c.nades.decoy += 1;
    },
  });
  items.push({
    id: 'dyna',
    name: 'DYNAMITE x2',
    desc: 'Throw with [H] — huge 180px blast',
    cost: 200,
    maxed: char.dynamite >= 8,
    buy: (c) => (c.dynamite = (c.dynamite || 0) + 2),
  });
  items.push({
    id: 'medkit',
    name: 'FIELD MEDKIT',
    desc: 'Restore to full HP next level',
    cost: 50,
    maxed: playerHp >= d.maxHp,
    buy: () => {}, // healing applied by caller
  });
  return items;
}

// ---- persistence ----------------------------------------------------------

export function saveCharacter(char) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(char));
  } catch {
    /* storage unavailable (private mode etc.) — play session-only */
  }
}

export function loadCharacter() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const base = newCharacter();
    const c = {
      ...base,
      ...parsed,
      // deep-merge nested maps so saves from older versions gain new keys
      attrs: { ...base.attrs, ...(parsed.attrs || {}) },
      weaponTiers: { ...base.weaponTiers, ...(parsed.weaponTiers || {}) },
      ownedWeapons: parsed.ownedWeapons || base.ownedWeapons,
      nades: { ...base.nades, ...(parsed.nades || {}) },
      shields: parsed.shields && parsed.shields.length ? parsed.shields : base.shields,
    };
    // migrate the old single grenade counter into frag grenades
    if (parsed.grenades != null && !parsed.nades) c.nades.frag = Math.max(c.nades.frag, parsed.grenades);
    if (!c.shields.includes(c.shieldType)) c.shieldType = c.shields[0];
    if (c.campaignLevel == null || !c.attrs) return null;
    // saves written at the victory screen can point one past the last level
    c.campaignLevel = Math.max(0, Math.min(9, c.campaignLevel | 0));
    c.maxCampaign = Math.max(0, Math.min(9, Math.max(c.maxCampaign || 0, c.campaignLevel)));
    return c;
  } catch {
    return null;
  }
}

export function wipeSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
