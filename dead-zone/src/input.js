// Keyboard + mouse state, polled by the game loop.
export const input = {
  keys: new Set(),
  mouse: { x: 0, y: 0, down: false },
  // edge-triggered presses consumed once per frame
  pressed: new Set(),
};

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (!input.keys.has(k)) input.pressed.add(k);
    input.keys.add(k);
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'r', 'e', 'f', 'g', 'h', 'q', 't', 'c', 'p', ' ', 'tab'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX;
    input.mouse.y = e.clientY;
  });
  canvas.addEventListener('mousedown', () => {
    input.mouse.down = true;
    input.pressed.add('mouse');
  });
  window.addEventListener('mouseup', () => (input.mouse.down = false));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouse.down = false;
  });
}

export function consumePressed() {
  input.pressed.clear();
}

export function wasPressed(k) {
  return input.pressed.has(k);
}
