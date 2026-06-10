// Xbox / standard-mapping gamepad support via the browser Gamepad API.
// Pair the controller over Bluetooth with the OS; the browser exposes it once
// any button is pressed. Standard mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6
// RT=7 Back=8 Start=9 L3=10 R3=11 DPad=12-15.
const DEAD = 0.22;

const state = {
  connected: false,
  moveX: 0, moveY: 0,        // left stick
  aimX: 0, aimY: 0, aiming: false, // right stick
  fire: false,                // RT held
  sprint: false,              // LT held
  pressed: new Set(),         // edge-triggered button names this frame
};
let prevButtons = [];

const BUTTON_NAMES = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb',
  8: 'back', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

function axis(v) {
  return Math.abs(v) > DEAD ? v : 0;
}

export function pollGamepad() {
  state.pressed.clear();
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find((p) => p && p.connected);
  state.connected = !!gp;
  if (!gp) {
    state.moveX = state.moveY = state.aimX = state.aimY = 0;
    state.aiming = state.fire = state.sprint = false;
    prevButtons = [];
    return state;
  }
  state.moveX = axis(gp.axes[0] ?? 0);
  state.moveY = axis(gp.axes[1] ?? 0);
  state.aimX = axis(gp.axes[2] ?? 0);
  state.aimY = axis(gp.axes[3] ?? 0);
  state.aiming = Math.hypot(state.aimX, state.aimY) > 0.3;
  state.fire = (gp.buttons[7]?.value ?? 0) > 0.35;
  state.sprint = (gp.buttons[6]?.value ?? 0) > 0.35;
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
