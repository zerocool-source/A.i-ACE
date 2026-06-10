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
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'smg', 'magnum', 'minigun'];
export const STARTING_WEAPONS = ['pistol', 'rifle', 'shotgun', 'smg'];
