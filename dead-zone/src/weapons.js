// Weapon definitions. auto: hold mouse to keep firing. pellets: shots per trigger pull.
// pierce: number of zombies a single bullet can pass through.
// store-only weapons carry a price and must be bought before they can be equipped.
export const WEAPONS = {
  pistol: {
    name: 'PISTOL', key: '1', auto: false, damage: 30, magSize: 12,
    fireInterval: 0.25, reloadTime: 1.0, spread: 0.03, pellets: 1,
    bulletSpeed: 1100, color: '#ffd27a', pierce: 1,
  },
  rifle: {
    name: 'RIFLE', key: '2', auto: true, damage: 35, magSize: 30,
    fireInterval: 0.11, reloadTime: 1.6, spread: 0.045, pellets: 1,
    bulletSpeed: 1300, color: '#ffe9a8', pierce: 1,
  },
  shotgun: {
    name: 'SHOTGUN', key: '3', auto: false, damage: 14, magSize: 6,
    fireInterval: 0.7, reloadTime: 2.2, spread: 0.22, pellets: 8,
    bulletSpeed: 950, color: '#ffb36b', pierce: 1,
  },
  smg: {
    name: 'SMG', key: '4', auto: true, damage: 18, magSize: 35,
    fireInterval: 0.07, reloadTime: 1.4, spread: 0.09, pellets: 1,
    bulletSpeed: 1000, color: '#a8e0ff', pierce: 1,
  },
  magnum: {
    name: 'MAGNUM', key: '5', auto: false, damage: 95, magSize: 6,
    fireInterval: 0.55, reloadTime: 1.8, spread: 0.02, pellets: 1,
    bulletSpeed: 1500, color: '#ff8a80', pierce: 3, price: 400,
  },
  minigun: {
    name: 'MINIGUN', key: '6', auto: true, damage: 15, magSize: 120,
    fireInterval: 0.045, reloadTime: 3.2, spread: 0.13, pellets: 1,
    bulletSpeed: 1100, color: '#b9f6ca', pierce: 1, price: 900,
  },
  flak: {
    name: 'FLAK CANNON', key: '7', auto: false, damage: 16, magSize: 8,
    fireInterval: 0.8, reloadTime: 2.4, spread: 0.3, pellets: 12,
    bulletSpeed: 900, color: '#ffab91', pierce: 1, price: 700,
  },
  railgun: {
    name: 'RAILGUN', key: '8', auto: false, damage: 220, magSize: 4,
    fireInterval: 0.9, reloadTime: 2.6, spread: 0, pellets: 1,
    bulletSpeed: 2400, color: '#80d8ff', pierce: 99, price: 1200,
  },
  sniper: {
    name: 'SNIPER', key: '9', auto: false, damage: 400, magSize: 5,
    fireInterval: 1.4, reloadTime: 2.8, spread: 0, pellets: 1,
    bulletSpeed: 2800, color: '#fff59d', pierce: 5, price: 1500,
  },
  mortar: {
    name: 'MORTAR', key: '0', auto: false, damage: 40, magSize: 4,
    fireInterval: 1.3, reloadTime: 3.0, spread: 0.05, pellets: 1,
    bulletSpeed: 620, color: '#ffcc80', pierce: 1, price: 1800, mortar: true,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'smg', 'magnum', 'minigun', 'flak', 'railgun', 'sniper', 'mortar'];

// reserve ammo carried per weapon at level start; the pistol never runs dry
export const AMMO_RESERVE = {
  pistol: Infinity, rifle: 150, shotgun: 42, smg: 210, magnum: 36,
  minigun: 480, flak: 56, railgun: 20, sniper: 25, mortar: 18,
};
export const STARTING_WEAPONS = ['pistol', 'rifle', 'shotgun', 'smg'];
