// Dragging a preview turns what is on it: the shop's stage (guns, skins, charms, the pilot) and the
// menu's pilot. Until it is touched a preview keeps its own idle swing; the first drag picks it up from
// wherever that swing had it, so nothing jumps, and from then on it stays where it is let go, with a
// little carry from a flick. Window listeners rather than pointer capture: the menu redraws while you
// drag, and moving a canvas into the new page releases a capture.
const TURN_RATE = 0.0105, TILT_RATE = 0.006;

// current(): the yaw and tilt the preview is showing right now, read on the first touch.
// canTurn(): whether what is on it can be turned at all (a crate being opened cannot).
export function turntable({ tiltMax = 0, current = () => ({ yaw: 0, pitch: 0 }), canTurn = () => true } = {}) {
  const turn = { yaw: 0, pitch: 0, carry: 0, touched: false, dragging: false, x: 0, y: 0, movedAt: 0, canvas: null };

  turn.attach = (canvas) => {
    turn.canvas = canvas;
    canvas.classList.add('turnable');
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !canTurn()) return;
      event.preventDefault();
      if (!turn.touched) { const now = current(); turn.yaw = now.yaw; turn.pitch = now.pitch || 0; turn.touched = true; }
      Object.assign(turn, { dragging: true, x: event.clientX, y: event.clientY, carry: 0, movedAt: performance.now() });
      canvas.classList.add('grabbing');
    });
  };
  // Show whether the thing on it can be turned right now, for the cursor.
  turn.allow = (on) => turn.canvas?.classList.toggle('turnable', on);
  // Something new is on the preview: back to its own idle swing.
  turn.reset = () => Object.assign(turn, { yaw: 0, pitch: 0, carry: 0, touched: false });
  // Once a frame: let a flick run down.
  turn.coast = () => {
    if (turn.dragging || Math.abs(turn.carry) < 0.0005) return;
    turn.yaw += turn.carry;
    turn.carry *= 0.86;
  };

  addEventListener('pointermove', (event) => {
    if (!turn.dragging) return;
    const dx = event.clientX - turn.x, dy = event.clientY - turn.y;
    turn.x = event.clientX; turn.y = event.clientY;
    turn.yaw += dx * TURN_RATE;
    turn.pitch = Math.max(-tiltMax, Math.min(tiltMax, turn.pitch - dy * TILT_RATE));
    turn.carry = dx * TURN_RATE;
    turn.movedAt = performance.now();
  });
  const end = () => {
    if (!turn.dragging) return;
    turn.dragging = false;
    turn.canvas?.classList.remove('grabbing');
    // Held still before letting go is a placement, not a flick.
    if (performance.now() - turn.movedAt > 70) turn.carry = 0;
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  return turn;
}
