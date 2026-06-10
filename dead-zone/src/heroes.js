// The playable roster. bonus: permanent attribute points baked into the
// character. favored: +15% damage while wielding that weapon.
export const HEROES = [
  { id: 'jack', name: 'JACK "HAVOC" MILLER', role: 'ex-SWAT', sprite: 'player', bonus: { str: 2 }, favored: 'rifle' },
  { id: 'maya', name: 'MAYA "GHOST" REYES', role: 'urban scout', sprite: 'player_f', bonus: { agi: 2 }, favored: 'smg' },
  { id: 'eli', name: 'ELI "DOC" CARTER', role: 'paramedic', sprite: 'hero_medic', bonus: { vit: 2 }, favored: 'pistol' },
  { id: 'rosa', name: 'ROSA "TANK" VIDAL', role: 'construction', sprite: 'hero_builder', bonus: { vit: 1, str: 1 }, favored: 'shotgun' },
  { id: 'kenji', name: 'KENJI "WIRE" SATO', role: 'hacker', sprite: 'hero_hacker', bonus: { tech: 2 }, favored: 'smg' },
  { id: 'amara', name: 'AMARA COLE', role: 'police officer', sprite: 'hero_cop', bonus: { agi: 1, tech: 1 }, favored: 'pistol' },
  { id: 'bear', name: 'BEAR JACKSON', role: 'biker', sprite: 'hero_biker', bonus: { str: 2 }, favored: 'shotgun' },
  { id: 'lena', name: 'LENA "SPARKS" NOVAK', role: 'engineer', sprite: 'hero_engineer', bonus: { tech: 1, str: 1 }, favored: 'minigun' },
  { id: 'sam', name: 'SAM "GRAMPS" HOLLIS', role: 'war veteran', sprite: 'hero_veteran', bonus: { str: 1, vit: 1 }, favored: 'magnum' },
  { id: 'chloe', name: 'CHLOE "DASH" KIM', role: 'athlete', sprite: 'hero_athlete', bonus: { agi: 2 }, favored: 'smg' },
];

export function heroById(id) {
  return HEROES.find((h) => h.id === id) || HEROES[0];
}

export function bonusText(h) {
  const parts = Object.entries(h.bonus).map(([k, v]) => `+${v} ${k.toUpperCase()}`);
  return `${parts.join(' ')} · favors ${h.favored.toUpperCase()}`;
}
