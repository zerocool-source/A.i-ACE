// All sound is synthesized with WebAudio so the game ships with zero audio files.
// If you drop mp3s into public/audio/ and list them in public/audio/playlist.json
// (e.g. ["dead_sector.mp3", "grave_circuit.mp3"]), the real DEAD ZONE soundtrack
// plays instead of the procedural ambient loop.
import { asset } from './assets.js';

let ctx = null;
let master = null;
let musicGain = null;
let musicEl = null;
let playlist = null;
let playlistIndex = 0;
let ambientNodes = [];

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.35;
    musicGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(seconds) {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---- SFX --------------------------------------------------------------

export function playGunshot(weapon) {
  const c = ac();
  const t = c.currentTime;
  // per-weapon character: shotgun deep boom, smg fast snap
  const profile = {
    pistol: { cutoff: 2200, dur: 0.16, vol: 0.5 },
    rifle: { cutoff: 2800, dur: 0.14, vol: 0.45 },
    shotgun: { cutoff: 900, dur: 0.32, vol: 0.7 },
    smg: { cutoff: 3600, dur: 0.09, vol: 0.35 },
  }[weapon] || { cutoff: 2200, dur: 0.15, vol: 0.5 };

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(profile.dur);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(profile.cutoff, t);
  filt.frequency.exponentialRampToValueAtTime(120, t + profile.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(profile.vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + profile.dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);

  // sub-thump body
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(weapon === 'shotgun' ? 90 : 140, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
  const og = c.createGain();
  og.gain.setValueAtTime(profile.vol * 0.8, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.14);
}

export function playReload() {
  const c = ac();
  const t = c.currentTime;
  // two metallic clicks: mag out, mag in
  for (const [dt, f] of [[0, 1800], [0.22, 1200]]) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(0.04);
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = f;
    filt.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.4, t + dt);
    g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
    src.connect(filt).connect(g).connect(master);
    src.start(t + dt);
  }
}

export function playEmptyClick() {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.03);
  const filt = c.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 2500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

export function playGroan(distance01) {
  // distance01: 0 = on top of you, 1 = far away
  const c = ac();
  const t = c.currentTime;
  const dur = 0.7 + Math.random() * 0.6;
  const base = 70 + Math.random() * 60;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.3), t + dur);
  const wob = c.createOscillator();
  wob.frequency.value = 4 + Math.random() * 4;
  const wobGain = c.createGain();
  wobGain.gain.value = base * 0.15;
  wob.connect(wobGain).connect(osc.frequency);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 500;
  const g = c.createGain();
  const vol = 0.18 * (1 - distance01 * 0.85);
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.002), t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(filt).connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur);
  wob.start(t);
  wob.stop(t + dur);
}

export function playSquelch() {
  const c = ac();
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.25);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(800, t);
  filt.frequency.exponentialRampToValueAtTime(80, t + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(0.45, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

export function playHiggsWhomp() {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(35, t + 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.85);
  // shimmer layer
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.5);
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(3000, t);
  filt.frequency.exponentialRampToValueAtTime(300, t + 0.5);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.15, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  src.connect(filt).connect(ng).connect(master);
  src.start(t);
}

export function playLevelUp() {
  const c = ac();
  const t = c.currentTime;
  // rising major arpeggio
  [261.6, 329.6, 392, 523.3].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = c.createGain();
    const t0 = t + i * 0.09;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  });
}

export function playScrapPickup() {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
  const g = c.createGain();
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.1);
}

export function playPurchase() {
  const c = ac();
  const t = c.currentTime;
  [660, 990].forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const g = c.createGain();
    const t0 = t + i * 0.1;
    g.gain.setValueAtTime(0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  });
}

export function playDenied() {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.linearRampToValueAtTime(120, t + 0.15);
  const g = c.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.2);
}

export function playFanfare() {
  const c = ac();
  const t = c.currentTime;
  // triumphant brass-ish chord run for level clear / victory
  [[220, 0], [277.2, 0], [329.6, 0], [440, 0.25], [554.4, 0.25], [659.3, 0.25]].forEach(([f, dt]) => {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1800;
    const g = c.createGain();
    const t0 = t + dt;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
    osc.connect(filt).connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 1.5);
  });
}

export function playScream() {
  const c = ac();
  const t = c.currentTime;
  const base = 600 + Math.random() * 300;
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.4, t + 0.5);
  const vib = c.createOscillator();
  vib.frequency.value = 18;
  const vibGain = c.createGain();
  vibGain.gain.value = 60;
  vib.connect(vibGain).connect(osc.frequency);
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1200;
  filt.Q.value = 1.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
  osc.connect(filt).connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.6);
  vib.start(t);
  vib.stop(t + 0.6);
}

export function playGameOverSting() {
  const c = ac();
  const t = c.currentTime;
  // descending minor arpeggio
  const notes = [220, 174.6, 146.8, 110];
  notes.forEach((f, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = c.createGain();
    const t0 = t + i * 0.35;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (i === notes.length - 1 ? 2.0 : 0.5));
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 2.2);
  });
}

// ---- Music ------------------------------------------------------------

async function tryLoadPlaylist() {
  try {
    const res = await fetch(asset('audio/playlist.json'));
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}

let failedTracks = 0;

function playNextTrack() {
  if (!playlist || !playlist.length) return;
  if (failedTracks >= playlist.length) {
    // every listed file is missing — fall back to the procedural ambient bed
    musicEl = null;
    startAmbientLoop();
    return;
  }
  const file = playlist[playlistIndex % playlist.length];
  playlistIndex++;
  musicEl = new Audio(asset('audio/' + file));
  musicEl.volume = 0.4;
  musicEl.addEventListener('ended', () => {
    failedTracks = 0;
    playNextTrack();
  });
  // skip tracks that 404 so the playlist can be pre-filled before the
  // mp3s are dropped in
  musicEl.addEventListener('error', () => {
    failedTracks++;
    playNextTrack();
  });
  musicEl.play().catch(() => {});
}

function startAmbientLoop() {
  const c = ac();
  // two detuned low drones + slow filter sweep = dark ambient bed
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 220;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 140;
  lfo.connect(lfoGain).connect(filt.frequency);
  const g = c.createGain();
  g.gain.value = 0.16;
  filt.connect(g).connect(musicGain);
  for (const f of [55, 55.7, 82.4]) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.connect(filt);
    osc.start();
    ambientNodes.push(osc);
  }
  lfo.start();
  ambientNodes.push(lfo, g);

  // slow heartbeat sub pulse
  const pulse = () => {
    if (!ambientNodes.length) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(50, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.25, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(pg).connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.45);
    setTimeout(pulse, 2400);
  };
  setTimeout(pulse, 1200);
}

export async function startMusic() {
  ac();
  if (musicEl || ambientNodes.length) return;
  playlist = await tryLoadPlaylist();
  if (playlist) playNextTrack();
  else startAmbientLoop();
}
