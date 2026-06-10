// Weapon definitions. auto: hold mouse to keep firing. pellets: shots per trigger pull.
export const WEAPONS = {
  pistol: {
    name: 'PISTOL', key: '1', auto: false, damage: 30, magSize: 12,
    fireInterval: 0.25, reloadTime: 1.0, spread: 0.03, pellets: 1,
    bulletSpeed: 1100, color: '#ffd27a',
  },
  rifle: {
    name: 'RIFLE', key: '2', auto: true, damage: 35, magSize: 30,
    fireInterval: 0.11, reloadTime: 1.6, spread: 0.045, pellets: 1,
    bulletSpeed: 1300, color: '#ffe9a8',
  },
  shotgun: {
    name: 'SHOTGUN', key: '3', auto: false, damage: 14, magSize: 6,
    fireInterval: 0.7, reloadTime: 2.2, spread: 0.22, pellets: 8,
    bulletSpeed: 950, color: '#ffb36b',
  },
  smg: {
    name: 'SMG', key: '4', auto: true, damage: 18, magSize: 35,
    fireInterval: 0.07, reloadTime: 1.4, spread: 0.09, pellets: 1,
    bulletSpeed: 1000, color: '#a8e0ff',
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'smg'];
