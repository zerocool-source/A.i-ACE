# DEAD ZONE

Top-down zombie survival campaign — five story levels, an RPG progression
layer, and a between-level shop. Vanilla canvas + WebAudio, no runtime
dependencies; all art was generated with Higgsfield and all audio is
synthesized, so the game runs from a fresh clone.

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
| E | **Higgs Field** — shockwave knockback, then everything inside the bubble moves at 25% speed for 5 s (recharge shortened by TECH + batteries) |
| Tab | Character sheet — pauses the game, spend attribute points |

## What's in the game

- **Story campaign, 5 levels** — City Outskirts → Old Harrow Graveyard →
  The Sewers → St. Mercy Hospital → Quarantine Base Delta. Each has its own
  generated splash art and ground texture, a typewriter radio briefing from
  ECHO-6, fog tint, difficulty multipliers, 5 waves, and a boss fight on the
  final wave (more bosses on later levels). Epilogue + New Game+ after the
  campaign.
- **RPG progression** — kills grant XP; each character level gives 3
  attribute points across STR (damage), AGI (speed/reload), VIT (HP/regen)
  and TECH (crit/Higgs cooldown). Crits, floating damage numbers, armor,
  HP regen. Progress persists in localStorage; dying costs half your scrap
  but your build survives.
- **Scrap & shop** — zombies scatter magnetic scrap pickups; between levels a
  requisitions shop sells weapon upgrade tiers (MK2–MK6), armor plates,
  Higgs batteries, and medkits.
- **4 weapons** — semi-auto pistol, full-auto rifle, 8-pellet shotgun,
  spray-and-pray SMG.
- **3 zombie types + bosses** — Walkers, fast Runners, tanky Brutes, and the
  minion-spawning Boss abomination.
- **Higgs Field** ability with charge meter, orbiting particles, and shockwave.
- **Blood** — particle bursts plus persistent ground decals.
- **All audio synthesized in WebAudio**: per-weapon gunshots, reload/empty
  clicks, distance-attenuated groans, squelches, Higgs whomp, level-up and
  purchase chimes, level-clear fanfare, game-over sting, ambient music loop.

Dev shortcuts: `?debug=shop` / `?debug=victory` jump to those screens from
the title click.

## Drop in your real assets (optional)

- `public/audio/` — copy the DEAD_ZONE_SOUNDTRACK mp3s and add
  `playlist.json` (see the README.txt inside) to replace the procedural music.
- `public/models/` — staging folder for the gun GLBs ahead of the 3D upgrade.
