/* Readline — веб-версия (PWA). Внешне повторяет приложение для iPhone.
   Сценарии и видео хранятся в браузере (IndexedDB), настройки — в localStorage. */
'use strict';

const VERSION = '0.2.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const icon = (id) => `<svg><use href="#i-${id}"/></svg>`;

/* ================= Настройки ================= */
const DEFAULTS = { theme: 'auto', font: 40, speed: 60, area: 50, mirror: false, countdown: 3, lang: 'ru-RU', sens: 50, res: '1080', mode: 'manual', lastBackup: 0 };
const prefs = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('readline.prefs')) || {}; } catch { return {}; } })());
function savePrefs() { try { localStorage.setItem('readline.prefs', JSON.stringify(prefs)); } catch {} }
function applyTheme() {
  const r = document.documentElement;
  if (prefs.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', prefs.theme);
}
applyTheme();

/* ================= База (IndexedDB) ================= */
const db = {
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      const req = indexedDB.open('readline', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('scripts')) d.createObjectStore('scripts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this._p;
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      let out;
      const r = fn(t.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
  put(store, v) { return this.tx(store, 'readwrite', (s) => s.put(v)); },
  del(store, id) { return this.tx(store, 'readwrite', (s) => s.delete(id)); },
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= Утилиты ================= */
const WPM = 130;
function wordsOf(text) { return (text.match(/[^\s#]+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)); }
function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const wordsLabel = (n) => `${n} ${plural(n, 'слово', 'слова', 'слов')}`;
function fmtDur(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} с`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} мин ${s} с` : `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}
const readSec = (words) => Math.round(words / WPM * 60);
function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function fmtClock2(sec) { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
function dayLabel(ts) {
  const d = new Date(ts), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const timeLabel = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
function fmtSize(b) { return b > 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' ГБ' : Math.max(1, Math.round(b / 1e6)) + ' МБ'; }
function titleFrom(text) {
  const l = text.split('\n').map((s) => s.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
  return l ? (l.length > 40 ? l.slice(0, 40) + '…' : l) : '';
}
const displayTitle = (s) => (s.title || '').trim() || 'Без названия';
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function setRangeFill(el) {
  const p = (el.value - el.min) / (el.max - el.min) * 100;
  el.style.setProperty('--p', p + '%');
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch { return false; }
  }
  downloadBlob(file, file.name); return true;
}

/* ================= Меню «⋯» (как контекстное меню iOS) ================= */
function showMenu(anchor, items, { dark = false } = {}) {
  closeMenu();
  const m = $('#menu');
  m.innerHTML = '';
  m.classList.toggle('dark', dark);
  for (const it of items) {
    if (it === '-') { m.insertAdjacentHTML('beforeend', '<div class="msep"></div>'); continue; }
    const b = document.createElement('button');
    if (it.danger) b.className = 'danger';
    b.innerHTML = `<span>${esc(it.label)}</span>${it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}`;
    b.addEventListener('click', () => { closeMenu(); it.action(); });
    m.appendChild(b);
  }
  const catcher = document.createElement('div');
  catcher.className = 'menu-catch';
  catcher.addEventListener('pointerdown', (e) => { e.preventDefault(); closeMenu(); });
  document.body.appendChild(catcher);
  m.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = r.right - w; if (left < 10) left = Math.min(r.left, innerWidth - w - 10);
  let top = r.bottom + 8; if (top + h > innerHeight - 10) top = Math.max(10, r.top - h - 8);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  m.style.transformOrigin = (left < r.left ? 'top left' : 'top right');
}
function closeMenu() { $('#menu').classList.add('hidden'); $$('.menu-catch').forEach((c) => c.remove()); }

/* ================= Навигация: экраны въезжают справа, шторки — снизу ================= */
const stack = [$('#home')];
function push(el) {
  const prev = stack[stack.length - 1];
  prev.classList.add('behind');
  el.classList.add('open');
  stack.push(el);
}
function pop() {
  if (stack.length < 2) return;
  const el = stack.pop();
  el.classList.remove('open');
  stack[stack.length - 1].classList.remove('behind');
}
// Свайп от левого края — назад, как в iOS
(function edgeSwipe() {
  let el = null, prev = null, x0 = 0, y0 = 0, dx = 0, active = false;
  document.addEventListener('touchstart', (e) => {
    if (stack.length < 2 || openSheets.length) return;
    const t = e.touches[0];
    if (t.clientX > 24) return;
    el = stack[stack.length - 1];
    if (el.dataset.noswipe === '1') { el = null; return; }
    prev = stack[stack.length - 2]; x0 = t.clientX; y0 = t.clientY; dx = 0; active = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!el) return;
    const t = e.touches[0];
    dx = Math.max(0, t.clientX - x0);
    if (!active) {
      if (Math.abs(t.clientY - y0) > 12 && Math.abs(t.clientY - y0) > dx) { el = null; return; }
      if (dx < 8) return;
      active = true; el.style.transition = prev.style.transition = 'none';
    }
    el.style.transform = `translateX(${dx}px)`;
    prev.style.transform = `translateX(${-28 + dx / innerWidth * 28}%)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!el) return;
    const cur = el, pr = prev; el = null;
    cur.style.transition = pr.style.transition = '';
    cur.style.transform = pr.style.transform = '';
    if (active && dx > innerWidth * 0.33) cur.dispatchEvent(new CustomEvent('swipeback'));
  });
})();

const openSheets = [];
function openSheet(sheet) {
  sheet.classList.add('open');
  openSheets.push(sheet);
  $('#scrim').classList.add('show');
  $('#scrim').style.zIndex = 40 + openSheets.length * 2 - 1;
  sheet.style.zIndex = 40 + openSheets.length * 2;
}
function closeSheet(sheet = openSheets[openSheets.length - 1]) {
  if (!sheet) return;
  sheet.classList.remove('open');
  openSheets.splice(openSheets.indexOf(sheet), 1);
  if (!openSheets.length) $('#scrim').classList.remove('show');
  else $('#scrim').style.zIndex = 40 + openSheets.length * 2 - 1;
  sheet.dispatchEvent(new Event('closed'));
}
$('#scrim').addEventListener('click', () => closeSheet());
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.sheet'))));
// Шторку можно смахнуть вниз за верхнюю часть
$$('.sheet').forEach((sheet) => {
  let y0 = 0, dy = 0, drag = false;
  sheet.addEventListener('pointerdown', (e) => {
    const top = sheet.getBoundingClientRect().top;
    if (e.clientY - top > 64 || e.target.closest('button')) return;
    drag = true; y0 = e.clientY; dy = 0; sheet.classList.add('dragging'); sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!drag) return;
    drag = false; sheet.classList.remove('dragging'); sheet.style.transform = '';
    if (dy > 110) closeSheet(sheet);
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
});

/* ================= Главный экран ================= */
let scripts = [];
async function loadScripts() {
  scripts = (await db.all('scripts')) || [];
  scripts.sort((a, b) => (b.lastOpenedAt || b.updatedAt) - (a.lastOpenedAt || a.updatedAt));
  renderLibrary();
}
function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}
function renderLibrary() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#script-list');
  const shown = scripts.filter((s) => !q || (s.title + ' ' + s.text).toLowerCase().includes(q));
  list.innerHTML = '';
  for (const s of shown) {
    const n = wordsOf(s.text).length;
    const b = document.createElement('button');
    b.className = 'script-card';
    b.innerHTML = `<h3>${esc(displayTitle(s))}</h3><div class="meta">${wordsLabel(n)} · ${fmtDur(readSec(n))}</div>`;
    b.addEventListener('click', () => openEditor(s.id));
    list.appendChild(b);
  }
  const total = scripts.reduce((a, s) => a + wordsOf(s.text).length, 0);
  $('#lib-greeting').textContent = greeting();
  $('#lib-summary').textContent = `Сценариев: ${scripts.length} · ≈ ${fmtDur(readSec(total))} чтения`;
  const empty = scripts.length === 0;
  $('#empty').classList.toggle('hidden', !empty);
  $('#library').classList.toggle('hidden', empty);
  $('#home-scroll').classList.toggle('is-empty', empty);
  $('#home-bottom').classList.toggle('hidden', empty);
  $('#search-empty').classList.toggle('hidden', !(shown.length === 0 && !empty));
}
$('#search').addEventListener('input', renderLibrary);
$('#home-scroll').addEventListener('scroll', (e) => {
  if (!scripts.length) return;
  $('#home-nav-title').classList.toggle('show', e.target.scrollTop > 36);
}, { passive: true });

async function createScript(text = '', title = '') {
  const s = { id: uid(), title, text, createdAt: Date.now(), updatedAt: Date.now() };
  await db.put('scripts', s);
  scripts.unshift(s);
  renderLibrary();
  openEditor(s.id, !text);
}
async function pasteScript() {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return toast('Буфер обмена пуст');
    createScript(text, titleFrom(text));
  } catch { toast('Не удалось прочитать буфер обмена'); }
}
$('#btn-new').addEventListener('click', () => createScript());
$('#btn-create-first').addEventListener('click', () => createScript());
$('#btn-paste').addEventListener('click', pasteScript);
$('#btn-import-file').addEventListener('click', () => $('#file-text').click());
$('#file-text').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const text = (await f.text()).trim();
  createScript(text, f.name.replace(/\.[^.]+$/, ''));
});
$('#btn-add').addEventListener('click', (e) => showMenu(e.currentTarget, [
  { label: 'Новый сценарий', icon: 'compose', action: () => createScript() },
  { label: 'Вставить из буфера', icon: 'paste', action: pasteScript },
  { label: 'Импорт из файла', icon: 'docplus', action: () => $('#file-text').click() },
]));
$('#btn-settings').addEventListener('click', () => { syncSettingsUI(); openSheet($('#sheet-settings')); });
$('#btn-recordings').addEventListener('click', async () => { await renderRecordings(); openSheet($('#sheet-recordings')); });

/* ================= Редактор ================= */
let current = null, saveTimer = null;
function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
function openEditor(id, focus) {
  current = scripts.find((s) => s.id === id);
  if (!current) return;
  current.lastOpenedAt = Date.now();
  db.put('scripts', current);
  $('#ed-title').value = current.title;
  $('#ed-text').value = current.text;
  $('#ed-scroll').scrollTop = 0;
  push($('#editor'));
  requestAnimationFrame(() => { autosize($('#ed-title')); autosize($('#ed-text')); });
  updateStats();
  if (focus) setTimeout(() => $('#ed-text').focus(), 420);
}
function updateStats() {
  const n = wordsOf($('#ed-text').value).length;
  const sec = readSec(n);
  const limits = [30, 60, 90, 180, 300, 600, 900, 1800, 3600];
  const limit = limits.find((l) => l >= Math.max(sec, 1)) || sec;
  $('#st-words').textContent = wordsLabel(n);
  $('#st-time').textContent = '≈ ' + fmtDur(sec);
  $('#st-limit').textContent = fmtDur(limit);
  $('#st-bar').style.width = Math.min(100, sec / limit * 100) + '%';
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveCurrent, 600); }
async function saveCurrent() {
  clearTimeout(saveTimer);
  if (!current) return;
  const title = $('#ed-title').value.replace(/\n/g, ' ').trim();
  const text = $('#ed-text').value;
  if (title === current.title && text === current.text) return;
  current.title = title; current.text = text; current.updatedAt = Date.now();
  await db.put('scripts', current);
}
$('#ed-title').addEventListener('input', (e) => { autosize(e.target); scheduleSave(); });
$('#ed-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#ed-text').focus(); } });
$('#ed-text').addEventListener('input', (e) => { autosize(e.target); updateStats(); scheduleSave(); });
$('#ed-scroll').addEventListener('scroll', (e) => {
  $('#ed-nav-title').textContent = $('#ed-title').value || 'Без названия';
  $('#ed-nav-title').classList.toggle('show', e.target.scrollTop > 40);
}, { passive: true });
async function closeEditor() {
  if (!current) return;
  document.activeElement?.blur();
  if (!$('#ed-title').value.trim() && $('#ed-text').value.trim()) $('#ed-title').value = titleFrom($('#ed-text').value);
  await saveCurrent();
  if (!current.text.trim() && !current.title.trim()) await db.del('scripts', current.id);
  current = null;
  pop();
  loadScripts();
}
$('#ed-back').addEventListener('click', closeEditor);
$('#editor').addEventListener('swipeback', closeEditor);
$('#ed-more').addEventListener('click', (e) => showMenu(e.currentTarget, [
  { label: 'Поделиться', icon: 'share', action: async () => {
    await saveCurrent();
    try { await navigator.share({ title: displayTitle(current), text: current.text }); } catch {}
  } },
  { label: 'Вставить из буфера', icon: 'paste', action: async () => {
    try {
      const t = await navigator.clipboard.readText();
      const ta = $('#ed-text');
      ta.value = ta.value ? ta.value.replace(/\s*$/, '\n\n') + t : t;
      autosize(ta); updateStats(); scheduleSave();
    } catch { toast('Не удалось прочитать буфер обмена'); }
  } },
  { label: 'Убрать лишние пробелы и пустые строки', icon: 'words', action: () => {
    const ta = $('#ed-text');
    ta.value = ta.value.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
    autosize(ta); updateStats(); scheduleSave();
  } },
  '-',
  { label: 'Удалить', icon: 'trash', danger: true, action: async () => {
    if (!confirm('Удалить сценарий? Это нельзя отменить.')) return;
    await db.del('scripts', current.id);
    current = null; pop(); loadScripts();
  } },
]));
function needText() {
  if (!$('#ed-text').value.trim()) { $('#ed-text').focus(); return true; }
  return false;
}
$('#ed-prompter').addEventListener('click', async () => { if (needText()) return; await saveCurrent(); openRec(current, false); });
$('#ed-record').addEventListener('click', async () => { if (needText()) return; await saveCurrent(); openRec(current, true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveCurrent(); });

/* ================= Экран съёмки и суфлёра ================= */
const P = {
  script: null, camera: false, stream: null, micStream: null, facing: 'user',
  offset: 0, playing: false, words: [], wordEls: [], cur: 0, target: null,
  vel: 0, dragging: false, lastFrame: 0, raf: 0, voiceSpeed: 0,
  audioCtx: null, analyser: null, buf: null, speakingUntil: 0,
  rec: null, recActive: false,
  recorder: null, chunks: [], recStart: 0, recPausedAt: 0, recPausedTotal: 0, recTimer: 0, mime: '', counting: false, countTimer: 0,
  wakeLock: null,
};
const MODES = {
  manual: { title: 'Ручной', icon: 'gauge', hint: 'Текст едет с постоянной скоростью, которую вы выбрали.' },
  voice: { title: 'Голос', icon: 'wave', hint: 'Текст едет, пока вы говорите, и плавно останавливается в паузах.' },
  follow: { title: 'Слежение', icon: 'follow', hint: 'Текст следует за словами, которые вы произносите.' },
};
const isRecording = () => P.recorder && P.recorder.state !== 'inactive';
function normWord(w) { return w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, ''); }

function renderPrompterText(text) {
  const box = $('#pr-text');
  box.innerHTML = '';
  P.words = []; P.wordEls = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isH = /^#+\s*/.test(line);
    const el = document.createElement(isH ? 'h2' : 'p');
    line.replace(/^#+\s*/, '').split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { el.appendChild(document.createTextNode(' ')); return; }
      const sp = document.createElement('span');
      sp.className = 'w'; sp.textContent = tok;
      const norm = normWord(tok);
      if (norm) { P.words.push(norm); P.wordEls.push(sp); }
      el.appendChild(sp);
    });
    box.appendChild(el);
  }
}

function areaPx() { return Math.round(innerHeight * prefs.area / 100); }
function layoutRec() {
  const top = Math.round($('#rec .rec-nav').getBoundingClientRect().bottom + 4);
  const bottomTop = $('#rec .rec-bottom').getBoundingClientRect().top;
  // Без камеры текст занимает весь экран между панелями
  const areaBottom = P.camera ? Math.min(areaPx(), bottomTop - 10) : bottomTop - 6;
  const vp = $('#pr-viewport');
  vp.style.top = top + 'px';
  vp.style.height = Math.max(140, areaBottom - top) + 'px';
  $('#pr-handle').style.top = (areaBottom - 6) + 'px';
  const t = $('#pr-text');
  t.style.fontSize = prefs.font + 'px';
  t.style.paddingBottom = (areaBottom - top) + 'px';
  // Затемнение: сверху под текстом и плавно исчезает ниже; внизу лёгкая тень под кнопками
  const h = innerHeight, e = Math.min(1, (areaBottom + 40) / h);
  $('#rec-shade').style.background = P.camera
    ? `linear-gradient(rgba(0,0,0,.66) 0%, rgba(0,0,0,.55) ${(areaBottom / h * 100 * 0.8).toFixed(1)}%, rgba(0,0,0,0) ${(e * 100).toFixed(1)}%, rgba(0,0,0,0) 72%, rgba(0,0,0,.35) 100%)`
    : 'none';
  applyOffset();
}
const lineY = () => Math.round(prefs.font * 0.4);
function maxOffset() { return Math.max(0, $('#pr-text').scrollHeight - $('#pr-viewport').clientHeight); }
function applyOffset() {
  P.offset = Math.min(Math.max(P.offset, 0), maxOffset());
  $('#pr-text').style.transform = `translate3d(0,${lineY() - P.offset}px,0)` + (prefs.mirror ? ' scaleX(-1)' : '');
}

async function openRec(script, withCamera) {
  Object.assign(P, { script, camera: withCamera, offset: 0, cur: 0, playing: false, target: null, vel: 0, voiceSpeed: 0 });
  renderPrompterText(script.text);
  const r = $('#rec');
  r.classList.toggle('no-camera', !withCamera);
  $('#tp-text').textContent = displayTitle(script);
  $('#rec-btn').classList.toggle('hidden', !withCamera);
  $('#play-btn').classList.toggle('hidden', withCamera);
  $('#cam').classList.remove('ready');
  banner('');
  push(r);
  setMode(prefs.mode, true);
  updateDock();
  requestAnimationFrame(layoutRec);
  requestWakeLock();
  cancelAnimationFrame(P.raf);
  P.lastFrame = performance.now();
  P.raf = requestAnimationFrame(tick);
  if (withCamera) startCamera();
}
async function startCamera() {
  stopStreams();
  const H = parseInt(prefs.res, 10), W = Math.round(H * 16 / 9);
  try {
    P.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: P.facing, width: { ideal: W }, height: { ideal: H }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const v = $('#cam');
    v.srcObject = P.stream;
    v.classList.toggle('mirror', P.facing === 'user');
    v.onloadeddata = () => v.classList.add('ready');
    await v.play().catch(() => {});
    banner('');
  } catch (e) {
    banner('Нет доступа к камере. Разрешите камеру и микрофон: «aA» в адресной строке Safari → «Настройки веб-сайта». Пока можно репетировать с суфлёром.');
  }
}
function stopStreams() {
  if (P.stream) { P.stream.getTracks().forEach((t) => t.stop()); P.stream = null; }
  if (P.micStream) { P.micStream.getTracks().forEach((t) => t.stop()); P.micStream = null; }
  if (P.audioCtx) { P.audioCtx.close().catch(() => {}); P.audioCtx = null; P.analyser = null; }
}
async function closeRec() {
  if (P.counting) cancelCountdown();
  if (isRecording()) await stopRecording(false);
  stopFollow();
  P.playing = false;
  cancelAnimationFrame(P.raf);
  stopStreams();
  $('#cam').srcObject = null;
  releaseWakeLock();
  pop();
}
$('#rec-back').addEventListener('click', closeRec);
$('#rec').addEventListener('swipeback', closeRec);
function banner(t) { $('#rec-banner').textContent = t; $('#rec-banner').classList.toggle('hidden', !t); requestAnimationFrame(layoutRec); }

/* --- режимы и подписи --- */
function setMode(m, silent) {
  if (P.mode === 'follow' && m !== 'follow') stopFollow();
  P.mode = m; prefs.mode = m; savePrefs();
  $('#rec').classList.toggle('follow', m === 'follow');
  P.wordEls.forEach((el) => el.classList.remove('read', 'cur'));
  $('#chip-mode-icon').innerHTML = `<use href="#i-${MODES[m].icon}"/>`;
  $('#chip-mode-text').textContent = MODES[m].title;
  $('#chip-speed').classList.toggle('hidden', m === 'follow');
  $$('#ctl-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  $('#ctl-hint').textContent = MODES[m].hint;
  $('#ctl-speed-wrap').classList.toggle('hidden', m === 'follow');
  if (!silent && P.playing) startPlaying();
  updateDock();
  syncSettingsUI();
}
function updateChips() {
  $('#chip-speed-text').textContent = prefs.speed;
  $('#chip-size-text').textContent = 'Aa ' + prefs.font;
}
function updateDock() {
  const rec = isRecording(), paused = rec && P.recorder.state === 'paused';
  let li, ll;
  if (!P.camera) { li = 'restart'; ll = 'С начала'; }
  else if (rec) { li = paused ? 'play' : 'pause'; ll = paused ? 'Продолжить' : 'Пауза'; }
  else if (P.mode === 'follow') { li = MODES.follow.icon; ll = 'Режим'; }
  else { li = P.playing ? 'pause' : 'play'; ll = P.playing ? 'Пауза' : 'Текст'; }
  $('#dock-left-icon').innerHTML = `<use href="#i-${li}"/>`;
  $('#dock-left-label').textContent = ll;
  if (P.camera) {
    $('#dock-right-icon').innerHTML = '<use href="#i-camflip"/>';
    $('#dock-right-label').textContent = 'Камера';
    $('#dock-right').style.opacity = rec ? .35 : 1;
  } else {
    $('#dock-right-icon').innerHTML = `<use href="#i-${MODES[P.mode].icon}"/>`;
    $('#dock-right-label').textContent = 'Режим';
    $('#dock-right').style.opacity = 1;
  }
  $('#rec-btn').classList.toggle('on', rec || P.counting);
  $('#rec-label').textContent = !P.camera ? (P.playing ? 'Пауза' : 'Старт') : P.counting ? 'Отменить' : rec ? 'Стоп' : 'Запись';
  $('#play-btn-icon').innerHTML = `<use href="#i-${P.playing ? 'pause' : 'play'}"/>`;
  $('#rec').dataset.noswipe = rec || P.counting ? '1' : '';
  $('#rec-back').style.visibility = rec || P.counting ? 'hidden' : '';
  updateChips();
}
$('#dock-left').addEventListener('click', () => {
  if (!P.camera) return restartText();
  if (isRecording()) {
    if (P.recorder.state === 'recording') { P.recorder.pause(); P.recPausedAt = Date.now(); stopPlaying(); }
    else { P.recorder.resume(); P.recPausedTotal += Date.now() - P.recPausedAt; startPlaying(); }
    updateDock(); updateTitlePill(); return;
  }
  if (P.mode === 'follow') return openControls();
  P.playing ? stopPlaying() : startPlaying();
});
$('#dock-right').addEventListener('click', async () => {
  if (!P.camera) return openControls();
  if (isRecording()) return;
  P.facing = P.facing === 'user' ? 'environment' : 'user';
  $('#cam').classList.remove('ready');
  await startCamera();
});
$('#play-btn').addEventListener('click', () => (P.playing ? stopPlaying() : startPlaying()));
function restartText() {
  P.offset = 0; P.cur = 0; P.target = null; P.vel = 0;
  P.wordEls.forEach((el) => el.classList.remove('read', 'cur'));
  applyOffset();
}
$('#rec-more').addEventListener('click', (e) => showMenu(e.currentTarget, [
  { label: 'Настройки суфлёра', icon: 'sliders', action: openControls },
  { label: 'С начала текста', icon: 'restart', action: restartText },
  { label: 'Зеркальный текст', checked: prefs.mirror, icon: 'mirror', action: () => { prefs.mirror = !prefs.mirror; savePrefs(); applyOffset(); syncSettingsUI(); } },
  '-',
  { label: 'Все настройки', icon: 'gear', action: () => { syncSettingsUI(); openSheet($('#sheet-settings')); } },
], { dark: true }));
['#chip-mode', '#chip-speed', '#chip-size'].forEach((s) => $(s).addEventListener('click', openControls));

async function startPlaying() {
  P.playing = true;
  updateDock();
  if (P.mode === 'voice') await ensureMicAnalyser();
  if (P.mode === 'follow') startFollow(); else stopFollow();
}
function stopPlaying() { P.playing = false; stopFollow(); updateDock(); }

/* --- шторка «Настройки суфлёра» --- */
function openControls() {
  syncControls();
  openSheet($('#sheet-controls'));
}
function syncControls() {
  $('#c-speed').value = prefs.speed; $('#c-speed-v').textContent = prefs.speed;
  $('#c-font').value = prefs.font; $('#c-font-v').textContent = prefs.font;
  $$('#c-lang button').forEach((b) => b.classList.toggle('on', b.dataset.v === prefs.lang));
  $$('#sheet-controls .ios-range').forEach(setRangeFill);
}
$$('#ctl-mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.v)));
$('#c-speed').addEventListener('input', (e) => { prefs.speed = +e.target.value; savePrefs(); syncControls(); updateChips(); });
$('#c-font').addEventListener('input', (e) => { prefs.font = +e.target.value; savePrefs(); syncControls(); updateChips(); layoutRec(); });
$$('#c-lang button').forEach((b) => b.addEventListener('click', () => {
  prefs.lang = b.dataset.v; savePrefs(); syncControls();
  if (P.recActive) { stopFollow(); startFollow(); }
}));

/* --- главный цикл прокрутки --- */
function tick(now) {
  const dt = Math.min(0.05, (now - P.lastFrame) / 1000);
  P.lastFrame = now;
  if (!P.dragging) {
    if (Math.abs(P.vel) > 5) { P.offset += P.vel * dt; P.vel *= Math.pow(0.04, dt); } else P.vel = 0;
    if (P.playing && P.vel === 0 && !P.counting) {
      if (P.mode === 'manual') P.offset += prefs.speed * dt;
      else if (P.mode === 'voice') {
        const speaking = isSpeaking(now);
        $('#chip-mode').classList.toggle('speaking', speaking);
        P.voiceSpeed += ((speaking ? prefs.speed : 0) - P.voiceSpeed) * Math.min(1, dt * (speaking ? 6 : 3));
        P.offset += P.voiceSpeed * dt;
      } else if (P.mode === 'follow' && P.target != null) {
        P.offset += (P.target - P.offset) * Math.min(1, dt * 2.5);
      }
    }
    applyOffset();
  }
  P.raf = requestAnimationFrame(tick);
}

/* --- пальцем: прокрутка с инерцией; двумя пальцами — размер текста --- */
(function touchScroll() {
  const vp = $('#pr-viewport');
  let y0 = 0, last = 0, lastT = 0, samples = [];
  vp.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    P.dragging = true; P.vel = 0; y0 = last = e.clientY; lastT = performance.now(); samples = [];
    vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener('pointermove', (e) => {
    if (!P.dragging || !e.isPrimary) return;
    const dy = e.clientY - last; last = e.clientY;
    P.offset -= dy; applyOffset();
    const t = performance.now(); samples.push([t, -dy / Math.max(1, t - lastT) * 1000]); lastT = t;
    if (samples.length > 5) samples.shift();
  });
  const end = () => {
    if (!P.dragging) return;
    P.dragging = false;
    const recent = samples.filter((s) => performance.now() - s[0] < 100);
    P.vel = recent.length ? recent.reduce((a, s) => a + s[1], 0) / recent.length : 0;
    if (P.mode === 'follow' && Math.abs(last - y0) > 6) { P.target = null; resyncCurFromOffset(); }
  };
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', end);

  let d0 = 0, f0 = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  $('#rec').addEventListener('touchstart', (e) => { if (e.touches.length === 2) { P.dragging = false; d0 = dist(e.touches); f0 = prefs.font; } }, { passive: true });
  $('#rec').addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && d0) { prefs.font = Math.round(Math.min(96, Math.max(20, f0 * dist(e.touches) / d0))); updateChips(); layoutRec(); }
  }, { passive: true });
  $('#rec').addEventListener('touchend', (e) => { if (d0 && e.touches.length < 2) { d0 = 0; savePrefs(); } });

  // Ручка под текстом меняет высоту области текста
  const h = $('#pr-handle');
  let dragH = false;
  h.addEventListener('pointerdown', (e) => { dragH = true; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointermove', (e) => {
    if (!dragH) return;
    prefs.area = Math.round(Math.min(100, Math.max(25, e.clientY / innerHeight * 100)));
    layoutRec();
  });
  h.addEventListener('pointerup', () => { dragH = false; savePrefs(); });
})();
addEventListener('resize', () => { if ($('#rec').classList.contains('open')) layoutRec(); });

/* ================= «Голос»: громкость микрофона ================= */
async function ensureMicAnalyser() {
  if (P.analyser) return;
  try {
    let stream = P.stream && P.stream.getAudioTracks().length ? P.stream : null;
    if (!stream) { P.micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream = P.micStream; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    P.audioCtx = new Ctx();
    await P.audioCtx.resume().catch(() => {});
    const src = P.audioCtx.createMediaStreamSource(stream);
    P.analyser = P.audioCtx.createAnalyser();
    P.analyser.fftSize = 1024;
    src.connect(P.analyser);
    P.buf = new Float32Array(P.analyser.fftSize);
  } catch { banner('Нет доступа к микрофону. Разрешите его в настройках Safari.'); }
}
function isSpeaking(now) {
  if (!P.analyser) return false;
  P.analyser.getFloatTimeDomainData(P.buf);
  let sum = 0; for (let i = 0; i < P.buf.length; i++) sum += P.buf[i] * P.buf[i];
  const level = 20 * Math.log10(Math.sqrt(sum / P.buf.length) + 1e-8);
  if (level > -20 - (prefs.sens / 100) * 30) P.speakingUntil = now + 450;
  return now < P.speakingUntil;
}

/* ================= «Слежение»: распознавание речи ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function startFollow() {
  if (!SR) { banner('Этот браузер не умеет распознавать речь. Выберите режим «Голос».'); return; }
  if (P.recActive) return;
  P.recActive = true;
  const r = new SR();
  r.lang = prefs.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onresult = (ev) => {
    const parts = [];
    for (let i = 0; i < ev.results.length; i++) parts.push(ev.results[i][0].transcript);
    const heard = parts.join(' ').split(/\s+/).map(normWord).filter(Boolean);
    $('#chip-mode').classList.add('speaking');
    clearTimeout(P.speakT); P.speakT = setTimeout(() => $('#chip-mode').classList.remove('speaking'), 600);
    matchHeard(heard.slice(-6));
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      banner('Распознавание речи выключено. Включите Siri и диктовку в Настройках iPhone и разрешите микрофон.');
      P.recActive = false;
    } else if (e.error === 'audio-capture') {
      banner('Микрофон занят записью видео. Во время записи на этом iPhone лучше режим «Голос».');
    } else if (e.error === 'network') {
      banner('Для «Слежения» нужен интернет.');
    }
  };
  r.onend = () => { if (P.recActive) setTimeout(() => { try { r.start(); } catch {} }, 150); };
  P.rec = r;
  try { r.start(); } catch { banner('Не удалось включить распознавание речи.'); }
}
function stopFollow() {
  P.recActive = false;
  if (P.rec) { try { P.rec.onend = null; P.rec.abort(); } catch {} P.rec = null; }
}
const same = (a, b) => a === b || (a.length > 3 && b.length > 3 && a.slice(0, 4) === b.slice(0, 4));
function matchHeard(tail) {
  if (!tail.length || !P.words.length) return;
  const N = tail.length;
  let best = -1, bestScore = 0, bestDist = 1e9;
  const from = Math.max(0, P.cur - 3), to = Math.min(P.words.length - 1, P.cur + 30);
  for (let j = from; j <= to; j++) {
    let score = 0;
    for (let k = 0; k < N && j - k >= 0; k++) if (same(P.words[j - k], tail[N - 1 - k])) score += k === 0 ? 1.5 : 1;
    const dist = Math.abs(j - P.cur);
    if (score > bestScore || (score === bestScore && dist < bestDist)) { best = j; bestScore = score; bestDist = dist; }
  }
  const lastLong = tail[N - 1].length >= 5;
  const ok = bestScore >= 2.5 || (bestScore >= 1.5 && lastLong && best - P.cur <= 4 && best >= P.cur - 1);
  if (!ok || best + 1 < P.cur) return;
  setCur(best + 1);
}
function setCur(i) {
  for (let k = Math.min(P.cur, i) - 1; k < Math.max(P.cur, i) + 1; k++) {
    const el = P.wordEls[k]; if (!el) continue;
    el.classList.toggle('read', k < i - 1);
    el.classList.toggle('cur', k === i - 1);
  }
  P.cur = i;
  const el = P.wordEls[Math.max(0, i - 1)];
  if (el) P.target = el.getBoundingClientRect().top - $('#pr-text').getBoundingClientRect().top;
}
function resyncCurFromOffset() {
  const box = $('#pr-text').getBoundingClientRect().top;
  let i = 0;
  while (i < P.wordEls.length && P.wordEls[i].getBoundingClientRect().top - box < P.offset) i++;
  P.wordEls.forEach((el, k) => { el.classList.toggle('read', k < i); el.classList.remove('cur'); });
  P.cur = i;
}

/* ================= Запись видео ================= */
function pickMime() {
  if (!window.MediaRecorder) return null;
  const list = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return list.find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
}
$('#rec-btn').addEventListener('click', async () => {
  if (P.counting) return cancelCountdown();
  if (isRecording()) return stopRecording(true);
  if (!P.stream) { await startCamera(); if (!P.stream) return; }
  const mime = pickMime();
  if (mime === null) return toast('Этот браузер не умеет записывать видео');
  restartText();
  if (prefs.countdown > 0) { const ok = await countdown(prefs.countdown); if (!ok) return; }
  startRecording(mime);
});
function countdown(n) {
  P.counting = true; updateDock();
  const el = $('#pr-countdown');
  el.classList.remove('hidden');
  return new Promise((res) => {
    P.countResolve = res;
    const step = () => {
      if (!P.counting) return;
      if (n === 0) { el.classList.add('hidden'); P.counting = false; return res(true); }
      el.textContent = n; n--; P.countTimer = setTimeout(step, 1000);
    };
    step();
  });
}
function cancelCountdown() {
  clearTimeout(P.countTimer); P.counting = false;
  $('#pr-countdown').classList.add('hidden');
  P.countResolve && P.countResolve(false);
  updateDock();
}
function startRecording(mime) {
  P.chunks = [];
  const bps = prefs.res === '2160' ? 35e6 : prefs.res === '1080' ? 12e6 : 6e6;
  try { P.recorder = new MediaRecorder(P.stream, mime ? { mimeType: mime, videoBitsPerSecond: bps } : undefined); }
  catch { P.recorder = new MediaRecorder(P.stream); }
  P.mime = P.recorder.mimeType || mime || 'video/mp4';
  P.recorder.ondataavailable = (e) => { if (e.data && e.data.size) P.chunks.push(e.data); };
  P.recorder.start(1000);
  P.recStart = Date.now(); P.recPausedTotal = 0;
  P.recTimer = setInterval(updateTitlePill, 250);
  updateTitlePill();
  startPlaying();
}
function elapsed() {
  const pausedNow = P.recorder && P.recorder.state === 'paused' ? Date.now() - P.recPausedAt : 0;
  return (Date.now() - P.recStart - P.recPausedTotal - pausedNow) / 1000;
}
function updateTitlePill() {
  const tp = $('#title-pill');
  if (isRecording()) {
    const paused = P.recorder.state === 'paused';
    tp.innerHTML = `<i class="rdot" style="${paused ? 'background:#fff' : ''}"></i><span>${fmtClock2(elapsed())}${paused ? ' <span style="opacity:.7">Пауза</span>' : ''}</span>`;
  } else tp.innerHTML = `<span id="tp-text">${esc(displayTitle(P.script))}</span>`;
}
function stopRecording(openAfter) {
  return new Promise((res) => {
    const r = P.recorder;
    if (!r || r.state === 'inactive') return res();
    const duration = elapsed();
    r.onstop = async () => {
      clearInterval(P.recTimer);
      P.recorder = null;
      stopPlaying();
      updateTitlePill();
      const blob = new Blob(P.chunks, { type: P.mime.split(';')[0] });
      P.chunks = [];
      const rec = { id: uid(), scriptId: P.script.id, title: displayTitle(P.script), createdAt: Date.now(), duration,
        mime: blob.type, size: blob.size, blob, mirrored: P.facing === 'user' };
      try { await db.put('recordings', rec); }
      catch { toast('Не хватило места для видео. Удалите старые записи.'); return res(); }
      res();
      if (openAfter) openPlayer(rec);
    };
    r.stop();
  });
}

/* ================= Записи ================= */
const thumbUrls = [];
async function renderRecordings() {
  thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const recs = ((await db.all('recordings')) || []).sort((a, b) => b.createdAt - a.createdAt);
  const grid = $('#rec-grid');
  grid.innerHTML = '';
  let lastDay = '', box = null;
  for (const r of recs) {
    const day = dayLabel(r.createdAt);
    if (day !== lastDay) {
      grid.insertAdjacentHTML('beforeend', `<p class="rec-day">${esc(day)}</p>`);
      box = document.createElement('div'); box.className = 'rec-grid'; grid.appendChild(box); lastDay = day;
    }
    const u = URL.createObjectURL(r.blob); thumbUrls.push(u);
    const b = document.createElement('button');
    b.className = 'take';
    b.innerHTML = `<div class="thumb"><video muted playsinline preload="metadata" src="${u}#t=0.1"></video><span class="dur">${fmtClock(r.duration)}</span></div>
      <b>${esc(r.title)}</b><small>${timeLabel(r.createdAt)} · ${fmtSize(r.size)}</small>`;
    b.addEventListener('click', () => openPlayer(r));
    box.appendChild(b);
  }
  const total = recs.reduce((a, r) => a + r.size, 0);
  $('#rec-summary').textContent = recs.length ? `${recs.length} ${plural(recs.length, 'дубль', 'дубля', 'дублей')} · ${fmtSize(total)}` : '';
  $('#rec-empty').classList.toggle('hidden', recs.length > 0);
}

/* --- просмотр дубля --- */
let playing = null, playerUrl = null;
function openPlayer(rec) {
  playing = rec;
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(rec.blob);
  const v = $('#pl-video');
  v.src = playerUrl;
  v.classList.toggle('mirror', false);
  $('#pl-title').textContent = rec.title;
  if (openSheets.length) while (openSheets.length) closeSheet();
  push($('#player'));
  v.play().catch(() => {});
}
function closePlayer() {
  const v = $('#pl-video'); v.pause(); v.removeAttribute('src'); v.load();
  pop();
  renderRecordings();
}
$('#pl-back').addEventListener('click', closePlayer);
$('#player').addEventListener('swipeback', closePlayer);
$('#pl-play').addEventListener('click', () => { const v = $('#pl-video'); v.paused ? v.play() : v.pause(); });
(() => {
  const v = $('#pl-video'), seek = $('#pl-seek');
  const sync = () => {
    $('#pl-play-icon').innerHTML = `<use href="#i-${v.paused ? 'play' : 'pause'}"/>`;
    const d = isFinite(v.duration) ? v.duration : (playing ? playing.duration : 0);
    $('#pl-cur').textContent = fmtClock(v.currentTime); $('#pl-dur').textContent = fmtClock(d);
    if (!seek.dragging) { seek.value = d ? v.currentTime / d * 1000 : 0; seek.style.setProperty('--p', seek.value / 10 + '%'); }
  };
  ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended'].forEach((ev) => v.addEventListener(ev, sync));
  seek.addEventListener('input', () => {
    seek.dragging = true;
    const d = isFinite(v.duration) ? v.duration : playing.duration;
    v.currentTime = seek.value / 1000 * d; seek.style.setProperty('--p', seek.value / 10 + '%');
  });
  seek.addEventListener('change', () => { seek.dragging = false; });
  v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
})();
$('#pl-delete').addEventListener('click', async () => {
  if (!playing || !confirm('Удалить этот дубль?')) return;
  await db.del('recordings', playing.id);
  playing = null; closePlayer();
});
$('#pl-share').addEventListener('click', async () => {
  if (!playing) return;
  const ext = playing.mime.includes('webm') ? 'webm' : 'mp4';
  const name = `${playing.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || 'Readline'} ${new Date(playing.createdAt).toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}.${ext}`;
  await shareFile(new File([playing.blob], name, { type: playing.mime }));
});

/* ================= Экран не гаснет во время съёмки ================= */
async function requestWakeLock() { try { P.wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWakeLock() { try { P.wakeLock?.release(); } catch {} P.wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#rec').classList.contains('open')) requestWakeLock(); });

/* ================= Настройки ================= */
const THEME_NAMES = { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' };
function syncSettingsUI() {
  $('#theme-val').textContent = THEME_NAMES[prefs.theme];
  $$('#theme-list .srow').forEach((b) => b.classList.toggle('on', b.dataset.theme === prefs.theme));
  $$('#res-list .srow').forEach((b) => b.classList.toggle('on', b.dataset.res === prefs.res));
  $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === prefs.mode));
  $$('#seg-lang button').forEach((b) => b.classList.toggle('on', b.dataset.v === prefs.lang));
  $$('#seg-countdown button').forEach((b) => b.classList.toggle('on', +b.dataset.v === prefs.countdown));
  $('#s-font').value = prefs.font; $('#v-font').textContent = prefs.font;
  $('#s-area').value = prefs.area; $('#v-area').textContent = prefs.area + '%';
  $('#s-speed').value = prefs.speed; $('#v-speed').textContent = prefs.speed;
  $('#s-sens').value = prefs.sens; $('#v-sens').textContent = prefs.sens + '%';
  $('#s-mirror').checked = prefs.mirror;
  $$('#sheet-settings .ios-range').forEach(setRangeFill);
  $('#backup-sub').textContent = prefs.lastBackup
    ? 'Сохранена: ' + new Date(prefs.lastBackup).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Ещё не создавалась';
}
// Переходы внутри шторки настроек
$$('#sheet-settings [data-page]').forEach((b) => b.addEventListener('click', () => {
  syncSettingsUI();
  $('#sp-home').classList.add('behind');
  $('#' + b.dataset.page).classList.add('open');
}));
function settingsBack() {
  $$('#sheet-settings .sheet-page.sub.open').forEach((p) => p.classList.remove('open'));
  $('#sp-home').classList.remove('behind');
}
$$('#sheet-settings [data-back]').forEach((b) => b.addEventListener('click', settingsBack));
$('#sheet-settings').addEventListener('closed', () => setTimeout(settingsBack, 500));
$('#sp-home .sheet-scroll').addEventListener('scroll', (e) => {
  $('#sp-home .nav-title').classList.toggle('show', e.target.scrollTop > 36);
}, { passive: true });
$('#sheet-recordings .sheet-scroll').addEventListener('scroll', (e) => {
  $('#sheet-recordings .nav-title').classList.toggle('show', e.target.scrollTop > 36);
}, { passive: true });

$$('#theme-list .srow').forEach((b) => b.addEventListener('click', () => { prefs.theme = b.dataset.theme; savePrefs(); applyTheme(); syncSettingsUI(); }));
$$('#res-list .srow').forEach((b) => b.addEventListener('click', () => { prefs.res = b.dataset.res; savePrefs(); syncSettingsUI(); }));
$$('#sheet-settings [data-mode]').forEach((b) => b.addEventListener('click', () => { prefs.mode = b.dataset.mode; savePrefs(); syncSettingsUI(); if ($('#rec').classList.contains('open')) setMode(prefs.mode); }));
$$('#seg-lang button').forEach((b) => b.addEventListener('click', () => { prefs.lang = b.dataset.v; savePrefs(); syncSettingsUI(); }));
$$('#seg-countdown button').forEach((b) => b.addEventListener('click', () => { prefs.countdown = +b.dataset.v; savePrefs(); syncSettingsUI(); }));
[['s-font', 'font'], ['s-area', 'area'], ['s-speed', 'speed'], ['s-sens', 'sens']].forEach(([id, k]) => {
  $('#' + id).addEventListener('input', (e) => { prefs[k] = +e.target.value; savePrefs(); syncSettingsUI(); if ($('#rec').classList.contains('open')) { updateChips(); layoutRec(); } });
});
$('#s-mirror').addEventListener('change', (e) => { prefs.mirror = e.target.checked; savePrefs(); applyOffset(); });
$('#v-version').textContent = VERSION;
$('#install-state').textContent = isStandalone ? 'Readline уже установлен на экран «Домой».' : (isIOS ? 'Сейчас Readline открыт в Safari.' : 'На компьютере установите через меню браузера → «Установить приложение».');

/* --- резервная копия сценариев --- */
$('#btn-export').addEventListener('click', async () => {
  const data = JSON.stringify({ app: 'Readline', version: 1, exportedAt: new Date().toISOString(), scripts: await db.all('scripts') }, null, 2);
  const d = new Date();
  const name = `Readline ${d.toISOString().slice(0, 10)}.json`;
  if (await shareFile(new File([data], name, { type: 'application/json' }))) { prefs.lastBackup = Date.now(); savePrefs(); syncSettingsUI(); }
});
$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.scripts;
    if (!Array.isArray(list)) throw new Error();
    const existing = new Set(((await db.all('scripts')) || []).map((s) => s.id));
    let added = 0;
    for (const s of list) {
      if (!s || typeof s.text !== 'string') continue;
      const item = { id: s.id || uid(), title: String(s.title || ''), text: s.text, createdAt: s.createdAt || Date.now(), updatedAt: s.updatedAt || Date.now() };
      if (existing.has(item.id)) continue;
      await db.put('scripts', item); added++;
    }
    toast(`Добавлено сценариев: ${added}`);
    loadScripts();
  } catch { toast('Не получилось прочитать файл копии'); }
});

/* ================= Старт ================= */
(async function start() {
  syncSettingsUI();
  updateChips();
  try { navigator.storage?.persist?.(); } catch {}
  await loadScripts();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
