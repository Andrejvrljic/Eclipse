// Eingabe: Tastatur + Maus (Pointer Lock) und Touch (Joystick, Wischen, Knöpfe).

export function createInput(canvas, ui) {
  const keys = new Set();
  const st = {
    move: { x: 0, y: 0 },      // x = rechts, y = vorwärts (-1..1)
    look: { x: 0, y: 0 },      // aufgelaufene Blickänderung in Pixeln
    sprint: false, brake: false,
    jump: false, interact: false, reset: false, // einmalige Auslöser
    touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
    locked: false,
    lastLook: 0,
  };
  const press = (k) => {
    if (k === 'Space') { st.jump = true; }
    if (k === 'KeyE') st.interact = true;
    if (k === 'KeyR') st.reset = true;
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (!keys.has(e.code)) press(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('click', () => {
    if (!st.touch && document.pointerLockElement !== canvas && ui.playing()) canvas.requestPointerLock?.()?.catch?.(() => {});
  });
  document.addEventListener('pointerlockchange', () => {
    st.locked = document.pointerLockElement === canvas;
    ui.onLockChange(st.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!st.locked) return;
    st.look.x += e.movementX; st.look.y += e.movementY; st.lastLook = performance.now();
  });

  // ---- Touch ----
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  let stickId = null, stickCenter = null, lookId = null, lookLast = null, touchBrake = false;
  const STICK_R = 56;
  function stickMove(t) {
    const dx = t.clientX - stickCenter.x, dy = t.clientY - stickCenter.y;
    const d = Math.min(STICK_R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
    const kx = Math.cos(a) * d, ky = Math.sin(a) * d;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;
    st.move.x = kx / STICK_R; st.move.y = -ky / STICK_R;
    st.sprint = d >= STICK_R * 0.95;
  }
  if (st.touch) {
    document.body.classList.add('touch');
    canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier; stickCenter = { x: t.clientX, y: t.clientY };
          stick.style.left = t.clientX - 70 + 'px'; stick.style.top = t.clientY - 70 + 'px'; stick.classList.add('on');
          stickMove(t);
        } else if (lookId === null) { lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY }; }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) stickMove(t);
        else if (t.identifier === lookId) {
          st.look.x += (t.clientX - lookLast.x) * 1.6; st.look.y += (t.clientY - lookLast.y) * 1.6;
          lookLast = { x: t.clientX, y: t.clientY }; st.lastLook = performance.now();
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; st.move.x = st.move.y = 0; st.sprint = false; knob.style.transform = ''; stick.classList.remove('on'); }
        if (t.identifier === lookId) lookId = null;
      }
    };
    canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
    const btn = (id, fn, hold) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(true); el.classList.add('down'); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); if (hold) fn(false); el.classList.remove('down'); });
    };
    btn('btn-jump', (d) => { if (d) st.jump = true; touchBrake = d; }, true);
    btn('btn-use', (d) => { if (d) st.interact = true; });
    btn('btn-reset', (d) => { if (d) st.reset = true; });
  }

  return {
    state: st,
    /** Wird einmal pro Bild aufgerufen; liefert die aktuelle Eingabe. */
    poll() {
      // Tastatur gilt immer, solange der Touch-Joystick nicht benutzt wird (auch iPad mit Tastatur).
      if (stickId === null) {
        st.move.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        st.move.y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        st.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      }
      st.brake = keys.has('Space') || touchBrake;
      return st;
    },
    consume() { st.jump = st.interact = st.reset = false; st.look.x = st.look.y = 0; },
    clear() { keys.clear(); },
  };
}
