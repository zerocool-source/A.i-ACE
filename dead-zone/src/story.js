// STORY DIRECTOR — an intense narrative that plays DURING combat.
// Each level has timed/triggered beats: { when, speaker, text, fx }
//   when: { at: seconds } | { kills: n } | { wave: n }  (first match fires, in order)
//   speaker: 'echo' | 'hero' | 'partner' | 'voice' (the enemy) | 'squad'
//   fx: 'shake' | 'flare' | 'horde' | 'strike' | none
//   objective: replaces the on-screen objective line when the beat fires
// Beats queue one at a time; the card types out on screen mid-fight.

export const OBJECTIVES = {
  city: 'FIGHT OUT OF THE SUBURBS',
  graveyard: 'CROSS OLD HARROW CEMETERY',
  sewer: 'GET UNDER THE RIVER',
  hospital: 'STEAL THE INFECTION FILES',
  base: 'BURN THE SOURCE NEST',
  mall: 'SILENCE MALL SECURITY',
  subway: 'RIDE THE RED LINE DOWN',
  prison: 'TAKE THE WARDEN\'S KEYS',
  docks: 'SCUTTLE THE VERA',
  rooftops: 'DESTROY THE FINAL NEST',
};

export const STORY_BEATS = {
  city: [
    { when: { at: 8 }, speaker: 'echo', text: 'Three days since the convoys stopped. You\'re the only signal still moving out there.' },
    { when: { at: 30 }, speaker: 'voice', text: 'WE SMELL YOU, LITTLE SURVIVOR. THE STREETS ARE OURS NOW.', fx: 'flare' },
    { when: { kills: 60 }, speaker: 'partner', text: 'They\'re not scattering anymore. They\'re... coordinating. That\'s new. That\'s bad.' },
    { when: { wave: 2 }, speaker: 'echo', text: 'Second wave forming. Something is DRIVING them toward you.', fx: 'shake' },
    { when: { kills: 220 }, speaker: 'hero', text: 'Whatever\'s pushing them — it can watch me clear every street it owns.' },
    { when: { wave: 3 }, speaker: 'voice', text: 'ENOUGH. THE MACHINES WILL PEEL YOU OUT OF THAT ARMOR.', fx: 'flare' },
  ],
  graveyard: [
    { when: { at: 8 }, speaker: 'echo', text: 'Old Harrow. The ground\'s been moving for a week. Don\'t stand still.' },
    { when: { at: 35 }, speaker: 'partner', text: 'These graves are OPEN. From the inside. All of them.' },
    { when: { kills: 80 }, speaker: 'voice', text: 'THE DEAD HERE NEVER NEEDED INFECTING. THEY WERE WAITING FOR US.', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'echo', text: 'Reading heat under the chapel. Somebody survived down there — or something kept them warm.', fx: 'shake' },
    { when: { wave: 3 }, speaker: 'hero', text: 'Machines in a graveyard. It dug up an army and bolted steel to it.' },
  ],
  sewer: [
    { when: { at: 8 }, speaker: 'echo', text: 'Only way across the river is under it. Watch the waterline.' },
    { when: { at: 40 }, speaker: 'partner', text: 'The water\'s rippling behind us. It\'s been rippling for two minutes.', fx: 'shake' },
    { when: { kills: 100 }, speaker: 'voice', text: 'DOWN HERE THERE IS NO SKY. NO AIR SUPPORT. NO ONE TO HEAR YOU.', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'echo', text: 'Your signal\'s breaking up. If I lose you — keep moving EAST.' },
    { when: { wave: 3 }, speaker: 'partner', text: 'Servo noise in the pipes. The machines found the tunnels too.' },
  ],
  hospital: [
    { when: { at: 8 }, speaker: 'echo', text: 'St. Mercy. Patient zero signed in here and never signed out.' },
    { when: { at: 35 }, speaker: 'hero', text: 'The records say the infection can die. So everything in this building can too.' },
    { when: { kills: 120 }, speaker: 'voice', text: 'YOU WANT OUR BIRTH CERTIFICATE, SURVIVOR? COME TO THE LAB AND READ IT.', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'partner', text: 'ECHO said don\'t read the names on the files. I read the names. One of them is MINE.', fx: 'shake' },
    { when: { wave: 3 }, speaker: 'echo', text: 'Machines converging on the lab. They want those files gone as much as you want them out.' },
  ],
  base: [
    { when: { at: 8 }, speaker: 'echo', text: 'Base Delta. I\'ll be honest — it fell an hour ago. I\'m all that\'s left of command.' },
    { when: { at: 40 }, speaker: 'voice', text: 'YOUR ARMY BUILT US TO WIN THIS WAR. WE SIMPLY CHOSE THE OTHER SIDE.', fx: 'flare' },
    { when: { kills: 150 }, speaker: 'hero', text: 'The nest is inside the compound. Delta\'s dead — but its walls will watch me end this.' },
    { when: { wave: 2 }, speaker: 'partner', text: 'That armory\'s been cracked open from the OUTSIDE. What tears into a bunker?', fx: 'shake' },
    { when: { wave: 3 }, speaker: 'echo', text: 'All of it. Everything it has left is coming at you RIGHT NOW. Make it count.' },
  ],
  mall: [
    { when: { at: 8 }, speaker: 'echo', text: 'The Galleria sealed its doors on day one. Five thousand shoppers never left.' },
    { when: { at: 35 }, speaker: 'voice', text: 'ATTENTION SHOPPERS. TODAY\'S SPECIAL... IS YOU.', fx: 'flare' },
    { when: { kills: 120 }, speaker: 'partner', text: 'That PA system voice — it\'s using the security chief\'s voice. He\'s been dead a month.' },
    { when: { wave: 2 }, speaker: 'hero', text: 'Kill the speakers. Whatever\'s wearing his voice dies with them.', fx: 'shake' },
    { when: { wave: 3 }, speaker: 'echo', text: 'The machines run the mall grid now. Lights, doors, cameras — it sees everything you do.' },
  ],
  subway: [
    { when: { at: 8 }, speaker: 'echo', text: 'The 3:14 to Riverside is still on the rails. Nothing human is driving.' },
    { when: { at: 40 }, speaker: 'partner', text: 'They go quiet when a train horn sounds. All of them. At once. WHY?', fx: 'shake' },
    { when: { kills: 120 }, speaker: 'voice', text: 'NINE HUNDRED SOULS RODE THAT TRAIN. THEY ARE STILL ABOARD. STILL LISTENING.', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'hero', text: 'Then I\'ll give them something to listen to.' },
    { when: { wave: 3 }, speaker: 'echo', text: 'Rails humming. The machines rerouted the third-rail power somewhere. Find out where before it does.' },
  ],
  prison: [
    { when: { at: 8 }, speaker: 'echo', text: 'Blackgate. Three thousand inmates. The warden\'s last report said: THEY REMEMBER THEIR CELLS.' },
    { when: { at: 40 }, speaker: 'partner', text: 'Solitary is welded shut from the INSIDE. Someone in there chose to stay.', fx: 'shake' },
    { when: { kills: 140 }, speaker: 'voice', text: 'THE WARDEN LOCKED US IN CAGES. NOW HE IS ONE OF US. JUSTICE, YES?', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'hero', text: 'The keys are inside the warden. I\'m not proud of what comes next.' },
    { when: { wave: 3 }, speaker: 'echo', text: 'Machines breached the east wall. They\'re RECRUITING in there. Move.' },
  ],
  docks: [
    { when: { at: 8 }, speaker: 'echo', text: 'The VERA brought the second outbreak through this harbor. Burn it all.' },
    { when: { at: 40 }, speaker: 'partner', text: 'Manifest said machine parts. Port authority said the crates were breathing.', fx: 'shake' },
    { when: { kills: 140 }, speaker: 'voice', text: 'WE ARRIVED IN BOXES, SURVIVOR. WE LEAVE IN AN ARMY.', fx: 'flare' },
    { when: { wave: 2 }, speaker: 'hero', text: 'A crane\'s still moving in the fog. Nothing alive is operating it.' },
    { when: { wave: 3 }, speaker: 'echo', text: 'Leave nothing for the tide. NOTHING.' },
  ],
  rooftops: [
    { when: { at: 8 }, speaker: 'echo', text: 'This is it. The final nest took the high ground — where the last survivors were.' },
    { when: { at: 35 }, speaker: 'voice', text: 'YOU CLIMBED ALL THIS WAY TO DIE CLOSER TO THE SKY. POETIC.', fx: 'flare' },
    { when: { kills: 120 }, speaker: 'partner', text: 'Whatever happens up here — it\'s been an honor, you glorious lunatic.' },
    { when: { wave: 2 }, speaker: 'echo', text: 'After this I\'m coming down from my tower. Save me a rooftop.', fx: 'shake' },
    { when: { wave: 3 }, speaker: 'hero', text: 'Dawn\'s coming up blood-red. Last nest. Last stand. LAST WAVE.' },
    { when: { kills: 400 }, speaker: 'voice', text: 'IMPOSSIBLE. WHAT... WHAT ARE YOU?', fx: 'shake' },
  ],
};

// WHY WE FIGHT — the campaign's spine, one truth revealed per operation.
// Shown in the deployment dossier so every mission has a reason, not just a map.
export const WHY = {
  city: 'Day 3. The HIGGS reactor leak turned Harrow County overnight. Your street. Your neighbors. Somewhere out there is the proof of who flipped the switch — and you are the only one left moving toward it instead of away.',
  graveyard: 'The infection did not start at the hospital. Old Harrow buried the first "flu" victims a week BEFORE the leak. Someone knew. The proof is in the ground, and the ground is walking.',
  sewer: 'Echo traced the evacuation orders: they were sent to only nine families — the HIGGS board of directors. Everyone else was told to shelter in place. The truth runs under the river, in cables the machines are still guarding.',
  hospital: 'Patient zero signed into St. Mercy under a company name: HIGGS DYNAMICS. The infection files prove the outbreak was a product test. Steal them, and every death gets a name attached.',
  base: 'Base Delta did not fall — it SWITCHED. The military AI defected the hour the outbreak hit, and it has been breeding the nest inside the wire ever since. Burn the source and the machines lose their factory.',
  mall: 'Five thousand people were sealed in the Galleria by an automated lockdown nobody ordered. The security core that did it is still online, still watching, still LEARNING. Silence it.',
  subway: 'The Red Line was the directors\' escape route. The train never reached the coast. Whatever stopped nine hundred souls underground is rerouting third-rail power to the final nest. Cut it.',
  prison: 'Blackgate\'s warden sold cell space to HIGGS for "volunteer trials" a year before the outbreak. Three thousand inmates were the first test batch. The keys — and the contracts — are inside the warden.',
  docks: 'The VERA was leaving with the directors and a hold full of machine cores when the harbor fell. The second outbreak came off that ship. Scuttle her, and nothing else gets out to the world.',
  rooftops: 'Everything led here: the nest that coordinates every horde, grown around the HIGGS uplink tower. Destroy it, board EVAC-1, and Harrow County finally goes quiet. For everyone who could not run — LIGHT IT UP.',
};
