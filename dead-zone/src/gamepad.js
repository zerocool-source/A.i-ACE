// Xbox / standard-mapping gamepad support via the browser Gamepad API.
// Works over USB and Bluetooth alike — the browser only exposes the pad
// after you press any button while the game tab is focused.
// Standard mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9
// L3=10 R3=11 DPad=12-15. Non-standard pads get best-effort fallbacks.
const DEAD = 0.22;

const state = {
  connected: false,
  id: '',
  standard: true,
  moveX: 0, moveY: 0,        // left stick
  aimX: 0, aimY: 0, aiming: false, // right stick
  fire: false,                // RT held (RB fallback on odd pads)
  sprint: false,              // LT held (LB fallback on odd pads)
  pressed: new Set(),         // edge-triggered button names this frame
};
let prevButtons = [];

const BUTTON_NAMES = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb',
  8: 'back', 9: 'start', 10: 'l3', 11: 'r3',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

function axis(v) {
  return Math.abs(v) > DEAD ? v : 0;
}

function pickPad() {
  let list = null;
  try {
    list = navigator.getGamepads ? navigator.getGamepads() : null;
  } catch {
    list = null;
  }
  const pads = list ? [...list] : [];
  // prefer a pad the browser recognizes as standard layout
  return (
    pads.find((p) => p && p.connected && p.mapping === 'standard') ||
    pads.find((p) => p && p.connected)
  );
}

export function pollGamepad() {
  state.pressed.clear();
  const gp = pickPad();
  state.connected = !!gp;
  if (!gp) {
    state.id = '';
    state.moveX = state.moveY = state.aimX = state.aimY = 0;
    state.aiming = state.fire = state.sprint = false;
    prevButtons = [];
    return state;
  }
  state.id = gp.id;
  state.standard = gp.mapping === 'standard';
  const btn = (i) => gp.buttons[i]?.value ?? 0;
  state.moveX = axis(gp.axes[0] ?? 0);
  state.moveY = axis(gp.axes[1] ?? 0);
  if (state.standard) {
    state.aimX = axis(gp.axes[2] ?? 0);
    state.aimY = axis(gp.axes[3] ?? 0);
    state.fire = btn(7) > 0.35;
    state.sprint = btn(6) > 0.35;
  } else {
    // odd mappings: right stick is sometimes axes 2/3, sometimes 3/4;
    // triggers may be missing, so bumpers double as fire/sprint
    const a2 = axis(gp.axes[2] ?? 0), a3 = axis(gp.axes[3] ?? 0), a4 = axis(gp.axes[4] ?? 0);
    if (Math.abs(a3) > 0 || Math.abs(a4) > 0) {
      state.aimX = a3 !== 0 || a4 !== 0 ? (gp.axes.length > 4 ? a3 : a2) : a2;
      state.aimY = gp.axes.length > 4 ? a4 : a3;
    } else {
      state.aimX = a2;
      state.aimY = a3;
    }
    state.fire = btn(7) > 0.35 || btn(5) > 0.5;
    state.sprint = btn(6) > 0.35 || btn(4) > 0.5;
  }
  state.aiming = Math.hypot(state.aimX, state.aimY) > 0.3;
  gp.buttons.forEach((b, i) => {
    const was = prevButtons[i] || false;
    if (b.pressed && !was && BUTTON_NAMES[i]) state.pressed.add(BUTTON_NAMES[i]);
  });
  prevButtons = gp.buttons.map((b) => b.pressed);
  return state;
}

export function gpPressed(name) {
  return state.pressed.has(name);
}

export const gamepad = state;
