// The playable roster. bonus: permanent attribute points baked into the
// character. favored: +15% damage while wielding that weapon.
export const HEROES = [
  { id: 'jack', name: 'JACK "HAVOC" MILLER', role: 'ex-SWAT', sprite: 'player', bonus: { str: 2 }, favored: 'rifle',
    story: "Led the last SWAT push into the quarantine line. His team didn't make it out. He did. He's been making it mean something ever since." },
  { id: 'maya', name: 'MAYA "GHOST" REYES', role: 'urban scout', sprite: 'player_f', bonus: { agi: 2 }, favored: 'smg',
    story: 'Ran parkour tours through these streets before the fall. Now she runs supply routes nobody else survives.' },
  { id: 'eli', name: 'ELI "DOC" CARTER', role: 'paramedic', sprite: 'hero_medic', bonus: { vit: 2 }, favored: 'pistol',
    story: 'Worked the ER the night patient zero came in. He still carries the crash cart key in his pocket.' },
  { id: 'rosa', name: 'ROSA "TANK" VIDAL', role: 'construction', sprite: 'hero_builder', bonus: { vit: 1, str: 1 }, favored: 'shotgun',
    story: 'Built half the towers downtown. Watched the horde pour out of them. She wants her city back, one floor at a time.' },
  { id: 'kenji', name: 'KENJI "WIRE" SATO', role: 'hacker', sprite: 'hero_hacker', bonus: { tech: 2 }, favored: 'smg',
    story: "Cracked the quarantine net's encryption to find his family. Found ECHO-6 instead. Kept listening." },
  { id: 'amara', name: 'AMARA COLE', role: 'police officer', sprite: 'hero_cop', bonus: { agi: 1, tech: 1 }, favored: 'pistol',
    story: 'Held a precinct evacuation alone for six hours. Her bodycam footage is why anyone believed the outbreak was real.' },
  { id: 'bear', name: 'BEAR JACKSON', role: 'biker', sprite: 'hero_biker', bonus: { str: 2 }, favored: 'shotgun',
    story: 'Rode in with a convoy of forty bikes. He keeps forty sets of dog tags on his handlebars.' },
  { id: 'lena', name: 'LENA "SPARKS" NOVAK', role: 'engineer', sprite: 'hero_engineer', bonus: { tech: 1, str: 1 }, favored: 'minigun',
    story: "Kept the power grid alive two weeks longer than anyone thought possible. The lights died. She didn't." },
  { id: 'sam', name: 'SAM "GRAMPS" HOLLIS', role: 'war veteran', sprite: 'hero_veteran', bonus: { str: 1, vit: 1 }, favored: 'magnum',
    story: "Three wars, two heart surgeries, one apocalypse. Says this one's the only fight that ever felt fair." },
  { id: 'chloe', name: 'CHLOE "DASH" KIM', role: 'athlete', sprite: 'hero_athlete', bonus: { agi: 2 }, favored: 'smg',
    story: "Olympic trials were the week the city fell. She still runs every route at race pace. The dead can't keep up." },
];

export function heroById(id) {
  return HEROES.find((h) => h.id === id) || HEROES[0];
}

export function bonusText(h) {
  const parts = Object.entries(h.bonus).map(([k, v]) => `+${v} ${k.toUpperCase()}`);
  return `${parts.join(' ')} · favors ${h.favored.toUpperCase()}`;
}
