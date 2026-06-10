# DEAD ZONE

Top-down zombie wave survival. Vanilla canvas + WebAudio, no runtime
dependencies — everything (zombies, blood, gunshots, groans, the soundtrack
fallback) is procedural, so the game runs from a fresh clone with zero assets.

## Play

```bash
cd dead-zone
npm install
npm run dev     # open the printed localhost URL, click to enter
```

## Controls

| Input | Action |
|---|---|
| WASD | Move |
| Shift | Sprint (stamina bar) |
| Mouse | Aim / shoot |
| 1 / 2 / 3 / 4 | Pistol / Rifle / Shotgun / SMG |
| R | Reload |
| E | **Higgs Field** — shockwave knockback, then everything inside the bubble moves at 25% speed for 5 s (15 s recharge) |

## What's in the game

- **4 weapons** — semi-auto pistol (infinite ammo feel via fast reloads),
  full-auto rifle, 8-pellet shotgun, spray-and-pray SMG.
- **3 zombie types + boss** — Walkers (green) from wave 1, fast Runners
  (orange) from wave 2, tanky Brutes (red) from wave 3, and a minion-spawning
  **Boss** (purple) on wave 10 and every 5th wave after.
- **Higgs Field** ability with charge meter, orbiting particles, and shockwave.
- **Blood** — particle bursts plus persistent ground decals.
- Title screen, slam-in wave banners, HUD (HP / stamina / Higgs / ammo),
  game-over sting and restart.
- **All audio synthesized in WebAudio**: per-weapon gunshots, reload/empty
  clicks, distance-attenuated zombie groans, death squelches, Higgs whomp,
  game-over sting, and a dark-ambient music loop.

## Drop in your real assets (optional)

- `public/audio/` — copy the DEAD_ZONE_SOUNDTRACK mp3s and add
  `playlist.json` (see the README.txt inside) to replace the procedural music.
- `public/models/` — staging folder for the gun GLBs ahead of the 3D upgrade.
