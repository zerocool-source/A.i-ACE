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
    waves: 3,
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
    waves: 3,
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
    waves: 3,
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
    waves: 3,
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
    waves: 3,
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

  {
    key: 'mall',
    name: 'DEADMALL GALLERIA',
    subtitle: 'Consumer paradise. Now they consume you.',
    ground: '/levels/mall-ground.png',
    intro: '/levels/mall-intro.png',
    tint: 'rgba(150, 130, 60, 0.07)',
    waves: 3, hpMult: 2.3, speedMult: 1.4, countMult: 1.8, bosses: 3,
    sizeMult: 1.5, civilians: 10, scrapBonus: 1300,
    story: [
      'ECHO-6: "Delta was the heart. But the infection grew new ones."',
      'The Galleria sealed its doors on day one. Five thousand shoppers never left.',
      '"Mall security is still broadcasting. It is not a human voice anymore."',
    ],
  },
  {
    key: 'subway',
    name: 'RED LINE SUBWAY',
    subtitle: 'The last train never arrived.',
    ground: '/levels/subway-ground.png',
    intro: '/levels/subway-intro.png',
    tint: 'rgba(40, 40, 70, 0.14)',
    waves: 3, hpMult: 2.6, speedMult: 1.45, countMult: 1.9, bosses: 3,
    sizeMult: 1.55, civilians: 6, scrapBonus: 1600,
    story: [
      'The evacuation train derailed with nine hundred souls aboard.',
      'ECHO-6: "They are still in the tunnels. All of them. Listening."',
      '"Kill the lights on your weapon. Or do not. It will not matter."',
    ],
  },
  {
    key: 'prison',
    name: 'BLACKGATE PRISON',
    subtitle: 'The cells are open. Nobody escaped.',
    ground: '/levels/prison-ground.png',
    intro: '/levels/prison-intro.png',
    tint: 'rgba(120, 100, 40, 0.08)',
    waves: 3, hpMult: 3.0, speedMult: 1.5, countMult: 2.0, bosses: 4,
    sizeMult: 1.6, civilians: 0, scrapBonus: 2000,
    story: [
      'ECHO-6: "Blackgate held the worst of us. The infection made them worse."',
      'The warden locked every block before he turned. The keys are inside him.',
      '"Three thousand inmates. Zero parole."',
    ],
  },
  {
    key: 'docks',
    name: 'HARBOR DOCKS',
    subtitle: 'The ships brought it in. The ships take nothing out.',
    ground: '/levels/docks-ground.png',
    intro: '/levels/docks-intro.png',
    tint: 'rgba(30, 60, 90, 0.12)',
    waves: 3, hpMult: 3.4, speedMult: 1.55, countMult: 2.2, bosses: 4,
    sizeMult: 1.7, civilians: 4, scrapBonus: 2600,
    story: [
      'Container ship VERA cruised in with no crew on deck. Port authority boarded her.',
      'ECHO-6: "That was the second outbreak. The one nobody talks about."',
      '"Burn the harbor. Leave nothing for the tide."',
    ],
  },
  {
    key: 'rooftops',
    name: 'THE ROOFTOPS',
    subtitle: 'Above the flood. For now.',
    ground: '/levels/rooftops-ground.png',
    intro: '/levels/rooftops-intro.png',
    tint: 'rgba(160, 60, 30, 0.09)',
    waves: 3, hpMult: 4.0, speedMult: 1.6, countMult: 2.5, bosses: 5,
    sizeMult: 1.8, civilians: 8, scrapBonus: 3500,
    story: [
      'The last survivors live on the roofs now. The dead learned to climb.',
      'ECHO-6: "This is it. The final nest is up there with them."',
      '"Whatever you are... thank you. Now finish it. For everyone."',
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

// deeper arc: deploy cinematics for the post-Delta levels
PRE_CUTSCENES[5] = [
  { img: 'levels/base-intro.png', duration: 6, zoomFrom: 1.12, zoomTo: 1.0,
    lines: ['Delta is ash, but the radio finds new ghosts.', 'ECHO-6: "I\'m picking up a loop from the Galleria. Mall security, channel 9."'] },
  { img: 'levels/mall-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.15,
    lines: ['"ATTENTION SHOPPERS," the loop says. Then it says your name.'] },
];
PRE_CUTSCENES[6] = [
  { img: 'levels/mall-intro.png', duration: 6, zoomFrom: 1.1, zoomTo: 1.0,
    lines: ['Below the Galleria, the tunnels hum.', 'ECHO-6: "The 3:14 to Riverside is still on the rails. Nothing human is driving."'] },
  { img: 'levels/subway-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.14,
    lines: ['You take the stairs down. The platform lights die one by one. Behind you.'] },
];
PRE_CUTSCENES[7] = [
  { img: 'levels/subway-intro.png', duration: 6, zoomFrom: 1.12, zoomTo: 1.0,
    lines: ['The tunnel ends at a wall of bars. Blackgate.', 'ECHO-6: "Three thousand inmates. The Warden\'s last report: THEY REMEMBER THEIR CELLS."'] },
  { img: 'levels/prison-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.16,
    lines: ['Every door in the block stands open. Every door but one. It\'s welded. From inside.'] },
];
PRE_CUTSCENES[8] = [
  { img: 'levels/prison-intro.png', duration: 6, zoomFrom: 1.1, zoomTo: 1.0,
    lines: ['The Warden\'s keys open the service gate to the waterfront.', 'ECHO-6: "The VERA is still moored out there. The ship that brought the second outbreak."'] },
  { img: 'levels/docks-intro.png', duration: 6, zoomFrom: 1.0, zoomTo: 1.15,
    lines: ['Fog rolls off the harbor. Somewhere in it, a crane is still moving.'] },
];
PRE_CUTSCENES[9] = [
  { img: 'levels/docks-intro.png', duration: 6, zoomFrom: 1.1, zoomTo: 1.0,
    lines: ['The harbor burns behind you. One climb left.', 'ECHO-6: "The final nest took the high ground. The roofs. Where the survivors were."'] },
  { img: 'levels/rooftops-intro.png', duration: 7, zoomFrom: 1.0, zoomTo: 1.2,
    lines: ['Dawn breaks blood-red over the skyline.', 'ECHO-6: "After this, I\'m coming down from my tower. Save me a rooftop."'] },
];

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
