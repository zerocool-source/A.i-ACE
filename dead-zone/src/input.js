// Keyboard + mouse state, polled by the game loop.
export const input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false, right: false },
  // edge-triggered presses consumed once per frame
  pressed: new Set(),
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!input.keys.has(k)) input.pressed.add(k);
    input.keys.add(k);
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'r', 'e', 'f', 'g', 'h', 'q', 't', 'c', 'p', 'm', 'z', 'b', 'y', 'n', ' ', 'tab'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      input.mouse.right = true; // hold right-button = weapon wheel
      return;
    }
    input.mouse.down = true;
    input.pressed.add('mouse');
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      input.mouse.right = false;
      input.pressed.add('wheel-release');
      return;
    }
    input.mouse.down = false;
  });
  // suppress the browser context menu so right-hold can drive the wheel
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouse.down = false;
    input.mouse.right = false;
  });
}

export function consumePressed() {
  input.pressed.clear();
}

export function wasPressed(k) {
  return input.pressed.has(k);
}
