// ECLIPSE – Survival-Prototyp: große Insel, Kreaturen, Fahrzeuge, Basenbau, Kampf, Quests, Mehrspieler.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createVehicles } from './vehicle.js';
import { createCreatures } from './creatures.js';
import { createBuildings } from './building.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { createState } from './state.js';
import { createUI } from './ui.js';
import { SPAWN, SEA_LEVEL, findLand } from './terrain.js';
import { setHeld, swingFigure } from './models.js';
import * as D from './shared/defaults.js';

const $ = (id) => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem('eclipse.game.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('eclipse.game.' + k, v); } catch { /* egal */ } },
};
const COLORS = ['#A78BFA', '#38BDF8', '#22C55E', '#F59E0B', '#F472B6', '#EF4444'];
const DT = 1 / 60;
const FIST = { name: 'Faust', damage: 6 };

let renderer, scene, camera, physics, world, player, vehicles, creatures, buildings, input, net, state, ui;
let config = { settings: D.DEFAULT_SETTINGS, items: D.DEFAULT_ITEMS, recipes: D.DEFAULT_RECIPES, species: D.DEFAULT_SPECIES, quests: D.DEFAULT_QUESTS };
let playing = false, joined = false, dead = false, admin = false, god = false;
let driving = null, pendingEnter = null, riding = null, ridePose = null;
let yaw = Math.PI * 0.15, pitch = 0.3, pendingJump = false, selSlot = 0, stamina = 100;
let attackCd = 0, swingT = 0, lastSave = 0, lastVSend = 0, lastRideSend = 0, damageFlash = 0, knockCd = 0;
const projectiles = [];
const depleted = new Map(); // Rohstoffquelle → { hits, until }
const focus = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const getConfig = () => config;

/* ---------- Startbildschirm ---------- */
function pid() {
  let id = ls.get('pid');
  if (!id || !/^[a-z0-9]{8,24}$/i.test(id)) { id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6); ls.set('pid', id); }
  return id;
}
function setupStart() {
  const nameIn = $('name');
  nameIn.value = ls.get('name') || '';
  $('code').value = ls.get('code') || '';
  let color = COLORS.includes(ls.get('color')) ? ls.get('color') : COLORS[Math.floor(Math.random() * COLORS.length)];
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
    ls.set('name', name); ls.set('color', color); ls.set('code', $('code').value.trim());
    startGame(name, color, $('code').value.trim());
  });
  nameIn.addEventListener('input', () => { $('name-err').textContent = ''; });
  $('show-code').addEventListener('click', () => { $('code-row').hidden = !$('code-row').hidden; });
  const dash = location.hostname.startsWith('spiel.') ? location.origin.replace('//spiel.', '//eclipse.') : '';
  if (dash) { $('dash-link').href = dash; $('dash-link').hidden = false; }
}

/* ---------- Initialisierung ---------- */
async function boot() {
  setupStart();
  $('loading').textContent = 'Physik wird geladen …';
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
  camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 6000);
  physics = new RAPIER.World({ x: 0, y: -20, z: 0 });
  $('loading').textContent = 'Insel wird erzeugt …';
  await new Promise((r) => setTimeout(r, 30));
  world = createWorld(scene, RAPIER, physics);
  world.findLand = (x, z) => findLand(world.heightAt, x, z);
  vehicles = createVehicles(RAPIER, physics, scene, world);
  creatures = createCreatures(scene, getConfig);
  buildings = createBuildings(RAPIER, physics, scene, world);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  state = createState(getConfig, {
    onItem: (id, n) => ui && ui.toast(`+${n} ${state.def(id)?.name || id}`, 'item'),
    onFull: () => ui && ui.toast('Dein Inventar ist voll.', 'warn'),
    onLevel: (l) => ui && ui.big(`Level ${l} erreicht!`),
    onQuest: (q) => ui && ui.big(`Quest erledigt: ${q.title}`),
  });
  ui = createUI({
    state, getConfig, nearStation: (type) => buildings.nearStation(player.feet(tmp), type),
    isAdmin: () => admin, adminState: () => ({ fly: player?.flying, god }),
    getPlayers: () => [...net.remotes.values()].map((r) => ({ id: r.id, name: r.name })),
    onSlot: (i) => { selSlot = i; },
    onCraft: (rid) => { const r = state.craft(rid, (type) => buildings.nearStation(player.feet(tmp), type)); if (r.ok) ui.toast(`${state.def(config.recipes[rid].item)?.name} hergestellt`); else ui.toast(r.why, 'warn'); },
    onAdmin: adminOp,
    onRespawn: respawn,
    onPanel: (open) => { if (open) document.exitPointerLock?.(); input.clear(); },
    onAte: () => ui.toast('Mahlzeit!'),
  });
  ui.bind();
  input = createInput(canvas, {
    playing: () => playing && !dead && !ui.open,
    onLockChange: (locked) => { $('pause').hidden = !playing || locked || input.state.touch || ui.open || dead; },
    onUiKey: (k) => {
      if (!joined) return;
      if (k === 'inventory') ui.toggle('inv');
      else if (k === 'admin' && admin) ui.toggle('admin');
      else if (k === 'escape' && ui.open) ui.close();
      else if (k === 'help') $('help').hidden = !$('help').hidden;
    },
    onSlot: (i) => { selSlot = i; },
    onScroll: (d) => { selSlot = (selSlot + d + D.HOTBAR) % D.HOTBAR; },
  });
  $('pause').addEventListener('click', () => canvas.requestPointerLock?.()?.catch?.(() => {}));
  $('loading').textContent = '';
  $('play').disabled = false; $('play').textContent = 'Spielen';
  requestAnimationFrame(frame);
}

/* ---------- Verbindung ---------- */
function startGame(name, color, code) {
  document.activeElement?.blur?.();
  $('play').disabled = true; $('play').textContent = 'Verbinde …';
  $('loading').textContent = 'Verbindung zum Spielserver wird aufgebaut …';
  let tries = 0;
  if (net) net.close();
  net = createNet(scene, {
    hello: () => ({ pid: pid(), name, color, code }),
    onCount: (n) => { $('online').textContent = `${n} online`; },
    onStatus: (ok, info) => {
      $('net-dot').dataset.ok = ok ? '1' : '0';
      if (!ok && joined) { $('online').textContent = 'Verbindung unterbrochen – neuer Versuch …'; ui.toast('Verbindung unterbrochen. Das Spiel verbindet sich automatisch neu.', 'warn'); }
      if (ok && joined) $('online').textContent = `${net.count} online`;
      if (!ok && !joined) { tries++; $('loading').textContent = `Spielserver nicht erreichbar${info ? ' (' + info + ')' : ''} – Versuch ${tries + 1} läuft …`; }
    },
    onJoin: (n) => ui.toast(`${n} ist beigetreten`),
    onLeave: (n) => ui.toast(`${n} hat das Spiel verlassen`),
    onMessage: onServer,
  });
  net.connect();
}

function onServer(m) {
  switch (m.t) {
    case 'welcome': {
      config = m.config; admin = !!m.admin;
      // Beim Wiederverbinden den aktuellen Stand im Browser behalten und an den Server schicken
      if (joined && state.profile) net.send({ t: 'save', profile: state.serialize() });
      else state.load(m.profile);
      if (!player) {
        let sp = { x: SPAWN.x + (Math.random() - 0.5) * 8, z: SPAWN.z + (Math.random() - 0.5) * 8 };
        const pos = m.profile.pos;
        if (Array.isArray(pos) && world.heightAt(pos[0], pos[2]) > 0.5) sp = { x: pos[0], z: pos[2] };
        player = createPlayer(RAPIER, physics, scene, { x: sp.x, y: world.heightAt(sp.x, sp.z), z: sp.z }, m.profile.color || '#A78BFA', {
          heightAt: world.heightAt,
          onWater: () => { const l = world.findLand(player.center(tmp).x, tmp.z); player.teleport(l.x, world.heightAt(l.x, l.z), l.z); ui.toast('Du wurdest an Land gebracht.'); },
          onFall: (h) => { if (!god) hurt(Math.round((h - 7) * 7), 'einem Sturz'); },
          onJump: () => { stamina = Math.max(0, stamina - 10); },
          onUnstuck: () => ui.toast('Du hingst fest und wurdest freigeschoben.'),
        });
      }
      vehicles.sync(m.vehicles, net.id);
      buildings.sync(m.buildings);
      $('online').textContent = `${net.count} online`;
      if (!joined) {
        joined = true; playing = true; $('loading').textContent = '';
        document.activeElement?.blur?.();
        $('start').hidden = true; $('hud').hidden = false; document.body.classList.add('playing');
        if (!input.state.touch) $('game').requestPointerLock?.()?.catch?.(() => {});
        if (config.settings.motd) ui.big(config.settings.motd);
        if (admin) ui.toast('Du bist Admin. Drück P für das Admin-Menü.', 'item');
        if (!ls.get('helpSeen')) { $('help').hidden = false; ls.set('helpSeen', '1'); setTimeout(() => { $('help').hidden = true; }, 12000); }
        if (new URLSearchParams(location.search).has('debug')) window.__eclipse = { player, vehicles, creatures, buildings, world, physics, state, net, useHeld, interact, leaveVehicle, adminOp, get driving() { return driving; }, get riding() { return riding; }, setYaw: (v) => { yaw = v; }, setSlot: (i) => { selSlot = i; }, get dead() { return dead; }, hurt };
      }
      $('admin-badge').hidden = !admin;
      break;
    }
    case 'denied':
      $('start').hidden = false; $('hud').hidden = true; playing = false; joined = false;
      $('name-err').textContent = m.reason; $('play').disabled = false; $('play').textContent = 'Spielen';
      if (/Admin/.test(m.reason)) $('code-row').hidden = false;
      break;
    case 'config': config = m.config; creatures.clear(); ui.render(); break;
    case 'cr': creatures.snapshot(m.c, performance.now()); break;
    case 'crdie': creatures.die(m.id, m.silent); break;
    case 'kill': {
      for (const [id, n] of Object.entries(m.drops || {})) state.add(id, Math.round(n * (Number(config.settings.gather_multiplier) || 1)), { count: true });
      state.profile.stats.kills++;
      state.progress('Besiegen', m.sp, 1);
      state.addXp(m.xp || 0);
      ui.toast(`${m.name} besiegt · +${m.xp} EP`, 'item');
      break;
    }
    case 'dmg': {
      if (god || dead) return;
      hurt(m.n, m.from);
      if (m.knock && knockCd <= 0 && !driving && !riding) {
        knockCd = 2;
        const [dx, dz] = m.dir || [0, 0]; const l = Math.hypot(dx, dz) || 1;
        player.tumble({ x: (dx / l) * 9, y: 6, z: (dz / l) * 9 });
      }
      break;
    }
    case 'tameprog': ui.toast(`${m.name} füttern: ${m.n} / ${m.need}`); break;
    case 'tamed': state.profile.tamed = (state.profile.tamed || 0) + 1; state.progress('Zähmen', m.sp, 1); state.addXp(50); ui.big(`${m.name} gezähmt! E: Folgen/Bleiben${config.species[m.sp]?.rideable ? ' · F: Reiten' : ''}`); break;
    case 'rideok': startRide(m); break;
    case 'refund': state.add(m.type, 1, { silent: true }); break;
    case 'build': buildings.add(m.b); break;
    case 'unbuild': buildings.remove(m.id); break;
    case 'door': buildings.door(m.id, m.open); break;
    case 'vown': {
      vehicles.owner(m.id, m.driver, m.ctrl, net.id);
      if (m.driver === net.id && pendingEnter === m.id) { pendingEnter = null; enterVehicle(vehicles.get(m.id)); }
      if (driving && driving.id === m.id && m.driver !== net.id) leaveVehicle(false);
      break;
    }
    case 'vs': vehicles.remote(m.id, m.p, m.q, m.sp, m.st); break;
    case 'vdef': vehicles.define(m.v, net.id); break;
    case 'vdel': if (driving && driving.id === m.id) leaveVehicle(false); vehicles.remove(m.id); break;
    case 'vreset': if (driving) leaveVehicle(false); vehicles.sync(m.vehicles, net.id); break;
    case 'admin': {
      if (m.op === 'give') { state.add(m.item, m.n, { silent: true }); ui.toast(`${m.by} hat dir ${m.n}× ${state.def(m.item)?.name || m.item} gegeben.`, 'item'); }
      if (m.op === 'set') { Object.assign(state.profile, m.f); if (m.f.hp !== undefined) state.profile.hp = Math.min(state.maxHp, m.f.hp); state.load(state.profile); ui.toast('Dein Spielstand wurde vom Admin geändert.'); }
      if (m.op === 'heal') { state.profile.hp = state.maxHp; state.profile.hunger = 100; if (dead) respawn(true); ui.toast('Du wurdest geheilt.'); }
      if (m.op === 'teleport' && Array.isArray(m.p)) { if (driving) leaveVehicle(false); if (riding) stopRide(); player.teleport(m.p[0], m.p[1], m.p[2]); ui.toast('Du wurdest teleportiert.'); }
      if (m.op === 'reset') { state.load(m.profile); ui.toast('Dein Spielstand wurde zurückgesetzt.'); }
      break;
    }
    case 'msg': if (m.big) ui.big(m.text); else ui.toast(m.text); break;
    default: break;
  }
}

/* ---------- Aktionen ---------- */
function hurt(n, from) {
  if (god || dead) return;
  const real = state.damage(n);
  damageFlash = 1;
  ui.toast(`-${real} Leben${from ? ' · ' + from : ''}`, 'hurt');
  if (state.profile.hp <= 0) die(from);
}
function die(by) {
  dead = true;
  if (driving) leaveVehicle(false);
  if (riding) stopRide();
  document.exitPointerLock?.();
  ui.death(true, by);
  net.send({ t: 'died', by });
}
function respawn(keep = false) {
  dead = false; ui.death(false);
  if (!keep) { state.profile.hp = Math.round(state.maxHp * 0.6); state.profile.hunger = Math.max(state.profile.hunger, 50); }
  const bed = buildings.bedsOf(pidCached())[0];
  const p = bed ? { x: bed.x + 1.5, z: bed.z } : { x: SPAWN.x + (Math.random() - 0.5) * 8, z: SPAWN.z + (Math.random() - 0.5) * 8 };
  player.teleport(p.x, bed ? bed.y + 0.3 : world.heightAt(p.x, p.z), p.z);
  ui.toast(bed ? 'Am Schlafsack wiederbelebt.' : 'Am Startplatz wiederbelebt.');
  if (!input.state.touch) $('game').requestPointerLock?.()?.catch?.(() => {});
}
let _pid = null; const pidCached = () => (_pid ||= pid());

function enterVehicle(e) {
  if (!e) return;
  driving = e;
  player.setHidden(true, true);
  const f = vehicles.forward(e); yaw = Math.atan2(-f.x, -f.z);
}
function leaveVehicle(sendExit = true) {
  const e = driving; driving = null; if (!e) return;
  if (sendExit) net.send({ t: 'vexit', id: e.id });
  const v = vehicles.velocity(e);
  const ex = vehicles.exitPoint(e);
  const gy = Math.max(world.heightAt(ex.x, ex.z), SEA_LEVEL - 0.5);
  player.setHidden(false);
  player.teleport(ex.x, Math.max(gy, ex.y - 0.6), ex.z);
  // Bei voller Fahrt herausspringen: abrollen mit echter Physik
  const speed = Math.hypot(v.x, v.z);
  if (speed > 5) {
    const side = vehicles.exitPoint(e); const t = vehicles.position(e);
    const sx = side.x - t.x, sz = side.z - t.z, sl = Math.hypot(sx, sz) || 1;
    player.tumble({ x: v.x * 0.85 + (sx / sl) * 3, y: 3 + speed * 0.08, z: v.z * 0.85 + (sz / sl) * 3 });
    ui.toast('Abgesprungen!');
  }
}

function startRide(m) {
  const c = creatures.map.get(m.id);
  const sp = config.species[m.sp]; if (!sp) return;
  riding = { id: m.id, sp, def: sp };
  ridePose = { p: new THREE.Vector3(m.p[0], m.p[1], m.p[2]), r: m.r, moving: 0 };
  player.setHidden(true, true);
  if (c) c.has = true;
  ui.toast(`Du reitest einen ${sp.name}. F zum Absteigen.`);
}
function stopRide() {
  if (!riding) return;
  net.send({ t: 'unride', id: riding.id });
  const p = ridePose.p;
  player.setHidden(false);
  player.teleport(p.x + 2, world.heightAt(p.x + 2, p.z), p.z);
  riding = null; ridePose = null;
}

function adminOp(op, a) {
  if (!admin) return;
  const sid = a.pid;
  switch (op) {
    case 'fly': player.flying = !player.flying; ui.toast(player.flying ? 'Fliegen an' : 'Fliegen aus'); break;
    case 'god': god = !god; ui.toast(god ? 'Unverwundbar an' : 'Unverwundbar aus'); break;
    case 'heal-me': state.profile.hp = state.maxHp; state.profile.hunger = 100; stamina = state.maxStamina; break;
    case 'spawn-tp': player.teleport(SPAWN.x, world.heightAt(SPAWN.x, SPAWN.z), SPAWN.z); break;
    case 'give-me': state.add(a.item, a.itemN, { silent: false }); break;
    case 'spawn': net.send({ t: 'adm', op: 'spawn', sp: a.sp, n: a.n }); break;
    case 'clear': net.send({ t: 'adm', op: 'clear', r: 60 }); break;
    case 'tpto': net.send({ t: 'adm', op: 'tpto', sid }); break;
    case 'bring': net.send({ t: 'adm', op: 'bring', sid }); break;
    case 'give': net.send({ t: 'adm', op: 'give', sid, item: a.item, n: a.itemN }); break;
    case 'heal': net.send({ t: 'adm', op: 'heal', sid }); break;
    case 'kick': net.send({ t: 'adm', op: 'kick', sid }); break;
    case 'msg': if (a.text.trim()) net.send({ t: 'adm', op: 'msg', text: a.text }); break;
    case 'pvp': net.send({ t: 'adm', op: 'pvp', on: !config.settings.pvp }); break;
    default: break;
  }
}

function heldDef() { const s = state.hotbar()[selSlot]; return s ? { id: s.id, n: s.n, def: state.def(s.id) } : null; }

function aimDir(out) { return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); }

function useHeld() {
  const h = heldDef();
  const d = h && h.def;
  const feet = player.feet(tmp);
  const dir = aimDir(tmp2);
  // Bauen
  if (d && d.structure) {
    const pl = buildings.preview(d.structure, feet, yaw);
    if (!pl || !pl.valid) { ui.toast('Hier kann nicht gebaut werden.', 'warn'); return; }
    net.send({ t: 'build', type: d.structure, x: pl.x, y: pl.y, z: pl.z, ry: pl.ry });
    state.removeSlot(selSlot, 1);
    state.profile.stats.built++;
    state.progress('Bauen', d.structure, 1);
    state.addXp(4);
    return;
  }
  // Essen
  if (d && d.type === 'Nahrung') { if (state.eat(selSlot)) ui.toast(`${d.name} gegessen`); return; }
  if (attackCd > 0) return;
  // Bogen
  if (h && h.id === 'bogen') {
    if (state.count('pfeil') < 1) { ui.toast('Keine Pfeile. Stelle welche her.', 'warn'); return; }
    state.remove('pfeil', 1);
    attackCd = 0.8; swingT = 0.3; swingFigure(player.mesh);
    const c = player.center(new THREE.Vector3()); c.y += 0.6;
    const v = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch * 0.6), Math.sin(-pitch * 0.6) + 0.12, -Math.cos(yaw) * Math.cos(pitch * 0.6)).normalize().multiplyScalar(55);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe5e7eb }));
    scene.add(mesh);
    projectiles.push({ mesh, pos: c, vel: v, life: 3, dmg: Number(d.damage) || 25 });
    return;
  }
  // Nahkampf und Sammeln
  const dmgBase = (d && Number(d.damage)) || FIST.damage;
  const reach = (d && Number(d.reach)) || 2.4;
  attackCd = 0.55; swingT = 0.3; swingFigure(player.mesh);
  const c = creatures.pick(feet, dir, reach, (x) => !x.mine && !(riding && x.id === riding.id));
  if (c) { net.send({ t: 'hit', id: c.id, n: dmgBase }); return; }
  if (config.settings.pvp) { const r = net.pick(feet, dir, reach); if (r) { net.send({ t: 'phit', id: r.id, n: dmgBase }); return; } }
  gather(feet, dir, d);
}

function gather(feet, dir, d) {
  const mult = Number(config.settings.gather_multiplier) || 1;
  const cand = [...world.nearTrees(feet.x, feet.z, 3.2), ...world.nearRocks(feet.x, feet.z, 3.6), ...world.nearBushes(feet.x, feet.z, 2.8)];
  let best = null, bd = Infinity;
  for (const n of cand) {
    const dx = n.x - feet.x, dz = n.z - feet.z, dist = Math.hypot(dx, dz);
    if ((dx * dir.x + dz * dir.z) / (dist || 1) < 0.2 && dist > 1.4) continue;
    if (dist < bd) { bd = dist; best = n; }
  }
  if (!best) return;
  const key = best.kind + best.i;
  const dep = depleted.get(key);
  if (dep && dep.until > performance.now()) { ui.toast(best.kind === 'strauch' ? 'Keine Beeren mehr – wachsen nach.' : 'Erschöpft – versuch es später.', 'warn'); return; }
  const hits = (dep ? dep.hits : 0) + 1;
  depleted.set(key, { hits: hits >= 10 ? 0 : hits, until: hits >= 10 ? performance.now() + 60000 : 0 });
  let id, n;
  if (best.kind === 'baum') { id = 'holz'; n = d && d.wood ? Number(d.wood) : 1; }
  else if (best.kind === 'fels') { id = 'stein'; n = d && d.stone ? Number(d.stone) : 1; }
  else { id = 'beeren'; n = 2; depleted.set(key, { hits: 0, until: performance.now() + 45000 }); }
  state.add(id, Math.max(1, Math.round(n * mult)), { count: true });
  state.addXp(1);
}

function interact() {
  const feet = player.feet(tmp);
  const dir = aimDir(tmp2);
  // Tür
  const b = buildings.pick(feet, yaw, 3.5);
  if (b && b.b.type === 'wand_tuer') { net.send({ t: 'door', id: b.b.id, open: !b.open }); return; }
  // Fahrzeug
  const v = vehicles.nearest(feet, 4.5);
  if (v) { pendingEnter = v.id; net.send({ t: 'venter', id: v.id }); return; }
  // Kreatur füttern oder kommandieren
  const c = creatures.pick(feet, dir, 5);
  if (c) {
    if (c.mine) { const mode = c.mine === 2 ? 'follow' : 'stay'; net.send({ t: 'tcmd', id: c.id, mode }); ui.toast(mode === 'follow' ? `${c.def.name} folgt dir` : `${c.def.name} bleibt hier`); return; }
    if (!c.owner && c.def.tame_food && Number(c.def.tame_amount) > 0) {
      if (state.count(c.def.tame_food) < 1) { ui.toast(`Zum Zähmen brauchst du ${state.def(c.def.tame_food)?.name || c.def.tame_food}.`, 'warn'); return; }
      state.remove(c.def.tame_food, 1);
      net.send({ t: 'feed', id: c.id });
      return;
    }
    if (!c.owner) ui.toast(`${c.def.name} lässt sich nicht zähmen.`, 'warn');
  }
}

/* ---------- Kamera ---------- */
function updateCamera(dt, inp) {
  if (!ui.open) { yaw -= inp.look.x * 0.0026; pitch = Math.max(-0.45, Math.min(1.3, pitch + inp.look.y * 0.0022)); }
  let dist = 5.8, lift = 1.55;
  if (driving) {
    const t = vehicles.position(driving);
    focus.lerp(tmp.set(t.x, t.y + 1.3, t.z), 1 - Math.exp(-dt * 20));
    dist = driving.spec.cam; lift = 1.3;
    const sp = vehicles.speed(driving);
    if (performance.now() - inp.lastLook > 1400 && Math.abs(sp) > 2) {
      const f = vehicles.forward(driving); const target = Math.atan2(-f.x, -f.z) + (sp < 0 ? Math.PI : 0);
      let d = target - yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); yaw += d * Math.min(1, dt * 2.5);
      pitch += (0.22 - pitch) * Math.min(1, dt * 1.5);
    }
  } else if (riding && ridePose) {
    focus.lerp(tmp.set(ridePose.p.x, ridePose.p.y + 2.2 * (Number(riding.sp.scale) || 1), ridePose.p.z), 1 - Math.exp(-dt * 20));
    dist = 6 + 3 * (Number(riding.sp.scale) || 1);
  } else {
    const f = player.feet(tmp);
    focus.lerp(f.setY(f.y + lift), 1 - Math.exp(-dt * 25));
  }
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
  const skip = (col) => col !== player.collider && ![...vehicles.list.values()].some((e) => e.collider === col) && !col.isSensor();
  const hit = physics.castRay(new RAPIER.Ray({ x: focus.x, y: focus.y, z: focus.z }, { x: dx, y: dy, z: dz }), dist, true, undefined, undefined, undefined, undefined, skip);
  if (hit) dist = Math.max(1.2, hit.timeOfImpact - 0.35);
  dist = world.crownClear(focus, tmp2.set(dx, dy, dz), dist);
  camPos.set(focus.x + dx * dist, focus.y + dy * dist, focus.z + dz * dist);
  const ground = Math.max(world.heightAt(camPos.x, camPos.z), SEA_LEVEL) + 0.5;
  if (camPos.y < ground) camPos.y = ground;
  camera.position.lerp(camPos, 1 - Math.exp(-dt * 18));
  if (camera.position.y < ground) camera.position.y = ground;
  camera.lookAt(focus);
}

/* ---------- Spielschleife ---------- */
let last = performance.now(), acc = 0, previewT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;

  if (!joined) {
    previewT += dt * 0.04;
    camera.position.set(SPAWN.x + Math.sin(previewT) * 110, 48, SPAWN.z + Math.cos(previewT) * 110);
    camera.lookAt(SPAWN.x, 12, SPAWN.z);
    world.update(t, camera.position);
    renderer.render(scene, camera);
    return;
  }

  const inp = input.poll();
  const blocked = ui.open || dead;
  const move = blocked ? { x: 0, y: 0 } : inp.move;
  const stepIn = { ...inp, move };
  if (inp.jump && !blocked) pendingJump = true;
  attackCd -= dt; knockCd -= dt; swingT -= dt;

  if (!blocked) {
    if (inp.interact) { if (driving) leaveVehicle(); else if (!riding) interact(); }
    if (inp.ride) {
      if (riding) stopRide();
      else if (!driving) { const c = creatures.pick(player.feet(tmp), aimDir(tmp2), 5, (x) => x.mine); if (c) { if (c.def.rideable) net.send({ t: 'ride', id: c.id }); else ui.toast(`${c.def.name} kann man nicht reiten.`, 'warn'); } }
    }
    if (inp.reset && driving) vehicles.reset(driving, world.heightAt(vehicles.position(driving).x, vehicles.position(driving).z) < 0.5);
    if (inp.demolish && !driving && !riding) { const b = buildings.pick(player.feet(tmp), yaw, 4.5); if (b) net.send({ t: 'demolish', id: b.b.id }); }
    if ((inp.attack || (inp.attackHeld && attackCd <= 0 && !(heldDef()?.def?.structure))) && !driving && !riding && !player.tumbling) useHeld();
  }

  // Ausdauer
  const sprinting = inp.sprint && Math.hypot(move.x, move.y) > 0.1 && !driving && !riding && player.grounded;
  if (sprinting) stamina = Math.max(0, stamina - 20 * dt); else stamina = Math.min(state.maxStamina, stamina + 14 * dt);

  // Physik
  acc += dt;
  while (acc >= DT) {
    const si = { ...stepIn, jump: pendingJump };
    pendingJump = false;
    if (!driving && !riding) player.step(DT, si, yaw, { canSprint: stamina > 1, canJump: stamina > 8 });
    vehicles.step(DT, driving && driving.id, si);
    physics.timestep = DT;
    physics.step();
    acc -= DT;
  }

  // Reiten (Reiter bewegt die Kreatur selbst)
  if (riding && ridePose) {
    const sp = Number(riding.sp.speed) * 1.25 || 6;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let mx = fx * move.y + rx * move.x, mz = fz * move.y + rz * move.x; const l = Math.hypot(mx, mz);
    ridePose.moving = 0;
    if (l > 0.05) {
      mx /= l; mz /= l;
      const nx = ridePose.p.x + mx * sp * (inp.sprint ? 1.4 : 1) * dt, nz = ridePose.p.z + mz * sp * (inp.sprint ? 1.4 : 1) * dt;
      if (world.heightAt(nx, nz) > 0.4) { ridePose.p.x = nx; ridePose.p.z = nz; ridePose.moving = 2; }
      ridePose.r = Math.atan2(mx, mz);
    }
    ridePose.p.y = world.heightAt(ridePose.p.x, ridePose.p.z);
    if (now - lastRideSend > 100) { lastRideSend = now; net.send({ t: 'rs', id: riding.id, p: [ridePose.p.x, ridePose.p.y, ridePose.p.z], r: ridePose.r, mv: ridePose.moving }); }
    player.body.setTranslation({ x: ridePose.p.x, y: ridePose.p.y + 1, z: ridePose.p.z }, false);
  }

  // Figur: im Fahrzeug/auf dem Reittier sitzen
  if (driving) {
    const seat = vehicles.seatPos(driving, tmp);
    player.body.setTranslation({ x: seat.x, y: seat.y + 0.4, z: seat.z }, false);
    player.mesh.position.set(seat.x, seat.y - 0.55, seat.z);
    const f = vehicles.forward(driving); player.mesh.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
  } else if (riding && ridePose) {
    const sc = Number(riding.sp.scale) || 1;
    player.mesh.position.set(ridePose.p.x, ridePose.p.y + 1.35 * sc, ridePose.p.z);
    player.mesh.rotation.set(0, ridePose.r + Math.PI, 0);
  } else player.render(dt);
  const held = heldDef();
  setHeld(player.mesh, held && !driving ? held.id : '', held && held.def);

  vehicles.render(dt);
  vehicles.maintain(dt, driving && driving.id, (e) => net.send({ t: 'vrest', id: e.id }));
  // Fahrzeuge melden (12 × pro Sekunde)
  if (now - lastVSend > 80) {
    lastVSend = now;
    for (const e of vehicles.list.values()) {
      if (e.mode !== 'local') continue;
      const p = e.body.translation(), r = e.body.rotation();
      net.send({ t: 'vs', id: e.id, p: [p.x, p.y, p.z], q: [r.x, r.y, r.z, r.w], sp: e.sp, st: e.st });
    }
  }
  // Angefahren werden
  if (!driving && !riding && !player.tumbling && knockCd <= 0 && !player.flying) {
    const c = player.center(tmp);
    for (const e of vehicles.list.values()) {
      const v = vehicles.velocity(e); const sp = Math.hypot(v.x, v.z);
      if (sp < 6) continue;
      const p = vehicles.position(e);
      if (Math.hypot(p.x - c.x, p.z - c.z) < e.spec.half[0] + 0.5 && Math.abs(p.y - c.y) < 2.5) {
        knockCd = 1.5;
        player.tumble({ x: v.x * 0.9, y: 5 + sp * 0.15, z: v.z * 0.9 });
        if (!god) hurt(Math.round(sp * 1.5), 'einem Fahrzeug');
        break;
      }
    }
  }

  creatures.update(dt, camera, riding && riding.id, ridePose);
  buildings.update(t);
  const bp = heldDef()?.def?.structure;
  buildings.preview(!blocked && !driving && !riding && bp ? bp : '', player.feet(tmp), yaw);

  // Pfeile
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.vel.y -= 9.8 * dt; pr.pos.addScaledVector(pr.vel, dt); pr.life -= dt;
    pr.mesh.position.copy(pr.pos); pr.mesh.lookAt(tmp.copy(pr.pos).add(pr.vel));
    let hitSomething = pr.pos.y < world.heightAt(pr.pos.x, pr.pos.z) || pr.life <= 0;
    if (!hitSomething) for (const c of creatures.map.values()) {
      if (c.mine) continue;
      const sc = Number(c.def.scale) || 1;
      if (Math.hypot(c.pos.x - pr.pos.x, c.pos.y + 1.1 * sc - pr.pos.y, c.pos.z - pr.pos.z) < 1.1 * sc) { net.send({ t: 'hit', id: c.id, n: pr.dmg, ranged: 1 }); hitSomething = true; break; }
    }
    if (!hitSomething && config.settings.pvp) for (const r of net.remotes.values()) {
      if (Math.hypot(r.pos.x - pr.pos.x, r.pos.y + 1 - pr.pos.y, r.pos.z - pr.pos.z) < 0.8) { net.send({ t: 'phit', id: r.id, n: pr.dmg, ranged: 1 }); hitSomething = true; break; }
    }
    if (hitSomething) { scene.remove(pr.mesh); projectiles.splice(i, 1); }
  }

  // Überleben: Hunger und Regeneration
  const p = state.profile;
  if (!dead && !god) {
    p.hunger = Math.max(0, p.hunger - dt * (100 / 1200) * (Number(config.settings.hunger_rate) || 1));
    if (p.hunger <= 0) { p.hp -= dt * 1.2; if (p.hp <= 0) { p.hp = 0; die('Hunger'); } }
    else if (p.hunger > 40 && p.hp < state.maxHp) p.hp = Math.min(state.maxHp, p.hp + dt * 0.6);
  }

  // Splitter einsammeln
  const pc = driving ? vehicles.position(driving) : player.center(tmp);
  for (const s of world.shards) {
    if (s.taken) continue;
    if (p.shards.includes(s.id)) { s.taken = true; s.group.visible = false; continue; }
    const g = s.group.position;
    if (Math.hypot(g.x - pc.x, g.z - pc.z) < 2.6 && Math.abs(g.y - pc.y) < 3.5) {
      s.taken = true; s.group.visible = false; p.shards.push(s.id);
      state.add('splitter', 1, { count: true }); state.addXp(15);
    }
  }

  updateCamera(dt, inp);
  world.update(t, focus);

  // Netz: eigener Zustand
  const feet = player.feet(tmp);
  const tq = player.figureQuat();
  const wpos = driving ? vehicles.position(driving) : riding && ridePose ? ridePose.p : feet;
  net.sendState({
    p: [wpos.x, wpos.y, wpos.z], r: player.mesh.rotation.y, v: driving ? driving.id : 0, sp: player.speed,
    w: held && !driving ? held.id : '', a: swingT > 0 ? 1 : 0, hp: Math.round((p.hp / state.maxHp) * 100),
    tq: tq ? [tq.x, tq.y, tq.z, tq.w] : undefined, ride: riding ? riding.id : '', fly: player.flying ? 1 : 0, dead: dead ? 1 : 0,
  });
  net.update(dt, camera, (id) => state.def(id), {
    seat: (vid) => { const e = vehicles.get(vid); if (!e) return null; const f = vehicles.forward(e); return { pos: vehicles.seatPos(e, new THREE.Vector3()), yaw: Math.atan2(-f.x, -f.z) }; },
    mount: (cid) => { const c = creatures.map.get(cid); return c ? { pos: c.pos, ry: c.ry, scale: Number(c.def.scale) || 1 } : null; },
  });
  if (now - lastSave > 5000 && state.dirty) { lastSave = now; net.send({ t: 'save', profile: state.serialize() }); state.clean(); }

  // Anzeige
  ui.bars(stamina, state.maxStamina);
  ui.hotbar(selSlot);
  if (Math.floor(t * 2) !== frame._q) { frame._q = Math.floor(t * 2); ui.tracker(); if (ui.open) ui.render(); }
  const touch = inp.touch;
  let prompt = '';
  if (dead) prompt = '';
  else if (driving) prompt = vehicles.flipped(driving) ? (touch ? 'Umgekippt · Zurücksetzen tippen' : 'Umgekippt · R zum Zurücksetzen') : (touch ? '' : 'E Aussteigen  ·  R Zurücksetzen  ·  Leertaste Handbremse');
  else if (riding) prompt = touch ? 'Reiten-Knopf: absteigen' : 'F Absteigen  ·  Shift schneller';
  else {
    const f = player.feet(tmp2);
    const v = vehicles.nearest(f, 4.5);
    const c = creatures.pick(f, aimDir(new THREE.Vector3()), 5);
    const b = buildings.pick(f, yaw, 3.5);
    if (bp) prompt = touch ? 'Angriff-Knopf: bauen' : 'Klick: bauen  ·  X: eigenes Bauteil abreißen';
    else if (b && b.b.type === 'wand_tuer') prompt = (touch ? 'Benutzen: ' : 'E ') + (b.open ? 'Tür schließen' : 'Tür öffnen');
    else if (v) prompt = v.driver ? 'Fahrzeug ist besetzt' : (touch ? 'Benutzen: Einsteigen' : `E Einsteigen (${D.VEHICLE_TYPES[v.type]?.name || 'Fahrzeug'})`);
    else if (c && c.mine) prompt = (touch ? '' : 'E ') + (c.mine === 2 ? 'Folgen lassen' : 'Bleiben lassen') + (c.def.rideable ? (touch ? ' · Reiten-Knopf' : '  ·  F Reiten') : '');
    else if (c && !c.owner && c.def.tame_food && Number(c.def.tame_amount) > 0) prompt = `${touch ? 'Benutzen' : 'E'}: ${c.def.name} mit ${state.def(c.def.tame_food)?.name || c.def.tame_food} füttern (zähmen)`;
    else if (player.swimming) prompt = 'Du schwimmst · gleich geht es zurück an Land';
  }
  $('prompt').textContent = prompt; $('prompt').hidden = !prompt;
  $('speedo').hidden = !driving;
  if (driving) $('kmh').textContent = String(Math.round(Math.abs(vehicles.speed(driving)) * 3.6));
  $('btn-use').textContent = driving ? 'Aussteigen' : 'Benutzen';
  $('btn-jump').textContent = driving ? 'Bremse' : 'Springen';
  $('btn-reset').hidden = !driving;
  $('btn-ride').hidden = !(riding || creatures.pick(player.feet(tmp), aimDir(tmp2), 5, (x) => x.mine && x.def.rideable));
  damageFlash = Math.max(0, damageFlash - dt * 2.5);
  $('flash').style.opacity = String(damageFlash * 0.5);

  renderer.render(scene, camera);
  input.consume();
}

addEventListener('pagehide', () => { if (net && state && state.profile) net.send({ t: 'save', profile: state.serialize() }); });
boot().catch((e) => {
  $('loading').textContent = 'Das Spiel konnte nicht starten: ' + (e && e.message ? e.message : e) + '. Dein Browser braucht WebGL.';
  console.error(e);
});
