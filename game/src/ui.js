// Spieloberfläche: Anzeigen, Schnellleiste, Inventar/Herstellen/Quests, Admin-Menü, Todesbildschirm, Meldungen.
import { HOTBAR, INV_SLOTS, STRUCTURE_TYPES } from './shared/defaults.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#8A8A96');

export function createUI(ctx) {
  let tab = 'inv', open = false, picked = -1;
  const S = ctx.state;
  const cfg = () => ctx.getConfig();

  function icon(id, n, extra = '') {
    if (!id) return `<span class="slot-empty"></span>`;
    const d = S.def(id) || {};
    const short = String(d.name || id).replace(/[^A-Za-zÄÖÜäöü ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="ico" style="--c:${safeColor(d.color)}">${esc(short)}</span>${n > 1 ? `<b class="cnt">${n}</b>` : ''}${extra}`;
  }

  const api = {
    get open() { return open; },
    toast(text, kind = '') {
      const el = document.createElement('div');
      el.className = 'toast ' + kind; el.textContent = text;
      $('toasts').appendChild(el);
      while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
      setTimeout(() => el.classList.add('out'), 3200);
      setTimeout(() => el.remove(), 3700);
    },
    big(text) {
      const el = $('bigmsg'); el.textContent = text; el.hidden = false;
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      clearTimeout(api._bt); api._bt = setTimeout(() => { el.hidden = true; }, 6000);
    },
    bars(stamina, maxSt) {
      const p = S.profile; if (!p) return;
      const set = (id, v, max, txt) => { $(id).style.setProperty('--p', Math.max(0, Math.min(100, (v / max) * 100)) + '%'); $(id + '-t').textContent = txt; };
      set('bar-hp', p.hp, S.maxHp, `${Math.ceil(p.hp)} / ${S.maxHp}`);
      set('bar-food', p.hunger, 100, `${Math.ceil(p.hunger)}`);
      set('bar-st', stamina, maxSt, `${Math.round(stamina)}`);
      set('bar-xp', p.xp, S.xpNeed, `${p.xp} / ${S.xpNeed} EP`);
      $('lvl').textContent = p.level;
      $('coins').textContent = p.coins;
      $('hud-hp-warn').hidden = p.hp > S.maxHp * 0.25;
    },
    hotbar(sel) {
      const hb = S.hotbar();
      const html = hb.map((s, i) => `<button class="hslot ${i === sel ? 'sel' : ''}" data-hslot="${i}" aria-label="Platz ${i + 1}"><i class="key">${i + 1}</i>${icon(s && s.id, s && s.n)}${s && S.profile.armor === s.id ? '<i class="worn">AN</i>' : ''}</button>`).join('');
      if ($('hotbar').innerHTML !== html) $('hotbar').innerHTML = html;
      const s = hb[sel];
      const d = s && S.def(s.id);
      $('held-name').textContent = d ? d.name + (d.damage ? ` · ${d.damage} Schaden` : d.food ? ` · +${d.food} Sättigung` : d.structure ? ' · zum Bauen klicken' : '') : 'Faust';
    },
    tracker() {
      if (!S.profile) return;
      const qs = S.openQuests().slice(0, 3);
      $('quests').innerHTML = qs.map(([id, q]) => {
        const st = S.profile.quests[id] || { n: 0 };
        return `<div class="qt"><b>${esc(q.title)}</b><span>${esc(q.description)}</span><i style="--p:${Math.round((st.n / (q.count || 1)) * 100)}%"></i><em>${st.n} / ${q.count}</em></div>`;
      }).join('');
    },
    toggle(t) {
      if (open && (!t || t === tab)) return api.close();
      if (t) tab = t;
      open = true; $('panel').hidden = false; picked = -1;
      ctx.onPanel?.(true);
      api.render();
    },
    close() { open = false; $('panel').hidden = true; ctx.onPanel?.(false); },
    render() {
      if (!open) return;
      const tabs = [['inv', 'Inventar'], ['craft', 'Herstellen'], ['quests', 'Quests']];
      if (ctx.isAdmin()) tabs.push(['admin', 'Admin']);
      $('panel-tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('');
      const p = S.profile;
      let html = '';
      if (tab === 'inv') {
        const sel = picked >= 0 ? p.inv[picked] : null;
        const d = sel && S.def(sel.id);
        html = `<p class="hint">Plätze 1–8 sind deine Schnellleiste. Tippe zwei Plätze nacheinander an, um sie zu tauschen.</p>
          <div class="grid">${p.inv.map((s, i) => `<button class="slot ${i < HOTBAR ? 'hb' : ''} ${i === picked ? 'picked' : ''}" data-slot="${i}">${icon(s && s.id, s && s.n)}${s && p.armor === s.id ? '<i class="worn">AN</i>' : ''}</button>`).join('')}</div>
          <div class="detail">${d ? `<div><b>${esc(d.name)}</b> <span class="muted">${esc(d.type)}${d.damage ? ' · Schaden ' + d.damage : ''}${d.food ? ' · Sättigung +' + d.food : ''}${d.armor ? ' · Schutz ' + d.armor + ' %' : ''}</span></div>
            <div class="row">${d.type === 'Nahrung' ? '<button class="btn" data-act="eat">Essen</button>' : ''}${d.type === 'Rüstung' ? `<button class="btn" data-act="armor">${p.armor === sel.id ? 'Ablegen' : 'Anlegen'}</button>` : ''}<button class="btn ghost" data-act="drop">1 wegwerfen</button></div>` : '<span class="muted">Wähle einen Gegenstand aus.</span>'}</div>
          <div class="stats"><span>Level <b>${p.level}</b></span><span>Münzen <b>${p.coins}</b></span><span>Besiegt <b>${p.stats.kills}</b></span><span>Hergestellt <b>${p.stats.crafted}</b></span><span>Gebaut <b>${p.stats.built}</b></span><span>Gezähmt <b>${p.tamed || 0}</b></span></div>`;
      } else if (tab === 'craft') {
        const rec = Object.entries(cfg().recipes).sort((a, b) => (Number(a[1].level) || 0) - (Number(b[1].level) || 0) || (Number(a[1].order) || 0) - (Number(b[1].order) || 0));
        html = `<div class="recipes">${rec.map(([rid, r]) => {
          const d = S.def(r.item) || { name: r.item };
          const c = S.canCraft(rid, ctx.nearStation);
          const ing = Object.entries(r.ingredients || {}).map(([id, n]) => { const have = S.count(id); return `<span class="ing ${have >= n ? 'ok' : ''}">${esc(S.def(id)?.name || id)} ${have}/${n}</span>`; }).join('');
          return `<div class="rec ${c.ok ? '' : 'no'}"><span class="rec-ico">${icon(r.item, 0)}</span><div class="rec-main"><b>${esc(d.name)}${Number(r.amount) > 1 ? ' ×' + r.amount : ''}</b><div class="ings">${ing}</div>${!c.ok ? `<small>${esc(c.why)}</small>` : r.station ? `<small class="ok">am ${esc(S.def(r.station)?.name || r.station)}</small>` : ''}</div><button class="btn" data-craft="${esc(rid)}" ${c.ok ? '' : 'disabled'}>Herstellen</button></div>`;
        }).join('')}</div>`;
      } else if (tab === 'quests') {
        const all = Object.entries(cfg().quests).sort((a, b) => (Number(a[1].order) || 0) - (Number(b[1].order) || 0));
        html = `<div class="qlist">${all.map(([id, q]) => {
          const st = p.quests[id] || { n: 0, done: false };
          const rw = [q.xp ? q.xp + ' EP' : '', q.coins ? q.coins + ' Münzen' : '', q.reward_item ? (q.reward_amount || 1) + '× ' + (S.def(q.reward_item)?.name || q.reward_item) : ''].filter(Boolean).join(' · ');
          return `<div class="q ${st.done ? 'done' : ''}"><div><b>${esc(q.title)}</b>${st.done ? ' <span class="okb">Erledigt</span>' : ''}<p>${esc(q.description)}</p><small>Belohnung: ${esc(rw || '–')}</small></div><div class="qp"><i style="--p:${Math.round((Math.min(st.n, q.count) / (q.count || 1)) * 100)}%"></i><em>${Math.min(st.n, q.count)} / ${q.count}</em></div></div>`;
        }).join('')}</div>`;
      } else if (tab === 'admin' && ctx.isAdmin()) {
        const players = ctx.getPlayers();
        const pOpts = players.map((x) => `<option value="${esc(x.pid || x.id)}" data-sid="${esc(x.id)}">${esc(x.name)}</option>`).join('');
        const spOpts = Object.entries(cfg().species).map(([id, s]) => `<option value="${esc(id)}">${esc(s.name)}</option>`).join('');
        const itOpts = Object.entries(cfg().items).map(([id, s]) => `<option value="${esc(id)}">${esc(s.name)}</option>`).join('');
        const a = ctx.adminState();
        html = `<div class="admin">
          <section><h4>Ich</h4><div class="row">
            <button class="btn ${a.fly ? 'on' : ''}" data-adm="fly">Fliegen ${a.fly ? 'AN' : 'AUS'}</button>
            <button class="btn ${a.god ? 'on' : ''}" data-adm="god">Unverwundbar ${a.god ? 'AN' : 'AUS'}</button>
            <button class="btn" data-adm="heal-me">Heilen</button>
            <button class="btn" data-adm="spawn-tp">Zum Startplatz</button></div>
            <p class="hint">Fliegen: Leertaste hoch, C runter, Shift schneller.</p></section>
          <section><h4>Kreaturen</h4><div class="row">
            <select id="adm-sp">${spOpts}</select><input id="adm-n" type="number" min="1" max="20" value="1">
            <button class="btn" data-adm="spawn">Erschaffen</button>
            <button class="btn ghost" data-adm="clear">Im Umkreis 60 m entfernen</button></div></section>
          <section><h4>Gegenstände</h4><div class="row">
            <select id="adm-item">${itOpts}</select><input id="adm-in" type="number" min="1" max="1000" value="10">
            <button class="btn" data-adm="give-me">Mir geben</button></div></section>
          <section><h4>Spieler</h4>${players.length ? `<div class="row">
            <select id="adm-p">${pOpts}</select>
            <button class="btn" data-adm="tpto">Hinteleportieren</button><button class="btn" data-adm="bring">Herholen</button>
            <button class="btn" data-adm="give">Gegenstand geben</button><button class="btn" data-adm="heal">Heilen</button>
            <button class="btn danger" data-adm="kick">Entfernen</button></div>` : '<p class="hint">Keine anderen Spieler online.</p>'}</section>
          <section><h4>Server</h4><div class="row">
            <input id="adm-msg" type="text" maxlength="200" placeholder="Nachricht an alle">
            <button class="btn" data-adm="msg">Senden</button>
            <button class="btn ${cfg().settings.pvp ? 'on' : ''}" data-adm="pvp">Spieler-Kämpfe ${cfg().settings.pvp ? 'AN' : 'AUS'}</button></div></section>
        </div>`;
      }
      $('panel-body').innerHTML = html;
    },
    death(show, by = '') {
      $('death').hidden = !show;
      if (show) $('death-by').textContent = by ? `Besiegt von ${by}.` : 'Du hast nicht überlebt.';
    },
    bind() {
      $('hotbar').addEventListener('click', (e) => { const b = e.target.closest('[data-hslot]'); if (b) ctx.onSlot(+b.dataset.hslot); });
      $('panel-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; picked = -1; api.render(); } });
      $('panel-close').addEventListener('click', () => api.close());
      $('panel-body').addEventListener('click', (e) => {
        const slot = e.target.closest('[data-slot]');
        if (slot) {
          const i = +slot.dataset.slot;
          if (picked >= 0 && picked !== i) { S.swap(picked, i); picked = -1; } else picked = picked === i ? -1 : i;
          api.render(); return;
        }
        const act = e.target.closest('[data-act]');
        if (act && picked >= 0) {
          const s = S.profile.inv[picked];
          if (act.dataset.act === 'eat') { if (S.eat(picked)) ctx.onAte?.(); }
          if (act.dataset.act === 'armor' && s) S.toggleArmor(s.id);
          if (act.dataset.act === 'drop') S.removeSlot(picked, 1);
          if (!S.profile.inv[picked]) picked = -1;
          api.render(); return;
        }
        const cr = e.target.closest('[data-craft]');
        if (cr) { ctx.onCraft(cr.dataset.craft); api.render(); return; }
        const adm = e.target.closest('[data-adm]');
        if (adm) {
          const pSel = $('adm-p');
          ctx.onAdmin(adm.dataset.adm, {
            pid: pSel ? pSel.value : '', sp: $('adm-sp')?.value, n: Number($('adm-n')?.value) || 1,
            item: $('adm-item')?.value, itemN: Number($('adm-in')?.value) || 1, text: $('adm-msg')?.value || '',
          });
          if (adm.dataset.adm === 'msg' && $('adm-msg')) $('adm-msg').value = '';
          api.render();
        }
      });
      $('respawn').addEventListener('click', () => ctx.onRespawn());
    },
    structureName(type) { return STRUCTURE_TYPES[type]?.name || type; },
  };
  void INV_SLOTS;
  return api;
}
