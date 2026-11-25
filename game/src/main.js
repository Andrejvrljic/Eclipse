// ECLIPSE – spielbarer Prototyp (Phase 2): Insel, Charakter, Fahrzeuge, Sammelobjekte, Mehrspieler.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createVehicle } from './vehicle.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { SPAWN } from './terrain.js';

const $ = (id) => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem('eclipse.game.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('eclipse.game.' + k, v); } catch { /* egal */ } },
};
const COLORS = ['#A78BFA', '#38BDF8', '#22C55E', '#F59E0B', '#F472B6', '#EF4444'];
const CAR_COLORS = [0x7c3aed, 0x0ea5e9, 0xf59e0b];
const DT = 1 / 60;

let renderer, scene, camera, physics, world, player, cars = [], input, net;
let playing = false, driving = null, yaw = Math.PI * 0.15, pitch = 0.3, pendingJump = false;
let collected = new Set();
const focus = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();

/* ---------- Oberfläche ---------- */
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}
function setLoading(text) { $('loading').textContent = text; }

function setupStart() {
  const nameIn = $('name');
  nameIn.value = ls.get('name') || '';
  let color = ls.get('color') && COLORS.includes(ls.get('color')) ? ls.get('color') : COLORS[Math.floor(Math.random() * COLORS.length)];
  const sw = $('colors');
  sw.innerHTML = COLORS.map((c) => `<button type="button" class="sw" data-c="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-pressed="${c === color}"></button>`).join('');
  sw.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    color = b.dataset.c;
    sw.querySelectorAll('.sw').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.c === color)));
  });
  $('start-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameIn.value.trim().slice(0, 20);
    if (name.length < 2) { $('name-err').textContent = 'Bitte gib einen Namen mit mindestens 2 Zeichen ein.'; nameIn.focus(); return; }
    $('name-err').textContent = '';
    ls.set('name', name); ls.set('color', color);
    startGame(name, color);
  });
  nameIn.addEventListener('input', () => { $('name-err').textContent = ''; });
  const dash = location.hostname.startsWith('spiel.') ? location.origin.replace('//spiel.', '//eclipse.') : '';
  if (dash) { $('dash-link').href = dash; $('dash-link').hidden = false; }
}

/* ---------- Start ---------- */
async function boot() {
  setupStart();
  setLoading('Physik wird geladen …');
  await RAPIER.init();
  const canvas = $('game');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const touch = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 3000);
  physics = new RAPIER.World({ x: 0, y: -20, z: 0 });

  setLoading('Insel wird erzeugt …');
  await new Promise((r) => setTimeout(r, 30));
  world = createWorld(scene, RAPIER, physics);

  // Vorschau hinter dem Startbildschirm: langsamer Kameraflug
  focus.set(SPAWN.x, world.heightAt(SPAWN.x, SPAWN.z) + 2, SPAWN.z);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  input = createInput(canvas, {
    playing: () => playing,
    onLockChange: (locked) => { $('pause').hidden = !playing || locked || input.state.touch; },
  });
  $('pause').addEventListener('click', () => canvas.requestPointerLock?.()?.catch?.(() => {}));
  setLoading('');
  $('play').disabled = false;
  $('play').textContent = 'Spielen';
  requestAnimationFrame(frame);
}

function startGame(name, color) {
  $('start').hidden = true;
  $('hud').hidden = false;
  document.body.classList.add('playing');
  const a = Math.random() * Math.PI * 2;
  const sx = SPAWN.x + Math.cos(a) * 3, sz = SPAWN.z + Math.sin(a) * 3;
  player = createPlayer(RAPIER, physics, scene, { x: sx, y: world.heightAt(sx, sz), z: sz }, color);
  const carSpots = [[9, 5, 0.4], [-8, 7, 2.2], [2, -11, -1.3]];
  cars = carSpots.map(([x, z, ry], i) => createVehicle(RAPIER, physics, scene, { x, y: world.heightAt(x, z), z }, ry, CAR_COLORS[i]));

  try { collected = new Set(JSON.parse(ls.get('shards') || '[]')); } catch { collected = new Set(); }
  for (const s of world.shards) if (collected.has(s.id)) { s.taken = true; s.group.visible = false; }
  updateShards();

  net = createNet(scene, {
    name, color,
    onStatus: (count, ok) => { $('online').textContent = ok ? `${count} online` : 'Verbinde …'; $('net-dot').dataset.ok = ok ? '1' : '0'; },
    onJoin: (n) => toast(`${n} ist beigetreten`),
    onLeave: (n) => toast(`${n} hat das Spiel verlassen`),
  });
  net.connect();
  playing = true;
  if (!input.state.touch) $('game').requestPointerLock?.()?.catch?.(() => {});
  toast('Willkommen auf der Insel. Finde die 25 Eclipse-Splitter!');
  // Nur zum Testen: ?debug in der Adresse macht den Spielzustand in der Konsole zugänglich.
  if (new URLSearchParams(location.search).has('debug')) window.__eclipse = { player, cars, world, physics, enterCar, get driving() { return driving; }, get acc() { return acc; } };
}

/* ---------- Spiellogik ---------- */
function nearestCar(maxDist) {
  const p = player.feet(tmp);
  let best = null, bd = maxDist;
  for (const c of cars) {
    const t = c.body.translation();
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bd && Math.abs(t.y - p.y) < 3) { bd = d; best = c; }
  }
  return best;
}
function enterCar(c) {
  driving = c; c.occupied = true; player.setDriving(true);
  const f = c.forward(); yaw = Math.atan2(-f.x, -f.z);
}
function exitCar() {
  const c = driving; driving = null; c.occupied = false;
  const e = c.exitPoint();
  player.teleport(e.x, Math.max(world.heightAt(e.x, e.z), 0), e.z);
  player.setDriving(false);
}
function updateShards() {
  $('shards').textContent = `${collected.size} / ${world.shards.length}`;
}
function checkShards() {
  const p = driving ? driving.body.translation() : player.body.translation();
  for (const s of world.shards) {
    if (s.taken) continue;
    const g = s.group.position;
    if (Math.hypot(g.x - p.x, g.z - p.z) < 2.4 && Math.abs(g.y - p.y) < 3) {
      s.taken = true; s.group.visible = false; collected.add(s.id);
      ls.set('shards', JSON.stringify([...collected]));
      updateShards();
      $('shard-box').classList.remove('pop'); void $('shard-box').offsetWidth; $('shard-box').classList.add('pop');
      toast(collected.size === world.shards.length ? 'Alle Eclipse-Splitter gefunden!' : `Eclipse-Splitter gefunden (${collected.size}/${world.shards.length})`);
    }
  }
}

function updateCamera(dt, inp) {
  yaw -= inp.look.x * 0.0026;
  pitch = Math.max(-0.35, Math.min(1.25, pitch + inp.look.y * 0.0022));
  let dist = 5.6, lift = 1.55;
  if (driving) {
    const t = driving.body.translation();
    focus.lerp(tmp.set(t.x, t.y + 1.3, t.z), 1 - Math.exp(-dt * 20));
    dist = 9.5; lift = 1.3;
    // Kamera richtet sich hinter dem Auto aus, wenn man nicht selbst umschaut
    if (performance.now() - inp.lastLook > 1400 && Math.abs(driving.speed()) > 2) {
      const f = driving.forward(); const target = Math.atan2(-f.x, -f.z) + (driving.speed() < 0 ? Math.PI : 0);
      let d = target - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 2.5);
      pitch += (0.22 - pitch) * Math.min(1, dt * 1.5);
    }
  } else {
    const f = player.feet(tmp);
    focus.lerp(f.setY(f.y + lift), 1 - Math.exp(-dt * 25));
  }
  const cp = Math.cos(pitch);
  // Kamera stoppt vor Baumstämmen, Felsen und Gelände statt hindurchzusehen
  const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  const skip = (col) => col !== player.collider && !cars.some((c) => c.collider === col);
  const hit = physics.castRay(new RAPIER.Ray({ x: focus.x, y: focus.y, z: focus.z }, { x: dx, y: dy, z: dz }), dist, true, undefined, undefined, undefined, undefined, skip);
  if (hit) dist = Math.max(1.2, hit.timeOfImpact - 0.35);
  camPos.set(focus.x + dx * dist, focus.y + dy * dist, focus.z + dz * dist);
  const ground = Math.max(world.heightAt(camPos.x, camPos.z), 0) + 0.6;
  if (camPos.y < ground) camPos.y = ground;
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 18));
  if (camera.position.y < ground) camera.position.y = ground;
  camera.lookAt(focus);
}

let last = performance.now(), acc = 0, previewT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;

  if (!playing) {
    // Langsamer Flug um den Startplatz hinter dem Startbildschirm
    previewT += dt * 0.05;
    camera.position.set(SPAWN.x + Math.sin(previewT) * 70, 34, SPAWN.z + Math.cos(previewT) * 70);
    camera.lookAt(SPAWN.x, 10, SPAWN.z);
    world.update(t, camera.position);
    renderer.render(scene, camera);
    return;
  }

  const inp = input.poll();
  if (inp.jump) pendingJump = true;
  if (inp.interact) {
    if (driving) exitCar();
    else { const c = nearestCar(4); if (c) enterCar(c); }
  }
  if (inp.reset && driving) driving.reset(world.heightAt);

  acc += dt;
  while (acc >= DT) {
    const stepInput = { ...inp, jump: pendingJump };
    pendingJump = false;
    if (!driving) player.step(DT, stepInput, yaw);
    for (const c of cars) c.step(DT, c === driving ? stepInput : { move: { x: 0, y: 0 }, brake: false });
    physics.timestep = DT;
    physics.step();
    acc -= DT;
  }

  if (driving) {
    const ct = driving.body.translation();
    player.body.setTranslation({ x: ct.x, y: ct.y + 1, z: ct.z }, false);
  }
  player.render(dt);
  for (const c of cars) c.render();
  updateCamera(dt, inp);
  checkShards();
  world.update(t, focus);

  // Mehrspieler: eigenen Zustand senden, andere nachführen
  if (driving) {
    const ct = driving.body.translation(), r = driving.body.rotation();
    net.send({ p: [ct.x, ct.y, ct.z], r: 0, v: 1, q: [r.x, r.y, r.z, r.w], sp: Math.abs(driving.speed()) });
  } else {
    const f = player.feet(tmp);
    net.send({ p: [f.x, f.y, f.z], r: player.mesh.rotation.y, v: 0, sp: player.speed });
  }
  net.update(dt, camera);

  // Anzeige
  const near = !driving && nearestCar(4);
  const touch = inp.touch;
  let prompt = '';
  if (driving) prompt = driving.flipped() ? (touch ? 'Das Auto liegt auf der Seite · Zurücksetzen tippen' : 'Das Auto liegt auf der Seite · R zum Zurücksetzen') : (touch ? '' : 'E Aussteigen  ·  R Zurücksetzen  ·  Leertaste Handbremse');
  else if (near) prompt = touch ? 'Auto in der Nähe · Einsteigen tippen' : 'E · Einsteigen';
  else if (player.swimming) prompt = 'Du schwimmst · zurück an Land';
  $('prompt').textContent = prompt; $('prompt').hidden = !prompt;
  $('speedo').hidden = !driving;
  if (driving) $('kmh').textContent = String(Math.round(Math.abs(driving.speed()) * 3.6));
  $('btn-use').textContent = driving ? 'Aussteigen' : 'Einsteigen';
  $('btn-use').classList.toggle('dim', !driving && !near);
  $('btn-jump').textContent = driving ? 'Bremse' : 'Springen';
  $('btn-reset').hidden = !driving;

  renderer.render(scene, camera);
  input.consume();
}

boot().catch((e) => {
  setLoading('Das Spiel konnte nicht starten: ' + (e && e.message ? e.message : e) + '. Dein Browser braucht WebGL.');
  console.error(e);
});
