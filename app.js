'use strict';
/* Family Altar: our family's prayers and scriptures.
   The prayers arrive encrypted in content.enc.json and are unlocked once with the family passcode.
   Everything written here (journal, prayer history) stays on this phone, in localStorage. */

const STORE = 'familyaltar.v1';
const BUILD = 2; // shown in Settings, so we can tell which version a phone has
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso).toLocaleDateString('en-GB', opts);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const hashParts = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);

const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  tick: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

/* ---------------- State ---------------- */
function loadState() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
const S = loadState();
const DEFAULTS = {
  who: '', journal: [], log: {}, timer: null, drafts: {}, prayerEdits: {}, userPrayers: [], lockOnOpen: false,
  reminders: { morning: { on: true, time: '06:00' }, evening: { on: true, time: '21:00' } },
};
for (const [k, v] of Object.entries(DEFAULTS)) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(v));
let saveTimer, wiped = false;
function save() {
  clearTimeout(saveTimer);
  if (wiped) return;
  try { localStorage.setItem(STORE, JSON.stringify(S)); }
  catch { toast('Family Altar couldn’t save. Free up some space on your phone, then try again.'); }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

let C = S.content || null;   // unlocked content
let ENC = null;              // latest encrypted bundle from the server
let unlocked = false;
let timers = [];
const clearTimers = () => { timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); timers = []; };

/* ---------------- Crypto ---------------- */
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: ub64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(enc.iv) }, key, ub64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------------- Sky (time of day) ---------------- */
// Keyframes by hour: top, middle, horizon, water top, water bottom, lamp colour, ink.
const SKY = [
  [0,    '#060A1C', '#0C1430', '#18244A', '#101A38', '#070C1E', '#DCE2F0', '#fff'],
  [4.5,  '#0A1026', '#18203F', '#2E3558', '#1C2444', '#0B1126', '#DCE2F0', '#fff'],
  [6,    '#1C2248', '#6B5A80', '#EBA874', '#5B5872', '#1E2740', '#FFD28A', '#fff'],
  [8,    '#6F9FC6', '#B7CFE0', '#F2E6CF', '#7F9FB6', '#3F6480', '#FFEFC2', '#141B38'],
  [12,   '#5F97C2', '#A6C8DE', '#E6ECF0', '#789FB8', '#3A6384', '#FFF7DC', '#141B38'],
  [16.5, '#5F8CB9', '#B4C8D8', '#EEDFC4', '#7A98AE', '#3B5C7A', '#FFE2A8', '#141B38'],
  [18.5, '#2A2C5A', '#A1617E', '#F1A565', '#6A546C', '#242644', '#FFBE78', '#fff'],
  [20.5, '#0C1436', '#1E2850', '#3A446C', '#1D2648', '#0B122A', '#E3E6F4', '#fff'],
  [24,   '#060A1C', '#0C1430', '#18244A', '#101A38', '#070C1E', '#DCE2F0', '#fff'],
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
function paintSky(el, d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  let i = SKY.findIndex((k) => k[0] > h) - 1; if (i < 0) i = 0;
  const a = SKY[i], b = SKY[i + 1], t = (h - a[0]) / (b[0] - a[0]);
  const names = ['--sky-a', '--sky-b', '--sky-c', '--water-a', '--water-b', '--lamp-c'];
  names.forEach((n, j) => el.style.setProperty(n, mix(a[j + 1], b[j + 1], t)));
  el.style.setProperty('--sky-ink', t < .5 ? a[7] : b[7]);
  // Sun from 6:00 to 20:00, moon through the night; both arc over the water.
  const day = h >= 6 && h < 20;
  const p = day ? (h - 6) / 14 : ((h - 20 + 24) % 24) / 10;
  el.style.setProperty('--lamp-x', `${12 + 76 * p}%`);
  el.style.setProperty('--lamp-y', `${64 - Math.sin(Math.PI * p) * 14}%`);
  el.style.setProperty('--glint', day ? .75 : .45);
  // Stars fade in through dusk and out through dawn.
  const stars = h >= 20.5 || h < 4.5 ? 1 : h >= 18.5 ? (h - 18.5) / 2 : h < 6.5 ? (6.5 - h) / 2 : 0;
  el.style.setProperty('--stars', stars.toFixed(2));
}
function greeting(d = new Date()) {
  const h = d.getHours();
  const part = h < 5 ? 'Peace to you tonight' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Peace to you tonight';
  return S.who ? `${part}, ${S.who}` : part;
}

/* ---------------- Helpers ---------------- */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
function bgUrl(ref) { return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref.replace('–', '-'))}&version=NKJV`; }
function addJournal(entry) { S.journal.unshift({ id: uid(), date: new Date().toISOString(), ...entry }); }
function pageTop(title, { back, backLabel = 'Back', lede, right = '' } = {}) {
  return `<header class="top"><div class="top-row">${back ? `<a class="back" href="${back}">${ICON.back}${esc(backLabel)}</a>` : '<span></span>'}${right}</div>
    ${title ? `<h1 class="title">${esc(title)}</h1>` : ''}${lede ? `<p class="lede">${lede}</p>` : ''}</header>`;
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function prayersAll() {
  const base = (C.prayers || []).map((p) => ({
    ...p, ref: p.verses.map((x) => x.ref).join(' · '), nkjv: true,
    ...(S.prayerEdits[p.id] ? { text: S.prayerEdits[p.id].text, edited: true } : {}),
  }));
  const mine = S.userPrayers.map((p) => ({
    id: p.id, title: p.title || 'My prayer', ref: p.ref || '', text: p.text, mine: true,
    verses: p.ref || p.verse ? [{ ref: p.ref || '', text: p.verse || '' }] : [],
  }));
  return [...base, ...mine];
}
const prayedToday = () => new Set(S.log[dkey()] || []);
function lastPrayed(id) {
  return Object.keys(S.log).sort().reverse().find((d) => S.log[d].includes(id));
}
const updateReady = () => ENC && S.encVersion && ENC.version !== S.encVersion;
function updateBanner() {
  return updateReady() ? `<div class="banner"><p>Your prayers have been updated.</p><button class="btn lamp get-update">Unlock</button></div>` : '';
}
function bindUpdate(v) { $$('.get-update', v).forEach((b) => b.onclick = () => renderGate('update')); }

/* ---------------- Boot & unlock ---------------- */
async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  try { const r = await fetch('content.enc.json', { cache: 'no-cache' }); if (r.ok) ENC = await r.json(); } catch {}
  if (!C) return ENC ? renderGate('first') : renderOffline();
  if (S.lockOnOpen && !unlocked) return renderGate('lock');
  startApp();
}

function gateShell(inner) {
  $('#tabbar').hidden = true; document.body.classList.add('focus'); document.body.classList.remove('praying');
  $('#view').innerHTML = `<div class="gate" id="gate"><div class="sky-stars"></div><div class="sky-lamp"></div><div class="gate-inner">${inner}</div></div>`;
  paintSky($('#gate'));
}
function renderOffline() {
  gateShell(`<h1>Family Altar</h1><p>Connect to the internet once so Family Altar can open your prayers. After that it works offline.</p>
    <button class="btn lamp block" id="retry">Try again</button>`);
  $('#retry').onclick = () => location.reload();
}
function renderGate(mode) {
  const copy = {
    first: 'Enter the family passcode to open your prayers on this phone. You only need to do this once.',
    lock: 'Enter the family passcode to open Family Altar.',
    update: 'Your prayers have been updated. Enter the family passcode to get the new version.',
  }[mode];
  const showTip = mode === 'first' && navigator.standalone === false;
  gateShell(`<h1>Family Altar</h1><p>${copy}</p>
    ${showTip ? `<p class="tip"><strong>Add Family Altar to your Home Screen first.</strong> Tap the Share button in Safari, then <em>Add to Home Screen</em>. Open it from there and enter the passcode, so your prayers are saved in the app.</p>` : ''}
    <form id="unlock" autocomplete="off">
      <input type="password" id="pass" placeholder="Passcode" aria-label="Passcode" autocomplete="current-password" enterkeyhint="go" required>
      <button class="btn lamp block" id="go">Unlock</button>
      <p class="err" id="err" hidden></p>
    </form>
    ${mode === 'update' ? '<button class="btn ghost" id="later">Not now</button>' : ''}`);
  $('#pass').focus();
  if (mode === 'update') $('#later').onclick = () => { unlocked = true; startApp(); };
  $('#unlock').onsubmit = async (e) => {
    e.preventDefault();
    const go = $('#go'), err = $('#err');
    go.disabled = true; go.textContent = 'Unlocking…'; err.hidden = true;
    const enc = mode === 'lock' ? (S.enc || ENC) : ENC;
    try {
      const content = await decrypt(enc, $('#pass').value.trim());
      if (mode !== 'lock') { C = content; S.content = content; S.enc = ENC; S.encVersion = ENC.version; save(); }
      unlocked = true; startApp();
      if (mode === 'update') toast('Your prayers are up to date');
    } catch {
      err.textContent = 'That passcode didn’t open Family Altar. Check it and try again.';
      err.hidden = false; go.disabled = false; go.textContent = 'Unlock'; $('#pass').select();
    }
  };
}
function renderWho() {
  gateShell(`<h1>Who is praying?</h1><p>Choose your name. This phone will greet you by it.</p>
    ${(C.family || []).map((n) => `<button class="btn block who" data-n="${esc(n)}">${esc(n)}</button>`).join('')}`);
  $$('.who').forEach((b) => b.onclick = () => { S.who = b.dataset.n; save(); startApp(); });
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); save(); return; }
  if (S.lockOnOpen && C && hiddenAt && Date.now() - hiddenAt > 2 * 60e3) { unlocked = false; renderGate('lock'); return; }
  tickTimer();
  if (S.timer?.end) keepAwake(true);
  if ($('#sky')) paintSky($('#sky'));
});

function startApp() {
  if (!S.who && C.family?.length) return renderWho();
  document.body.classList.remove('focus');
  $('#tabbar').hidden = false;
  window.onhashchange = route;
  if (!location.hash) location.replace('#/today');
  route();
}

/* ---------------- Router ---------------- */
function route() {
  if (!C || (S.lockOnOpen && !unlocked) || (!S.who && C.family?.length)) return;
  clearTimers();
  const [tab = 'today', id, sub] = hashParts();
  if (justDone && !(tab === 'pray' && id === justDone)) justDone = null;
  const inPrayer = tab === 'pray' && !!id;
  document.body.classList.toggle('focus', inPrayer);
  document.body.classList.toggle('praying', inPrayer && id !== 'new' && !sub && justDone !== id);
  $$('#tabbar a').forEach((a) => {
    if (a.dataset.tab === (tab === 'settings' ? 'today' : tab)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const v = $('#view');
  const views = {
    today: viewToday, settings: viewSettings,
    pray: id === 'new' ? (el) => viewPrayerForm(el, null) : id && sub === 'edit' ? (el) => viewPrayerForm(el, id) : id ? (el) => viewPrayer(el, id) : viewPrayers,
    journal: id === 'new' ? viewNewEntry : id ? (el) => viewEntry(el, id) : viewJournal,
  };
  v.innerHTML = '';
  (views[tab] || viewToday)(v);
  window.scrollTo(0, 0);
}

/* ---------------- The 10-minute prayer timer ---------------- */
// One timer at a time. A running timer is kept as an end time, so it stays right if the phone sleeps.
const PRAY_MS = 10 * 60e3, RING = 150.8;
let audioCtx, wake, justDone = null;
const timerFor = (id) => (S.timer && S.timer.id === id ? S.timer : null);
const leftOf = (t) => (!t ? PRAY_MS : t.end ? Math.max(0, t.end - Date.now()) : t.left);
const fmtLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function chime() {
  try {
    audioCtx.resume();
    const t = audioCtx.currentTime;
    [523.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), at = t + i * .45;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(.22, at + .02); g.gain.exponentialRampToValueAtTime(.001, at + 2.4);
      o.connect(g).connect(audioCtx.destination); o.start(at); o.stop(at + 2.5);
    });
  } catch {}
}
async function keepAwake(on) {
  try { if (on) wake = await navigator.wakeLock?.request('screen'); else { await wake?.release(); wake = null; } } catch {}
}
function startTimer(id) {
  const t = timerFor(id);
  if (t && t.end) return;
  S.timer = { id, end: Date.now() + (t ? t.left : PRAY_MS) };
  save();
  // Start the sound system on this tap, so the chime is allowed to play later. Sound and
  // keeping the screen on are extras: the timer must run even where a phone refuses them.
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const r = audioCtx.resume(); if (r && r.catch) r.catch(() => {});
  } catch (e) {}
  keepAwake(true);
}
function pauseTimer() {
  const t = S.timer; if (!t?.end) return;
  S.timer = { id: t.id, left: Math.max(0, t.end - Date.now()) }; keepAwake(false); save();
}
function resetTimer() { S.timer = null; keepAwake(false); save(); }
function paintTimer() {
  $$('.t-left').forEach((el) => { el.textContent = fmtLeft(leftOf(timerFor(el.dataset.id))); });
  const pr = $('.ring .prog');
  if (pr) pr.style.strokeDashoffset = RING * leftOf(timerFor(pr.dataset.id)) / PRAY_MS;
}
function tickTimer() {
  const t = S.timer; if (!t || !C) return;
  if (t.end && Date.now() >= t.end) return completeTimer(t.id);
  paintTimer();
}
function completeTimer(id) {
  const day = dkey(); if (!S.log[day]) S.log[day] = [];
  S.log[day].push(id);
  S.timer = null; save(); keepAwake(false);
  if (!document.hidden) chime();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  const [tab, cur, sub] = hashParts();
  if (tab === 'pray' && cur === id && !sub) { justDone = id; route(); return; }
  const p = prayersAll().find((x) => x.id === id);
  toast(`10 minutes of prayer done${p?.ref ? ': ' + p.ref : ''}. Amen.`);
  if ((tab === 'today' || tab === 'pray') && !sub && cur !== 'new') route();
}
setInterval(tickTimer, 500);

/* ---------------- Today ---------------- */
function viewToday(v) {
  const all = prayersAll(), done = prayedToday();
  const active = S.timer && all.find((p) => p.id === S.timer.id);
  const next = active || all.find((p) => !done.has(p.id));
  const n = all.filter((p) => done.has(p.id)).length;
  const days = Object.values(S.log).filter((a) => a.length).length;
  const total = Object.values(S.log).reduce((s, a) => s + a.length, 0);
  v.innerHTML = `
    <header class="sky" id="sky">
      <div class="sky-stars"></div><div class="sky-lamp"></div><div class="sky-water"><div class="sky-glint"></div></div>
      <div class="sky-text"><p class="sky-date">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 class="sky-greet">${esc(greeting())}</h1></div>
      <a class="icon-btn sky-gear" href="#/settings" aria-label="Settings">${ICON.gear}</a>
    </header>
    <div class="page">
      ${updateBanner()}
      ${C.word ? `<section class="card word"><p class="eyebrow">Our prophetic word</p>
        <p class="word-text">“${esc(C.word.text)}”</p><p class="ref">${esc(C.word.ref)}</p></section>` : ''}
      <section class="card next"><p class="eyebrow">Today · ${n} of ${all.length} prayed</p>
        <div class="dots" aria-hidden="true">${all.map((p) => `<i${done.has(p.id) ? ' class="on"' : ''}></i>`).join('')}</div>
        ${next ? `<span class="pref">${esc(next.ref || 'My prayer')}</span><h2 class="h2">${esc(next.title)}</h2>
          <p class="snip">${esc(next.text)}</p>
          <a class="btn lamp block" href="#/pray/${encodeURIComponent(next.id)}">${active
            ? `${S.timer.end ? 'Continue praying' : 'Paused'} · <span class="t-left" data-id="${esc(next.id)}">${fmtLeft(leftOf(S.timer))}</span>`
            : 'Pray for 10 minutes'}</a>`
        : `<h2 class="h2">All ${all.length} prayers prayed today</h2>
          <p class="muted">Thank God for today. You can pray any of them again.</p>
          <a class="btn block" href="#/pray">Open prayers</a>`}
      </section>
      <a class="btn block" href="#/journal/new">Write in the journal</a>
      <p class="tally">${total ? `On this phone you have prayed ${total} ${total === 1 ? 'time' : 'times'} over ${days} ${days === 1 ? 'day' : 'days'}.` : 'Each 10 minutes you pray will be counted here.'}</p>
    </div>`;
  paintSky($('#sky'));
  timers.push(setInterval(() => $('#sky') && paintSky($('#sky')), 60e3));
  bindUpdate(v);
}

/* ---------------- Prayers ---------------- */
function viewPrayers(v) {
  const all = prayersAll(), done = prayedToday();
  const n = all.filter((p) => done.has(p.id)).length;
  v.innerHTML = pageTop('Prayers', { lede: `Open a prayer and pray it for 10 minutes. ${n} of ${all.length} prayed today.` }) + `<div class="page">
    ${updateBanner()}
    <div class="list">${all.map((p, i) => {
      const t = timerFor(p.id), last = lastPrayed(p.id);
      const status = t ? `<div class="meta status live">${t.end ? 'Praying now' : 'Paused'} · <span class="t-left" data-id="${esc(p.id)}">${fmtLeft(leftOf(t))}</span> left</div>`
        : done.has(p.id) ? '<div class="meta status">Prayed today</div>'
        : last ? `<div class="meta">Last prayed ${fmtDate(last + 'T12:00')}</div>` : '';
      return `<a class="row-link" href="#/pray/${encodeURIComponent(p.id)}"><div class="card">
        <span class="pnum${done.has(p.id) ? ' on' : ''}">${done.has(p.id) ? ICON.tick : i + 1}</span>
        <div class="grow"><span class="pref">${esc(p.ref || 'My prayer')}</span><h2 class="h3" style="margin:0 0 4px">${esc(p.title)}</h2>
          <p class="snip">${esc(p.text)}</p>${status}</div>${ICON.chev}</div></a>`;
    }).join('')}</div>
    <a class="btn block" href="#/pray/new" style="margin-top:14px">Add a prayer</a>
  </div>`;
  bindUpdate(v);
}

function ovalHtml(x, nkjv) {
  const cap = x.ref ? `<figcaption>${nkjv
    ? `<a href="${bgUrl(x.ref)}" target="_blank" rel="noopener">${esc(x.ref)}</a> <span class="ver">· NKJV</span>` : esc(x.ref)}</figcaption>` : '';
  return `<figure class="oval${x.text ? '' : ' bare'}">${x.text ? `<blockquote>${esc(x.text)}</blockquote>` : ''}${cap}</figure>`;
}
function dockHtml(id) {
  const t = timerFor(id), state = !t ? 'idle' : t.end ? 'running' : 'paused';
  return `<svg class="ring" viewBox="0 0 56 56" aria-hidden="true"><circle class="track" cx="28" cy="28" r="24"/>
      <circle class="prog" data-id="${esc(id)}" cx="28" cy="28" r="24" transform="rotate(-90 28 28)" stroke-dasharray="${RING}" stroke-dashoffset="${RING * leftOf(t) / PRAY_MS}"/></svg>
    <div class="dock-time"><span class="time t-left" data-id="${esc(id)}" role="timer">${fmtLeft(leftOf(t))}</span>
      <span class="lbl">${state === 'idle' ? '10 minutes of prayer' : `${state === 'running' ? 'Praying' : 'Paused'} · <button data-act="reset">Reset</button>`}</span></div>
    <button class="btn${state === 'running' ? '' : ' lamp'}" data-act="${state === 'running' ? 'pause' : 'start'}">${state === 'idle' ? 'Start' : state === 'running' ? 'Pause' : 'Resume'}</button>`;
}
function viewPrayer(v, id) {
  const all = prayersAll(), i = all.findIndex((p) => p.id === id), p = all[i];
  if (!p) { location.hash = '#/pray'; return; }
  if (justDone === id) return viewDone(v, p, all[i + 1]);
  const done = prayedToday().has(id);
  v.innerHTML = `<header class="top"><div class="top-row"><a class="back" href="#/pray">${ICON.back}Prayers</a><span class="count">${i + 1} of ${all.length}</span></div></header>
    <div class="page">
      ${p.verses.map((x) => ovalHtml(x, p.nkjv)).join('')}
      <h1 class="pray-title">${esc(p.title)}</h1>
      <p class="pray-text">${esc(p.text)}</p>
      <div class="pray-meta">${done ? `<span class="done-chip">${ICON.tick}Prayed today</span>` : '<span></span>'}
        <a class="link" href="#/pray/${encodeURIComponent(id)}/edit">Edit prayer</a></div>
      <div class="dock" id="dock">${dockHtml(id)}</div>
    </div>`;
  let lastTap = 0;
  $('#dock').onclick = (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    // A double tap must not start and then pause straight away: Pause appears where Start was.
    if (Date.now() - lastTap < 900) return;
    lastTap = Date.now();
    const act = btn.dataset.act;
    try {
      if (act === 'start') startTimer(id);
      if (act === 'pause') pauseTimer();
      if (act === 'reset') resetTimer();
    } catch (err) { toast(`The timer hit a problem: ${err && err.message ? err.message : err}`); }
    $('#dock').innerHTML = dockHtml(id);
  };
}
function viewDone(v, p, next) {
  v.innerHTML = `<div class="flow done"><div class="glow"></div>
    <h2>Amen.</h2>
    <p class="lede">You prayed for 10 minutes${p.ref ? ` over ${esc(p.ref)}` : ''}.</p>
    <label class="field"><span>Anything you prayed or sensed? (optional)</span>
      <textarea id="note" class="short" placeholder="It will be kept in your journal."></textarea></label>
    <div class="flow-nav"><button class="btn primary" data-go="#/pray">Back to prayers</button><button class="btn" data-go="#/today">Go to Today</button></div>
    ${next ? `<button class="btn ghost block" data-go="#/pray/${encodeURIComponent(next.id)}" style="margin-top:8px">Next prayer: ${esc(next.ref || next.title)}</button>` : ''}
  </div>`;
  $$('[data-go]', v).forEach((b) => b.onclick = () => {
    const note = $('#note').value.trim();
    if (note) { addJournal({ type: 'prayer', title: p.ref ? `${p.title} · ${p.ref}` : p.title, fields: [{ label: 'What I prayed or sensed', text: note }] }); save(); toast('Saved to your journal'); }
    justDone = null; location.hash = b.dataset.go;
  });
}
function viewPrayerForm(v, id) {
  const p = id ? prayersAll().find((x) => x.id === id) : null;
  if (id && !p) { location.hash = '#/pray'; return; }
  const builtIn = p && !p.mine, own = p?.mine ? S.userPrayers.find((x) => x.id === id) : null;
  v.innerHTML = pageTop(p ? 'Edit prayer' : 'Add a prayer', { back: p ? `#/pray/${encodeURIComponent(id)}` : '#/pray', lede: builtIn ? esc(`${p.title} · ${p.ref}`) : '' }) + `<div class="page">
    ${builtIn ? '' : `<label class="field"><span>Title (optional)</span><input type="text" id="fTitle" value="${esc(own?.title || '')}" placeholder="For example, Thanksgiving"></label>
    <label class="field"><span>Scripture (optional)</span><input type="text" id="fRef" value="${esc(own?.ref || '')}" placeholder="For example, Isaiah 43:19"></label>
    <label class="field"><span>Words of the scripture (optional)</span><textarea id="fVerse" class="short" placeholder="Type or paste the verse to show it in the oval">${esc(own?.verse || '')}</textarea></label>`}
    <label class="field"><span>Prayer</span><textarea id="fText" placeholder="Father in the name of Jesus…">${esc(p?.text || '')}</textarea></label>
    <button class="btn primary block" id="fSave">Save prayer</button>
    ${builtIn && p.edited ? '<button class="btn ghost block" id="fRestore" style="margin-top:8px">Restore the original prayer</button>' : ''}
    ${own ? '<button class="btn ember block" id="fDel" style="margin-top:10px">Delete prayer</button>' : ''}
  </div>`;
  $('#fSave').onclick = () => {
    const text = $('#fText').value.trim();
    if (!text) { toast('Write the prayer first, then save.'); return; }
    let goId = id;
    if (builtIn) S.prayerEdits[id] = { text };
    else {
      const data = { title: $('#fTitle').value.trim(), ref: $('#fRef').value.trim(), verse: $('#fVerse').value.trim(), text };
      if (own) Object.assign(own, data); else { goId = 'u-' + uid(); S.userPrayers.push({ id: goId, ...data }); }
    }
    save(); location.hash = `#/pray/${encodeURIComponent(goId)}`; toast('Prayer saved');
  };
  if ($('#fRestore')) $('#fRestore').onclick = () => { delete S.prayerEdits[id]; save(); location.hash = `#/pray/${encodeURIComponent(id)}`; toast('Original prayer restored'); };
  if ($('#fDel')) $('#fDel').onclick = () => {
    if (!confirm('Delete this prayer? This can’t be undone.')) return;
    S.userPrayers = S.userPrayers.filter((x) => x.id !== id); if (S.timer?.id === id) S.timer = null;
    save(); location.hash = '#/pray'; toast('Prayer deleted');
  };
}

/* ---------------- Journal ---------------- */
const typeLabel = (e) => (e.type === 'prayer' ? 'Prayer' : 'Journal');
function viewJournal(v) {
  const groups = {};
  for (const e of S.journal) { const m = fmtDate(e.date, { month: 'long', year: 'numeric' }); (groups[m] = groups[m] || []).push(e); }
  v.innerHTML = pageTop('Journal', { right: '<a class="btn primary" href="#/journal/new" style="min-height:38px;padding:0 14px">New entry</a>' }) + `<div class="page">
    ${S.journal.length ? Object.entries(groups).map(([m, es]) => `<h2 class="section-h">${esc(m)}</h2><div class="list">${es.map((e) => {
      const snip = e.fields?.map((f) => f.text).join(' · ') || '';
      return `<a class="row-link" href="#/journal/${e.id}"><div class="card entry"><div class="grow">
        <span class="type">${esc(typeLabel(e))}</span><h3 class="h3" style="margin:2px 0 0">${esc(e.title || 'Untitled')}</h3>
        ${snip ? `<p class="snip">${esc(snip)}</p>` : ''}<div class="meta">${fmtDate(e.date)} · ${fmtTime(e.date)}</div></div>${ICON.chev}</div></a>`;
    }).join('')}</div>`).join('')
    : `<div class="empty"><h2 class="h3">Your journal is empty</h2><p>Write what God is saying, testimonies and answers to prayer. It is kept on this phone only.</p>
       <a class="btn primary" href="#/journal/new">Write your first entry</a></div>`}
  </div>`;
}
function viewNewEntry(v) {
  const dr = S.drafts.note || { title: '', text: '' };
  v.innerHTML = pageTop('New entry', { back: '#/journal' }) + `<div class="page">
    <label class="field"><span>Title (optional)</span><input type="text" id="nt" value="${esc(dr.title)}" placeholder="For example, A testimony"></label>
    <label class="field"><span>Entry</span><textarea id="nx" class="tall" placeholder="Write freely…">${esc(dr.text)}</textarea></label>
    <button class="btn primary block" id="ns">Save entry</button></div>`;
  const keep = () => { S.drafts.note = { title: $('#nt').value, text: $('#nx').value }; saveSoon(); };
  $('#nt').oninput = keep; $('#nx').oninput = keep;
  $('#ns').onclick = () => {
    const text = $('#nx').value.trim();
    if (!text) { toast('Write something first, then save.'); return; }
    addJournal({ type: 'note', title: $('#nt').value.trim() || fmtDate(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' }), fields: [{ label: '', text }] });
    delete S.drafts.note; save(); location.hash = '#/journal'; toast('Entry saved');
  };
}
function viewEntry(v, id) {
  const e = S.journal.find((x) => x.id === id);
  if (!e) { location.hash = '#/journal'; return; }
  v.innerHTML = pageTop('', { back: '#/journal' }) + `<div class="page entry">
    <span class="type">${esc(typeLabel(e))}</span><h1 class="title">${esc(e.title || 'Untitled')}</h1>
    <p class="muted" style="margin:0 0 22px">${fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(e.date)}</p>
    ${(e.fields || []).map((f) => `<div class="entry-field">${f.label ? `<h3>${esc(f.label)}</h3>` : ''}<p>${esc(f.text)}</p></div>`).join('') || '<p class="muted">Nothing was written for this entry.</p>'}
    <button class="btn ember block" id="del" style="margin-top:20px">Delete entry</button></div>`;
  $('#del').onclick = () => {
    if (!confirm('Delete this journal entry? This can’t be undone.')) return;
    S.journal = S.journal.filter((x) => x.id !== id); save(); location.hash = '#/journal'; toast('Entry deleted');
  };
}

/* ---------------- Settings ---------------- */
function ics() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const ymd = `${tomorrow.getFullYear()}${pad(tomorrow.getMonth() + 1)}${pad(tomorrow.getDate())}`;
  const app = location.href.split('#')[0];
  const icsText = (s) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1');
  const ev = (key, label, line) => {
    const r = S.reminders[key]; if (!r.on) return '';
    label = icsText(label); line = icsText(line);
    return ['BEGIN:VEVENT', `UID:familyaltar-${key}-${stamp}@familyaltar`, `DTSTAMP:${stamp}`,
      `DTSTART:${ymd}T${r.time.replace(':', '')}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      `SUMMARY:${label}`, `DESCRIPTION:${line} Open Family Altar: ${app}`, `URL:${app}`,
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${label}`, 'END:VALARM', 'END:VEVENT'].join('\r\n') + '\r\n';
  };
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Family Altar//EN\r\nCALSCALE:GREGORIAN\r\n'
    + ev('morning', 'Family Altar: morning prayer', 'Time to pray.')
    + ev('evening', 'Family Altar: evening prayer', 'Time to pray.')
    + 'END:VCALENDAR\r\n';
}
function viewSettings(v) {
  const r = S.reminders;
  v.innerHTML = pageTop('Settings', { back: '#/today' }) + `<div class="page">
    ${C.family?.length ? `<h2 class="section-h">Who is praying on this phone</h2>
    <div class="seg" role="group" aria-label="Who is praying">${C.family.map((n) => `<button data-n="${esc(n)}" aria-pressed="${S.who === n}">${esc(n)}</button>`).join('')}</div>` : ''}

    <h2 class="section-h">Daily reminders to pray</h2>
    <div class="card">
      ${['morning', 'evening'].map((k) => `<div class="switch" style="margin-bottom:10px"><label for="on-${k}" style="flex:1">${k === 'morning' ? 'Morning prayer' : 'Evening prayer'}</label>
        <input type="time" id="t-${k}" value="${r[k].time}" style="width:auto;padding:8px 10px" aria-label="${k} time">
        <input type="checkbox" id="on-${k}"${r[k].on ? ' checked' : ''}></div>`).join('')}
      <button class="btn primary block" id="ics" style="margin-top:6px">Add reminders to Calendar</button>
      <p class="small muted" style="margin:10px 0 0">Open the file and tap <strong>Add All</strong>. Your iPhone Calendar will then remind you every day. If you change the times, delete the old Family Altar events in Calendar and add the new ones.</p>
    </div>

    <h2 class="section-h">Privacy</h2>
    <div class="card">
      <label class="switch"><span>Ask for the passcode when I open Family Altar</span><input type="checkbox" id="lock"${S.lockOnOpen ? ' checked' : ''}></label>
      <p class="small muted" style="margin:8px 0 0">Your journal and prayer history are stored only on this phone. Nothing you write is sent anywhere, so each phone keeps its own.</p>
    </div>

    <h2 class="section-h">Backup</h2>
    <div class="card">
      <p class="small muted">Save a copy of your journal, prayer history and the prayers you added. Keep it somewhere private, like your iCloud Drive.</p>
      <div class="btn-row" style="margin-top:0"><button class="btn" id="exp">Save a backup</button><label class="btn" for="imp">Restore a backup</label></div>
      <input type="file" id="imp" accept="application/json,.json" hidden>
    </div>

    <h2 class="section-h">About the scripture</h2>
    <div class="card"><p class="small" style="margin:0">Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All rights reserved.</p></div>

    <h2 class="section-h">Start again</h2>
    <div class="card"><button class="btn ember block" id="wipe">Remove everything from this phone</button></div>
    <p class="tally">Family Altar version ${BUILD}</p>
  </div>`;

  $$('.seg button', v).forEach((b) => b.onclick = () => { S.who = b.dataset.n; save(); route(); toast(`This phone now greets ${S.who}`); });
  for (const k of ['morning', 'evening']) {
    $('#t-' + k).onchange = (e) => { r[k].time = e.target.value || r[k].time; save(); };
    $('#on-' + k).onchange = (e) => { r[k].on = e.target.checked; save(); };
  }
  $('#ics').onclick = () => {
    if (!r.morning.on && !r.evening.on) { toast('Turn on at least one reminder first.'); return; }
    download('Family Altar reminders.ics', ics(), 'text/calendar');
  };
  $('#lock').onchange = (e) => { S.lockOnOpen = e.target.checked; unlocked = true; save(); toast(e.target.checked ? 'Family Altar will ask for the passcode' : 'Passcode lock turned off'); };
  $('#exp').onclick = () => {
    const { content, enc, ...mine } = S;
    download(`Family Altar backup ${dkey()}.json`, JSON.stringify({ altarBackup: 1, saved: new Date().toISOString(), data: mine }, null, 1), 'application/json');
  };
  $('#imp').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const b = JSON.parse(await file.text());
      if (!b.altarBackup || !b.data) throw new Error();
      if (!confirm(`Restore the backup from ${fmtDate(b.saved)}? It will replace the journal and prayer history on this phone.`)) return;
      Object.assign(S, b.data); save(); toast('Backup restored'); location.hash = '#/today';
    } catch { toast('That file isn’t a Family Altar backup. Choose a file saved from Family Altar.'); }
  };
  $('#wipe').onclick = () => {
    if (!confirm('Remove all Family Altar data from this phone, including the journal? This can’t be undone. Save a backup first if you want to keep it.')) return;
    wiped = true; localStorage.removeItem(STORE); location.replace(location.pathname);
  };
}

boot();
