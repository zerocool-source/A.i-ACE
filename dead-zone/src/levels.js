// The five-level campaign. Each level runs `waves` waves; the final wave adds
// the bosses. Multipliers scale the base wave composition / zombie stats.
// effective difficulty wave = levelIndex * 5 + wave-in-level (see main.js).
export const LEVELS = [
  {
    key: 'city',
    name: 'CITY OUTSKIRTS',
    subtitle: 'The evacuation failed. Fight your way out of the suburbs.',
    ground: '/levels/city-ground.png',
    intro: '/levels/city-intro.png',
    tint: null,
    waves: 10,
    hpMult: 1.0,
    speedMult: 1.0,
    countMult: 1.0,
    bosses: 1,
    sizeMult: 1.0,
    civilians: 14,
    scrapBonus: 150,
    story: [
      'You woke to sirens three days ago. The evac convoys never came back.',
      'ECHO-6 (radio): "Anyone alive out there? Quarantine Base Delta still holds."',
      '"If you can hear this — move. Follow my signal."',
      'Get out of the suburbs. Head for the voice.',
    ],
  },
  {
    key: 'graveyard',
    name: 'OLD HARROW GRAVEYARD',
    subtitle: 'The dead here never needed infecting. They were waiting.',
    ground: '/levels/graveyard-ground.png',
    intro: '/levels/graveyard-intro.png',
    tint: 'rgba(40, 80, 40, 0.10)',
    waves: 10,
    hpMult: 1.2,
    speedMult: 1.0,
    countMult: 1.25,
    bosses: 1,
    sizeMult: 1.15,
    civilians: 6,
    scrapBonus: 250,
    story: [
      'ECHO-6: "You made it out. Good. Stay off the highway — it\'s a feeding ground."',
      'The shortcut runs through Old Harrow cemetery.',
      'The ground there has been... moving.',
      '"Whatever claws out of those graves — don\'t let it slow you down."',
    ],
  },
  {
    key: 'sewer',
    name: 'THE SEWERS',
    subtitle: 'Runners breed fast in the dark. Listen for splashing.',
    ground: '/levels/sewer-ground.png',
    intro: '/levels/sewer-intro.png',
    tint: 'rgba(30, 70, 30, 0.14)',
    waves: 10,
    hpMult: 1.35,
    speedMult: 1.2,
    countMult: 1.25,
    bosses: 2,
    sizeMult: 1.25,
    civilians: 4,
    scrapBonus: 400,
    story: [
      'ECHO-6: "Bridge is gone. The only way across the river is under it."',
      'The old sewer network. Dark, flooded, and the fast ones hunt in packs down there.',
      '"Watch the water. If it ripples, shoot it."',
    ],
  },
  {
    key: 'hospital',
    name: 'ST. MERCY HOSPITAL',
    subtitle: 'Patient zero checked in here. Nobody ever checked out.',
    ground: '/levels/hospital-ground.png',
    intro: '/levels/hospital-intro.png',
    tint: 'rgba(120, 140, 160, 0.08)',
    waves: 10,
    hpMult: 1.6,
    speedMult: 1.25,
    countMult: 1.5,
    bosses: 2,
    sizeMult: 1.4,
    civilians: 8,
    scrapBonus: 600,
    story: [
      'ECHO-6: "Before the fall, St. Mercy logged the first bite. Patient zero."',
      'The infection records are still in the lab. That data could end this.',
      '"Grab the files and burn your way out."',
      '"...Don\'t read the names."',
    ],
  },
  {
    key: 'base',
    name: 'QUARANTINE BASE DELTA',
    subtitle: 'The heart of the Dead Zone. End this.',
    ground: '/levels/base-ground.png',
    intro: '/levels/base-intro.png',
    tint: 'rgba(160, 30, 30, 0.10)',
    waves: 10,
    hpMult: 2.0,
    speedMult: 1.35,
    countMult: 1.75,
    bosses: 3,
    sizeMult: 1.6,
    civilians: 0,
    scrapBonus: 1000,
    story: [
      'ECHO-6: "I\'ll be honest with you. Base Delta fell an hour ago. I\'m all that\'s left."',
      'The source nest is inside the compound. The hospital records say it can die.',
      '"End this. For all of us."',
      '"ECHO-6 out."',
    ],
  },
];

export const VICTORY_ART = '/levels/victory.png';

// Short story cutscenes played when deploying into each level (index = level
// reached). Each introduces the squadmate who joins there and pushes the plot.
export const PRE_CUTSCENES = {
  1: [
    { img: 'levels/city-intro.png', duration: 6, zoomFrom: 1.15, zoomTo: 1.0,
      lines: ['A soldier crawls out of a wrecked APC at the city limits.', 'SGT. REYES: "My whole unit\'s gone. I\'m coming with you."'] },
    { img: 'levels/graveyard-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.15,
      lines: ['ECHO-6: "Two heartbeats now. Good. You\'ll need each other where you\'re going."'] },
  ],
  2: [
    { img: 'levels/graveyard-intro.png', duration: 6, zoomFrom: 1.1, zoomTo: 1.0,
      lines: ['You find a field clinic in the chapel ruins. One doctor, still working.', 'DOC OKAFOR: "I\'ve buried enough patients. Let me keep some alive."'] },
    { img: 'levels/sewer-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.12,
      lines: ['She packs her kit. The way down into the dark is open.'] },
  ],
  3: [
    { img: 'levels/sewer-intro.png', duration: 6, zoomFrom: 1.12, zoomTo: 1.0,
      lines: ['A magnum echoes through the tunnels. Someone is still fighting down here.', 'CDR. HALE: "I held this junction for nine days. About time command sent somebody."'] },
    { img: 'levels/hospital-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.12,
      lines: ['ECHO-6: "Hale?! She\'s alive? Then you actually have a chance at St. Mercy."'] },
  ],
  4: [
    { img: 'levels/hospital-intro.png', duration: 6, zoomFrom: 1.1, zoomTo: 1.0,
      lines: ['In the hospital armory, a man in bomb-squad plate guards the records.', '"BOOM" OSORIO: "You reading those files? Then I\'m blowing you a path to Delta."'] },
    { img: 'levels/base-intro.png', duration: 7, zoomFrom: 1.0, zoomTo: 1.18,
      lines: ['Four of you now. One nest left.', 'ECHO-6: "Whatever happens at Delta... it was an honor."'] },
  ],
};

export const VICTORY_SHOTS = [
  { img: 'levels/base-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.2,
    lines: ['The nest screams once. Then nothing.', 'The boils stop glowing. The horde just... stops.'] },
  { img: 'levels/victory.png', duration: 7, zoomFrom: 1.2, zoomTo: 1.0,
    lines: ['ECHO-6: "...I can see you on the wall cam. All four of you."', '"Survivors of the Dead Zone — the sun\'s coming up."'] },
];

export const EPILOGUE = [
  'The nest is ash.',
  'The radio falls silent — then, one by one, other survivors start answering.',
  'The Dead Zone is clear. You are the reason why.',
];
