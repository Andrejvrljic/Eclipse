// Eingabe: Tastatur + Maus (Pointer Lock) und Touch (Joystick, Wischen, Knöpfe).

export function createInput(canvas, ui) {
  const keys = new Set();
  const st = {
    move: { x: 0, y: 0 }, look: { x: 0, y: 0 },
    sprint: false, brake: false, jumpHeld: false, down: false, attackHeld: false,
    jump: false, interact: false, reset: false, attack: false, ride: false, demolish: false,
    touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,
    locked: false, lastLook: 0,
  };
  const uiKeys = { Tab: 'inventory', KeyI: 'inventory', KeyP: 'admin', Escape: 'escape', KeyH: 'help' };
  // Tasten nur ignorieren, wenn wirklich in ein sichtbares Eingabefeld getippt wird
  const typing = (t) => (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) && t.offsetParent !== null;

  window.addEventListener('keydown', (e) => {
    if (typing(e.target)) return;
    if (e.target instanceof HTMLElement && e.target !== document.body && e.target.tagName !== 'CANVAS' && !e.target.closest('.panel')) e.target.blur?.();
    if (uiKeys[e.code]) { e.preventDefault(); ui.onUiKey(uiKeys[e.code]); return; }
    if (/^Digit[1-8]$/.test(e.code)) { ui.onSlot(Number(e.code.slice(5)) - 1); return; }
    if (!keys.has(e.code)) {
      if (e.code === 'Space') st.jump = true;
      if (e.code === 'KeyE') st.interact = true;
      if (e.code === 'KeyR') st.reset = true;
      if (e.code === 'KeyF') st.ride = true;
      if (e.code === 'KeyX') st.demolish = true;
    }
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); st.attackHeld = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (st.touch || !ui.playing()) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.()?.catch?.(() => {}); return; }
    if (e.button === 0) { st.attack = true; st.attackHeld = true; }
    if (e.button === 2) ui.onUiKey('cancel');
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) st.attackHeld = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { if (st.locked) ui.onScroll(Math.sign(e.deltaY)); }, { passive: true });
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
  let stickId = null, stickCenter = null, lookId = null, lookLast = null, touchBrake = false, touchJumpHeld = false;
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
      const el = document.getElementById(id); if (!el) return;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(true); el.classList.add('down'); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); if (hold) fn(false); el.classList.remove('down'); });
    };
    btn('btn-jump', (d) => { if (d) st.jump = true; touchBrake = d; touchJumpHeld = d; }, true);
    btn('btn-use', (d) => { if (d) st.interact = true; });
    btn('btn-reset', (d) => { if (d) st.reset = true; });
    btn('btn-attack', (d) => { if (d) st.attack = true; st.attackHeld = d; }, true);
    btn('btn-ride', (d) => { if (d) st.ride = true; });
    btn('btn-inv', (d) => { if (d) ui.onUiKey('inventory'); });
  }

  return {
    state: st,
    poll() {
      if (stickId === null) {
        st.move.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        st.move.y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        st.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      }
      st.brake = keys.has('Space') || touchBrake;
      st.jumpHeld = keys.has('Space') || touchJumpHeld;
      st.down = keys.has('KeyC') || keys.has('ControlLeft');
      return st;
    },
    consume() { st.jump = st.interact = st.reset = st.attack = st.ride = st.demolish = false; st.look.x = st.look.y = 0; },
    clear() { keys.clear(); st.attackHeld = false; },
  };
}
