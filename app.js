/* واجهة تطبيق الحضور والانصراف */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'attendance_state_v1';
  const $ = id => document.getElementById(id);

  /* ======================= الحالة والحفظ ======================= */
  const clone = o => JSON.parse(JSON.stringify(o));
  function blank() {
    return {
      settings: clone(E.DEFAULT_SETTINGS), employees: {}, perms: {}, manual: {}, punches: [], names: {}, removed: {}, imports: [],
      view: { type: 'summary', emp: '' },
      backup: { freq: 'daily', day: 5, time: '23:00', keep: 10, last: '', init: 1 },
      notes: {}, reviewed: {}, remind: { on: true, time: '00:00' }, locked: {},
      device: { ip: '192.168.1.201', port: 4370, password: '', auto: true, lastPull: null }
    };
  }
  let S = blank();
  // البصمات بتتخزن مضغوطة: [كود، رقم اليوم، الدقيقة، النوع] بدل كائن كامل — بتوفر حوالي 60% من المساحة
  const TYPES = [null, 'in', 'out'];
  function packP(list) { return { v: 2, d: list.map(p => [p.id, E.dayNum(p.key), p.min, p.type === 'in' ? 1 : p.type === 'out' ? 2 : 0]) }; }
  function unpackP(x) { if (!x) return []; if (Array.isArray(x)) return x; if (x.v === 2) return x.d.map(a => ({ id: a[0], key: E.keyFromNum(a[1]), min: a[2], type: TYPES[a[3]] || null })); return []; }
  const serialize = () => JSON.stringify(Object.assign({}, S, { punches: packP(S.punches) }));
  try { const raw = localStorage.getItem(KEY); if (raw) { S = Object.assign(blank(), JSON.parse(raw)); S.punches = unpackP(S.punches); } } catch (e) { /* التخزين مش متاح */ }
  function normalize() {
    S.settings = Object.assign(clone(E.DEFAULT_SETTINGS), S.settings || {});
    S.backup = Object.assign(blank().backup, S.backup || {});
    if (!S.settings.v3) { // شيفت رمضان المقسوم + قاعدة الجمعة ورمضان
      if (!S.settings.shifts.some(x => x.id === 'r')) S.settings.shifts.push(clone(E.DEFAULT_SETTINGS.shifts.find(x => x.id === 'r')));
      if (!Array.isArray(S.settings.rules)) S.settings.rules = clone(E.DEFAULT_SETTINGS.rules);
      if (S.settings.hoursGrace == null) S.settings.hoursGrace = 10;
      S.settings.v3 = 1;
    }
    if (!S.backup.init) { S.backup.freq = 'daily'; S.backup.init = 1; } // النسخة التلقائية اليومية شغالة من الأول
    S.view = Object.assign(blank().view, S.view || {});
    S.notes = S.notes || {}; S.reviewed = S.reviewed || {}; S.locked = S.locked || {}; S.settings.holidays = S.settings.holidays || [];
    S.remind = Object.assign(blank().remind, S.remind || {});
    // النسخة الأولى كانت بتحفظ آخر ملف بس — نحوّله لسجل البصمات المتجمع
    if (S.data) { mergePunches(S.data.punches || []); Object.assign(S.names, S.data.names || {}); delete S.data; delete S.fileName; delete S.range; }
    for (const id in S.employees) if (S.employees[id].hidden) { S.removed[id] = true; delete S.employees[id]; }
    // بداية الحساب: أول يوم في شهر تشغيل الجهاز — مفيش أي شهر قبله يظهر
    if (!S.settings.startFrom) S.settings.startFrom = (S.settings.deviceFrom || todayKey()).slice(0, 7) + '-01';
    S.device = Object.assign(blank().device, S.device || {});
    clampToStart();
  }
  /** أي موظف تاريخ بدايته قبل بداية الحساب يتظبط عليها، والشهور المقفولة القديمة تتشال */
  function clampToStart(oldStart) {
    const sf = S.settings.startFrom; if (!sf) return;
    for (const id in S.employees) { const e = S.employees[id]; if (!e.start || e.start < sf || (oldStart && e.start === oldStart)) e.start = sf; }
    for (const m in S.locked) if (m < sf.slice(0, 7)) delete S.locked[m];
  }
  let PV = 0; // نسخة البصمات — بتزيد لما بصمات تتضاف أو تتمسح
  function mergePunches(list) {
    const seen = new Set(S.punches.map(p => `${p.id}|${p.key}|${p.min}|${p.type || ''}`)); let added = 0;
    for (const p of list) { const k = `${p.id}|${p.key}|${p.min}|${p.type || ''}`; if (!seen.has(k)) { seen.add(k); S.punches.push({ id: p.id, key: p.key, min: p.min, type: p.type || null }); added++; } }
    if (added) PV++;
    return added;
  }
  let DV = 0; // رقم نسخة البيانات — بيزيد مع كل حفظ عشان الحسابات المحفوظة تتعاد
  function save() { DV++; try { localStorage.setItem(KEY, serialize()); } catch (e) { toast('مش قادر أحفظ — مساحة الموبايل ممكن تكون مليانة'); } }

  /* ======================= أدوات ======================= */
  // replaceChildren بتكتب null وقوايم كنص — نخليها تتجاهل الفاضي وتفرد القوايم
  const _rc = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.flat(3).filter(x => x != null && x !== false)); };
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'html') el.innerHTML = v; // للأيقونات الثابتة فقط
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
    xls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };
  const D = E.fmtDur, C = E.fmtClock;
  const pad = n => String(n).padStart(2, '0');
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const todayKey = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const addDays = (k, n) => E.keyFromNum(E.dayNum(k) + n);
  const fmtDate = k => { const [y, m, d] = k.split('-'); return `${+d}/${+m}/${y}`; };
  const longDate = k => { const [, m, d] = k.split('-'); return `${E.DAY_NAMES[E.weekday(k)]} ${+d} ${MONTHS[+m - 1]}`; };
  const monthLabel = m => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y}`; };
  const startDay = () => S.settings.startFrom || S.settings.deviceFrom || todayKey();
  const startMonth = () => startDay().slice(0, 7);
  const prevMonth = m => addDays(m + '-01', -1).slice(0, 7);
  const nextMonth = m => addDays(m + '-28', 7).slice(0, 7);
  /** أول يوم البصمات بتتاخد منه (الأحدث بين بداية الحساب وتشغيل الجهاز) */
  const takeFrom = () => [S.settings.startFrom, S.settings.deviceFrom].filter(Boolean).sort().pop() || '';
  const monthOf = k => k.slice(0, 7);
  const empName = id => (S.employees[id] && S.employees[id].name) || S.names[id] || ('موظف ' + id);
  const sortedIds = () => Object.keys(S.employees).sort((a, b) => (+a - +b) || a.localeCompare(b));
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = n => (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins[n] : null;
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('has-undo'); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function confirmBtn(btn, label, action) { // زرار بيطلب ضغطة تانية للتأكيد
    if (btn.dataset.armed) { delete btn.dataset.armed; action(); return; }
    const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; } }, 3500);
  }

  /** تحميل مكتبة وقت الحاجة بس (Excel / PDF) عشان التطبيق يفتح أسرع */
  const libs = {};
  function needLib(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return libs[src] || (libs[src] = new Promise((res, rej) => {
      const el = document.createElement('script'); el.src = src;
      el.onload = () => res(window[globalName]); el.onerror = () => { delete libs[src]; rej(new Error('مقدرتش أحمّل المكتبة')); };
      document.head.append(el);
    }));
  }
  const needXLSX = () => needLib('vendor/xlsx.full.min.js', 'XLSX');
  /** حفظ ملف: في التطبيق بيفتح قائمة المشاركة/الحفظ، وفي المتصفح بينزل عادي */
  async function saveFile(name, mime, base64, text) {
    if (isNative()) {
      const F = plugin('Filesystem'), Sh = plugin('Share');
      const r = await F.writeFile(text != null ? { path: name, data: text, directory: 'CACHE', encoding: 'utf8' } : { path: name, data: base64, directory: 'CACHE' });
      try { await Sh.share({ title: name, dialogTitle: 'احفظ الملف أو ابعته', files: [r.uri] }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
      return;
    }
    const blob = text != null ? new Blob([text], { type: mime }) : new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mime });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ======================= الحساب ======================= */
  const calcState = () => Object.assign({}, S, { onlyListed: true });
  const data = () => ({ punches: S.punches, names: S.names, ver: PV });
  const CC = new Map();
  function computeRange(from, to) {
    const ck = `${DV}|${from}|${to}|${Math.floor(Date.now() / 60000)}`;
    if (CC.has(ck)) return CC.get(ck);
    if (CC.size > 60) CC.clear();
    const res = computeRangeRaw(from, to); CC.set(ck, res); return res;
  }
  function computeRangeRaw(from, to) {
    const res = E.compute(calcState(), data(), { from, to });
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes(), cut = (S.settings.dayCutHour ?? 5) * 60, t = todayKey();
    const openDay = nm < cut ? addDays(t, -1) : t;
    if (from <= openDay && to >= openDay) for (const e of res) for (const r of e.rows)
      if (r.date === openDay && r.code === 'missing' && r.missingField === 'out') { r.code = 'working'; r.status = 'لسه في الشغل'; r.nowMin = r.date === t ? nm : nm + 1440; const sh = S.settings.shifts.find(x => x.id === r.shiftId); if (sh) { const raw = r.in - E.hm(sh.start), g = +S.settings.grace || 0; r.late = raw > g ? raw - g : 0; if (r.permLate && r.late) { r.lateExcused = r.late; r.late = 0; } } e.summary.missing--; e.summary.working = (e.summary.working || 0) + 1; }
    return res;
  }
  function monthRange(m) {
    const [y, mo] = m.split('-').map(Number), last = `${m}-${pad(new Date(y, mo, 0).getDate())}`, today = todayKey();
    return { from: `${m}-01`, to: last < today ? last : today, end: last, future: `${m}-01` > today };
  }
  /** الأيام اللي مستنية تسجيل في شهر (لحد النهارده) */
  function pendingIn(m) {
    const r = monthRange(m); if (r.future || (S.locked && S.locked[m])) return [];
    const out = [];
    for (const e of computeRange(r.from, r.to)) for (const row of e.rows) if (row.code === 'pending' || row.code === 'missing') out.push(row.date);
    return out.sort();
  }
  /** الشيفت المعتاد للموظف: الثابت لو متحدد، أو الأكتر في آخر 30 يوم */
  function usualShift(id) {
    const shifts = S.settings.shifts, emp = S.employees[id] || {};
    const fixed = shifts.find(s => s.id === emp.shift); if (fixed) return fixed;
    const t = todayKey(), res = computeRange(addDays(t, -30), t).find(e => e.id === id), cnt = {};
    if (res) for (const r of res.rows) if (r.shiftId && r.code === 'present') cnt[r.shiftId] = (cnt[r.shiftId] || 0) + 1;
    const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    return shifts.find(s => s.id === best) || shifts[0];
  }
  /** مواعيد اليوم لموظف في شيفت: البداية + ساعاته (لو متحددة) */
  function shiftTimes(id, s) {
    const h = E.hoursOf(S.employees[id]); if (!h) return { start: s.start, end: s.end };
    const st = E.hm(s.start) + h; return { start: s.start, end: `${pad(Math.floor(st / 60) % 24)}:${pad(st % 60)}` };
  }
  /* ---------- قفل الشهر ---------- */
  const isLocked = date => !!(S.locked && S.locked[monthOf(date)]);
  function lockedToast(date) { toast(`🔒 ${monthLabel(monthOf(date))} مقفول — افتحه من الإعدادات أو من التقارير`); }
  /* ---------- تراجع ---------- */
  const snap = () => JSON.stringify({ manual: S.manual, perms: S.perms, notes: S.notes, reviewed: S.reviewed });
  function undoable(label, fn) {
    const before = snap(); fn(); save(); render();
    if (snap() === before) return;
    const t = $('toast');
    t.replaceChildren(h('span', null, label), h('button', { class: 'undo-btn', onclick: () => { Object.assign(S, JSON.parse(before)); save(); render(); t.classList.remove('show', 'has-undo'); toast('اترجعت ↶'); } }, '↶ تراجع'));
    t.classList.add('show', 'has-undo'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show', 'has-undo'), 5000);
  }
  function setManual(id, date, patch) {
    if (isLocked(date)) { lockedToast(date); return; }
    const k = id + '|' + date, m = Object.assign({}, S.manual[k] || {}, patch);
    for (const f in m) if (m[f] == null || m[f] === '') delete m[f];
    if (Object.keys(m).length) S.manual[k] = m; else delete S.manual[k];
    save();
  }

  /* ======================= التنقل ======================= */
  const UI = {
    tab: 'day', date: todayKey(), month: monthOf(todayKey()), gmonth: monthOf(todayKey()), pmonth: monthOf(todayKey()),
    rmode: 'month', range: { from: monthOf(todayKey()) + '-01', to: todayKey() },
    openPresent: new Set(), filter: 'all', gridMode: 'status', gridSel: null, profile: '', pday: '', editor: null, empQ: ''
  };
  document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'emps') UI.profile = ''; go(b.dataset.tab); }));
  $('settings-btn').addEventListener('click', () => go('settings'));
  $('search-btn').addEventListener('click', () => openSearch());
  function go(tab) {
    UI.tab = tab;
    document.querySelectorAll('nav.bottom button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + tab));
    window.scrollTo(0, 0);
    render();
  }
  function goDay(date, empId) { UI.date = date; go('day'); if (empId) setTimeout(() => openEditor(empId, date), 60); }
  function openProfile(id) { UI.profile = id; UI.pmonth = monthOf(UI.tab === 'grid' ? UI.gmonth + '-01' : todayKey()); UI.pday = ''; go('emps'); }
  function render() {
    const sd = startDay(), sm = sd.slice(0, 7);
    if (UI.date < sd) UI.date = sd;
    if (UI.month < sm) UI.month = sm;
    if (UI.gmonth < sm) UI.gmonth = sm;
    if (UI.pmonth && UI.pmonth < sm) UI.pmonth = sm;
    if (UI.range && UI.range.from < sd) UI.range.from = sd;
    renderTop();
    ({ day: renderDay, grid: renderGrid, month: renderMonth, emps: renderEmps, settings: renderSettings })[UI.tab]();
    const p = pendingIn(monthOf(todayKey())).length;
    $('badge-day').hidden = !p; $('badge-day').textContent = p > 99 ? '99+' : p;
    if (UI.editor && $('sheet').open) drawEditor();
  }
  function navBar(label, sub, inputType, value, onPick, onPrev, onNext) {
    const mn = inputType === 'month' ? startMonth() : inputType === 'date' ? startDay() : '';
    const inp = h('input', { type: inputType, value, min: mn || null, 'aria-label': 'اختار', onchange: ev => ev.target.value && onPick(ev.target.value < mn ? mn : ev.target.value) });
    return h('div', { class: 'nav-bar' },
      h('button', { class: 'arrow', 'aria-label': 'اللي قبله', html: ICON.prev, disabled: !!mn && value <= mn, onclick: onPrev }),
      h('label', { class: 'picker' }, h('b', null, label), sub ? h('small', null, sub) : null, inp),
      h('button', { class: 'arrow', 'aria-label': 'اللي بعده', html: ICON.next, onclick: onNext }));
  }
  const initial = name => (String(name).trim().replace(/^(ال)/, '').charAt(0) || '؟');
  const avatar = (name, cls) => h('span', { class: 'avatar' + (cls ? ' ' + cls : '') }, initial(name));
  const SHORT_DAYS = ['حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة', 'سبت'];

  /* ---------- الهيدر ---------- */
  function renderTop() {
    const titles = { day: 'الحضور والانصراف', grid: 'شبكة الشهر', month: 'التقارير', emps: UI.profile ? empName(UI.profile) : 'الموظفين', settings: 'الإعدادات' };
    $('title').textContent = titles[UI.tab];
    const extra = $('top-extra');
    if (UI.tab !== 'day' || !sortedIds().length) { extra.replaceChildren(); return; }
    const date = UI.date, today = todayKey(), future = date > today;
    const rows = computeRange(date, date).filter(e => e.rows.length).map(e => e.rows[0]);
    const need = rows.filter(r => r.code === 'pending' || r.code === 'missing').length;
    const done = rows.length - (future ? rows.filter(r => r.code === 'pending').length : need);
    const present = rows.filter(r => ['present', 'offwork', 'working'].includes(r.code));
    const byShift = {}; for (const r of present) if (r.shift) byShift[r.shift] = (byShift[r.shift] || 0) + 1;
    const C2 = 2 * Math.PI * 15.5, frac = rows.length ? done / rows.length : 0;
    const ring = h('div', { class: 'ring', html: `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" style="stroke:var(--ring-track)" stroke-width="3.5"/><circle cx="18" cy="18" r="15.5" fill="none" style="stroke:var(--ring-fill)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(C2 * frac).toFixed(1)} ${C2.toFixed(1)}"/></svg>` },
      h('b', null, `${done}/${rows.length}`, h('small', null, 'متسجلين')));
    const dateInput = h('input', { type: 'date', value: date, 'aria-label': 'اختار يوم', onchange: ev => { if (ev.target.value) { UI.date = ev.target.value; render(); } } });
    const lines = future ? ['يوم جاي — تقدر تسجّل أذونات أو إجازات مقدّمًا']
      : [`${present.length} حاضر · ${need ? need + ' مستنيين تسجيلك' : 'كله متسجّل ✓'}`, Object.keys(byShift).length ? Object.entries(byShift).map(([s, n]) => `${s} ${n}`).join(' · ') : null];
    const hero = h('div', { class: 'hero' }, ring,
      h('label', { class: 'hero-t' }, h('b', null, longDate(date) + (date === today ? ' — النهارده' : '')), ...lines.filter(Boolean).map(l => h('div', null, l)), dateInput));
    // شريط الأسبوع (من السبت للجمعة)
    const start = addDays(date, -((E.weekday(date) + 1) % 7));
    const pend = new Set(pendingIn(monthOf(start)).concat(monthOf(addDays(start, 6)) !== monthOf(start) ? pendingIn(monthOf(addDays(start, 6))) : []));
    const week = h('div', { class: 'week' },
      h('button', { class: 'wk-arrow', 'aria-label': 'الأسبوع اللي فات', html: ICON.prev, onclick: () => { UI.date = addDays(date, -7); render(); } }),
      ...Array.from({ length: 7 }, (_, i) => {
        const k = addDays(start, i);
        return h('button', { class: 'wd' + (k === date ? ' on' : '') + (k === today ? ' today' : ''), onclick: () => { UI.date = k; render(); } },
          SHORT_DAYS[E.weekday(k)], h('b', null, +k.slice(8)), pend.has(k) ? h('i') : null);
      }),
      h('button', { class: 'wk-arrow', 'aria-label': 'الأسبوع الجاي', html: ICON.next, onclick: () => { UI.date = addDays(date, 7); render(); } }));
    extra.replaceChildren(hero, week);
  }

  /* ======================= شاشة النهارده ======================= */
  function renderDay() {
    const root = $('tab-day'), date = UI.date, today = todayKey(), future = date > today;
    $('subtitle').textContent = '';
    if (!sortedIds().length) {
      root.replaceChildren(h('div', { class: 'card empty' }, h('b', null, 'لسه مفيش موظفين'), 'ارفع ملف جهاز البصمة من زرار ⬆ اللي فوق، أو ضيف الموظفين من شاشة "الموظفين".',
        h('div', { class: 'btns', style: 'justify-content:center;margin-top:12px' }, h('button', { class: 'btn primary', onclick: () => $('file').click() }, 'رفع ملف الجهاز'), h('button', { class: 'btn', onclick: () => go('emps') }, 'إضافة موظف'))));
      return;
    }
    const kids = [];
    const cm = monthOf(date) > monthOf(today) ? monthOf(today) : monthOf(date);
    const items = closeItems(cm);
    if (items.length) {
      const pend = items.filter(i => i.kind === 'pending' || i.kind === 'missing').length, rv = items.length - pend;
      kids.push(h('div', { class: 'inbox' }, h('div', { class: 'inbox-n' }, items.length),
        h('div', { class: 'grow' }, h('b', null, 'حاجات محتاجة قرارك'), h('div', { class: 'muted' }, [pend ? `${pend} تسجيل ناقص` : null, rv ? `${rv} تأخير/بدري: بإذن ولا لأ؟` : null].filter(Boolean).join(' · ') + ` — ${monthLabel(cm)}`)),
        h('button', { class: 'btn primary sm', onclick: () => closeFlow(cm) }, 'ابدأ')));
    }
    // أول 10 أيام في الشهر: فكّرني أقفل الشهر اللي فات
    const lastM = prevMonth(monthOf(today));
    if (date === today && +today.slice(8) <= 10 && lastM >= startMonth() && !S.locked[lastM] && S.view.nag !== lastM) {
      const left = closeItems(lastM).length;
      kids.unshift(h('div', { class: 'banner nagb' }, h('span', { class: 'grow' }, h('b', null, `${monthLabel(lastM)} خلص`), h('small', null, left ? `فيه ${left} حاجة محتاجة قرارك قبل ما تقفله` : 'كله متسجّل — اقفله عشان محدش يعدّل فيه بالغلط')),
        h('button', { class: 'btn sm primary', onclick: () => left ? closeFlow(lastM) : lockMonth(lastM) }, left ? 'راجع' : '🔒 اقفله'),
        h('button', { class: 'note-x', 'aria-label': 'بعدين', onclick: () => { S.view.nag = lastM; save(); render(); } }, '×')));
    }
    if (date === today && Zk() && S.device.ip) kids.unshift(syncChip());
    const all = computeRange(date, date).filter(e => e.rows.length).map(e => ({ e, r: e.rows[0] }));
    if (!all.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'مفيش موظفين شغالين اليوم ده'), 'راجع تاريخ بداية وترك الشغل في شاشة الموظفين.')); return; }
    const isNeed = r => r.code === 'pending' || r.code === 'missing';
    const groups = { all: () => true, present: r => ['present', 'offwork', 'working'].includes(r.code), absent: r => ['absent', 'excused', 'leave', 'off', 'holiday'].includes(r.code), need: isNeed };
    const cnt = f => all.filter(x => groups[f](x.r)).length;
    const mode = S.view.dayMode || 'timeline';
    const vt = (v, l) => h('button', { class: mode === v ? 'on' : '', onclick: () => { S.view.dayMode = v; save(); render(); } }, l);
    const fc = (v, l) => h('button', { class: 'fc' + (UI.filter === v ? ' on' : ''), onclick: () => { UI.filter = v; render(); } }, l, ' ', h('b', null, cnt(v)));
    kids.push(h('div', { class: 'toolbar' }, h('div', { class: 'vt' }, vt('timeline', 'خط زمني'), vt('list', 'قايمة')),
      h('div', { class: 'fil' }, fc('all', 'الكل'), fc('present', 'حاضر'), fc('absent', 'غياب/إجازة'), future ? null : fc('need', 'مستني'))));
    const pendingOnly = all.filter(x => x.r.code === 'pending');
    if (isLocked(date)) kids.unshift(h('div', { class: 'banner lockb' }, h('span', null, `🔒 ${monthLabel(monthOf(date))} مقفول — مش هينفع تعديل`), h('button', { class: 'btn sm', onclick: () => unlockMonth(monthOf(date)) }, 'فتح')));
    if (!future && !isLocked(date) && pendingOnly.length > 1) {
      kids.push(h('div', { class: 'bulk' }, h('span', null, `${pendingOnly.length} ملهمش تسجيل:`),
        h('button', { class: 'btn sm primary', onclick: () => undoable(`${pendingOnly.length} اتسجّلوا حضور`, () => { for (const { e } of pendingOnly) markPresent(e.id, date); }) }, 'كلهم حضور'),
        h('button', { class: 'btn sm danger', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟', () => undoable(`${pendingOnly.length} اتسجّلوا غياب`, () => { for (const { e } of pendingOnly) setManual(e.id, date, { absence: 'absent' }); })) }, 'كلهم غياب')));
    }
    const shown = all.filter(x => groups[UI.filter] ? groups[UI.filter](x.r) : true);
    if (!shown.length) kids.push(h('div', { class: 'card empty' }, 'مفيش حد في الفلتر ده'));
    else if (mode === 'timeline') kids.push(timeline(shown, future));
    else kids.push(h('div', { class: 'list' }, shown.map(x => dayRow(x.e, x.r, future))));
    root.replaceChildren(...kids);
  }
  function markPresent(id, date) { const t = shiftTimes(id, usualShift(id)); setManual(id, date, { in: t.start, out: t.end, absence: null }); }
  const statusLabel = (r, future) => future && r.code === 'pending' ? 'لسه' : r.code === 'pending' ? 'مستني' : r.code === 'missing' ? 'ناقص' : r.status.replace(' (يدوي)', '');
  const pillCode = (r, future) => future && r.code === 'pending' ? 'future' : r.code;
  function flagsOf(r, k) {
    const out = [];
    if (r.late) out.push(h('span', { class: 'flag r' }, 'تأخير ' + D(r.late)));
    if (r.early) out.push(h('span', { class: 'flag r' }, 'بدري ' + D(r.early)));
    if (r.overtime) out.push(h('span', { class: 'flag g' }, 'زيادة ' + D(r.overtime)));
    if (r.permLate) out.push(h('span', { class: 'flag v' }, 'تأخير بإذن'));
    if (r.permEarly) out.push(h('span', { class: 'flag v' }, 'انصراف بإذن'));
    if (r.short) out.push(h('span', { class: 'flag r' }, 'نقص ' + D(r.short)));
    if (r.permShort) out.push(h('span', { class: 'flag v' }, 'نقص بإذن'));
    if (r.missedPeriods) out.push(h('span', { class: 'flag a' }, 'فترة ناقصة'));
    if (r.rule) out.push(h('span', { class: 'flag n' }, r.rule));
    if (r.code === 'missing') out.push(h('span', { class: 'flag a' }, `ناقص ${r.missingField === 'in' ? 'الحضور' : 'الانصراف'}`));
    if (r.code === 'working' && r.late) out.push(h('span', { class: 'flag r' }, 'تأخير ' + D(r.late)));
    const n = (S.notes[k] || []).length; if (n) out.push(h('span', { class: 'flag n' }, '📝 ' + n));
    return out;
  }
  function rowSub(r) {
    if (r.code === 'working') return [r.shift, `حضر ${C(r.in)}`, `بقاله ${D(r.nowMin - r.in)}`].filter(Boolean).join(' · ');
    if (r.in != null || r.out != null) {
      const times = (r.segs && r.segs.length > 1 ? r.segs : [{ in: r.in, out: r.out }]).map(x => `${C(x.in) || '—'} ← ${C(x.out) || '—'}`).join(' ، ');
      const hrs = r.worked != null ? (r.mode === 'hours' && r.required ? `${D(r.worked)} من ${D(r.required)}` : D(r.worked) + ' س') : null;
      return [r.shift, times, hrs].filter(Boolean).join(' · ');
    }
    if (r.code === 'pending') return r.date < (S.settings.deviceFrom || '') ? 'قبل تشغيل الجهاز — سجّل يدوي' : 'مفيش بصمات من الجهاز';
    return r.status;
  }
  function quickActions(e, r) {
    return h('div', { class: 'qa', onclick: ev => ev.stopPropagation() },
      h('button', { class: 'btn sm', onclick: () => undoable(`${e.name}: حاضر`, () => markPresent(e.id, r.date)) }, '✓ حاضر'),
      h('button', { class: 'btn sm', style: 'color:var(--rose)', onclick: () => undoable(`${e.name}: غياب`, () => setManual(e.id, r.date, { absence: 'absent' })) }, 'غياب'),
      h('button', { class: 'btn sm', style: 'color:var(--violet)', onclick: () => undoable(`${e.name}: غياب بإذن`, () => setManual(e.id, r.date, { absence: 'excused' })) }, 'بإذن'),
      h('button', { class: 'btn sm', 'aria-label': 'تفاصيل', onclick: () => openEditor(e.id, r.date) }, '⋯'));
  }
  function dayRow(e, r, future) {
    const k = e.id + '|' + r.date, need = !future && (r.code === 'pending' || r.code === 'missing');
    return h('div', { class: 'li2' + (need ? ' need' : ''), role: 'button', tabindex: 0, onclick: () => openEditor(e.id, r.date) },
      avatar(e.name, need ? 'warn' : ''),
      h('div', { class: 'grow' }, h('div', { class: 't' }, h('span', { dir: 'auto' }, e.name), h('small', null, e.id)), h('div', { class: 's' }, rowSub(r)),
        flagsOf(r, k).length ? h('div', { class: 'flags' }, flagsOf(r, k)) : null,
        !future && r.code === 'pending' && !isLocked(r.date) ? quickActions(e, r) : null),
      h('span', { class: 'pill c-' + pillCode(r, future) }, statusLabel(r, future)));
  }

  /* ---------- الخط الزمني (الوقت ماشي من اليمين للشمال) ---------- */
  function timeline(rows, future) {
    const sh = S.settings.shifts.map(s => ({ st: E.hm(s.start), en: E.hm(s.end) <= E.hm(s.start) ? E.hm(s.end) + 1440 : E.hm(s.end) }));
    const allSh = E.shiftsOf(S.settings);
    const winsOf = (e, r) => { // فترات الشيفت المطلوبة لليوم ده
      if (r.mode === 'hours') return [];
      if (r.periods) return r.periods;
      const rule = E.ruleFor(S.settings, r.date), s0 = (rule && allSh.find(x => x.id === rule.shift)) || allSh.find(x => x.id === r.shiftId) || (['pending', 'absent', 'excused', 'leave'].includes(r.code) ? allSh.find(x => x.id === usualShift(e.id).id) : null);
      if (!s0) return []; const per = s0.periods.map(p => ({ ...p })), hrs = E.hoursOf(S.employees[e.id]);
      if (per.length === 1 && hrs) per[0].en = per[0].st + hrs; return per;
    };
    let lo = Math.min(...sh.map(s => s.st)), hi = Math.max(...sh.map(s => s.en));
    for (const { e, r } of rows) for (const p of winsOf(e, r)) { lo = Math.min(lo, p.st); hi = Math.max(hi, p.en); }
    for (const { r } of rows) { if (r.in != null) lo = Math.min(lo, r.in); if (r.out != null) hi = Math.max(hi, r.out); if (r.nowMin) hi = Math.max(hi, Math.min(r.nowMin, lo + 20 * 60)); }
    const t0 = Math.floor((lo - 30) / 60) * 60, t1 = Math.ceil((hi + 30) / 60) * 60, span = t1 - t0;
    const P = t => ((t - t0) / span * 100).toFixed(2) + '%', W = (a, b) => (Math.max(0, b - a) / span * 100).toFixed(2) + '%';
    const seg = (cls, a, b, extra) => h('i', { class: 'tl-' + cls, style: `right:${P(a)};width:${W(a, b)}` + (extra || '') });
    const step = span > 14 * 60 ? 180 : 120, ticks = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) { const hh = Math.floor(t / 60) % 24; ticks.push(h('span', { style: `right:${P(t)}` }, String(hh % 12 || 12))); }
    const head = h('div', { class: 'tl-row tl-head' }, h('span'), h('div', { class: 'tl-track' }, ticks));
    const body = rows.map(({ e, r }) => {
      const ws = winsOf(e, r), w = ws.length ? { st: ws[0].st, en: ws[ws.length - 1].en } : null, parts = [], need = !future && (r.code === 'pending' || r.code === 'missing');
      for (const p of ws) parts.push(seg('win' + (need ? ' warn' : r.code === 'absent' ? ' bad' : ''), p.st, p.en));
      if (r.in != null && r.out != null) {
        const segs = (r.segs || []).filter(x => x.in != null && x.out != null);
        for (const x of segs.length ? segs : [{ in: r.in, out: r.out }]) parts.push(seg('on', x.in, x.out));
        // التأخير والبدري والزيادة لكل فترة
        for (const p of ws) {
          let best = null, bo = 0; for (const x of segs) { const o = Math.min(x.out, p.en) - Math.max(x.in, p.st); if (o > bo) { bo = o; best = x; } }
          if (!best) { if (r.early || r.earlyExcused) parts.push(seg(r.permEarly ? 'perm' : 'late', p.st, p.en)); continue; }
          if (best.in > p.st && (r.late || r.lateExcused)) parts.push(seg(r.permLate ? 'perm' : 'late', p.st, best.in));
          if (best.out < p.en && (r.early || r.earlyExcused)) parts.push(seg(r.permEarly ? 'perm' : 'late', best.out, p.en));
          if (best.out > p.en && r.overtime) parts.push(seg('ot', p.en, best.out));
        }
        if (!ws.length && r.overtime && r.required) { const last = segs[segs.length - 1] || { out: r.out }; parts.push(seg('ot', last.out - r.overtime, last.out)); }
      } else if (r.code === 'working') { parts.push(seg('on', r.in, Math.min(r.nowMin, t1))); if (w && r.late) parts.push(seg('late', w.st, r.in)); parts.push(seg('now', Math.min(r.nowMin, t1) - 2, Math.min(r.nowMin, t1))); }
      else if (r.in != null) parts.push(seg('on fade-l', r.in, Math.min(r.in + 150, t1)));
      else if (r.out != null) parts.push(seg('on fade-r', Math.max(r.out - 150, t0), r.out));
      else if (['absent', 'excused', 'leave', 'off', 'holiday'].includes(r.code)) parts.push(h('em', { class: 'tl-lbl c-' + r.code }, r.status));
      else if (!future) parts.push(h('em', { class: 'tl-lbl c-pending' }, 'مستني تسجيلك'));
      const minus = (r.late || 0) + (r.early || 0) + (r.short || 0);
      const sub = r.worked != null ? [D(r.worked), r.overtime ? '+' + D(r.overtime) : null, minus ? '−' + D(minus) : null].filter(Boolean).join(' · ') : statusLabel(r, future);
      return h('div', { class: 'tl-row' + (need ? ' need' : ''), role: 'button', tabindex: 0, onclick: () => openEditor(e.id, r.date) },
        h('div', { class: 'tl-name' }, h('b', { dir: 'auto' }, e.name), h('small', null, sub)), h('div', { class: 'tl-track' }, parts));
    });
    const lg = (cls, l) => h('span', null, h('i', { class: 'lg-' + cls }), l);
    return h('div', { class: 'tl' }, head, body, h('div', { class: 'legend tl-legend' }, lg('win', 'الشيفت'), lg('on', 'موجود'), lg('late', 'تأخير/بدري'), lg('perm', 'بإذن'), lg('ot', 'زيادة')));
  }

  /* ======================= شاشة التعديل (من تحت) ======================= */
  function openEditor(id, date) { UI.editor = { id, date }; drawEditor(); if (!$('sheet').open) $('sheet').showModal(); }
  $('sheet').addEventListener('close', () => { UI.editor = null; });
  function drawEditor() {
    const { id, date } = UI.editor, e0 = computeRange(date, date).find(x => x.id === id);
    if (!e0 || !e0.rows.length) { $('sheet').close(); return; }
    const e = e0, r = e0.rows[0], k = id + '|' + date, man = S.manual[k] || {}, perm = S.perms[k] || {}, future = date > todayKey();
    const isAbs = ['absent', 'excused', 'leave'].includes(man.absence);
    const mode = isAbs ? man.absence : (r.in != null || r.out != null || UI.openPresent.has(k)) ? 'present' : '';
    const upd = () => { save(); render(); };
    const locked = isLocked(date);
    const segBtn = (v, l) => h('button', { class: `s-${v}` + (mode === v ? ' on' : ''), disabled: locked, onclick: () => {
      if (v === 'present') { UI.openPresent.add(k); setManual(id, date, { absence: null }); upd(); }
      else if (mode === v) undoable(`${e.name}: اتشال "${l}"`, () => { setManual(id, date, { absence: null }); UI.openPresent.delete(k); });
      else undoable(`${e.name}: ${l}`, () => { setManual(id, date, { absence: v, in: null, out: null }); UI.openPresent.delete(k); });
    } }, l);
    const body = [];
    if (mode === 'present') {
      const ti = (f, val, dev, l) => h('div', null, h('label', { class: 'f' }, l),
        h('input', { type: 'time', value: C(val), class: man[f] ? 'edited' : '', 'aria-label': l, onchange: ev => { const v = ev.target.value; setManual(id, date, { [f]: v && v !== C(dev) ? v : null, absence: null }); upd(); } }),
        man[f] && dev != null ? h('div', { class: 'dev' }, `الجهاز: ${C(dev)}`) : null);
      body.push(h('div', { class: 'times' }, ti('in', r.in, r.devIn, 'الحضور'), ti('out', r.out, r.devOut, 'الانصراف')));
      if (r.segs && r.segs.length > 1) body.push(h('div', { class: 'muted', style: 'margin-top:6px;font-size:12.5px' }, 'الفترات: ' + r.segs.map(x => `${C(x.in) || '—'} ← ${C(x.out) || '—'}`).join(' ، ')));
      if (r.worked != null && r.mode === 'hours') body.push(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, D(r.worked)), h('span', null, 'ساعات')),
        h('div', { class: 'stat' }, h('b', null, D(r.required)), h('span', null, 'المطلوب')),
        h('div', { class: 'stat' + (r.short ? ' bad' : '') }, h('b', null, D(r.short)), h('span', null, 'نقص')),
        h('div', { class: 'stat' + (r.overtime ? ' good' : '') }, h('b', null, D(r.overtime)), h('span', null, 'زيادة'))));
      else if (r.worked != null) body.push(h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', null, D(r.worked)), h('span', null, 'ساعات')),
        h('div', { class: 'stat' + (r.late ? ' bad' : '') }, h('b', null, D(r.late)), h('span', null, 'تأخير')),
        h('div', { class: 'stat' + (r.early ? ' bad' : '') }, h('b', null, D(r.early)), h('span', null, 'بدري')),
        h('div', { class: 'stat' + (r.overtime ? ' good' : '') }, h('b', null, D(r.overtime)), h('span', null, 'زيادة'))));
      else if (r.code === 'missing') body.push(h('div', { class: 'warn-line' }, `ناقص وقت ${r.missingField === 'in' ? 'الحضور' : 'الانصراف'} — اكتبه فوق`));
      const shiftSel = h('select', { 'aria-label': 'الشيفت', onchange: ev => { setManual(id, date, { shift: ev.target.value || null }); upd(); } },
        h('option', { value: '' }, 'شيفت تلقائي' + (r.shift && !man.shift ? ` (${r.shift})` : '')), ...S.settings.shifts.map(s => h('option', { value: s.id }, `${s.name} ${s.start}–${s.end}`)));
      shiftSel.value = man.shift || '';
      if (r.mode !== 'hours') body.push(h('div', { class: 'row-tools' }, shiftSel, r.in == null || r.out == null ? h('button', { class: 'btn ghost sm', onclick: () => {
        const t = shiftTimes(id, S.settings.shifts.find(x => x.id === man.shift) || usualShift(id));
        setManual(id, date, { in: r.in == null ? t.start : man.in, out: r.out == null ? t.end : man.out }); upd();
      } }, 'املا بمواعيد الشيفت') : null));
      const tg = (f, l) => h('button', { class: 'tg' + (perm[f] ? ' on' : ''), onclick: () => {
        const p = Object.assign({}, S.perms[k] || {}, { [f]: !perm[f] }); if (p.late || p.early || p.short) S.perms[k] = p; else delete S.perms[k]; upd();
      } }, (perm[f] ? '✓ ' : '+ ') + l);
      body.push(h('div', { class: 'toggles' }, r.mode === 'hours' ? tg('short', 'نقص ساعات بإذن') : [tg('late', 'تأخير بإذن'), tg('early', 'انصراف بدري بإذن')]));
    }
    const notes = S.notes[k] || [];
    const devLine = r.punches ? `الجهاز: ${C(r.devIn) || '—'} ← ${C(r.devOut) || '—'}` : (date < (S.settings.deviceFrom || '') ? 'قبل تشغيل الجهاز' : 'مفيش بصمات من الجهاز');
    $('sheet-in').replaceChildren(
      h('div', { class: 'grab' }),
      h('div', { class: 'ed-head' }, avatar(e.name), h('div', { class: 'grow' }, h('div', { class: 't', dir: 'auto' }, e.name, h('small', null, ' كود ' + id)), h('div', { class: 's' }, `${longDate(date)} · ${devLine}`)),
        h('span', { class: 'pill c-' + pillCode(r, future) }, statusLabel(r, future))),
      locked ? h('div', { class: 'banner lockb', style: 'margin:10px 0 0' }, h('span', null, `🔒 ${monthLabel(monthOf(date))} مقفول`), h('button', { class: 'btn sm', onclick: () => unlockMonth(monthOf(date)) }, 'فتح الشهر')) : null,
      h('div', { class: 'seg' }, segBtn('present', 'حاضر'), segBtn('absent', 'غياب'), segBtn('excused', 'غياب بإذن'), segBtn('leave', 'إجازة')),
      ...(locked ? body.filter(x => !(x.classList && (x.classList.contains('times') || x.classList.contains('row-tools') || x.classList.contains('toggles')))) : body),
      h('div', { class: 'notes' }, notes.map((n, i) => h('div', { class: 'note-line', dir: 'auto' }, n.type && n.type !== 'note' ? h('span', { class: 'muted' }, QLABEL[n.type] + ': ') : null, n.text,
        h('button', { class: 'note-x', 'aria-label': 'امسح الملاحظة', onclick: () => undoable('اتمسحت الملاحظة', () => { notes.splice(i, 1); if (!notes.length) delete S.notes[k]; }) }, '×')))),
      h('div', { class: 'btns', style: 'margin-top:10px' },
        h('button', { class: 'btn', style: 'flex:1', onclick: () => quickSheet({ ids: [id], date, type: 'note' }) }, '+ ملاحظة'),
        S.manual[k] && r.punches ? h('button', { class: 'btn', style: 'flex:1', onclick: () => undoable('رجع زي بيانات الجهاز', () => { delete S.manual[k]; UI.openPresent.delete(k); }) }, 'رجّع زي الجهاز') : null),
      h('div', { class: 'btns', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', style: 'flex:2', onclick: () => $('sheet').close() }, 'تم'),
        h('button', { class: 'btn', style: 'flex:1', onclick: () => { $('sheet').close(); openProfile(id); } }, 'ملف الموظف')));
  }

  /* ======================= شبكة الشهر ======================= */
  function renderGrid() {
    const root = $('tab-grid'), m = UI.gmonth, rng = monthRange(m), today = todayKey();
    $('subtitle').textContent = 'كل الموظفين × كل الأيام';
    const shiftM = d => { const [y, mo] = m.split('-').map(Number), t = new Date(y, mo - 1 + d, 1); UI.gmonth = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; UI.gridSel = null; render(); };
    const kids = [navBar(monthLabel(m), m === monthOf(today) ? 'الشهر الحالي' : '', 'month', m, v => { UI.gmonth = v; UI.gridSel = null; render(); }, () => shiftM(-1), () => shiftM(1))];
    if (rng.future || !sortedIds().length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, rng.future ? 'الشهر ده لسه مجاش' : 'لسه مفيش موظفين'))); return; }
    const all = computeRange(rng.from, rng.end);
    if (!all.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'مفيش موظفين كانوا شغالين الشهر ده'))); return; }
    const gm = UI.gridMode, mb = (v, l) => h('button', { class: 'fc' + (gm === v ? ' on' : ''), onclick: () => { UI.gridMode = v; render(); } }, l);
    kids.push(h('div', { class: 'fil', style: 'margin-bottom:10px' }, mb('status', 'الحالة'), mb('late', 'التأخير'), mb('hours', 'الساعات')));
    const n = +rng.end.slice(8), days = Array.from({ length: n }, (_, i) => `${m}-${pad(i + 1)}`);
    const cells = [h('div', { class: 'g-name g-h' })];
    for (const k of days) cells.push(h('div', { class: 'g-h' + (k === today ? ' today' : ''), id: k === today ? 'g-today' : null }, h('small', null, SHORT_DAYS[E.weekday(k)].charAt(0)), +k.slice(8)));
    for (const e of all) {
      cells.push(h('button', { class: 'g-name', dir: 'auto', onclick: () => openProfile(e.id) }, e.name));
      const byDate = Object.fromEntries(e.rows.map(r => [r.date, r]));
      for (const k of days) {
        const r = byDate[k], sel = UI.gridSel && UI.gridSel.id === e.id && UI.gridSel.date === k;
        if (!r) { cells.push(h('div', { class: 'gc g-out' })); continue; }
        const fut = k > today; let cls = 'gc', style = '', label = '';
        if (fut) cls += r.code === 'pending' ? ' g-fut' : ' c-' + r.code;
        else if (gm === 'status') cls += ' gs-' + r.code;
        else if (gm === 'late') { const v = (r.late || 0) + (r.early || 0) + (r.short || 0); if (r.code === 'off') cls += ' gs-off'; else if (r.code === 'pending' || r.code === 'missing') cls += ' gs-pending'; else if (v) { style = `background:rgba(194,72,95,${Math.min(1, .3 + v / 60 * .7).toFixed(2)})`; label = String(v); } else cls += ' g-zero'; }
        else { if (r.code === 'off') cls += ' gs-off'; else if (r.code === 'pending' || r.code === 'missing') cls += ' gs-pending'; else if (r.worked) { const req = r.required || 480; style = `background:rgba(30,140,110,${Math.min(1, .2 + r.worked / req * .8).toFixed(2)})`; label = String(Math.round(r.worked / 60)); } else cls += ' g-zero'; }
        if (sel) cls += ' sel';
        cells.push(h('button', { class: cls, style, title: `${e.name} — ${longDate(k)}: ${r.status}`, onclick: () => { UI.gridSel = { id: e.id, date: k }; render(); } }, label));
      }
    }
    const grid = h('div', { class: 'gwrap' }, h('div', { class: 'gtable', style: `grid-template-columns:96px repeat(${n},26px)` }, cells));
    kids.push(grid);
    const lg = (cls, l) => h('span', null, h('i', { class: cls }), l);
    kids.push(gm === 'status' ? h('div', { class: 'legend' }, lg('gs-present', 'حاضر'), lg('gs-excused', 'بإذن/إجازة'), lg('gs-absent', 'غياب'), lg('gs-pending', 'ناقص'), lg('gs-off', 'إجازة أسبوعية'), lg('gs-holiday', 'إجازة رسمية'))
      : gm === 'late' ? h('div', { class: 'legend' }, 'الأغمق = تأخير وبدري أكتر (الرقم بالدقايق)') : h('div', { class: 'legend' }, 'الأغمق = ساعات أكتر (الرقم بالساعات)'));
    if (UI.gridSel) {
      const e = all.find(x => x.id === UI.gridSel.id), r = e && e.rows.find(x => x.date === UI.gridSel.date);
      if (r) {
        const fut = r.date > today;
        kids.push(h('div', { class: 'card sel-card' },
          h('div', { class: 'ed-head' }, avatar(e.name), h('div', { class: 'grow' }, h('div', { class: 't', dir: 'auto' }, e.name), h('div', { class: 's' }, `${longDate(r.date)} · ${rowSub(r)}`)), h('span', { class: 'pill c-' + pillCode(r, fut) }, statusLabel(r, fut))),
          flagsOf(r, e.id + '|' + r.date).length ? h('div', { class: 'flags' }, flagsOf(r, e.id + '|' + r.date)) : null,
          !fut && r.code === 'pending' ? quickActions(e, r) : h('div', { class: 'btns', style: 'margin-top:10px' }, h('button', { class: 'btn primary', style: 'flex:1', onclick: () => openEditor(e.id, r.date) }, 'تعديل'), h('button', { class: 'btn', onclick: () => openProfile(e.id) }, 'ملف الموظف'))));
      }
    }
    root.replaceChildren(...kids);
    const t = $('g-today') || grid.querySelector('.sel');
    if (t) { const gw = grid; const off = t.offsetLeft - gw.clientWidth / 2; gw.scrollLeft = off; }
  }

  /* ======================= تقفيل الشهر (حالة حالة) ======================= */
  function closeItems(m) {
    const r0 = monthRange(m); if (r0.future || S.locked[m]) return [];
    const out = [];
    for (const e of computeRange(r0.from, r0.to)) for (const r of e.rows) {
      const k = e.id + '|' + r.date;
      if (r.code === 'pending') out.push({ e, r, kind: 'pending' });
      else if (r.code === 'missing') out.push({ e, r, kind: 'missing' });
      if (r.late > 0 && !S.reviewed[k + '|late']) out.push({ e, r, kind: 'late' });
      if (r.early > 0 && !S.reviewed[k + '|early']) out.push({ e, r, kind: 'early' });
      if (r.short > 0 && !S.reviewed[k + '|short']) out.push({ e, r, kind: 'short' });
    }
    return out.sort((a, b) => a.r.date.localeCompare(b.r.date) || a.e.id.localeCompare(b.e.id, undefined, { numeric: true }));
  }
  function lockMonth(m) { S.locked[m] = todayKey(); save(); render(); toast(`🔒 ${monthLabel(m)} اتقفل`); }
  function unlockMonth(m) { delete S.locked[m]; save(); render(); toast(`🔓 ${monthLabel(m)} اتفتح للتعديل`); }
  function monthState(m) {
    const lk = S.locked[m], pn = lk ? 0 : pendingIn(m).length;
    return { lk, pn, s: lk ? `مقفول من ${fmtDate(lk)}` : pn ? `مفتوح · ${pn} ناقص` : 'مفتوح · متسجّل كامل' };
  }
  function lockRow(m, tag) {
    const x = monthState(m);
    return h('div', { class: 'li', style: 'cursor:default' }, h('span', { class: 'avatar' }, x.lk ? '🔒' : x.pn ? '⚠' : '✓'),
      h('span', { class: 'grow' }, h('div', { class: 't' }, monthLabel(m), tag ? h('small', { class: 'muted' }, ' · ' + tag) : null), h('div', { class: 's' }, x.s)),
      x.lk ? h('button', { class: 'btn sm', onclick: () => unlockMonth(m) }, 'فتح')
        : h('button', { class: 'btn sm primary', onclick: () => x.pn ? closeFlow(m) : lockMonth(m) }, x.pn ? 'راجع' : 'اقفله'));
  }
  /** شبكة شهور السنة — بدل قايمة طويلة بتكبر كل شهر */
  function monthsSheet(year) {
    const sm = startMonth(), cur = monthOf(todayKey()), y0 = +sm.slice(0, 4), y1 = +cur.slice(0, 4);
    let y = Math.min(Math.max(year || +prevMonth(cur).slice(0, 4), y0), y1), sel = '';
    const draw = () => {
      const tiles = [];
      for (let i = 1; i <= 12; i++) {
        const m = `${y}-${pad(i)}`, out = m < sm || m >= cur;
        const x = out ? null : monthState(m);
        tiles.push(h('button', { class: 'mt' + (out ? ' off' : '') + (x && x.lk ? ' lk' : '') + (x && x.pn ? ' pn' : '') + (sel === m ? ' on' : ''), disabled: out, onclick: () => { sel = m; draw(); } },
          h('b', null, MONTHS[i - 1]), h('small', null, m === cur ? 'الحالي' : out ? '' : x.lk ? '🔒 مقفول' : x.pn ? `⚠ ${x.pn} ناقص` : '✓ كامل')));
      }
      const x = sel ? monthState(sel) : null;
      $('sheet-in').replaceChildren(h('div', { class: 'grab' }), h('h2', null, 'الشهور'),
        h('div', { class: 'yr-bar' }, h('button', { class: 'arrow', 'aria-label': 'السنة اللي قبلها', html: ICON.prev, disabled: y <= y0, onclick: () => { y--; sel = ''; draw(); } }),
          h('b', null, y), h('button', { class: 'arrow', 'aria-label': 'السنة اللي بعدها', html: ICON.next, disabled: y >= y1, onclick: () => { y++; sel = ''; draw(); } })),
        h('div', { class: 'mgrid' }, tiles),
        sel ? h('div', { class: 'mt-act' }, h('div', { class: 'grow' }, h('b', null, monthLabel(sel)), h('div', { class: 'muted' }, x.s)),
          x.lk ? h('button', { class: 'btn sm', onclick: () => { unlockMonth(sel); draw(); } }, '🔓 افتحه')
            : x.pn ? h('button', { class: 'btn sm primary', onclick: () => closeFlow(sel) }, 'راجع') : h('button', { class: 'btn sm primary', onclick: () => { lockMonth(sel); draw(); } }, '🔒 اقفله'),
          h('button', { class: 'btn sm', onclick: () => { $('sheet').close(); UI.month = sel; UI.rmode = 'month'; go('month'); } }, 'التقرير'))
          : h('p', { class: 'muted', style: 'text-align:center' }, 'دوس على أي شهر'));
    };
    openSheet([]); draw();
  }
  function closeFlow(m) {
    const items = closeItems(m); if (!items.length) { toast('مفيش حاجة ناقصة ✓'); return; }
    let i = 0; const done = new Set();
    UI.editor = null;
    const next = () => { done.add(i); i++; draw(); };
    const draw = () => {
      $('sheet').classList.add('full');
      if (i >= items.length) {
        const left = closeItems(m).length;
        $('sheet-in').replaceChildren(h('div', { class: 'cf-done' }, h('div', { class: 'cf-check' }, left ? '…' : '✓'), h('b', null, left ? `فاضل ${left} حاجة اتخطيتها` : `${monthLabel(m)} اتقفل ✓`),
          h('p', { class: 'muted' }, left ? 'تقدر ترجعلهم في أي وقت من زرار "ابدأ".' : 'كل الأيام متسجلة وكل التأخير اتراجع. التقرير جاهز.'),
          h('div', { class: 'btns', style: 'justify-content:center' }, !left && m < monthOf(todayKey()) ? h('button', { class: 'btn', onclick: () => { lockMonth(m); $('sheet').close(); } }, '🔒 اقفل الشهر') : null, h('button', { class: 'btn primary', onclick: () => { $('sheet').close(); UI.month = m; UI.rmode = 'month'; go('month'); } }, 'روح للتقرير'), h('button', { class: 'btn', onclick: () => $('sheet').close() }, 'اقفل'))));
        render(); return;
      }
      const it = items[i], { e, r } = it, k = e.id + '|' + r.date;
      const note = h('textarea', { rows: 1, dir: 'auto', placeholder: '📝 السبب أو ملاحظة (اختياري)' });
      const withNote = (type) => { const t = note.value.trim(); if (t) (S.notes[k] = S.notes[k] || []).push({ text: t, type, at: new Date().toISOString() }); };
      const big = (l, cls, fn) => h('button', { class: 'cf-btn ' + cls, onclick: () => { fn(); save(); next(); } }, l);
      let msg, actions;
      const s = S.settings.shifts.find(x => x.id === r.shiftId) || usualShift(e.id), t = shiftTimes(e.id, s);
      if (it.kind === 'pending') {
        msg = [h('div', { class: 'cf-msg' }, 'مفيش أي تسجيل لليوم ده'), h('div', { class: 'muted' }, r.date < (S.settings.deviceFrom || '') ? 'قبل تشغيل الجهاز' : 'مفيش بصمات من الجهاز')];
        actions = h('div', { class: 'cf-grid' },
          big(`حاضر ${t.start} لـ ${t.end}`, 'teal', () => { markPresent(e.id, r.date); withNote('note'); }),
          big('غياب', 'rose', () => { setManual(e.id, r.date, { absence: 'absent' }); withNote('absent'); }),
          big('غياب بإذن', 'violet', () => { setManual(e.id, r.date, { absence: 'excused' }); withNote('excused'); }),
          big('إجازة', 'violet', () => { setManual(e.id, r.date, { absence: 'leave' }); withNote('leave'); }));
      } else if (it.kind === 'missing') {
        const f = r.missingField, inp = h('input', { type: 'time', value: f === 'in' ? t.start : t.end, 'aria-label': 'الوقت' });
        msg = [h('div', { class: 'cf-msg' }, `ناقص وقت ${f === 'in' ? 'الحضور' : 'الانصراف'}`), h('div', { class: 'muted' }, f === 'in' ? `مشي ${C(r.out)}` : `حضر ${C(r.in)}`)];
        actions = h('div', null, h('div', { style: 'max-width:200px;margin:0 auto 10px' }, inp),
          h('div', { class: 'cf-grid' }, big('حفظ الوقت', 'teal', () => { setManual(e.id, r.date, { [f]: inp.value || (f === 'in' ? t.start : t.end) }); withNote('note'); }),
            big('غياب', 'rose', () => { setManual(e.id, r.date, { absence: 'absent', in: null, out: null }); withNote('absent'); })));
      } else if (it.kind === 'short') {
        msg = [h('div', { class: 'cf-msg' }, 'اشتغل ', h('b', null, D(r.worked)), ' من ', h('b', null, D(r.required))), h('div', { class: 'muted' }, `نقص ${D(r.short)} · ${C(r.in)} ← ${C(r.out)}`)];
        actions = h('div', { class: 'cf-grid' },
          big('بإذن', 'violet', () => { S.perms[k] = Object.assign({}, S.perms[k] || {}, { short: true }); withNote('short'); }),
          big('بدون إذن', 'rose', () => { S.reviewed[k + '|short'] = 1; withNote('note'); }));
      } else {
        const late = it.kind === 'late';
        msg = [h('div', { class: 'cf-msg' }, late ? 'اتأخر ' : 'مشي ', h('b', { style: 'color:var(--rose)' }, D(late ? r.late : r.early) + (late ? '' : ' بدري'))),
          h('div', { class: 'muted' }, late ? `حضر ${C(r.in)} بدل ${t.start}` : `انصراف ${C(r.out)} بدل ${t.end}`)];
        actions = h('div', { class: 'cf-grid' },
          big('بإذن', 'violet', () => { S.perms[k] = Object.assign({}, S.perms[k] || {}, { [it.kind]: true }); withNote(it.kind); }),
          big('بدون إذن', 'rose', () => { S.reviewed[k + '|' + it.kind] = 1; withNote('note'); }));
      }
      $('sheet-in').replaceChildren(
        h('div', { class: 'cf-top' }, h('b', null, `تقفيل ${monthLabel(m)}`), h('span', null, `${i + 1} من ${items.length}`), h('button', { class: 'note-x', 'aria-label': 'اقفل', onclick: () => $('sheet').close() }, '×')),
        h('div', { class: 'cf-prog' }, h('i', { style: `width:${(i / items.length * 100).toFixed(1)}%` })),
        h('div', { class: 'cf-card' }, avatar(e.name, 'big'), h('div', { class: 'cf-name', dir: 'auto' }, e.name), h('div', { class: 'muted' }, `${longDate(r.date)}${r.shift ? ' · شيفت ' + r.shift : ''}`), ...msg, actions, h('div', { style: 'margin-top:10px' }, note)),
        h('div', { class: 'cf-nav' }, h('button', { class: 'btn ghost', disabled: i === 0, onclick: () => { i = Math.max(0, i - 1); draw(); } }, '→ اللي قبله'), h('button', { class: 'btn ghost', onclick: () => { i++; draw(); } }, 'تخطّي ←')),
        items[i + 1] ? h('div', { class: 'muted', style: 'text-align:center;margin-top:6px' }, `الجاي: ${items[i + 1].e.name} — ${longDate(items[i + 1].r.date)}`) : null);
    };
    draw(); if (!$('sheet').open) $('sheet').showModal();
  }
  $('sheet').addEventListener('close', () => $('sheet').classList.remove('full'));

  /* ======================= شاشة التقارير ======================= */
  function reportRange() {
    const today = todayKey();
    if (UI.rmode === 'range') {
      let { from, to } = UI.range; if (from > to) [from, to] = [to, from];
      return { from, to: to > today ? today : to, end: to, future: from > today, label: `من ${fmtDate(from)} لـ ${fmtDate(to)}`, tag: `${from}_to_${to}`, custom: true };
    }
    return Object.assign(monthRange(UI.month), { label: monthLabel(UI.month), tag: UI.month });
  }
  function periodSheet() {
    const today = todayKey(), lastM = monthOf(addDays(monthOf(today) + '-01', -1));
    const pick = (fn) => { fn(); $('sheet').close(); render(); };
    const opt = (l, sub, fn, on) => h('button', { class: 'li' + (on ? ' on' : ''), onclick: () => pick(fn) }, h('span', { class: 'grow' }, h('div', { class: 't' }, l), sub ? h('div', { class: 's' }, sub) : null));
    const mIn = h('input', { type: 'month', value: UI.month, min: startMonth(), max: monthOf(today) }), fIn = h('input', { type: 'date', value: UI.range.from, min: startDay() }), tIn = h('input', { type: 'date', value: UI.range.to, min: startDay() });
    openSheet([h('div', { class: 'grab' }), h('h2', null, 'الفترة'),
      h('div', { class: 'list' },
        opt('الشهر ده', monthLabel(monthOf(today)), () => { UI.rmode = 'month'; UI.month = monthOf(today); }, UI.rmode === 'month' && UI.month === monthOf(today)),
        lastM < startMonth() ? null : opt('الشهر اللي فات', monthLabel(lastM), () => { UI.rmode = 'month'; UI.month = lastM; }, UI.rmode === 'month' && UI.month === lastM),
        opt('آخر 7 أيام', null, () => { UI.rmode = 'range'; UI.range = { from: addDays(today, -6), to: today }; }),
        opt('آخر 30 يوم', null, () => { UI.rmode = 'range'; UI.range = { from: addDays(today, -29), to: today }; })),
      h('div', { class: 'sec-title' }, 'شهر معيّن'),
      h('div', { class: 'btns' }, h('div', { style: 'flex:1' }, mIn), h('button', { class: 'btn', onclick: () => mIn.value && pick(() => { UI.rmode = 'month'; UI.month = mIn.value; }) }, 'عرض')),
      h('div', { class: 'sec-title' }, 'من يوم لـ يوم'),
      h('div', { class: 'grid2' }, fIn, tIn),
      h('button', { class: 'btn primary block', style: 'margin-top:10px', onclick: () => fIn.value && tIn.value && pick(() => { UI.rmode = 'range'; UI.range = { from: fIn.value, to: tIn.value }; }) }, 'عرض الفترة')]);
  }
  function empPicker(ids, current, onPick) {
    const q = h('input', { type: 'search', placeholder: '🔍 ابحث بالاسم أو الكود', dir: 'auto' }), box = h('div', { class: 'list', style: 'max-height:55vh;overflow:auto' });
    const draw = () => {
      const hits = ids.filter(id => matchEmp(id, q.value));
      box.replaceChildren(
        !q.value ? h('button', { class: 'li' + (!current ? ' on' : ''), onclick: () => { $('sheet').close(); onPick(''); } }, h('span', { class: 'avatar' }, '٭'), h('span', { class: 'grow t' }, 'كل الموظفين')) : null,
        ...hits.map(id => h('button', { class: 'li' + (current === id ? ' on' : ''), onclick: () => { $('sheet').close(); onPick(id); } }, avatar(empName(id)), h('span', { class: 'grow' }, h('div', { class: 't' }, hl(empName(id), q.value)), h('div', { class: 's' }, hl('كود ' + id, q.value))))));
    };
    q.addEventListener('input', draw); draw();
    openSheet([h('div', { class: 'grab' }), h('h2', null, 'اختار موظف'), q, h('div', { style: 'height:8px' }), box]);
    setTimeout(() => q.focus(), 150);
  }
  function renderMonth() {
    const root = $('tab-month'), rng = reportRange();
    $('subtitle').textContent = '';
    const v = S.view;
    if (!['summary', 'detail', 'charts', 'log'].includes(v.type)) v.type = 'summary';
    const all = rng.future ? [] : computeRange(rng.from, rng.to);
    if (v.emp && !all.some(e => e.id === v.emp)) v.emp = '';
    const dd = (small, val, fn) => h('button', { class: 'dd', onclick: fn }, h('span', null, h('small', null, small), val), h('span', { html: ICON.chev, style: 'display:inline-flex;transform:rotate(-90deg)' }));
    const kids = [h('div', { class: 'fb' }, dd('الفترة', rng.label, periodSheet), dd('الموظف', v.emp ? empName(v.emp) : 'كل الموظفين', () => empPicker(all.map(e => e.id), v.emp, id => { v.emp = id; save(); render(); })))];
    if (rng.future) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'الفترة دي لسه مجتش'))); return; }
    if (!all.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'مفيش بيانات للفترة دي'))); return; }
    const list = v.emp ? all.filter(e => e.id === v.emp) : all;
    // محتاج انتباهك
    const pend = []; for (const e of list) for (const r of e.rows) if (r.code === 'pending' || r.code === 'missing') pend.push(r.date);
    pend.sort();
    const rv = reviewItems(rng.from, rng.to).filter(x => !v.emp || x.e.id === v.emp).length;
    if (pend.length || rv) kids.push(h('div', { class: 'attn' }, h('b', null, 'محتاج انتباهك'),
      pend.length ? h('div', { class: 'attn-r' }, h('span', null, h('i', { class: 'dot', style: 'background:var(--c4)' }), `${pend.length} تسجيل ناقص`), h('button', { class: 'btn sm', style: 'background:var(--amber-soft);color:var(--amber-ink)', onclick: () => UI.rmode === 'month' ? closeFlow(UI.month) : goDay(pend[0]) }, 'كمّل')) : null,
      rv ? h('div', { class: 'attn-r' }, h('span', null, h('i', { class: 'dot', style: 'background:var(--c2)' }), `${rv} تأخير/بدري: بإذن ولا لأ؟`), h('button', { class: 'btn sm', style: 'background:var(--violet-soft);color:var(--violet)', onclick: () => reviewSheet(rng.from, rng.to) }, 'راجع')) : null));
    else if (UI.rmode === 'month' && S.locked[UI.month]) kids.push(h('div', { class: 'banner lockb' }, h('span', null, `🔒 ${monthLabel(UI.month)} مقفول من ${fmtDate(S.locked[UI.month])}`), h('button', { class: 'btn sm', onclick: () => unlockMonth(UI.month) }, 'فتح')));
    else kids.push(h('div', { class: 'banner ok' }, h('span', null, rng.to < rng.end ? `كل الأيام لحد ${fmtDate(rng.to)} متسجلة ✓` : 'الفترة متسجّلة كاملة ✓'),
      UI.rmode === 'month' && rng.to >= rng.end && UI.month < monthOf(todayKey()) ? h('button', { class: 'btn sm', onclick: () => lockMonth(UI.month) }, '🔒 اقفل الشهر') : null));
    const tot = f => list.reduce((a, e) => a + (e.summary[f] || 0), 0);
    kids.push(h('div', { class: 'totals' },
      h('div', { class: 'total' }, h('b', null, D(tot('worked')).split(':')[0]), h('span', null, 'ساعة شغل')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, tot('absent')), h('span', null, 'يوم غياب')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, D(tot('late') + tot('short'))), h('span', null, tot('short') ? 'تأخير/نقص' : 'تأخير')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--green)' }, D(tot('overtime'))), h('span', null, 'زيادة'))));
    const tab = (t, l) => h('button', { class: v.type === t ? 'on' : '', onclick: () => { v.type = t; save(); render(); } }, l);
    const canX = v.type === 'summary' || v.type === 'detail';
    kids.push(h('div', { class: 'tabs' }, tab('summary', 'ملخص'), tab('detail', 'تفاصيل'), tab('charts', 'رسوم'), tab('log', 'أذونات'),
      canX ? h('button', { class: 'xl', 'aria-label': 'تحميل Excel', html: ICON.xls + '<span>Excel</span>', onclick: () => exportExcel(list, rng) }) : null,
      h('button', { class: 'xl', 'aria-label': 'كشوف PDF', html: '<span>📄 كشف</span>', onclick: () => statementSheet(list, rng, rng.label) })));
    if (v.type === 'log') kids.push(...logView(list));
    else if (v.type === 'charts') kids.push(...(v.emp ? empCharts(list[0], rng) : teamCharts(list, rng)));
    else if (v.type === 'summary') kids.push(insightsView(list, rng), summaryTable(list));
    else for (const e of list) kids.push(...detailTable(e));
    root.replaceChildren(...kids);
  }
  function summaryTable(list) {
    const max = Math.max(...list.map(e => e.summary.worked), 1);
    const sorted = [...list].sort((a, b) => b.summary.worked - a.summary.worked);
    return h('div', { class: 'list' },
      h('div', { class: 'st-row st-h' }, h('span', null, 'الموظف'), h('span', null, 'ساعات'), h('span', null, 'تأخير'), h('span', null, 'غياب'), h('span', null, 'زيادة')),
      sorted.map(e => { const s = e.summary; return h('button', { class: 'st-row', onclick: () => { S.view.emp = e.id; S.view.type = 'detail'; save(); render(); window.scrollTo(0, 0); } },
        h('span', { class: 'st-n' }, h('b', { dir: 'auto' }, e.name), s.pending + s.missing ? h('small', { style: 'color:var(--amber-ink)' }, `مستني ${s.pending + s.missing}`) : h('small', null, `حضور ${s.present + s.offwork} يوم`)),
        h('span', { class: 'st-h2' }, h('i', { style: `width:${(s.worked / max * 100).toFixed(0)}%` }), D(s.worked)),
        h('span', { class: s.late + s.short ? 'bad' : 'mut' }, D(s.late + s.short)), h('span', { class: s.absent ? 'bad' : 'mut' }, s.absent), h('span', { class: s.overtime ? 'good' : 'mut' }, D(s.overtime))); }));
  }


  /* ======================= ملاحظات ذكية ======================= */
  function insights(list, rng) {
    const today = todayKey(), out = [];
    const days = Math.round(E.dayNum(rng.to) - E.dayNum(rng.from)) + 1;
    if (days < 7 || !list.length) return out;
    const WD = E.DAY_NAMES, topDay = arr => { const c = {}; for (const r of arr) c[r.weekday] = (c[r.weekday] || 0) + 1; const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; return k == null ? null : { d: WD[+k], n: c[k] }; };
    const card = (emoji, cls, title, sub, strip) => ({ emoji, cls, title, sub, strip });
    // الأكتر تأخير
    const lateTop = list.map(e => ({ e, rows: e.rows.filter(r => r.late > 0) })).filter(x => x.rows.length >= 3).sort((a, b) => b.rows.length - a.rows.length)[0];
    if (lateTop) { const t = topDay(lateTop.rows), tot = lateTop.rows.reduce((a, r) => a + r.late, 0);
      out.push(card('⏰', 'i-r', `${lateTop.e.name} اتأخر ${lateTop.rows.length} مرات`, `${t && t.n >= 2 ? `أغلبهم يوم ${t.d} — ` : ''}إجمالي ${D(tot)}`, lateTop.e.rows.filter(r => r.date <= today && r.code !== 'off').map(r => r.late > 0))); }
    // انصراف بدري من غير إذن
    const earlyTop = list.map(e => ({ e, n: e.rows.filter(r => r.early > 0).length, ok: e.rows.filter(r => r.earlyExcused > 0).length })).filter(x => x.n + x.ok >= 2).sort((a, b) => b.n - a.n)[0];
    if (earlyTop && earlyTop.n) out.push(card('🚪', 'i-a', `${earlyTop.e.name} مشي بدري ${earlyTop.n + earlyTop.ok} مرات`, earlyTop.ok ? `${earlyTop.n} منهم من غير إذن` : 'كلهم من غير إذن'));
    // نقص ساعات
    const shortTop = list.map(e => ({ e, n: e.summary.shortDays, t: e.summary.short })).filter(x => x.n >= 2).sort((a, b) => b.t - a.t)[0];
    if (shortTop) out.push(card('⌛', 'i-a', `${shortTop.e.name} نقص ساعات ${shortTop.n} مرات`, `إجمالي ${D(shortTop.t)}`));
    // ملتزمين
    const perfect = list.filter(e => { const s = e.summary; return s.present + s.offwork >= 5 && !s.late && !s.early && !s.absent && !s.short && !s.pending && !s.missing; });
    if (perfect.length) out.push(card('⭐', 'i-g', perfect.length === 1 ? `${perfect[0].name} ملتزم 100%` : `${perfect.length} موظفين ملتزمين 100%`, perfect.length === 1 ? `مفيش تأخير ولا غياب${perfect[0].summary.overtime ? ' · زيادة ' + D(perfect[0].summary.overtime) : ''}` : perfect.slice(0, 3).map(e => e.name).join('، ') + (perfect.length > 3 ? ' …' : '')));
    // أكتر يوم غياب
    const abs = list.flatMap(e => e.rows.filter(r => r.code === 'absent'));
    const ad = topDay(abs); if (abs.length >= 3 && ad && ad.n >= 2) out.push(card('📅', 'i-v', `${ad.d} أكتر يوم فيه غياب`, `${ad.n} من ${abs.length} حالات غياب كانت يوم ${ad.d}`));
    // مقارنة بالفترة اللي قبلها
    const len = Math.round(E.dayNum(rng.to) - E.dayNum(rng.from)) + 1;
    const pTo = addDays(rng.from, -1), pFrom = addDays(rng.from, -len);
    const ids = new Set(list.map(e => e.id)), prev = computeRange(pFrom, pTo).filter(e => ids.has(e.id));
    const lateNow = list.reduce((a, e) => a + e.summary.late, 0), latePrev = prev.reduce((a, e) => a + e.summary.late, 0);
    if (prev.length && prev.some(e => e.summary.present > 3) && latePrev > 0) {
      const ch = Math.round((lateNow - latePrev) / latePrev * 100);
      if (Math.abs(ch) >= 15) out.push(card(ch < 0 ? '📉' : '📈', ch < 0 ? 'i-g' : 'i-r', `التأخير ${ch < 0 ? 'قلّ' : 'زاد'} ${Math.abs(ch)}% عن ${UI.rmode === 'month' ? 'الشهر اللي فات' : 'الفترة اللي قبلها'}`, `من ${D(latePrev)} لـ ${D(lateNow)}`));
    }
    return out.slice(0, 5);
  }
  function insightsView(list, rng) {
    const cards = insights(list, rng); if (!cards.length) return null;
    return h('div', { class: 'ins-wrap' }, h('div', { class: 'sec-title', style: 'margin-top:0' }, '💡 ملاحظات الفترة'),
      cards.map(c => h('div', { class: 'ins ' + c.cls }, h('span', { class: 'ins-e' }, c.emoji), h('div', { class: 'grow' }, h('b', { dir: 'auto' }, c.title), h('span', null, c.sub),
        c.strip && c.strip.length ? h('div', { class: 'ins-strip' }, c.strip.slice(-31).map(x => h('i', { class: x ? 'on' : '' }))) : null))));
  }

  /* ======================= البحث ======================= */
  const normAr = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  function matchEmp(id, q) { q = normAr(q).trim(); if (!q) return true; return normAr(empName(id)).includes(q) || String(id).includes(q); }
  function hl(text, q) { // يعلّم على الجزء اللي بيطابق البحث
    q = normAr(q).trim(); if (!q) return text;
    const map = [], chars = [...text]; let n = '';
    chars.forEach((c, i) => { const nc = normAr(c); for (const x of nc) { n += x; map.push(i); } });
    const at = n.indexOf(q); if (at < 0) return text;
    const a = map[at], b = map[at + q.length - 1] + 1;
    return h('span', null, chars.slice(0, a).join(''), h('mark', null, chars.slice(a, b).join('')), chars.slice(b).join(''));
  }
  function openSearch() {
    const today = todayKey(), tm = monthRange(monthOf(today));
    const dayRes = Object.fromEntries(computeRange(today, today).filter(e => e.rows.length).map(e => [e.id, e.rows[0]]));
    const monRes = Object.fromEntries(computeRange(tm.from, tm.to).map(e => [e.id, e.summary]));
    let filter = 'all';
    const ov = h('div', { class: 'search-ov', role: 'dialog', 'aria-label': 'بحث' });
    const q = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو بالكود', dir: 'auto', enterkeyhint: 'search' });
    const close = () => { ov.remove(); UI.searchOpen = null; };
    const fb = (v, l) => h('button', { class: 'sf' + (filter === v ? ' on' : ''), onclick: () => { filter = v; draw(); } }, l);
    const chipsBox = h('div', { class: 'sfs' }), res = h('div', { class: 'sres' });
    const go2 = id => { S.recent = [id, ...(S.recent || []).filter(x => x !== id)].slice(0, 6); save(); close(); openProfile(id); };
    function draw() {
      chipsBox.replaceChildren(fb('all', 'الكل'), fb('active', 'شغالين'), fb('gone', 'سابوا'), fb('need', 'مستنيين النهارده'));
      const gone = id => S.employees[id].end && S.employees[id].end < today;
      const ids = sortedIds().filter(id => matchEmp(id, q.value)).filter(id => filter === 'all' || (filter === 'active' && !gone(id)) || (filter === 'gone' && gone(id)) || (filter === 'need' && dayRes[id] && ['pending', 'missing'].includes(dayRes[id].code)));
      const kids = [];
      if (!q.value && (S.recent || []).length) kids.push(h('div', { class: 'sec-title' }, 'آخر بحث'), h('div', { class: 'qchips' }, S.recent.filter(id => S.employees[id]).map(id => h('button', { class: 'qchip', onclick: () => go2(id) }, empName(id)))));
      kids.push(h('div', { class: 'sec-title' }, q.value ? `${ids.length} نتيجة` : 'كل الموظفين'));
      if (!ids.length) kids.push(h('div', { class: 'card empty' }, 'مفيش موظف بالاسم أو الكود ده'));
      else kids.push(h('div', { class: 'list' }, ids.map(id => {
        const r = dayRes[id], s = monRes[id], e = { id, name: empName(id) };
        const sub = [r ? 'النهارده: ' + rowSub(r) : gone(id) ? `ساب ${fmtDate(S.employees[id].end)}` : null, s ? `الشهر: ${D(s.worked)} س${s.late ? ' · تأخير ' + D(s.late) : ''}` : null].filter(Boolean).join(' · ');
        const need = r && ['pending', 'missing'].includes(r.code);
        return h('div', { class: 'li2' + (need ? ' need' : ''), role: 'button', tabindex: 0, onclick: () => go2(id) },
          avatar(e.name, need ? 'warn' : ''),
          h('div', { class: 'grow' }, h('div', { class: 't' }, h('span', { dir: 'auto' }, hl(e.name, q.value)), h('small', null, hl('كود ' + id, q.value))), h('div', { class: 's' }, sub),
            r && r.code === 'pending' ? quickActions(e, r) : null),
          r ? h('span', { class: 'pill c-' + r.code }, statusLabel(r, false)) : null);
      })));
      res.replaceChildren(...kids);
    }
    q.addEventListener('input', draw);
    ov.append(h('div', { class: 'search-top' }, h('div', { class: 'srch' }, h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>', style: 'display:inline-flex' }), q, h('button', { class: 'btn ghost sm', onclick: close }, 'إلغاء')), chipsBox), res);
    document.body.append(ov); UI.searchOpen = { close, draw }; draw(); setTimeout(() => q.focus(), 50);
  }

  /* ======================= ملف الموظف ======================= */
  function renderProfile(id) {
    const root = $('tab-emps'), emp = S.employees[id];
    if (!emp) { UI.profile = ''; renderEmps(); return; }
    $('subtitle').textContent = 'كود ' + id;
    const m = UI.pmonth, rng = monthRange(m), today = todayKey();
    const res = rng.future ? null : computeRange(rng.from, rng.end).find(e => e.id === id);
    const sh = S.settings.shifts.find(s => s.id === emp.shift);
    const chips = [sh ? 'شيفت ' + sh.name : 'شيفت تلقائي', E.hoursOf(emp) ? `${+emp.hours} ساعات` : 'ساعات الشيفت', emp.off !== '' && emp.off != null ? 'إجازته ' + E.DAY_NAMES[+emp.off] : 'يوم الإجازة مش متحدد ⚠', emp.start ? 'من ' + fmtDate(emp.start) : null, emp.end ? 'ساب ' + fmtDate(emp.end) : null].filter(Boolean);
    const shiftM = d => { const [y, mo] = m.split('-').map(Number), t = new Date(y, mo - 1 + d, 1); UI.pmonth = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; UI.pday = ''; render(); };
    const kids = [
      h('button', { class: 'btn ghost sm', style: 'margin:-4px 0 6px', onclick: () => { UI.profile = ''; render(); } }, '→ كل الموظفين'),
      h('div', { class: 'prof' }, avatar(empName(id), 'big'), h('div', { class: 'grow' }, h('div', { class: 'prof-n', dir: 'auto' }, empName(id)), h('div', { class: 'muted' }, 'كود ' + id), h('div', { class: 'qchips', style: 'margin-top:6px' }, chips.map(c => h('span', { class: 'mini' }, c))))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => quickSheet({ ids: [id] }) }, 'تسجيل إذن'),
        h('button', { class: 'btn', disabled: !res, onclick: () => statementSheet([computeRange(rng.from, rng.to).find(e => e.id === id)], Object.assign(rng, { label: monthLabel(m), tag: m }), monthLabel(m)) }, '📄 كشف'),
        h('button', { class: 'btn', onclick: () => empSheet(id) }, 'تعديل البيانات')),
      navBar(monthLabel(m), '', 'month', m, v => { UI.pmonth = v; UI.pday = ''; render(); }, () => shiftM(-1), () => shiftM(1))];
    if (!res || !res.rows.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, rng.future ? 'الشهر ده لسه مجاش' : 'مكنش شغال الشهر ده')); return; }
    const past = res.rows.filter(r => r.date <= today), s = { worked: 0, absent: 0, late: 0, overtime: 0 };
    for (const r of past) { s.worked += r.worked || 0; s.absent += r.code === 'absent' ? 1 : 0; s.late += (r.late || 0) + (r.short || 0); s.overtime += r.overtime || 0; }
    kids.push(h('div', { class: 'totals' },
      h('div', { class: 'total' }, h('b', null, D(s.worked)), h('span', null, 'ساعات')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, s.absent), h('span', null, 'غياب')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, D(s.late)), h('span', null, 'تأخير')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--green)' }, D(s.overtime)), h('span', null, 'زيادة'))));
    // التقويم (السبت أول الأسبوع)
    const byDate = Object.fromEntries(res.rows.map(r => [r.date, r]));
    const first = rng.from, lead = (E.weekday(first) + 1) % 7, n = +rng.end.slice(8);
    const cal = [...['سبت', 'حد', 'اتنين', 'تلات', 'أربع', 'خميس', 'جمعة'].map(d => h('div', { class: 'cal-h' }, d))];
    for (let i = 0; i < lead; i++) cal.push(h('div'));
    for (let d = 1; d <= n; d++) {
      const k = `${m}-${pad(d)}`, r = byDate[k], fut = k > today;
      if (!r) { cal.push(h('div', { class: 'cal-d g-out' }, d)); continue; }
      const small = fut ? '' : r.worked != null ? D(r.worked) : r.code === 'excused' ? 'بإذن' : r.code === 'leave' ? 'إجازة' : r.code === 'absent' ? 'غياب' : r.code === 'off' ? '' : r.code === 'pending' ? '؟' : r.code === 'missing' ? 'ناقص' : '';
      cal.push(h('button', { class: 'cal-d ' + (fut ? (r.code === 'pending' ? 'g-fut' : 'gs-' + r.code) : 'gs-' + r.code) + (UI.pday === k ? ' sel' : '') + (k === today ? ' today' : ''), onclick: () => { UI.pday = UI.pday === k ? '' : k; render(); } }, d, h('small', null, small)));
    }
    kids.push(h('div', { class: 'cal' }, cal));
    const lg = (cls, l) => h('span', null, h('i', { class: cls }), l);
    kids.push(h('div', { class: 'legend' }, lg('gs-present', 'حاضر'), lg('gs-excused', 'بإذن/إجازة'), lg('gs-absent', 'غياب'), lg('gs-pending', 'ناقص'), lg('gs-off', 'إجازة أسبوعية'), lg('gs-holiday', 'إجازة رسمية')));
    const showDays = UI.pday ? [byDate[UI.pday]].filter(Boolean) : past.slice().reverse().filter(r => r.code !== 'off').slice(0, 5);
    kids.push(h('div', { class: 'sec-title' }, UI.pday ? longDate(UI.pday) : 'آخر الأيام'));
    kids.push(h('div', { class: 'list' }, showDays.map(r => {
      const k = id + '|' + r.date, notes = S.notes[k] || [];
      return h('div', { class: 'li2', role: 'button', tabindex: 0, onclick: () => openEditor(id, r.date) },
        h('div', { class: 'grow' }, h('div', { class: 't' }, longDate(r.date)), h('div', { class: 's' }, rowSub(r)),
          flagsOf(r, k).filter(f => !f.classList.contains('n')).length ? h('div', { class: 'flags' }, flagsOf(r, k).filter(f => !f.classList.contains('n'))) : null,
          notes.map(nn => h('div', { class: 'note-line', dir: 'auto' }, nn.text))),
        h('span', { class: 'pill c-' + pillCode(r, r.date > today) }, statusLabel(r, r.date > today)));
    })));
    root.replaceChildren(...kids);
  }
  /* ======================= الرسوم البيانية ======================= */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
  const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  function legend(series) { return h('div', { class: 'legend' }, series.map(s => h('span', null, h('i', { style: `background:${s.color}` }), s.name))); }
  function chartCard(title, sub, ...body) { return h('div', { class: 'card chart' }, h('h2', null, title), sub ? h('p', { class: 'muted', style: 'margin:-6px 0 10px' }, sub) : null, ...body); }

  /** أعمدة أفقية: موظف لكل صف، القيمة على طرف العمود */
  function hBars(title, sub, items, color, fmt) {
    const max = Math.max(...items.map(i => i.value), 0) || 1;
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return chartCard(title, sub, h('div', { class: 'hbars' }, sorted.map(i => h('div', { class: 'hb', title: `${i.label}: ${fmt(i.value)}` },
      h('span', { class: 'hb-l', dir: 'auto' }, i.label),
      h('span', { class: 'hb-t' }, i.value > 0 ? h('span', { class: 'hb-b', style: `width:${Math.max(2, i.value / max * 100)}%;background:${color}` }) : null),
      h('span', { class: 'hb-v' }, fmt(i.value))))));
  }

  /** أعمدة يوم بيوم (مكدّسة لو أكتر من سلسلة)، اليوم الأول على اليمين */
  const niceMinutes = v => v <= 15 ? 15 : v <= 30 ? 30 : v <= 60 ? 60 : niceMax(v / 60) * 60;
  function dayColumns(title, sub, days, series, fmt, tip, ref, minutes) {
    const W = 340, H = 170, T = 10, B = 22, R = 30, L = 4, pw = W - R - L, ph = H - T - B, n = days.length;
    const totals = days.map(d => d.vals.reduce((a, b) => a + b, 0));
    const top = Math.max(...totals, ref ? ref.value : 0), max = minutes ? niceMinutes(top) : niceMax(top);
    const y = v => T + ph - v / max * ph, slot = pw / n, bw = Math.max(2, Math.min(16, slot * 0.68));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cols', role: 'img', 'aria-label': title, direction: 'ltr' });
    for (const t of [0, max / 2, max]) {
      svg.append(sv('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid' }));
      const tx = sv('text', { x: W - R + 4, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'start' }); tx.textContent = fmt(t); svg.append(tx);
    }
    const cap = h('div', { class: 'cap' }, 'اضغط على أي يوم يظهرلك تفاصيله');
    const hl = sv('rect', { y: T, height: ph, width: slot, class: 'hl', opacity: 0 }); svg.append(hl);
    const every = Math.max(1, Math.ceil(n / 8));
    days.forEach((d, i) => {
      const cx = W - R - (i + 0.5) * slot, x = cx - bw / 2;
      let acc = 0; const segs = d.vals.map((v, si) => ({ v, si })).filter(o => o.v > 0);
      segs.forEach((o, j) => {
        const y0 = y(acc), y1 = y(acc + o.v), gap = j > 0 ? 2 : 0, hgt = Math.max(0, y0 - y1 - gap); acc += o.v;
        if (hgt <= 0) return;
        const top = j === segs.length - 1, r = Math.min(3, hgt, bw / 2), yt = y0 - gap - hgt;
        const dpath = top ? `M${x},${y0 - gap} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${y0 - gap} Z` : `M${x},${y0 - gap} V${yt} H${x + bw} V${y0 - gap} Z`;
        svg.append(sv('path', { d: dpath, style: `fill:${series[o.si].color}` }));
      });
      if (i % every === 0 || (i === n - 1 && (n - 1) % every >= every * 0.6)) { const tx = sv('text', { x: cx, y: H - 6, class: 'tick', 'text-anchor': 'middle' }); tx.textContent = d.label; svg.append(tx); }
      const hit = sv('rect', { x: cx - slot / 2, y: T, width: slot, height: ph + B, fill: 'transparent', style: 'cursor:pointer' });
      const show = () => { cap.textContent = tip(d) || `${dayTip(d.key)}: مفيش بيانات`; hl.setAttribute('x', cx - slot / 2); hl.setAttribute('opacity', 1); };
      hit.addEventListener('pointerenter', show); hit.addEventListener('click', show);
      svg.append(hit);
    });
    if (ref && ref.value > 0) {
      svg.append(sv('line', { x1: L, x2: W - R, y1: y(ref.value), y2: y(ref.value), class: 'ref' }));
    }
    return chartCard(title, sub, series.length > 1 ? legend(series) : null, svg, cap);
  }
  function rangeDays(rng) { const out = []; for (let k = rng.from; k <= rng.to; k = addDays(k, 1)) out.push(k); return out; }
  const dayLbl = k => String(+k.slice(8));
  const dayTip = k => `${E.DAY_NAMES[E.weekday(k)]} ${fmtDate(k)}`;
  const hrs = m => D(Math.round(m));
  const STATUS_SERIES = [
    { name: 'حاضر', color: 'var(--c1)', codes: ['present', 'offwork'] },
    { name: 'بإذن/إجازة', color: 'var(--c2)', codes: ['excused', 'leave', 'off'] },
    { name: 'غياب', color: 'var(--c3)', codes: ['absent'] },
    { name: 'مستني تسجيل', color: 'var(--c4)', codes: ['pending', 'missing'] }];

  function teamCharts(list, rng) {
    const ks = rangeDays(rng);
    const byDay = ks.map(k => {
      const rows = list.map(e => e.rows.find(r => r.date === k)).filter(Boolean);
      return { key: k, label: dayLbl(k), vals: STATUS_SERIES.map(s => rows.filter(r => s.codes.includes(r.code)).length) };
    });
    const out = [dayColumns('الحضور يوم بيوم', 'عدد الموظفين في كل حالة', byDay, STATUS_SERIES, v => Number.isInteger(v) ? String(v) : '',
      d => d.vals.some(Boolean) ? `${dayTip(d.key)}: ` + STATUS_SERIES.map((s, i) => d.vals[i] ? `${s.name} ${d.vals[i]}` : null).filter(Boolean).join(' · ') : `${dayTip(d.key)}: مفيش موظفين شغالين`)];
    const it = f => list.map(e => ({ label: e.name, value: e.summary[f] || 0 }));
    out.push(hBars('ساعات الشغل', 'إجمالي الساعات لكل موظف في الفترة', it('worked'), 'var(--c1)', hrs));
    out.push(hBars('التأخير', 'بعد فترة السماح ومن غير التأخير بإذن', it('late'), 'var(--c3)', hrs));
    out.push(hBars('الانصراف بدري', 'من غير الانصراف بإذن', it('early'), 'var(--c3)', hrs));
    out.push(hBars('الزيادة', 'الوقت بعد نهاية اليوم المطلوب', it('overtime'), 'var(--c1)', hrs));
    out.push(hBars('أيام الغياب', null, it('absent'), 'var(--c3)', v => String(v)));
    return out;
  }
  function empCharts(e, rng) {
    const ks = rangeDays(rng), rowOf = k => e.rows.find(r => r.date === k);
    const reqs = e.rows.map(r => r.required).filter(Boolean).sort((a, b) => a - b), req = reqs.length ? reqs[Math.floor(reqs.length / 2)] : 0;
    const mk = (f, div = 1) => ks.map(k => { const r = rowOf(k); return { key: k, label: dayLbl(k), r, vals: [r && r[f] ? r[f] / div : 0] }; });
    const tipRow = d => `${dayTip(d.key)}: ` + (d.r ? (d.r.worked != null ? `${C(d.r.in)}–${C(d.r.out)} · ${D(d.r.worked)} ساعة${d.r.late ? ' · تأخير ' + D(d.r.late) : ''}${d.r.overtime ? ' · زيادة ' + D(d.r.overtime) : ''}` : d.r.status) : 'مكنش شغال');
    const out = [dayColumns('ساعات الشغل يوم بيوم', req ? `${e.name} · الخط الرمادي = المطلوب ${D(req)}` : e.name, mk('worked', 60), [{ name: 'ساعات', color: 'var(--c1)' }], v => String(+v.toFixed(1)), tipRow, req ? { value: req / 60, label: `المطلوب ${D(req)}` } : null)];
    const s = e.summary, parts = STATUS_SERIES.map(x => ({ ...x, n: e.rows.filter(r => x.codes.includes(r.code)).length })).filter(x => x.n);
    const totalDays = parts.reduce((a, b) => a + b.n, 0) || 1;
    out.push(chartCard('توزيع الأيام', `${e.rows.length} يوم في الفترة`, legend(parts.map(p => ({ name: `${p.name} ${p.n}`, color: p.color }))),
      h('div', { class: 'stackbar' }, parts.map(p => h('span', { style: `flex:${p.n / totalDays};background:${p.color}`, title: `${p.name}: ${p.n}` })))));
    if (s.late) out.push(dayColumns('التأخير يوم بيوم', `إجمالي ${D(s.late)}`, mk('late'), [{ name: 'تأخير', color: 'var(--c3)' }], D, tipRow, null, true));
    if (s.overtime) out.push(dayColumns('الزيادة يوم بيوم', `إجمالي ${D(s.overtime)}`, mk('overtime'), [{ name: 'زيادة', color: 'var(--c1)' }], D, tipRow, null, true));
    return out;
  }
  function monthRow(e) {
    const s = e.summary, c = (label, val, color) => val ? h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${color}` }), label, h('b', null, val)) : null;
    return h('button', { class: 'mrow', onclick: () => { S.view.emp = e.id; S.view.type = 'detail'; save(); render(); window.scrollTo(0, 0); } },
      h('div', { class: 'mrow-top' }, h('div', null, h('div', { class: 'emp-name', dir: 'auto' }, e.name), h('div', { class: 'emp-meta' }, `كود ${e.id}${e.offDay ? ' · إجازته ' + e.offDay : ''}`)),
        h('div', { class: 'hrs' }, D(s.worked), h('small', null, s.required ? ` من ${D(s.required)}` : ' ساعة'))),
      h('div', { class: 'chips' },
        c('حضور', s.present + s.offwork, 'var(--green)'), c('غياب', s.absent, 'var(--rose)'), c('غياب بإذن', s.excused, 'var(--violet)'), c('إجازة', s.leave, 'var(--violet)'),
        c('تأخير', s.late ? D(s.late) : 0, 'var(--rose)'), c('بدري', s.early ? D(s.early) : 0, 'var(--rose)'), c('زيادة', s.overtime ? D(s.overtime) : 0, 'var(--green)'),
        c('مستني', s.pending + s.missing, 'var(--amber-ink)')));
  }
  const DETAIL_COLS = ['اليوم', 'الحالة', 'الحضور', 'الانصراف', 'ساعات', 'تأخير', 'بدري', 'زيادة', 'الشيفت', 'إذن', 'ملاحظات'];
  const notesText = (id, date) => (S.notes[id + '|' + date] || []).map(n => n.text).join(' | ');
  function detailTable(e) {
    const s = e.summary, td = (v, cls) => h('td', { class: cls || null }, v || '');
    const body = e.rows.map(r => h('tr', { onclick: () => goDay(r.date, e.id) },
      td(`${E.DAY_NAMES[r.weekday]} ${+r.date.slice(8)}`), h('td', null, h('span', { class: 'pill c-' + r.code }, r.status)),
      td(C(r.in)), td(C(r.out)), td(D(r.worked)), td(r.late ? D(r.late) : r.short ? 'نقص ' + D(r.short) : '', 'bad'), td(r.early ? D(r.early) : '', 'bad'), td(r.overtime ? D(r.overtime) : '', 'good'),
      td(r.shift), td([r.lateExcused ? 'تأخير ' + D(r.lateExcused) : '', r.earlyExcused ? 'بدري ' + D(r.earlyExcused) : ''].filter(Boolean).join(' · ')),
      h('td', { class: 'note-td', dir: 'auto' }, notesText(e.id, r.date))));
    const tot = h('tr', { class: 'tot' }, h('td', { colspan: 2 }, 'الإجمالي'), td(''), td(''), td(D(s.worked)), td(D(s.late)), td(D(s.early)), td(D(s.overtime)), td(''),
      td([s.lateExcused ? 'تأخير ' + D(s.lateExcused) : '', s.earlyExcused ? 'بدري ' + D(s.earlyExcused) : ''].filter(Boolean).join(' · ')), td(''));
    return [h('div', { class: 'emp-title' }, h('span', { dir: 'auto' }, e.name), h('span', { class: 'muted' }, 'اضغط على أي يوم تعدّله')),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, DETAIL_COLS.map(c => h('th', null, c)))), h('tbody', null, body, tot)))];
  }

  /* ======================= Excel ======================= */
  async function exportExcel(list, rng, opts) {
    try { await needXLSX(); } catch (e) { toast(e.message); return; }
    opts = opts || { type: S.view.type, single: !!S.view.emp };
    const dur = min => ({ t: 'n', v: (min || 0) / 1440, z: '[h]:mm' }), txt = v => ({ t: 's', v: v == null ? '' : String(v) }), num = v => ({ t: 'n', v: v || 0 });
    const isSum = opts.type === 'summary', single = opts.single;
    const title = `${isSum ? 'تقرير شامل' : 'تقرير مفصّل'} — ${single ? list[0].name : 'كل الموظفين'} — ${rng.custom ? `من ${fmtDate(rng.from)} إلى ${fmtDate(rng.to)}` : `${rng.label} (من ${fmtDate(rng.from)} إلى ${fmtDate(rng.to)})`}`;
    const aoa = [[txt(title)], []]; let widths;
    if (isSum) {
      const head = ['الكود', 'الاسم', 'يوم الإجازة', 'الساعات المطلوبة', 'أيام الحضور', 'أيام الغياب', 'غياب بإذن', 'إجازة', 'إجازة أسبوعية', 'إجازات رسمية', 'شغل يوم إجازة', 'مستني تسجيل', 'ساعات العمل', 'التأخير', 'أيام التأخير', 'تأخير بإذن', 'انصراف بدري', 'أيام الانصراف بدري', 'انصراف بدري بإذن', 'نقص ساعات', 'نقص بإذن', 'الزيادة'];
      aoa.push(head.map(txt));
      for (const e of list) { const s = e.summary; aoa.push([txt(e.id), txt(e.name), txt(e.offDay), dur(s.required), num(s.present + s.offwork), num(s.absent), num(s.excused), num(s.leave), num(s.off), num(s.holiday), num(s.offwork), num(s.pending + s.missing), dur(s.worked), dur(s.late), num(s.lateDays), dur(s.lateExcused), dur(s.early), num(s.earlyDays), dur(s.earlyExcused), dur(s.short), dur(s.shortExcused), dur(s.overtime)]); }
      widths = [8, 24, 11, 14, 11, 11, 10, 8, 13, 12, 13, 12, 12, 10, 11, 11, 12, 16, 16, 11, 10, 10];
    } else {
      aoa.push(['الكود', 'الاسم', 'التاريخ', 'اليوم', 'الشيفت', 'الحضور', 'الانصراف', 'ساعات العمل', 'التأخير', 'تأخير بإذن', 'انصراف بدري', 'انصراف بإذن', 'نقص ساعات', 'الزيادة', 'الحالة', 'ملاحظات'].map(txt));
      for (const e of list) {
        for (const x of e.rows) aoa.push([txt(e.id), txt(e.name), txt(fmtDate(x.date)), txt(x.dayName), txt(x.shift), txt(C(x.in)), txt(C(x.out)),
          x.worked == null ? txt('') : dur(x.worked), x.late ? dur(x.late) : txt(''), x.lateExcused ? dur(x.lateExcused) : txt(''),
          x.early ? dur(x.early) : txt(''), x.earlyExcused ? dur(x.earlyExcused) : txt(''), x.short ? dur(x.short) : txt(''), x.overtime ? dur(x.overtime) : txt(''), txt(x.status), txt(notesText(e.id, x.date))]);
        const s = e.summary;
        aoa.push([txt(''), txt(`إجمالي ${e.name}`), txt(''), txt(''), txt(''), txt(''), txt(''), dur(s.worked), dur(s.late), dur(s.lateExcused), dur(s.early), dur(s.earlyExcused), dur(s.overtime),
          txt(`حضور ${s.present + s.offwork} · غياب ${s.absent} · غياب بإذن ${s.excused} · إجازة ${s.leave + s.off}${s.pending + s.missing ? ' · مستني تسجيل ' + (s.pending + s.missing) : ''}`)]);
        aoa.push([]);
      }
      widths = [8, 22, 12, 10, 9, 9, 9, 11, 9, 11, 11, 12, 10, 9, 20, 40];
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: widths.length - 1 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isSum ? 'شامل' : 'مفصل');
    wb.Workbook = { Views: [{ RTL: true }] };
    const fname = `attendance_${rng.tag}_${isSum ? 'summary' : 'detailed'}${single ? '_emp' + list[0].id : '_all'}.xlsx`;
    saveFile(fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }))
      .catch(err => toast('مقدرتش أحفظ الملف: ' + (err.message || err)));
  }

  /* ======================= التسجيل السريع ======================= */
  const QTYPES = [
    { v: 'late', label: 'تأخير بإذن' }, { v: 'early', label: 'انصراف بدري بإذن' },
    { v: 'excused', label: 'غياب بإذن' }, { v: 'absent', label: 'غياب بدون إذن' },
    { v: 'leave', label: 'إجازة' }, { v: 'short', label: 'نقص ساعات بإذن' }, { v: 'note', label: 'ملاحظة بس' }];
  const QLABEL = Object.fromEntries(QTYPES.map(t => [t.v, t.label]));
  /** اليوم الافتراضي: بعد 12 بالليل ولحد آخر اليوم (5 الفجر) يبقى اليوم اللي لسه خالص */
  function defaultQuickDate() { const h = new Date().getHours(); return h < (S.settings.dayCutHour ?? 5) ? addDays(todayKey(), -1) : todayKey(); }
  function activeOn(date) { return sortedIds().filter(id => { const e = S.employees[id]; return !(e.end && date > e.end) && !(e.start && date < e.start); }); }
  function quickSheet(preset) {
    UI.editor = null; $('sheet').classList.remove('full');
    const st = { ids: new Set((preset && preset.ids) || []), date: (preset && preset.date) || defaultQuickDate(), type: (preset && preset.type) || '' };
    const draw = () => {
      const today = todayKey(), ids = activeOn(st.date);
      const chip = (on, label, onclick, cls) => h('button', { class: 'qchip' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), onclick }, label);
      const dateChips = [['امبارح', addDays(today, -1)], ['النهارده', today], ['بكرة', addDays(today, 1)]];
      const note = h('textarea', { rows: 2, dir: 'auto', placeholder: st.type === 'note' ? 'اكتب الملاحظة' : 'السبب أو أي ملاحظة (اختياري)' }); note.value = st.noteText || '';
      note.addEventListener('input', () => { st.noteText = note.value; });
      const msg = h('div');
      const saveBtn = h('button', { class: 'btn primary block', onclick: () => {
        const text = (note.value || '').trim();
        if (!st.ids.size) return msg.replaceChildren(h('div', { class: 'warn-line' }, 'اختار موظف واحد على الأقل'));
        if (!st.type) return msg.replaceChildren(h('div', { class: 'warn-line' }, 'اختار النوع'));
        if (st.type === 'note' && !text) { note.focus(); return msg.replaceChildren(h('div', { class: 'warn-line' }, 'اكتب الملاحظة')); }
        if (isLocked(st.date)) return msg.replaceChildren(h('div', { class: 'warn-line' }, `🔒 ${monthLabel(monthOf(st.date))} مقفول — افتحه الأول`));
        $('sheet').close();
        undoable(`اتسجّل: ${QLABEL[st.type]} — ${[...st.ids].map(empName).join('، ')}`, () => { for (const id of st.ids) applyQuick(id, st.date, st.type, text); });
      } }, 'حفظ');
      $('sheet-in').replaceChildren(
        h('h2', null, 'تسجيل سريع'),
        h('label', { class: 'f' }, 'الموظف (ممكن أكتر من واحد)'),
        h('div', { class: 'qchips' }, ids.length ? ids.map(id => chip(st.ids.has(id), empName(id), () => { st.ids.has(id) ? st.ids.delete(id) : st.ids.add(id); draw(); })) : h('span', { class: 'muted' }, 'مفيش موظفين شغالين اليوم ده')),
        h('label', { class: 'f', style: 'margin-top:12px' }, 'اليوم'),
        h('div', { class: 'qchips' }, dateChips.map(([l, d]) => chip(st.date === d, l, () => { st.date = d; draw(); })),
          h('label', { class: 'qchip qdate' + (dateChips.some(([, d]) => d === st.date) ? '' : ' on') }, dateChips.some(([, d]) => d === st.date) ? 'يوم تاني' : longDate(st.date),
            h('input', { type: 'date', value: st.date, onchange: ev => { if (ev.target.value) { st.date = ev.target.value; draw(); } } }))),
        h('label', { class: 'f', style: 'margin-top:12px' }, 'النوع'),
        h('div', { class: 'qtypes' }, QTYPES.map(t => chip(st.type === t.v, t.label, () => { st.type = t.v; draw(); }, 'q-' + t.v))),
        h('div', { style: 'margin-top:12px' }, note), msg,
        h('div', { style: 'margin-top:12px' }, saveBtn));
    };
    draw(); if (!$('sheet').open) $('sheet').showModal();
  }
  function applyQuick(id, date, type, text) {
    const k = id + '|' + date;
    if (type === 'late' || type === 'early' || type === 'short') { S.perms[k] = Object.assign({}, S.perms[k] || {}, { [type]: true }); delete (S.reviewed || {})[k + '|' + type]; }
    else if (type === 'excused' || type === 'absent' || type === 'leave') { setManual(id, date, { absence: type, in: null, out: null }); UI.openPresent.delete(k); }
    if (text) (S.notes[k] = S.notes[k] || []).push({ text, type, at: new Date().toISOString() });
  }
  $('fab').addEventListener('click', () => quickSheet(UI.tab === 'day' ? { date: UI.date <= todayKey() ? UI.date : defaultQuickDate() } : null));

  /* ======================= مراجعة التأخير والانصراف بدري ======================= */
  function reviewItems(from, to) {
    const out = [];
    for (const e of computeRange(from, to)) for (const r of e.rows) {
      const k = e.id + '|' + r.date;
      if (isLocked(r.date)) continue;
      if (r.late > 0 && !S.reviewed[k + '|late']) out.push({ e, r, kind: 'late', amount: r.late });
      if (r.early > 0 && !S.reviewed[k + '|early']) out.push({ e, r, kind: 'early', amount: r.early });
      if (r.short > 0 && !S.reviewed[k + '|short']) out.push({ e, r, kind: 'short', amount: r.short });
    }
    return out.sort((a, b) => a.r.date.localeCompare(b.r.date) || a.e.id.localeCompare(b.e.id, undefined, { numeric: true }));
  }
  function reviewSheet(from, to) {
    UI.editor = null; $('sheet').classList.remove('full');
    const draw = () => {
      const items = reviewItems(from, to);
      if (!items.length) { $('sheet').close(); toast('خلصت المراجعة ✓'); render(); return; }
      const mark = (it, ok) => { const k = it.e.id + '|' + it.r.date; if (ok) S.perms[k] = Object.assign({}, S.perms[k] || {}, { [it.kind]: true }); else S.reviewed[k + '|' + it.kind] = 1; save(); draw(); };
      $('sheet-in').replaceChildren(
        h('h2', null, 'مراجعة سريعة'),
        h('p', { class: 'muted', style: 'margin:-6px 0 10px' }, `${items.length} حالة تأخير أو انصراف بدري ملهاش إذن متسجّل. افتكر وعلّم على كل واحدة:`),
        h('div', { class: 'rv-list' }, items.map(it => h('div', { class: 'rv' },
          h('div', null, h('b', { dir: 'auto' }, it.e.name), h('div', { class: 'muted' }, `${longDate(it.r.date)} — ${it.kind === 'late' ? `تأخير ${D(it.amount)} (حضر ${C(it.r.in)})` : it.kind === 'short' ? `نقص ساعات ${D(it.amount)} (اشتغل ${D(it.r.worked)})` : `انصراف بدري ${D(it.amount)} (مشي ${C(it.r.out)})`}`)),
          h('div', { class: 'rv-btns' }, h('button', { class: 'btn sm', style: 'color:var(--violet)', onclick: () => mark(it, true) }, 'بإذن'), h('button', { class: 'btn sm danger', onclick: () => mark(it, false) }, 'بدون إذن'))))),
        h('div', { class: 'btns', style: 'margin-top:12px' },
          h('button', { class: 'btn danger', style: 'flex:1', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ اضغط تاني', () => { for (const it of items) S.reviewed[it.e.id + '|' + it.r.date + '|' + it.kind] = 1; save(); draw(); }) }, 'الباقي كله بدون إذن'),
          h('button', { class: 'btn', onclick: () => { $('sheet').close(); render(); } }, 'بعدين')));
    };
    draw(); if (!$('sheet').open) $('sheet').showModal();
  }

  /* ======================= سجل الأذونات والملاحظات ======================= */
  function logEntries(list) {
    const out = [];
    for (const e of list) for (const r of e.rows) {
      const k = e.id + '|' + r.date, notes = S.notes[k] || [], tags = [];
      if (r.code === 'excused') tags.push(['excused', 'غياب بإذن']);
      if (r.code === 'absent') tags.push(['absent', 'غياب بدون إذن']);
      if (r.code === 'leave') tags.push(['leave', 'إجازة']);
      if (r.permLate) tags.push(['excused', 'تأخير بإذن' + (r.lateExcused ? ' ' + D(r.lateExcused) : '')]);
      if (r.permEarly) tags.push(['excused', 'انصراف بإذن' + (r.earlyExcused ? ' ' + D(r.earlyExcused) : '')]);
      if (r.permShort) tags.push(['excused', 'نقص بإذن' + (r.shortExcused ? ' ' + D(r.shortExcused) : '')]);
      if (tags.length || notes.length) out.push({ e, r, tags, notes });
    }
    return out.sort((a, b) => b.r.date.localeCompare(a.r.date));
  }
  function logView(list) {
    const items = logEntries(list);
    if (!items.length) return [h('div', { class: 'card empty' }, h('b', null, 'مفيش أذونات ولا ملاحظات في الفترة دي'), 'سجّلها من زرار + أول ما تحصل.')];
    let lastDate = '';
    const out = [];
    for (const it of items) {
      if (it.r.date !== lastDate) { lastDate = it.r.date; out.push(h('div', { class: 'sec-title' }, longDate(it.r.date))); }
      out.push(h('button', { class: 'mrow', onclick: () => goDay(it.r.date, it.e.id) },
        h('div', { class: 'mrow-top' }, h('div', { class: 'emp-name', dir: 'auto' }, it.e.name), h('div', { class: 'chips', style: 'margin:0' }, it.tags.map(([c, l]) => h('span', { class: 'pill c-' + c }, l)))),
        it.notes.map(n => h('div', { class: 'note-line', dir: 'auto' }, n.text))));
    }
    return out;
  }

  /* ======================= الموظفين ======================= */
  function renderEmps() {
    if (UI.profile) return renderProfile(UI.profile);
    $('subtitle').textContent = '';
    const today = todayKey(), ids = sortedIds();
    const dayRes = Object.fromEntries(computeRange(today, today).filter(e => e.rows.length).map(e => [e.id, e.rows[0]]));
    const q = h('input', { type: 'search', placeholder: '🔍 ابحث بالاسم أو الكود', dir: 'auto', value: UI.empQ || '' });
    const listBox = h('div');
    const draw = () => {
      UI.empQ = q.value;
      const hits = ids.filter(id => matchEmp(id, q.value));
      const active = hits.filter(id => !(S.employees[id].end && S.employees[id].end < today)), gone = hits.filter(id => !active.includes(id));
      const item = id => {
        const e = S.employees[id], sh = S.settings.shifts.find(s => s.id === e.shift), r = dayRes[id];
        const off = e.off === '' || e.off == null ? 'يوم الإجازة مش متحدد ⚠' : 'إجازته ' + E.DAY_NAMES[+e.off];
        return h('button', { class: 'li' + (gone.includes(id) ? ' gone' : ''), onclick: () => openProfile(id) },
          avatar(empName(id)),
          h('span', { class: 'grow' }, h('div', { class: 't', dir: 'auto' }, hl(empName(id), q.value)),
            h('div', { class: 's' }, [hl('كود ' + id, q.value), ' · ', [off, sh ? 'شيفت ' + sh.name : null, E.hoursOf(e) ? `${+e.hours} ساعات` : null, e.end ? `ساب ${fmtDate(e.end)}` : null].filter(Boolean).join(' · ')])),
          r ? h('span', { class: 'pill c-' + r.code }, statusLabel(r, false)) : h('span', { html: ICON.chev, style: 'display:inline-flex' }));
      };
      const kids = [];
      if (!ids.length) kids.push(h('div', { class: 'card empty' }, h('b', null, 'لسه مفيش موظفين'), 'بيتضافوا لوحدهم لما ترفع ملف الجهاز، أو ضيفهم من الزرار اللي فوق.'));
      else if (!hits.length) kids.push(h('div', { class: 'card empty' }, 'مفيش موظف بالاسم أو الكود ده'));
      if (active.length) kids.push(h('div', { class: 'sec-title' }, `شغالين (${active.length})`), h('div', { class: 'list' }, active.map(item)));
      if (gone.length) kids.push(h('div', { class: 'sec-title' }, 'سابوا الشغل (موجودين في تقارير الشهور القديمة)'), h('div', { class: 'list' }, gone.map(item)));
      listBox.replaceChildren(...kids);
    };
    q.addEventListener('input', draw); draw();
    $('tab-emps').replaceChildren(h('div', { class: 'btns', style: 'margin-bottom:10px' }, h('div', { style: 'flex:1' }, q), h('button', { class: 'btn primary', onclick: () => empSheet(null) }, h('span', { html: ICON.plus, style: 'display:inline-flex' }), 'جديد')), listBox);
  }
  function empSheet(id) {
    const isNew = id == null, e = isNew ? { name: '', off: '', shift: '', hours: '', start: todayKey(), end: '' } : Object.assign({}, S.employees[id]);
    const f = (label, el) => h('div', { class: 'field' }, h('label', { class: 'f' }, label), el);
    const idIn = h('input', { inputmode: 'numeric', value: isNew ? '' : id, disabled: !isNew, placeholder: 'نفس الكود المتسجّل في جهاز البصمة' });
    const nameIn = h('input', { dir: 'auto', value: e.name || (isNew ? '' : S.names[id] || '') });
    const offIn = h('select', null, h('option', { value: '' }, '— مش متحدد —'), E.DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))); offIn.value = e.off == null ? '' : String(e.off);
    const shIn = h('select', null, h('option', { value: '' }, 'تلقائي (حسب البصمة)'), S.settings.shifts.filter(s => !s.ruleOnly).map(s => h('option', { value: s.id }, `${s.name} ${s.start}–${s.end}`))); shIn.value = e.shift || '';
    const hrIn = h('input', { type: 'number', min: 0.5, max: 23, step: 0.5, inputmode: 'decimal', value: e.hours || '', placeholder: 'حسب الشيفت (8)' });
    const modeIn = h('select', null, h('option', { value: 'shift' }, 'بشيفت (مواعيد)'), h('option', { value: 'hours' }, 'ساعات بس (من غير مواعيد)')); modeIn.value = e.mode === 'hours' ? 'hours' : 'shift';
    const shWrap = h('div'), hrLbl = h('label', { class: 'f' }), hrHelp = h('div', { class: 'muted', style: 'align-self:center;font-size:12.5px' });
    const syncMode = () => { const hm2 = modeIn.value === 'hours'; shWrap.hidden = hm2; hrLbl.textContent = hm2 ? 'عدد الساعات المطلوبة في اليوم' : 'ساعات العمل في اليوم (اختياري)'; hrIn.placeholder = hm2 ? 'مثلًا 2 أو 8' : 'حسب الشيفت (8)'; hrHelp.textContent = hm2 ? `ييجي وقت ما ييجي. أقل من الساعات = نقص (بعد سماح ${S.settings.hoursGrace ?? 10} دقايق)، وأكتر = زيادة. مفيش تأخير ولا انصراف بدري.` : 'الانصراف المطلوب = بداية الشيفت + الساعات دي. سيبها فاضية تبقى حسب الشيفت.'; };
    modeIn.addEventListener('change', syncMode);
    const stIn = h('input', { type: 'date', value: e.start || '' }), enIn = h('input', { type: 'date', value: e.end || '' });
    const msg = h('div');
    const saveBtn = h('button', { class: 'btn primary', style: 'flex:1', onclick: () => {
      const nid = isNew ? idIn.value.trim() : id;
      if (!nid) { idIn.focus(); return; }
      if (isNew && S.employees[nid]) { msg.replaceChildren(h('div', { class: 'warn-line' }, `الكود ${nid} متسجّل قبل كده باسم ${empName(nid)}`)); return; }
      if (modeIn.value === 'hours' && !(+hrIn.value > 0)) { msg.replaceChildren(h('div', { class: 'warn-line' }, 'اكتب عدد الساعات المطلوبة')); hrIn.focus(); return; }
      if (isNew) delete S.removed[nid];
      S.employees[nid] = Object.assign(S.employees[nid] || {}, { name: nameIn.value.trim(), off: offIn.value, mode: modeIn.value, shift: modeIn.value === 'hours' ? '' : shIn.value, hours: hrIn.value && +hrIn.value > 0 ? String(+hrIn.value) : '', start: stIn.value, end: enIn.value });
      save(); $('sheet').close(); toast(isNew ? `اتضاف ${empName(nid)}` : 'اتحفظ'); render();
    } }, isNew ? 'إضافة' : 'حفظ');
    const kids = [h('h2', null, isNew ? 'موظف جديد' : empName(id)),
      h('div', { class: 'grid2' }, f('الكود في الجهاز', idIn), f('الاسم', nameIn)),
      h('div', { class: 'grid2' }, f('يوم الإجازة الأسبوعية', offIn), f('طريقة الحساب', modeIn)),
      (shWrap.replaceChildren(f('الشيفت', shIn)), shWrap),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, hrLbl, hrIn), hrHelp),
      h('div', { class: 'grid2' }, f('بدأ الشغل يوم', stIn), f('ساب الشغل يوم (لو مشي)', enIn)),
      h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'الشيفت "تلقائي" يعني التطبيق بيعرفه من وقت البصمة كل يوم. لو موظف مشي اكتب يوم ما ساب — بيفضل في تقارير الشهور القديمة.'),
      msg, h('div', { class: 'btns' }, saveBtn, h('button', { class: 'btn', onclick: () => $('sheet').close() }, 'إلغاء'))];
    if (!isNew) kids.push(h('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)' },
      h('button', { class: 'btn danger block', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ هيتمسح من كل الشهور — اضغط تاني', () => {
        delete S.employees[id]; S.removed[id] = true;
        for (const k in S.manual) if (k.startsWith(id + '|')) delete S.manual[k];
        for (const k in S.perms) if (k.startsWith(id + '|')) delete S.perms[k];
        S.punches = S.punches.filter(p => p.id !== id); PV++;
        if (S.view.emp === id) S.view.emp = '';
        save(); $('sheet').close(); toast('اتحذف'); render();
      }) }, 'حذف الموظف نهائيًا')));
    openSheet(kids); syncMode();
  }
  function openSheet(kids) { UI.editor = null; $('sheet').classList.remove('full'); $('sheet-in').replaceChildren(...kids); if (!$('sheet').open) $('sheet').showModal(); }
  $('sheet').addEventListener('click', ev => { if (ev.target === $('sheet')) $('sheet').close(); });

  /* ======================= الإعدادات ======================= */
  function renderSettings() {
    $('subtitle').textContent = '';
    const st = S.settings, b = S.backup;
    const row = (title, sub, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, h('b', null, title), sub ? h('span', null, sub) : null), ctrl);
    const numIn = (key, min, max) => h('input', { type: 'number', min, max, inputmode: 'numeric', value: st[key], onchange: ev => { const v = parseInt(ev.target.value, 10); if (!isNaN(v) && v >= min) { st[key] = v; save(); toast('اتحفظ'); } } });

    const dataCard = h('div', { class: 'card' }, h('h2', null, 'ملفات الجهاز'),
      row('بداية الحساب', 'أول يوم التطبيق بيحسب منه — مفيش أي شهر قبله بيظهر', h('input', { type: 'date', value: st.startFrom || '', max: todayKey(), onchange: ev => { if (!ev.target.value) return; const old = st.startFrom; st.startFrom = ev.target.value; clampToStart(old); save(); render(); toast('اتحفظ'); } })),
      row('الاعتماد على الجهاز من يوم', 'بصمات الجهاز قبل اليوم ده بتتجاهل (فترة التجربة) وتسجّلها يدوي', h('input', { type: 'date', value: st.deviceFrom || '', onchange: ev => { st.deviceFrom = ev.target.value; if (st.deviceFrom && st.deviceFrom < (st.startFrom || '9')) { const old = st.startFrom; st.startFrom = st.deviceFrom.slice(0, 7) + '-01'; clampToStart(old); } save(); render(); toast('اتحفظ'); } })),
      h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => $('file').click() }, 'رفع ملف الجهاز')),
      S.imports.length ? h('ul', { class: 'file-list' }, S.imports.slice(0, 5).map(i => h('li', null, `${fmtDate(i.at)} — ${i.name} — ${i.count} بصمة جديدة`))) : h('p', { class: 'muted' }, 'لسه مرفعتش ملفات. كل ملف بترفعه بيتجمع مع اللي قبله.'));

    const tIn = (o, f, l) => h('div', null, h('label', { class: 'f' }, l), h('input', { type: 'time', value: o[f] || '', onchange: ev => { o[f] = ev.target.value; save(); } }));
    const shiftCard = h('div', { class: 'card' }, h('h2', null, 'الشيفتات'),
      h('p', { class: 'muted', style: 'margin-top:-4px' }, 'الشيفت "المقسوم" ليه فترتين (زي رمضان). "بالقواعد بس" يعني مش بيتخمّن من البصمة، وبيتطبق بس في الأيام الخاصة.'),
      ...st.shifts.map((s, i) => h('div', { class: 'shift-box' },
        h('div', { class: 'shift-top' }, h('input', { value: s.name, 'aria-label': 'اسم الشيفت', onchange: ev => { s.name = ev.target.value; save(); } }),
          h('button', { class: 'btn danger sm', disabled: st.shifts.length <= 1, onclick: ev => confirmBtn(ev.currentTarget, 'تاني', () => { st.shifts.splice(i, 1); save(); render(); }) }, 'حذف')),
        h('div', { class: 'grid2' }, tIn(s, 'start', s.start2 ? 'الفترة الأولى من' : 'من'), tIn(s, 'end', 'لـ')),
        s.start2 != null ? h('div', { class: 'grid2', style: 'margin-top:6px' }, tIn(s, 'start2', 'الفترة التانية من'), tIn(s, 'end2', 'لـ')) : null,
        h('div', { class: 'chk', style: 'margin-top:8px' },
          h('label', null, h('input', { type: 'checkbox', checked: s.start2 != null, onchange: ev => { if (ev.target.checked) { s.start2 = s.start2 || '20:00'; s.end2 = s.end2 || '00:00'; } else { delete s.start2; delete s.end2; } save(); render(); } }), 'مقسوم (فترتين)'),
          h('label', null, h('input', { type: 'checkbox', checked: !!s.ruleOnly, onchange: ev => { s.ruleOnly = ev.target.checked; save(); } }), 'بالقواعد بس')))),
      h('button', { class: 'btn sm', onclick: () => { const ids = new Set(st.shifts.map(s => s.id)); let n = 1; while (ids.has('s' + n)) n++; st.shifts.push({ id: 's' + n, name: 'شيفت ' + (st.shifts.length + 1), start: '08:00', end: '16:00' }); save(); render(); } }, '+ شيفت جديد'));

    st.rules = st.rules || [];
    const shiftOpts = sel => { const el = h('select', { onchange: ev => sel(ev.target.value) }, st.shifts.map(x => h('option', { value: x.id }, x.name))); return el; };
    const daysCard = h('div', { class: 'card' }, h('h2', null, 'أيام بمواعيد خاصة'),
      h('p', { class: 'muted', style: 'margin-top:-4px' }, 'في الأيام دي كل اللي شغالين بشيفت بيتحسبوا على الشيفت ده (مش بيتخمّن). موظفين "ساعات بس" مش بيتأثروا، ويوم الإجازة بيفضل إجازة.'),
      ...st.rules.map((r, i) => {
        const kindSel = h('select', { onchange: ev => { r.kind = ev.target.value; save(); render(); } }, h('option', { value: 'weekday' }, 'كل أسبوع'), h('option', { value: 'range' }, 'فترة من يوم لـ يوم'), h('option', { value: 'date' }, 'يوم معيّن')); kindSel.value = r.kind;
        const wdSel = h('select', { onchange: ev => { r.weekday = +ev.target.value; save(); } }, E.DAY_NAMES.map((n, j) => h('option', { value: String(j) }, n))); wdSel.value = String(r.weekday ?? 5);
        const shSel = shiftOpts(v => { r.shift = v; save(); }); shSel.value = r.shift;
        const dIn = (f, l) => h('div', null, h('label', { class: 'f' }, l), h('input', { type: 'date', value: r[f] || '', onchange: ev => { r[f] = ev.target.value; save(); } }));
        return h('div', { class: 'shift-box' + (r.on === false ? ' off' : '') },
          h('div', { class: 'shift-top' }, h('input', { value: r.name || '', placeholder: 'اسم (زي الجمعة، رمضان)', 'aria-label': 'اسم القاعدة', onchange: ev => { r.name = ev.target.value; save(); } }),
            h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: r.on !== false, onchange: ev => { r.on = ev.target.checked; save(); render(); } }), r.on !== false ? 'شغالة' : 'مقفولة'),
            h('button', { class: 'btn danger sm', onclick: ev => confirmBtn(ev.currentTarget, 'تاني', () => { st.rules.splice(i, 1); save(); render(); }) }, 'حذف')),
          h('div', { class: 'grid2' }, h('div', null, h('label', { class: 'f' }, 'امتى'), kindSel), h('div', null, h('label', { class: 'f' }, 'الشيفت'), shSel)),
          r.kind === 'weekday' ? h('div', { style: 'margin-top:6px' }, h('label', { class: 'f' }, 'اليوم'), wdSel)
            : r.kind === 'range' ? h('div', { class: 'grid2', style: 'margin-top:6px' }, dIn('from', 'من يوم'), dIn('to', 'لـ يوم'))
              : h('div', { style: 'margin-top:6px' }, dIn('from', 'اليوم')),
          r.on !== false && r.kind === 'range' && (!r.from || !r.to) ? h('div', { class: 'warn-line' }, 'حدد من يوم لـ يوم عشان تشتغل') : null);
      }),
      h('button', { class: 'btn sm', onclick: () => { st.rules.push({ id: 'r' + Date.now(), name: '', kind: 'weekday', weekday: 5, shift: st.shifts[0].id, on: true }); save(); render(); } }, '+ يوم خاص جديد'));

    const rulesCard = h('div', { class: 'card' }, h('h2', null, 'قواعد الحساب'),
      row('فترة السماح في التأخير', 'بالدقايق — جه 10:20 والسماح 15 = 5 دقايق تأخير', numIn('grace', 0, 120)),
      row('البصمة المكررة', 'بصمتين من نفس النوع في أقل من كام دقيقة = بصمة واحدة', numIn('dedupeMinutes', 0, 60)),
      row('آخر اليوم', 'البصمة قبل الساعة دي الفجر تتبع اليوم اللي قبله', numIn('dayCutHour', 0, 12)),
      row('سماح نقص الساعات', 'لموظفين "ساعات بس" — اشتغل 1:50 من 2 والسماح 10 = مفيش نقص', numIn('hoursGrace', 0, 120)),
      h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'الانصراف بدري بيتحسب من أول دقيقة. الزيادة = الوقت بعد نهاية الشيفت. الشغل يوم الإجازة الأسبوعية كله زيادة.'));

    const freqSel = h('select', { onchange: ev => { b.freq = ev.target.value; save(); render(); } }, h('option', { value: 'off' }, 'مقفول'), h('option', { value: 'daily' }, 'كل يوم'), h('option', { value: 'weekly' }, 'كل أسبوع')); freqSel.value = b.freq;
    const daySel = h('select', { onchange: ev => { b.day = +ev.target.value; save(); } }, E.DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))); daySel.value = String(b.day);
    const backupCard = h('div', { class: 'card' }, h('h2', null, 'النسخ الاحتياطي'),
      isNative() ? [
        row('نسخة تلقائية', 'بتتحفظ في Documents ← الحضور والانصراف', freqSel),
        b.freq === 'weekly' ? row('يوم النسخة', null, daySel) : null,
        b.freq !== 'off' ? row('الساعة', 'لو التطبيق مقفول وقتها، بتتعمل أول ما تفتحه', h('input', { type: 'time', value: b.time, onchange: ev => { b.time = ev.target.value || '23:00'; save(); } })) : null,
        b.freq !== 'off' ? row('عدد النسخ اللي تتحفظ', 'الأقدم بيتمسح لوحده', h('input', { type: 'number', min: 1, max: 60, value: b.keep, onchange: ev => { const v = parseInt(ev.target.value, 10); if (v >= 1) { b.keep = v; save(); } } })) : null,
        b.last ? h('p', { class: 'muted', style: 'margin:6px 0 0' }, `آخر نسخة تلقائية: ${b.last.replace('T', ' ')}`) : null,
        h('div', { id: 'auto-list' })
      ] : h('p', { class: 'muted', style: 'margin-top:0' }, 'النسخة التلقائية متاحة في تطبيق الأندرويد بس.'),
      h('div', { class: 'btns', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', onclick: () => saveFile(`attendance_backup_${todayKey()}.json`, 'application/json', null, backupJson()).catch(e => toast('مقدرتش أعمل النسخة: ' + (e.message || e))) }, 'نسخة دلوقتي'),
        h('button', { class: 'btn', onclick: () => $('restore').click() }, 'استرجاع من ملف')),
      h('input', { type: 'file', id: 'restore', accept: isNative() ? null : '.json', hidden: true, onchange: async ev => { const f = ev.target.files[0]; if (f) restoreText(await f.text()); ev.target.value = ''; } }));

    const dangerCard = h('div', { class: 'card' }, h('h2', null, 'مسح البيانات'),
      h('p', { class: 'muted', style: 'margin-top:0' }, 'بيمسح كل الموظفين والبصمات والتسجيلات من على الموبايل ده. اعمل نسخة الأول.'),
      h('button', { class: 'btn danger', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ اضغط تاني للمسح', () => { S = blank(); PV++; save(); toast('اتمسح كل حاجة'); render(); }) }, 'مسح كل البيانات'));

    const rm = S.remind;
    const remindSel = h('select', { onchange: ev => { rm.on = ev.target.value === '1'; save(); scheduleReminder(true); render(); } }, h('option', { value: '1' }, 'شغال'), h('option', { value: '0' }, 'مقفول')); remindSel.value = rm.on ? '1' : '0';
    const remindCard = h('div', { class: 'card' }, h('h2', null, 'التذكير اليومي'),
      isNative() ? [
        row('تذكير بالأذونات والغياب', 'إشعار كل يوم: فيه حد استأذن أو غاب؟ ودوسة عليه بتفتح التسجيل السريع', remindSel),
        rm.on ? row('الساعة', '12 بالليل = اليوم اللي لسه خالص', h('input', { type: 'time', value: rm.time, onchange: ev => { rm.time = ev.target.value || '00:00'; save(); scheduleReminder(true); toast('اتحفظ'); } })) : null,
        h('div', { id: 'remind-status' })
      ] : h('p', { class: 'muted', style: 'margin-top:0' }, 'التذكير متاح في تطبيق الأندرويد بس.'));
    const STY = [
      { v: 'vivid', l: 'ملوّن حيوي', hb: '#5B4BDB', bg: '#F6F3FF', t: ['#5B4BDB', '#FF8FA3', '#FFD66B'] },
      { v: 'default', l: 'أخضر هادي', hb: '#0F766E', bg: '#EEF1F4', t: ['#fff', '#fff', '#F4C53A'] },
      { v: 'dark', l: 'داكن احترافي', hb: '#0B1220', bg: '#0B1220', t: ['#131C2E', '#34D399', '#FBBF24'] },
      { v: 'minimal', l: 'أبيض بسيط', hb: '#FFFFFF', bg: '#FFFFFF', t: ['#111', '#F3F3F3', '#16A34A'] }];
    const styleCard = h('div', { class: 'card' }, h('h2', null, 'شكل التطبيق'),
      h('div', { class: 'styles' }, STY.map(x => h('button', { class: 'sty' + ((st.style || 'vivid') === x.v ? ' on' : ''), onclick: () => { st.style = x.v; save(); applyStyle(); render(); toast('اتغيّر شكل التطبيق'); } },
        h('div', { class: 'sty-prev', style: `background:${x.bg}` }, h('div', { class: 'hb', style: `background:${x.hb};${x.v === 'minimal' ? 'border-bottom:1px solid #E9E9E9' : ''}` }), h('div', { class: 'bdy' }, x.t.map(c => h('i', { style: `background:${c};${c === '#fff' || c === '#F3F3F3' ? 'border:1px solid #DDD' : ''}` })))),
        h('b', null, x.l)))));
    // الإجازات الرسمية
    st.holidays = st.holidays || [];
    const FIXED = [['01-07', 'عيد الميلاد المجيد'], ['01-25', 'ثورة 25 يناير وعيد الشرطة'], ['04-25', 'عيد تحرير سيناء'], ['05-01', 'عيد العمال'], ['06-30', 'ثورة 30 يونيو'], ['07-23', 'ثورة 23 يوليو'], ['10-06', 'عيد القوات المسلحة']];
    const yr = +todayKey().slice(0, 4);
    const holCard = h('div', { class: 'card' }, h('h2', null, '🎉 الإجازات الرسمية'),
      h('p', { class: 'muted', style: 'margin-top:-4px' }, 'بتتحسب إجازة للكل لوحدها، ولو حد اشتغل فيها كل ساعاته تتحسب زيادة. الحكومة أحيانًا بتنقل الإجازة لخميس — عدّل التاريخ لو اتنقلت.'),
      ...st.holidays.slice().sort((a, b) => (a.from || '').localeCompare(b.from || '')).map(x => h('div', { class: 'shift-box' + (x.on === false ? ' off' : '') },
        h('div', { class: 'shift-top' }, h('input', { value: x.name || '', placeholder: 'اسم الإجازة', 'aria-label': 'اسم الإجازة', onchange: ev => { x.name = ev.target.value; save(); } }),
          h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: x.on !== false, onchange: ev => { x.on = ev.target.checked; save(); render(); } })),
          h('button', { class: 'btn danger sm', onclick: ev => confirmBtn(ev.currentTarget, 'تاني', () => { st.holidays.splice(st.holidays.indexOf(x), 1); save(); render(); }) }, 'حذف')),
        h('div', { class: 'grid2' }, h('div', null, h('label', { class: 'f' }, 'من يوم'), h('input', { type: 'date', value: x.from || '', onchange: ev => { x.from = ev.target.value; if (!x.to || x.to < x.from) x.to = x.from; save(); render(); } })),
          h('div', null, h('label', { class: 'f' }, 'لـ يوم'), h('input', { type: 'date', value: x.to || x.from || '', onchange: ev => { x.to = ev.target.value; save(); } }))))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn sm', onclick: () => { st.holidays.push({ id: 'h' + Date.now(), name: '', from: todayKey(), to: todayKey(), on: true }); save(); render(); } }, '+ إجازة رسمية'),
        [yr, yr + 1].map(y => h('button', { class: 'btn sm', onclick: () => { let n = 0; for (const [md, name] of FIXED) { const d = `${y}-${md}`; if (!st.holidays.some(x => x.from === d)) { st.holidays.push({ id: 'h' + y + md, name, from: d, to: d, on: true }); n++; } } save(); render(); toast(n ? `اتضاف ${n} إجازات ثابتة لسنة ${y}` : 'موجودين قبل كده'); } }, `أضف الإجازات الثابتة ${y}`))),
      h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'الأعياد اللي بتتغير كل سنة (الفطر، الأضحى، المولد، رأس السنة الهجرية، شم النسيم) ضيفها لما تتعلن.'));
    // الشهور المقفولة: الشهر اللي فات بس + الباقي في شبكة سنة
    const curM = monthOf(todayKey()), sm = startMonth(), lastM = prevMonth(curM);
    const lockCard = h('div', { class: 'card' }, h('h2', null, '🔒 قفل الشهور'),
      h('p', { class: 'muted', style: 'margin-top:-4px' }, 'الشهر المقفول محدش يقدر يعدّل فيه بالغلط، وأي بصمات جديدة ليه بتتجاهل. تقدر تفتحه في أي وقت.'),
      lastM < sm ? h('p', { class: 'muted' }, `لسه مفيش شهر خلص — بدأت من ${monthLabel(sm)}.`) :
        h('div', { class: 'list' }, lockRow(lastM, 'الشهر اللي فات'),
          lastM > sm ? h('button', { class: 'li', onclick: () => monthsSheet() }, h('span', { class: 'avatar' }, '🗓'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'الشهور القديمة'),
            h('div', { class: 's' }, (() => { let n = 0, l = 0; for (let m = sm; m < lastM; m = nextMonth(m)) { n++; if (S.locked[m]) l++; } return `${n} شهر · ${l} مقفول`; })())), h('span', { html: ICON.chev, style: 'display:inline-flex' })) : null));
    // المساحة
    let used = 0; try { used = (localStorage.getItem(KEY) || '').length * 2; } catch (e) { /* ignore */ }
    const cap = 5 * 1024 * 1024, pct = Math.min(100, Math.round(used / cap * 100));
    dataCard.append(h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, h('b', null, 'المساحة المستخدمة'), h('span', null, `${(used / 1024 / 1024).toFixed(2)} ميجا من حوالي 5 — ${S.punches.length.toLocaleString('ar-EG')} بصمة`),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(2, pct)}%;${pct > 70 ? 'background:var(--rose)' : ''}` })), pct > 70 ? h('span', { style: 'color:var(--rose)' }, 'المساحة قربت تخلص — اعمل نسخة احتياطية وكلّمني') : null)));
    const lc = lockCfg();
    const lockAppCard = h('div', { class: 'card' }, h('h2', null, '🔐 قفل التطبيق'),
      row(lc && lc.on ? 'القفل شغال' : 'القفل مقفول', lc && lc.on ? (lc.bio ? 'بالرقم السري والبصمة — بيقفل لما تسيب التطبيق أكتر من دقيقة' : 'بالرقم السري — بيقفل لما تسيب التطبيق أكتر من دقيقة') : 'محدش يفتح بيانات الموظفين من غير رقمك أو بصمتك',
        h('button', { class: 'btn sm' + (lc && lc.on ? '' : ' primary'), onclick: lockSetupSheet }, lc && lc.on ? 'تعديل' : 'شغّله')));
    $('tab-settings').replaceChildren(styleCard, lockAppCard, deviceCard(), dataCard, shiftCard, daysCard, holCard, rulesCard, lockCard, remindCard, backupCard, dangerCard);
    if (isNative()) { listAutoBackups(); remindStatus(); }
  }

  /* ======================= التذكير اليومي ======================= */
  const REMIND_ID = 2101;
  async function scheduleReminder(ask) {
    const L = plugin('LocalNotifications'); if (!isNative() || !L) return;
    try { await L.cancel({ notifications: [{ id: REMIND_ID }] }); } catch (e) { /* ignore */ }
    if (!S.remind.on) return;
    try {
      let p = await L.checkPermissions();
      if (p.display !== 'granted' && ask) p = await L.requestPermissions();
      if (p.display !== 'granted') return;
      const [H, M] = (S.remind.time || '00:00').split(':').map(Number);
      await L.schedule({ notifications: [{ id: REMIND_ID, channelId: 'reminders', title: 'فيه حد استأذن أو غاب النهارده؟', body: 'دوس هنا وسجّلها في ثواني قبل ما تنساها', schedule: { on: { hour: H, minute: M }, allowWhileIdle: true } }] });
    } catch (e) { console.warn('reminder failed', e); }
  }
  async function remindStatus() {
    const box = $('remind-status'), L = plugin('LocalNotifications'); if (!box || !L || !S.remind.on) return;
    const items = [];
    try { const p = await L.checkPermissions(); if (p.display !== 'granted') items.push(h('div', { class: 'warn-line' }, 'الإشعارات مقفولة للتطبيق ', h('button', { class: 'btn sm', onclick: async () => { await scheduleReminder(true); render(); } }, 'اسمح بالإشعارات'))); } catch (e) { /* ignore */ }
    try { const x = await L.checkExactNotificationSetting(); if (x.exact_alarm !== 'granted') items.push(h('div', { class: 'warn-line' }, 'عشان التذكير ييجي في ميعاده بالظبط ', h('button', { class: 'btn sm', onclick: async () => { try { await L.changeExactNotificationSetting(); } catch (e) { /* ignore */ } } }, 'فعّل المواعيد الدقيقة'))); } catch (e) { /* ignore */ }
    box.replaceChildren(...items);
  }

  /* ======================= النسخ الاحتياطي ======================= */
  const AB_DIR = 'الحضور والانصراف';
  const backupJson = () => JSON.stringify(Object.assign({ app: 'attendance', exported: new Date().toISOString() }, S, { punches: packP(S.punches) }));
  function restoreText(text) {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || !obj.settings) throw new Error();
      delete obj.app; delete obj.exported;
      S = Object.assign(blank(), obj); S.punches = unpackP(S.punches); PV++; normalize(); save(); applyStyle(); toast('اترجعت النسخة الاحتياطية'); render();
    } catch (e) { toast('الملف ده مش نسخة احتياطية سليمة'); }
  }
  function backupDue() {
    const b = S.backup; if (b.freq === 'off') return false;
    const now = new Date(), [hh, mm] = (b.time || '23:00').split(':').map(Number);
    // آخر ميعاد كان المفروض النسخة تتعمل فيه
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    if (due > now) due.setDate(due.getDate() - 1);
    if (b.freq === 'weekly') while (due.getDay() !== +b.day) due.setDate(due.getDate() - 1);
    return !b.last || new Date(b.last) < due;
  }
  async function autoBackup() {
    if (!isNative() || !backupDue()) return;
    const F = plugin('Filesystem'); if (!F) return;
    try {
      const t = new Date(), stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}`;
      await F.writeFile({ path: `${AB_DIR}/attendance-backup-${stamp}.json`, data: backupJson(), directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      S.backup.last = `${todayKey()}T${pad(t.getHours())}:${pad(t.getMinutes())}`; save();
      const files = await autoFiles();
      for (const f of files.slice(S.backup.keep)) try { await F.deleteFile({ path: `${AB_DIR}/${f}`, directory: 'DOCUMENTS' }); } catch (e) { /* ignore */ }
      if (UI.tab === 'settings') render();
    } catch (e) { console.warn('auto backup failed', e); }
  }
  async function autoFiles() {
    const F = plugin('Filesystem');
    try { const r = await F.readdir({ path: AB_DIR, directory: 'DOCUMENTS' }); return r.files.map(f => typeof f === 'string' ? f : f.name).filter(n => /^attendance-backup-.*\.json$/.test(n)).sort().reverse(); }
    catch (e) { return []; }
  }
  async function listAutoBackups() {
    const box = $('auto-list'); if (!box) return;
    const files = await autoFiles(); if (!files.length) return;
    box.replaceChildren(h('div', { class: 'sec-title', style: 'margin:12px 0 6px' }, 'النسخ المحفوظة'),
      h('ul', { class: 'file-list' }, files.slice(0, 10).map(f => h('li', { style: 'display:flex;justify-content:space-between;align-items:center' },
        h('span', null, f.replace('attendance-backup-', '').replace('.json', '').replace('_', ' ')),
        h('button', { class: 'btn ghost sm', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ هتستبدل البيانات الحالية', async () => {
          try { const r = await plugin('Filesystem').readFile({ path: `${AB_DIR}/${f}`, directory: 'DOCUMENTS', encoding: 'utf8' }); restoreText(r.data); } catch (e) { toast('مقدرتش أقرا النسخة'); }
        }) }, 'استرجاع')))));
  }

  /* ======================= جهاز البصمة: سحب مباشر على الشبكة ======================= */
  const Zk = () => isNative() ? plugin('Zk') : null;
  const devArgs = timeout => ({ ip: String(S.device.ip || '').trim(), port: +S.device.port || 4370, password: String(S.device.password || '').trim(), timeout });
  const ZK_ERR = { TIMEOUT: 'الجهاز مردّش — اتأكد إن الموبايل على واي فاي المحل وإن الـ IP صح', UNREACHABLE: 'مش لاقي الجهاز على الشبكة — اتأكد إنك على واي فاي المحل', AUTH: 'كلمة سر الاتصال (Comm Key) غلط' };
  const zkErr = e => { const m = String((e && e.message) || e || ''); for (const k in ZK_ERR) if (m.includes(k)) return ZK_ERR[k]; return 'حصلت مشكلة: ' + m; };
  const ZK_TYPE = { 0: 'in', 1: 'out', 2: 'out', 3: 'in', 4: 'in', 5: 'out' }; // حضور، انصراف، خروج بريك، رجوع بريك، حضور إضافي، انصراف إضافي
  const nowStamp = () => { const d = new Date(); return `${todayKey()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  /** فرق ساعة الجهاز عن الموبايل بالدقايق (موجب = الجهاز قدّام) */
  const clockOff = t => { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(t || ''); if (!m) return null; return Math.round((new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Date.now()) / 60000); };
  const offText = o => `ساعة الجهاز ${o > 0 ? 'قدّام' : 'متأخرة'} ${Math.abs(o) >= 60 ? E.fmtDur(Math.abs(o)) + ' ساعة' : Math.abs(o) + ' دقيقة'} عن الموبايل`;
  function zkParsed(r) {
    const names = {};
    for (const u of r.users || []) if (u.id && u.name && !/^NN-/.test(u.name) && !/�/.test(u.name)) names[u.id] = u.name;
    const punches = [];
    for (const l of String(r.lines || '').split('\n')) {
      const [id, t, pu] = l.split('|'), m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(t || '');
      if (id && m) punches.push({ id, name: names[id] || '', key: m[1], min: +m[2] * 60 + +m[3], type: ZK_TYPE[+pu] || null });
    }
    return { kind: 'raw', punches, dates: [], names, hasState: true, device: true };
  }
  let pulling = false, lastTry = 0;
  async function pullDevice(auto) {
    const Z = Zk(); if (!Z || pulling || !S.device.ip) return;
    pulling = true; lastTry = Date.now(); UI.pullState = 'run'; if (UI.tab === 'day' || UI.tab === 'settings') render();
    let from = takeFrom() || todayKey();
    const lp = S.device.lastPull && S.device.lastPull.at;
    if (auto && lp) { const d = addDays(lp.slice(0, 10), -2); if (d > from) from = d; }
    if (!auto) toast('بسحب من الجهاز…');
    try {
      const r = await Z.pull(Object.assign(devArgs(auto ? 2500 : 6000), { from: from + ' 00:00:00' }));
      const parsed = zkParsed(r), off = clockOff(r.time);
      S.device.clock = off; S.device.seen = nowStamp();
      parsed.note = `الجهاز فيه ${(+r.total).toLocaleString('ar-EG')} بصمة — اتجاب منهم ${(+r.kept).toLocaleString('ar-EG')} من ${fmtDate(from)}` + (off != null && Math.abs(off) >= 3 ? ` · ⚠ ${offText(off)}` : '');
      const ids = new Set(parsed.punches.map(p => p.id));
      const newIds = [...ids].filter(id => !S.employees[id] && !S.removed[id]);
      const existing = new Set(S.punches.map(pKey)), tf = takeFrom();
      const fresh = parsed.punches.filter(p => { const d = effDate(p); return !existing.has(pKey(p)) && (!tf || d >= tf) && !isLocked(d) && !S.removed[p.id]; });
      if (auto && !newIds.length) {
        const added = fresh.length ? mergePunches(fresh) : 0;
        S.device.lastPull = { at: nowStamp(), count: added };
        save(); UI.pullState = ''; render();
        if (added) toast(`⟳ اتسحب ${added} بصمة جديدة من الجهاز`);
        return;
      }
      UI.pullState = ''; save(); render();
      if (!parsed.punches.length && !newIds.length) { S.device.lastPull = { at: nowStamp(), count: 0 }; save(); render(); toast('مفيش بصمات جديدة على الجهاز ✓'); return; }
      if (!fresh.length && !newIds.length) { S.device.lastPull = { at: nowStamp(), count: 0 }; save(); render(); toast('كل البصمات متسجلة قبل كده ✓'); return; }
      expectKind = '';
      importPreview(parsed, 'سحب من جهاز البصمة');
    } catch (e) {
      UI.pullState = auto ? '' : 'err'; S.device.err = zkErr(e); render();
      if (!auto) toast(zkErr(e));
    } finally { pulling = false; }
  }
  function autoPull() { if (S.device.auto && Zk() && S.device.ip && Date.now() - lastTry > 5 * 60000) pullDevice(true); }
  function syncChip() {
    const lp = S.device.lastPull, run = UI.pullState === 'run';
    const when = lp ? (lp.at.slice(0, 10) === todayKey() ? 'النهارده ' + fmt12(E.hm(lp.at.slice(11))) : fmtDate(lp.at.slice(0, 10))) : '';
    return h('button', { class: 'sync-chip' + (run ? ' run' : ''), disabled: run, onclick: () => pullDevice(false) },
      h('span', { class: 'sc-i' }, '⟳'), run ? 'بسحب من الجهاز…' : lp ? `آخر سحب من الجهاز: ${when}` : 'اسحب البصمات من الجهاز');
  }
  function deviceCard() {
    const D = S.device;
    if (!isNative()) return h('div', { class: 'card' }, h('h2', null, '📡 جهاز البصمة'), h('p', { class: 'muted' }, 'السحب المباشر من الجهاز شغال من التطبيق المتسطّب على الموبايل بس. من هنا ارفع ملف الجهاز.'));
    const fld = (l, el) => h('div', null, h('label', { class: 'f' }, l), el);
    const setD = (k, v) => { D[k] = v; save(); };
    const autoSel = h('select', { onchange: ev => { setD('auto', ev.target.value === '1'); } }, h('option', { value: '1' }, 'شغال'), h('option', { value: '0' }, 'مقفول')); autoSel.value = D.auto ? '1' : '0';
    const info = UI.devInfo;
    const res = UI.devTest === 'run' ? h('div', { class: 'dev-res' }, '… بجرّب أوصل للجهاز')
      : info && info.err ? h('div', { class: 'dev-res bad' }, h('b', null, '✗ ' + info.err), h('small', null, 'الموبايل لازم يكون على نفس الراوتر اللي الجهاز متوصل بيه. على الكمبيوتر: برنامج البصمة ← Device ← IP Address.'))
      : info ? h('div', { class: 'dev-res ok' }, h('b', null, `✓ متصل${info.name ? ' — ' + info.name : ''}`),
        h('div', { class: 'dev-grid' }, [['البصمات', (+info.records).toLocaleString('ar-EG') + (info.recCap ? ` من ${(+info.recCap).toLocaleString('ar-EG')}` : '')], ['الموظفين', info.users], ['السيريال', info.serial || '—'], ['ساعة الجهاز', info.time ? info.time.slice(11, 16) : '—']].map(([a, b]) => h('div', null, h('small', null, a), h('span', { dir: 'ltr' }, String(b))))),
        info.off != null && Math.abs(info.off) >= 3 ? h('div', { class: 'warn-line' }, '⚠ ' + offText(info.off) + ' — دوس "ظبط ساعة الجهاز"') : null) : null;
    const lp = D.lastPull;
    return h('div', { class: 'card' }, h('h2', null, '📡 جهاز البصمة'),
      h('div', { class: 'grid2' }, fld('IP الجهاز', h('input', { value: D.ip || '', dir: 'ltr', inputmode: 'decimal', placeholder: '192.168.1.201', onchange: ev => setD('ip', ev.target.value.trim()) })),
        fld('Port', h('input', { type: 'number', dir: 'ltr', value: D.port || 4370, onchange: ev => setD('port', +ev.target.value || 4370) }))),
      h('div', { style: 'margin-top:8px' }, fld('كلمة سر الاتصال (Comm Key)', h('input', { value: D.password || '', dir: 'ltr', inputmode: 'numeric', placeholder: 'فاضية', onchange: ev => setD('password', ev.target.value.trim()) }))),
      row('سحب تلقائي', 'أول ما تفتح التطبيق وانت على واي فاي المحل', autoSel),
      h('div', { class: 'muted', style: 'margin:6px 0' }, lp ? `آخر سحب: ${fmtDate(lp.at.slice(0, 10))} ${fmt12(E.hm(lp.at.slice(11)))} — ${lp.count} بصمة جديدة` : 'لسه مسحبتش من الجهاز'),
      res,
      h('div', { class: 'btns', style: 'margin-top:10px' },
        h('button', { class: 'btn primary', disabled: UI.pullState === 'run', onclick: () => pullDevice(false) }, UI.pullState === 'run' ? 'بسحب…' : '⟳ اسحب دلوقتي'),
        h('button', { class: 'btn', onclick: testDevice }, 'اختبار الاتصال'),
        h('button', { class: 'btn', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ اضغط تاني', setDeviceTime) }, 'ظبط ساعة الجهاز')));
    function row(title, sub, ctrl) { return h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, h('b', null, title), h('span', null, sub)), ctrl); }
  }
  async function testDevice() {
    const Z = Zk(); if (!Z) return;
    UI.devTest = 'run'; UI.devInfo = null; render();
    try { const r = await Z.info(devArgs(5000)); r.off = clockOff(r.time); S.device.clock = r.off; UI.devInfo = r; S.device.seen = nowStamp(); save(); }
    catch (e) { UI.devInfo = { err: zkErr(e) }; }
    UI.devTest = ''; render();
  }
  async function setDeviceTime() {
    const Z = Zk(); if (!Z) return;
    const d = new Date();
    try {
      const r = await Z.setTime(Object.assign(devArgs(5000), { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() }));
      S.device.clock = clockOff(r.time); if (UI.devInfo && !UI.devInfo.err) { UI.devInfo.time = r.time; UI.devInfo.off = S.device.clock; }
      save(); render(); toast(r.ok ? '✓ ساعة الجهاز اتظبطت على ساعة الموبايل' : 'الجهاز مقبلش تغيير الساعة');
    } catch (e) { toast(zkErr(e)); }
  }

  /* ======================= رفع ملف الجهاز ======================= */
  let expectKind = '';
  $('upload-btn').addEventListener('click', uploadChooser);
  function xlsSample(cols, rows) {
    return h('table', { class: 'xls', dir: 'ltr' }, h('tr', null, cols.map(c => h('th', null, c))), rows.map(r => h('tr', null, r.map(c => h('td', null, c)))));
  }
  function uploadChooser() {
    const opt = (kind, title, tag, desc, sample) => h('button', { class: 'up-opt' + (tag ? ' rec' : ''), onclick: () => { expectKind = kind; $('sheet').close(); $('file').click(); } },
      h('div', { class: 'up-h' }, h('b', null, title), tag ? h('span', { class: 'up-tag' }, tag) : null), h('p', null, desc), sample);
    openSheet([h('div', { class: 'grab' }), h('h2', { style: 'margin-bottom:2px' }, 'رفع ملف الجهاز'), h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'اختار نوع الملف اللي طلّعته من الجهاز'),
      Zk() && S.device.ip ? h('button', { class: 'up-opt rec', onclick: () => { $('sheet').close(); pullDevice(false); } }, h('div', { class: 'up-h' }, h('b', null, '📡 اسحب من الجهاز على طول'), h('span', { class: 'up-tag' }, 'من غير ملف')),
        h('p', null, `الموبايل لازم يكون على واي فاي المحل · ${S.device.ip}`)) : null,
      opt('raw', 'سجل البصمات', Zk() ? null : 'الأحسن', 'كل بصمة في سطر بوقتها ونوعها (حضور/انصراف). بيشتغل مع الشيفتين.', xlsSample(['AC-No.', 'Name', 'Time', 'State'], [['102', 'SONDES', '2026/11/06 03:36 م', 'C/In'], ['102', 'SONDES', '2026/11/06 06:03 م', 'C/Out']])),
      opt('report', 'تقرير الحضور', null, 'سطر لكل موظف في اليوم فيه حضور وانصراف. الجهاز بيظبطه على شيفت واحد، فممكن يضيّع بصمات المسائي.', xlsSample(['AC-No.', 'Name', 'Date', 'Clock In', 'Clock Out'], [['102', 'SONDES', '2026/11/06', '10:05', '18:02']])),
      h('div', { class: 'up-note' }, '💡 مش متأكد؟ اختار أي واحد — لو الملف طلع من النوع التاني، التطبيق هيقولك ويقراه صح.')]);
  }
  $('file').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try { importPreview(await readDeviceFile(f), f.name); }
    catch (e) { console.error(e); toast('مقدرتش أقرا الملف: ' + (e.message || e)); }
    ev.target.value = '';
  });
  async function readDeviceFile(f) {
    let parsed;
    await needXLSX();
    if (/\.(dat|txt)$/i.test(f.name)) {
      const text = await f.text(), p = E.parseAttlogText(text);
      parsed = p ? { kind: 'raw', punches: p, dates: [], names: {}, hasState: p.some(x => x.type) } : parseWorkbook(XLSX.read(text, { type: 'string' }));
    } else parsed = parseWorkbook(XLSX.read(await f.arrayBuffer(), { type: 'array' }));
    if (!E.dataRange(parsed)) throw new Error('الملف مفيهوش تواريخ');
    return parsed;
  }
  const pKey = p => `${p.id}|${p.key}|${p.min}|${p.type || ''}`;
  const KIND_NAME = { raw: 'سجل البصمات', report: 'تقرير الحضور' };
  /** اليوم اللي البصمة بتتحسب عليه (البصمة بعد 12 بالليل وقبل آخر اليوم تتبع اليوم اللي قبله) */
  const effDate = p => p.min < (S.settings.dayCutHour ?? 5) * 60 ? addDays(p.key, -1) : p.min >= 1440 ? addDays(p.key, 1) : p.key;
  function importPreview(parsed, fname) {
    const df = takeFrom(), existing = new Set(S.punches.map(pKey)), seen = new Set();
    const ps = [...parsed.punches].sort((a, b) => a.key.localeCompare(b.key) || a.min - b.min || a.id.localeCompare(b.id, undefined, { numeric: true }));
    let fresh = 0, dup = 0, already = 0, before = 0; const days = new Set(), notes = new Map();
    for (const p of ps) {
      const k = pKey(p), d = effDate(p), n = [];
      if (seen.has(k) || /repeat/i.test(p.exc || '')) { dup++; n.push('مكررة'); }
      else if (existing.has(k)) { already++; n.push('موجودة قبل كده'); }
      else if (df && d < df) { before++; n.push('قبل تشغيل الجهاز — هتتجاهل'); }
      else if (isLocked(d)) { before++; n.push('شهر مقفول — هتتجاهل'); }
      else { fresh++; days.add(d); }
      if (p.changed) n.push('اتعدّلت في الجهاز');
      seen.add(k); notes.set(p, n);
    }
    const ids = [...new Set(ps.map(p => p.id).concat(Object.keys(parsed.names)))].sort((a, b) => +a - +b);
    const newIds = ids.filter(id => !S.employees[id] && !S.removed[id]);
    const looksAdmin = id => /admin|مدير|test|تجرب/i.test(parsed.names[id] || '');
    const accept = new Set(newIds.filter(id => !looksAdmin(id)));
    // تنبيهات: حضور وانصراف لنفس الموظف في نفس الدقايق
    const warns = [];
    const byId = {}; for (const p of ps) (byId[p.id + '|' + effDate(p)] = byId[p.id + '|' + effDate(p)] || []).push(p);
    for (const k in byId) { const a = byId[k]; for (let i = 1; i < a.length; i++) if (a[i].type && a[i - 1].type && a[i].type !== a[i - 1].type && Math.abs(a[i].min - a[i - 1].min) < (S.settings.dedupeMinutes ?? 10)) { const [id, d] = k.split('|'); warns.push(`${parsed.names[id] || 'موظف ' + id} (${id}) يوم ${fmtDate(d)}: بصمة حضور وانصراف ورا بعض في نفس الوقت — هيتحسب حضور بس والانصراف هيستناك.`); break; } }
    if (parsed.kind === 'raw' && !parsed.hasState) warns.push('الملف مفيهوش نوع البصمة (حضور/انصراف)، فأول بصمة في اليوم هتتحسب حضور وآخر بصمة انصراف.');
    const range = E.dataRange(parsed), dl = [...days].sort();
    let showAll = false;
    const draw = () => {
      const typeLbl = p => p.type === 'in' ? h('span', { class: 'in' }, 'حضور') : p.type === 'out' ? h('span', { class: 'out' }, 'انصراف') : h('span', { class: 'muted' }, '—');
      const rows = (showAll ? ps : ps.slice(0, 8)).map(p => h('div', { class: 'pv-r' + (notes.get(p).some(x => /هتتجاهل|مكررة|موجودة/.test(x)) ? ' dim' : '') },
        h('span', null, p.id), h('span', { class: 'pv-n', dir: 'auto' }, parsed.names[p.id] || ''),
        h('span', null, fmtDate(p.key).slice(0, -5), h('small', null, fmt12(p.min))), h('span', null, typeLbl(p), notes.get(p).length ? h('small', null, notes.get(p).join(' · ')) : null)));
      const mismatch = expectKind && expectKind !== parsed.kind;
      $('sheet-in').replaceChildren(
        h('div', { class: 'cf-top' }, h('b', null, 'راجع قبل الحفظ'), h('button', { class: 'note-x', 'aria-label': 'إلغاء', onclick: () => $('sheet').close() }, '×')),
        h('div', { class: 'muted', style: 'margin:-6px 0 10px', dir: 'auto' }, fname),
        parsed.note ? h('div', { class: 'dev-note' }, parsed.note) : null,
        mismatch ? h('div', { class: 'warn-line', style: 'margin-bottom:8px' }, `اخترت "${KIND_NAME[expectKind]}" بس الملف طلع "${KIND_NAME[parsed.kind]}" — اتقرا كـ "${KIND_NAME[parsed.kind]}".`) : null,
        h('div', { class: 'qchips', style: 'margin-bottom:10px' }, h('span', { class: 'mini ok' }, '✓ ' + KIND_NAME[parsed.kind]),
          h('span', { class: 'mini' }, range.from === range.to ? longDate(range.from) : `${fmtDate(range.from)} ← ${fmtDate(range.to)}`)),
        h('div', { class: 'totals' }, h('div', { class: 'total' }, h('b', null, fresh), h('span', null, 'بصمة جديدة')), h('div', { class: 'total' }, h('b', null, ids.length), h('span', null, 'موظف')),
          h('div', { class: 'total' }, h('b', { style: 'color:var(--muted)' }, dup + already), h('span', null, 'مكررة/موجودة')), h('div', { class: 'total' }, h('b', { style: 'color:var(--muted)' }, before), h('span', null, 'هتتجاهل'))),
        h('div', { class: 'sec-title' }, 'اتقرا كده'),
        h('div', { class: 'list pv' }, h('div', { class: 'pv-r pv-h' }, h('span', null, 'الكود'), h('span', null, 'الاسم'), h('span', null, 'الوقت'), h('span', null, 'النوع')), rows),
        ps.length > 8 ? h('button', { class: 'btn ghost sm', onclick: () => { showAll = !showAll; draw(); } }, showAll ? 'اعرض أقل' : `اعرض كل السطور (${ps.length})`) : null,
        newIds.length ? [h('div', { class: 'sec-title' }, 'موظفين جداد — علّم على اللي يتضاف'),
          h('div', { class: 'list' }, newIds.map(id => h('label', { class: 'pv-ne' },
            h('input', { type: 'checkbox', checked: accept.has(id), onchange: ev => { ev.target.checked ? accept.add(id) : accept.delete(id); } }),
            h('span', { class: 'grow' }, h('b', { dir: 'auto' }, parsed.names[id] || 'موظف ' + id), ' · ' + id,
              looksAdmin(id) ? h('small', { style: 'display:block;color:var(--amber-ink)' }, 'شكله حساب مدير الجهاز — مش هيتضاف إلا لو علّمت عليه') : null))))] : null,
        warns.map(w => h('div', { class: 'warn-line' }, '⚠ ' + w)),
        h('div', { class: 'btns', style: 'margin-top:14px' },
          h('button', { class: 'btn primary', style: 'flex:2', disabled: !fresh && !accept.size, onclick: () => { $('sheet').close(); applyImport(parsed, fname, accept, newIds); } }, fresh ? `حفظ ${fresh} بصمة` : 'حفظ'),
          h('button', { class: 'btn', style: 'flex:1', onclick: () => $('sheet').close() }, 'إلغاء')));
    };
    UI.editor = null; $('sheet').classList.add('full'); draw(); if (!$('sheet').open) $('sheet').showModal();
  }
  const fmt12 = min => { const m = ((min % 1440) + 1440) % 1440, hh = Math.floor(m / 60), mm = m % 60; return `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? 'ص' : 'م'}`; };
  function applyImport(parsed, fname, accept, newIds) {
    const range = E.dataRange(parsed) || { from: todayKey(), to: todayKey() }, df = takeFrom();
    const first = {};
    for (const p of parsed.punches) { const d = effDate(p); if (d >= df && (!first[p.id] || d < first[p.id])) first[p.id] = d; }
    let addedEmp = 0;
    for (const id of new Set(parsed.punches.map(p => p.id).concat(Object.keys(parsed.names)))) {
      if (parsed.names[id] && !S.names[id]) S.names[id] = parsed.names[id];
      if (newIds.includes(id) && !accept.has(id)) { S.removed[id] = true; continue; } // اتجاهل (زي ADMIN)
      if (S.removed[id]) continue;
      if (!S.employees[id]) { S.employees[id] = { name: parsed.names[id] || '', off: '', shift: '', hours: '', start: first[id] || (range.from > df ? range.from : df), end: '' }; addedEmp++; }
      else if (!S.employees[id].name && parsed.names[id]) S.employees[id].name = parsed.names[id];
    }
    const added = mergePunches(parsed.punches.filter(p => { const d = effDate(p); return !S.removed[p.id] && !isLocked(d) && (!df || d >= df); }));
    if (parsed.device) S.device.lastPull = { at: nowStamp(), count: added };
    S.imports.unshift({ name: fname, at: todayKey(), count: added, from: range.from, to: range.to, kind: parsed.kind }); S.imports = S.imports.slice(0, 50);
    save();
    toast(`اتحفظ: ${added} بصمة جديدة` + (addedEmp ? ` و${addedEmp} موظف جديد — كمّل بياناتهم` : ''));
    UI.month = monthOf(range.to); UI.gmonth = UI.month;
    if (addedEmp) { UI.profile = ''; go('emps'); } else render();
    const rf = range.from > df ? range.from : df, rt = range.to < todayKey() ? range.to : todayKey();
    if (!addedEmp && rf <= rt && reviewItems(rf, rt).length) setTimeout(() => reviewSheet(rf, rt), 700);
  }
  function parseWorkbook(wb) {
    let best = null, err = null;
    for (const name of wb.SheetNames) {
      try { const d = E.parseRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })); if (!best || d.punches.length > best.punches.length) best = d; } catch (e) { err = e; }
    }
    if (!best) throw err || new Error('الملف فاضي');
    return best;
  }

  /* ======================= كشف الموظف (صورة / PDF) ======================= */
  // بيترسم على canvas مباشرة عشان العربي يطلع متشكّل صح، وبعدين يتحوّل صورة أو PDF
  async function statementPages(e, rng, label) {
    try { await Promise.all(['400', '600'].map(w => document.fonts.load(`${w} 20px "IBM Plex Sans Arabic"`))); } catch (err) { /* ignore */ }
    const W = 1240, H = 1754, M = 70, RH = 40;
    const F = (w, sz) => `${w} ${sz}px "IBM Plex Sans Arabic", Tahoma, sans-serif`;
    const s = e.summary, today = todayKey();
    const rows = e.rows.filter(r => r.date <= today);
    const cols = [['اليوم', 165], ['الحالة', 165], ['الحضور', 105], ['الانصراف', 105], ['ساعات', 95], ['تأخير/نقص', 110], ['بدري', 90], ['زيادة', 90]];
    cols.push(['ملاحظات', W - 2 * M - cols.reduce((a, c) => a + c[1], 0)]);
    const pages = [];
    let ctx, y;
    const fit = (t, mw) => { t = String(t || ''); if (ctx.measureText(t).width <= mw) return t; while (t.length > 1 && ctx.measureText(t + '…').width > mw) t = t.slice(0, -1); return t + '…'; };
    const text = (t, x, yy, opt = {}) => { ctx.font = F(opt.w || 400, opt.sz || 20); ctx.fillStyle = opt.c || '#1E1B3A'; ctx.textAlign = opt.a || 'right'; ctx.direction = 'rtl'; ctx.fillText(opt.mw ? fit(t, opt.mw) : t, x, yy); };
    const newPage = first => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; pages.push(c);
      ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#5B4BDB'; ctx.fillRect(0, 0, W, 14);
      y = M;
      text('كشف حضور وانصراف', W - M, y + 30, { w: 600, sz: 34 });
      text(label, M, y + 30, { a: 'left', sz: 22, c: '#6B6790' });
      y += 62;
      text(`${e.name}  ·  كود ${e.id}`, W - M, y + 20, { w: 600, sz: 24 });
      const emp = S.employees[e.id] || {}, sh = S.settings.shifts.find(x => x.id === emp.shift);
      const info = [emp.mode === 'hours' ? `ساعات بس (${+emp.hours} ساعة)` : sh ? 'شيفت ' + sh.name : 'شيفت حسب البصمة', emp.off !== '' && emp.off != null ? 'إجازته ' + E.DAY_NAMES[+emp.off] : null, `من ${fmtDate(rng.from)} لـ ${fmtDate(rows.length ? rows[rows.length - 1].date : rng.to)}`].filter(Boolean).join('  ·  ');
      text(info, W - M, y + 52, { sz: 19, c: '#6B6790' });
      y += 80;
      if (first) {
        const k = [['ساعات العمل', D(s.worked)], ['المطلوب', D(s.required)], ['أيام الحضور', s.present + s.offwork], ['غياب', s.absent + (s.excused ? ` (+${s.excused} بإذن)` : '')], ['تأخير/نقص', D(s.late + s.short)], ['بدري', D(s.early)], ['زيادة', D(s.overtime)]];
        const bw = (W - 2 * M - 6 * 10) / 7;
        k.forEach(([l, v], i) => {
          const x = W - M - i * (bw + 10) - bw;
          ctx.fillStyle = '#F6F3FF'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, 86, 12) : ctx.rect(x, y, bw, 86); ctx.fill();
          text(String(v), x + bw / 2, y + 40, { a: 'center', w: 600, sz: 24 });
          text(l, x + bw / 2, y + 70, { a: 'center', sz: 16, c: '#6B6790' });
        });
        y += 112;
      }
      // رأس الجدول
      ctx.fillStyle = '#ECE9FB'; ctx.fillRect(M, y, W - 2 * M, RH + 4);
      let x = W - M;
      for (const [l, w] of cols) { text(l, x - w / 2, y + 28, { a: 'center', w: 600, sz: 17 }); x -= w; }
      y += RH + 4;
    };
    newPage(true);
    const footerH = 150;
    rows.forEach((r, i) => {
      if (y + RH > H - M - footerH) newPage(false);
      if (i % 2) { ctx.fillStyle = '#FAF9FF'; ctx.fillRect(M, y, W - 2 * M, RH); }
      ctx.strokeStyle = '#EEEAFB'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, y + RH); ctx.lineTo(W - M, y + RH); ctx.stroke();
      const k = e.id + '|' + r.date;
      const notes = [r.permLate ? 'تأخير بإذن' : '', r.permEarly ? 'انصراف بإذن' : '', r.permShort ? 'نقص بإذن' : '', ...(S.notes[k] || []).map(n => n.text)].filter(Boolean).join(' · ');
      const stColor = { absent: '#C2485F', excused: '#6A5FC1', leave: '#6A5FC1', off: '#8A87A8', holiday: '#9A5B00', pending: '#A68510', missing: '#A68510' }[r.code] || '#127A4A';
      const timesIn = r.segs && r.segs.length > 1 ? r.segs.map(x => C(x.in)).join(' / ') : C(r.in);
      const timesOut = r.segs && r.segs.length > 1 ? r.segs.map(x => C(x.out)).join(' / ') : C(r.out);
      const vals = [`${r.dayName} ${+r.date.slice(8)}`, r.status.replace(' (يدوي)', ''), timesIn, timesOut, r.worked != null ? D(r.worked) : '', r.late ? D(r.late) : r.short ? D(r.short) : '', r.early ? D(r.early) : '', r.overtime ? D(r.overtime) : '', notes];
      let x = W - M;
      cols.forEach(([, w], j) => {
        const center = j >= 2 && j <= 7;
        const color = j === 1 ? stColor : (j === 5 || j === 6) && vals[j] ? '#C2485F' : j === 7 && vals[j] ? '#127A4A' : '#1E1B3A';
        text(vals[j], center ? x - w / 2 : x - 10, y + 27, { a: center ? 'center' : 'right', sz: j === 8 ? 15 : 17, c: color, mw: w - 16 });
        x -= w;
      });
      y += RH;
    });
    // الإجمالي والتوقيع
    if (y + footerH > H - M) newPage(false);
    ctx.fillStyle = '#ECE9FB'; ctx.fillRect(M, y, W - 2 * M, RH);
    text(`الإجمالي: ${D(s.worked)} ساعة · تأخير/نقص ${D(s.late + s.short)} · بدري ${D(s.early)} · زيادة ${D(s.overtime)}`, W - M - 10, y + 27, { w: 600, sz: 17 });
    y += RH + 70;
    text('توقيع الموظف: ..............................', W - M, y, { sz: 19 });
    text('توقيع المدير: ..............................', M, y, { a: 'left', sz: 19 });
    pages.forEach((c, i) => { const g = c.getContext('2d'); g.font = F(400, 15); g.fillStyle = '#9A97B8'; g.textAlign = 'center'; g.direction = 'rtl';
      g.fillText(`تطبيق الحضور والانصراف · اتعمل ${fmtDate(today)}${pages.length > 1 ? ` · صفحة ${i + 1} من ${pages.length}` : ''}`, W / 2, H - 36); });
    return pages;
  }
  async function shareFiles(files) { // files: [{name, mime, base64}]
    if (isNative()) {
      const F = plugin('Filesystem'), Sh = plugin('Share'), uris = [];
      for (const f of files) uris.push((await F.writeFile({ path: f.name, data: f.base64, directory: 'CACHE' })).uri);
      try { await Sh.share({ title: files[0].name, dialogTitle: 'ابعته أو احفظه', files: uris }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
      return;
    }
    for (const f of files) await saveFile(f.name, f.mime, f.base64);
  }
  async function exportStatement(list, rng, label, kind) {
    toast('بجهّز الكشف…');
    try {
      const all = [];
      for (const e of list) all.push({ e, pages: await statementPages(e, rng, label) });
      const tag = `${rng.tag || rng.from}${list.length === 1 ? '_emp' + list[0].id : '_all'}`;
      if (kind === 'image') {
        const files = [];
        for (const { e, pages } of all) pages.forEach((c, i) => files.push({ name: `statement_${tag}_${e.id}${pages.length > 1 ? '_p' + (i + 1) : ''}.png`, mime: 'image/png', base64: c.toDataURL('image/png').split(',')[1] }));
        await shareFiles(files);
      } else {
        await needLib('vendor/jspdf.umd.min.js', 'jspdf');
        const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
        let first = true;
        for (const { pages } of all) for (const c of pages) { if (!first) doc.addPage(); first = false; doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 595.28, 841.89); }
        await shareFiles([{ name: `statement_${tag}.pdf`, mime: 'application/pdf', base64: doc.output('datauristring').split(',')[1] }]);
      }
    } catch (err) { console.error(err); toast('مقدرتش أعمل الكشف: ' + (err.message || err)); }
  }
  function statementSheet(list, rng, label) {
    const one = list.length === 1;
    openSheet([h('div', { class: 'grab' }), h('h2', null, one ? `كشف ${list[0].name}` : `كشوف ${list.length} موظفين`), h('p', { class: 'muted', style: 'margin:-6px 0 12px' }, label),
      h('div', { class: 'list' },
        h('button', { class: 'li', onclick: () => { $('sheet').close(); exportStatement(list, rng, label, 'image'); } }, h('span', { class: 'avatar' }, '📷'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'صورة'), h('div', { class: 's' }, 'تبعتها واتساب على طول'))),
        h('button', { class: 'li', onclick: () => { $('sheet').close(); exportStatement(list, rng, label, 'pdf'); } }, h('span', { class: 'avatar' }, '📄'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'PDF'), h('div', { class: 's' }, one ? 'للطباعة أو الإرسال' : 'كل موظف في صفحة — ملف واحد'))),
        h('button', { class: 'li', onclick: () => { $('sheet').close(); exportExcel(one ? [computeRange(rng.from, rng.to).find(x => x.id === list[0].id)] : list, rng, { type: 'detail', single: one }); } }, h('span', { class: 'avatar' }, '📊'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'Excel'), h('div', { class: 's' }, 'جدول مفصّل يتعدّل'))))]);
  }

  /* ======================= قفل التطبيق ======================= */
  const LOCK_KEY = 'attendance_lock_v1';
  const lockCfg = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch (e) { return null; } };
  const setLockCfg = c => { try { if (c) localStorage.setItem(LOCK_KEY, JSON.stringify(c)); else localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ } };
  async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  const pinHash = (pin, salt) => sha(salt + ':' + pin);
  async function bioAvailable() { const B = plugin('NativeBiometric'); if (!isNative() || !B) return false; try { const r = await B.isAvailable(); return !!(r && r.isAvailable); } catch (e) { return false; } }
  async function bioVerify(reason) { const B = plugin('NativeBiometric'); try { await B.verifyIdentity({ reason, title: 'الحضور والانصراف', subtitle: reason, negativeButtonText: 'الرقم السري' }); return true; } catch (e) { return false; } }
  /** لوحة أرقام: بترجع عنصر وبتنادي onDone(pin) لما الـ 4 أرقام تكمل */
  function keypad(onDone, extra) {
    let pin = ''; const dots = h('div', { class: 'pin-dots' }), pad = h('div', { class: 'pin-pad' });
    const draw = () => dots.replaceChildren(...[0, 1, 2, 3].map(i => h('i', { class: i < pin.length ? 'f' : '' })));
    const press = d => { if (pin.length >= 4) return; pin += d; draw(); if (pin.length === 4) setTimeout(() => { const p = pin; pin = ''; draw(); onDone(p, dots); }, 120); };
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) pad.append(h('button', { onclick: () => press(d) }, d));
    pad.append(extra || h('span'), h('button', { onclick: () => press('0') }, '0'), h('button', { 'aria-label': 'امسح', onclick: () => { pin = pin.slice(0, -1); draw(); } }, '⌫'));
    draw(); return { dots, pad };
  }
  const shake = el => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); if (navigator.vibrate) navigator.vibrate(80); };
  let locked = false, fails = 0, waitUntil = 0;
  async function showLock() {
    const cfg = lockCfg(); if (!cfg || !cfg.on || locked) return;
    locked = true;
    const msg = h('div', { class: 'lk-msg' }, 'ادخل الرقم السري');
    const ov = h('div', { class: 'lock-ov', role: 'dialog', 'aria-label': 'التطبيق مقفول' });
    const unlock = () => { ov.classList.add('out'); setTimeout(() => ov.remove(), 250); locked = false; fails = 0; };
    const useBio = cfg.bio && await bioAvailable();
    const bioBtn = useBio ? h('button', { class: 'bio', 'aria-label': 'افتح بالبصمة', onclick: async () => { if (await bioVerify('افتح التطبيق')) unlock(); } }, '☝') : null;
    const kp = keypad(async (pin, dots) => {
      if (Date.now() < waitUntil) { msg.textContent = `استنى ${Math.ceil((waitUntil - Date.now()) / 1000)} ثانية`; shake(dots); return; }
      if (await pinHash(pin, cfg.salt) === cfg.hash) unlock();
      else { fails++; shake(dots); msg.textContent = fails >= 5 ? 'محاولات كتير — استنى 30 ثانية' : 'رقم غلط، جرّب تاني'; if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; } }
    }, bioBtn);
    ov.append(h('div', { class: 'lk-ico', html: '<svg viewBox="0 0 100 100" width="46" height="46"><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M29 69C25 62 24 56 24 50 24 36 36 24 50 24s26 12 26 26c0 4-1 7-1 10"/><path d="M37 75c-3-7-5-15-5-23 0-10 8-19 18-19s18 9 18 19"/><path d="M45 78c-3-7-5-15-5-25 0-6 5-11 10-11s10 5 10 11c0 9-1 17-3 24"/></g></svg>' }),
      h('div', { class: 'lk-t' }, 'الحضور والانصراف'), msg, kp.dots, kp.pad,
      useBio ? h('div', { class: 'lk-hint' }, '☝ أو افتح ببصمة صباعك') : '',
      h('button', { class: 'lk-forgot', onclick: () => { msg.textContent = useBio ? 'افتح بالبصمة وغيّر الرقم من الإعدادات' : 'من غير الرقم لازم تمسح بيانات التطبيق وترجّع نسخة احتياطية'; } }, 'نسيت الرقم؟'));
    document.body.append(ov);
    if (useBio) setTimeout(() => bioBtn.click(), 400);
  }
  function lockSetupSheet() {
    const cfg = lockCfg();
    const stepNew = () => {
      let first = null;
      const title = h('h2', null, 'اختار رقم سري (4 أرقام)'), hint = h('p', { class: 'muted', style: 'margin:-6px 0 4px;text-align:center' }, 'هتحتاجه كل ما تفتح التطبيق');
      const kp = keypad(async (pin, dots) => {
        if (!first) { first = pin; title.textContent = 'اكتبه تاني للتأكيد'; return; }
        if (pin !== first) { first = null; title.textContent = 'الرقمين مش زي بعض — ابدأ تاني'; shake(dots); return; }
        const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const c = { on: true, salt, hash: await pinHash(pin, salt), bio: false };
        if (await bioAvailable()) {
          openSheet([h('div', { class: 'grab' }), h('h2', null, 'تفتح ببصمة صباعك كمان؟'), h('p', { class: 'muted' }, 'تقدر تفتح بالبصمة بدل ما تكتب الرقم كل مرة. الرقم بيفضل شغال لو البصمة ماشتغلتش.'),
            h('div', { class: 'btns' }, h('button', { class: 'btn primary', style: 'flex:1', onclick: async () => { if (await bioVerify('تأكيد البصمة')) { c.bio = true; } setLockCfg(c); $('sheet').close(); toast('🔐 القفل اشتغل' + (c.bio ? ' بالرقم والبصمة' : '')); render(); } }, 'آه، بالبصمة'),
              h('button', { class: 'btn', onclick: () => { setLockCfg(c); $('sheet').close(); toast('🔐 القفل اشتغل'); render(); } }, 'الرقم بس'))]);
        } else { setLockCfg(c); $('sheet').close(); toast('🔐 القفل اشتغل'); render(); }
      });
      openSheet([h('div', { class: 'grab' }), h('div', { class: 'pin-sheet' }, title, hint, kp.dots, kp.pad)]);
    };
    if (!cfg || !cfg.on) return stepNew();
    // تأكيد الرقم الحالي قبل أي تغيير
    const title = h('h2', null, 'ادخل الرقم الحالي');
    const kp = keypad(async (pin, dots) => {
      if (await pinHash(pin, cfg.salt) !== cfg.hash) { title.textContent = 'رقم غلط'; shake(dots); return; }
      openSheet([h('div', { class: 'grab' }), h('h2', null, 'قفل التطبيق'), h('div', { class: 'list' },
        h('button', { class: 'li', onclick: stepNew }, h('span', { class: 'grow t' }, 'غيّر الرقم السري')),
        h('button', { class: 'li', onclick: async () => { const c = lockCfg(); if (!c.bio) { if (!(await bioAvailable())) return toast('البصمة مش متاحة على الموبايل ده'); if (!(await bioVerify('تأكيد البصمة'))) return; } c.bio = !c.bio; setLockCfg(c); $('sheet').close(); toast(c.bio ? 'البصمة اشتغلت' : 'البصمة اتقفلت'); render(); } }, h('span', { class: 'grow t' }, cfg.bio ? 'اقفل الفتح بالبصمة' : 'شغّل الفتح بالبصمة')),
        h('button', { class: 'li', onclick: () => { setLockCfg(null); $('sheet').close(); toast('القفل اتشال'); render(); } }, h('span', { class: 'grow t', style: 'color:var(--rose)' }, 'شيل القفل')))]);
    });
    openSheet([h('div', { class: 'grab' }), h('div', { class: 'pin-sheet' }, title, kp.dots, kp.pad)]);
  }

  /* ======================= البداية ======================= */
  function applyStyle() {
    const st = S.settings.style || 'vivid', el = document.documentElement;
    if (st === 'default') el.removeAttribute('data-style'); else el.setAttribute('data-style', st);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', { vivid: '#5B4BDB', default: '#0F766E', dark: '#0B1220', minimal: '#FFFFFF' }[st] || '#0F766E');
  }
  // شاشة التحميل: بتفضل لحد ما الأنيميشن يخلص (حوالي ثانية ونص) وبعدين تختفي
  (function hideSplash() {
    const sp = $('splash'); if (!sp) return;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); }, reduce ? 500 : 1500);
  })();
  normalize(); save(); applyStyle();
  if (isNative()) $('file').removeAttribute('accept'); // عشان ملفات .dat تبان في اختيار الملفات
  render();
  showLock();
  autoBackup();
  setTimeout(autoPull, 1800);
  if (isNative()) (async () => {
    const L = plugin('LocalNotifications'), A = plugin('App');
    if (L) {
      try { await L.createChannel({ id: 'reminders', name: 'التذكيرات', description: 'تذكير يومي بالأذونات والغياب', importance: 4, visibility: 1, vibration: true }); } catch (e) { /* ignore */ }
      try { L.addListener('localNotificationActionPerformed', ev => { if (ev && ev.notification && ev.notification.id === REMIND_ID) { go('day'); setTimeout(() => quickSheet(null), 300); } }); } catch (e) { /* ignore */ }
      scheduleReminder(true);
    }
    if (A) try { A.addListener('backButton', () => { if (UI.searchOpen) UI.searchOpen.close(); else if ($('sheet').open) $('sheet').close(); else if (UI.tab === 'emps' && UI.profile) { UI.profile = ''; render(); } else if (UI.tab !== 'day') go('day'); else A.minimizeApp(); }); } catch (e) { /* ignore */ }
  })();
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 60000) showLock();
    const t = todayKey();
    if (UI.lastSeen && UI.lastSeen !== t && UI.date === UI.lastSeen) UI.date = t; // يوم جديد
    if (UI.lastSeen && monthOf(UI.lastSeen) !== monthOf(t) && UI.month === monthOf(UI.lastSeen)) UI.month = monthOf(t); // شهر جديد
    UI.lastSeen = t; render(); autoBackup(); autoPull();
  });
  UI.lastSeen = todayKey();
  if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
