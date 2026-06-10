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

- **10 playable survivors** — each with permanent attribute bonuses and a
  favored weapon (+15% damage). Chosen on a roster screen at campaign start.
- **Squad of four** — a new ally joins after every level: SGT. REYES
  (rifle DPS), DOC OKAFOR (healing aura + mid-wave revives), CDR. HALE
  (piercing magnum), "BOOM" OSORIO (grenades into the thickest cluster).
- **6 zombie types** — walkers, runners, brutes, acid-lobbing Spitters,
  chain-reacting Exploders, and minion-spawning Bosses.
- **8 guns** — pistol/rifle/shotgun/SMG free; Magnum, Minigun, Flak Cannon
  and Railgun sold in the store, all upgradable to MK6.
- **Loot** — kills can drop medkits, instant-reload ammo, 30s armor shields
  and 15s rage (x2 damage); brutes and bosses always drop.
- **Checkpoints** — a save point every 3 waves; death returns you there.
- **Story campaign, 5 levels x 10 waves** — City Outskirts → Old Harrow
  Graveyard → The Sewers → St. Mercy Hospital → Quarantine Base Delta, with
  an opening cinematic, squad-introduction cutscenes between levels, ECHO-6
  radio briefings, a victory cutscene, epilogue and New Game+.
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
