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
      backup: { freq: 'off', day: 5, time: '23:00', keep: 10, last: '' }
    };
  }
  let S = blank();
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* التخزين مش متاح */ }
  function normalize() {
    S.settings = Object.assign(clone(E.DEFAULT_SETTINGS), S.settings || {});
    S.backup = Object.assign(blank().backup, S.backup || {});
    S.view = Object.assign(blank().view, S.view || {});
    // النسخة الأولى كانت بتحفظ آخر ملف بس — نحوّله لسجل البصمات المتجمع
    if (S.data) { mergePunches(S.data.punches || []); Object.assign(S.names, S.data.names || {}); delete S.data; delete S.fileName; delete S.range; }
    for (const id in S.employees) if (S.employees[id].hidden) { S.removed[id] = true; delete S.employees[id]; }
  }
  function mergePunches(list) {
    const seen = new Set(S.punches.map(p => `${p.id}|${p.key}|${p.min}|${p.type || ''}`)); let added = 0;
    for (const p of list) { const k = `${p.id}|${p.key}|${p.min}|${p.type || ''}`; if (!seen.has(k)) { seen.add(k); S.punches.push({ id: p.id, key: p.key, min: p.min, type: p.type || null }); added++; } }
    return added;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('مش قادر أحفظ — مساحة الموبايل ممكن تكون مليانة'); } }

  /* ======================= أدوات ======================= */
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
  const monthOf = k => k.slice(0, 7);
  const empName = id => (S.employees[id] && S.employees[id].name) || S.names[id] || ('موظف ' + id);
  const sortedIds = () => Object.keys(S.employees).sort((a, b) => (+a - +b) || a.localeCompare(b));
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = n => (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins[n] : null;
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function confirmBtn(btn, label, action) { // زرار بيطلب ضغطة تانية للتأكيد
    if (btn.dataset.armed) { delete btn.dataset.armed; action(); return; }
    const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = old; } }, 3500);
  }

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
  const data = () => ({ punches: S.punches, names: S.names });
  function computeRange(from, to) { return E.compute(calcState(), data(), { from, to }); }
  function monthRange(m) {
    const [y, mo] = m.split('-').map(Number), last = `${m}-${pad(new Date(y, mo, 0).getDate())}`, today = todayKey();
    return { from: `${m}-01`, to: last < today ? last : today, end: last, future: `${m}-01` > today };
  }
  /** الأيام اللي مستنية تسجيل في شهر (لحد النهارده) */
  function pendingIn(m) {
    const r = monthRange(m); if (r.future) return [];
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
  function setManual(id, date, patch) {
    const k = id + '|' + date, m = Object.assign({}, S.manual[k] || {}, patch);
    for (const f in m) if (m[f] == null || m[f] === '') delete m[f];
    if (Object.keys(m).length) S.manual[k] = m; else delete S.manual[k];
    save();
  }

  /* ======================= التنقل ======================= */
  const UI = { tab: 'day', date: todayKey(), month: monthOf(todayKey()), openPresent: new Set(), focusEmp: '' };
  document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
  function go(tab) {
    UI.tab = tab;
    document.querySelectorAll('nav.bottom button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + tab));
    window.scrollTo(0, 0);
    render();
  }
  function goDay(date, empId) { UI.date = date; UI.focusEmp = empId || ''; go('day'); }
  function render() {
    ({ day: renderDay, month: renderMonth, emps: renderEmps, settings: renderSettings })[UI.tab]();
    const p = pendingIn(monthOf(todayKey())).length;
    $('badge-day').hidden = !p; $('badge-day').textContent = p > 99 ? '99+' : p;
  }
  function navBar(label, sub, inputType, value, onPick, onPrev, onNext) {
    const inp = h('input', { type: inputType, value, 'aria-label': 'اختار', onchange: ev => ev.target.value && onPick(ev.target.value) });
    return h('div', { class: 'nav-bar' },
      h('button', { class: 'arrow', 'aria-label': 'اللي قبله', html: ICON.prev, onclick: onPrev }),
      h('label', { class: 'picker' }, h('b', null, label), sub ? h('small', null, sub) : null, inp),
      h('button', { class: 'arrow', 'aria-label': 'اللي بعده', html: ICON.next, onclick: onNext }));
  }

  /* ======================= شاشة اليوم ======================= */
  function renderDay() {
    const root = $('tab-day'), date = UI.date, today = todayKey();
    $('subtitle').textContent = longDate(date) + (date === today ? ' — النهارده' : '');
    const kids = [];
    const rel = date === today ? 'النهارده' : date === addDays(today, -1) ? 'امبارح' : date > today ? 'يوم جاي' : fmtDate(date);
    kids.push(navBar(longDate(date), rel, 'date', date, v => { UI.date = v; render(); }, () => { UI.date = addDays(date, -1); render(); }, () => { UI.date = addDays(date, 1); render(); }));

    if (!sortedIds().length) {
      root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'لسه مفيش موظفين'), 'ارفع ملف جهاز البصمة من الزرار اللي فوق، أو ضيف الموظفين من شاشة "الموظفين".',
        h('div', { class: 'btns', style: 'justify-content:center;margin-top:12px' }, h('button', { class: 'btn primary', onclick: () => $('file').click() }, 'رفع ملف الجهاز'), h('button', { class: 'btn', onclick: () => go('emps') }, 'إضافة موظف'))));
      return;
    }

    // الأيام الناقصة في الشهر
    const pend = pendingIn(monthOf(date) > monthOf(today) ? monthOf(today) : monthOf(date));
    const otherPend = pend.filter(d => d !== date);
    if (otherPend.length) {
      const next = otherPend.find(d => d > date) || otherPend[0];
      kids.push(h('div', { class: 'banner' }, h('span', null, `${new Set(pend).size} يوم في ${monthLabel(monthOf(pend[0]))} محتاجين تسجيلك`),
        h('button', { class: 'btn sm', onclick: () => { UI.date = next; render(); } }, `روح لـ ${fmtDate(next).slice(0, -5)}`)));
    }

    const res = computeRange(date, date).filter(e => e.rows.length);
    if (!res.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'مفيش موظفين شغالين اليوم ده'), 'راجع تاريخ بداية وترك الشغل في شاشة الموظفين.')); return; }
    const rows = res.map(e => ({ e, r: e.rows[0] }));
    const future = date > today;
    const cnt = c => rows.filter(x => c.includes(x.r.code)).length;
    const need = rows.filter(x => x.r.code === 'pending' || x.r.code === 'missing');
    kids.push(h('div', { class: 'chips', style: 'margin-bottom:10px' },
      chip('حاضر', cnt(['present', 'offwork']), 'var(--green)'), chip('غياب', cnt(['absent']), 'var(--rose)'),
      chip('بإذن/إجازة', cnt(['excused', 'leave', 'off']), 'var(--violet)'), future ? null : chip('مستني', need.length, 'var(--amber-ink)')));

    const pendingOnly = rows.filter(x => x.r.code === 'pending');
    if (!future && pendingOnly.length > 1) {
      kids.push(h('div', { class: 'card', style: 'padding:10px 12px' }, h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${pendingOnly.length} موظف ملهمش أي تسجيل اليوم ده:`),
        h('div', { class: 'btns' },
          h('button', { class: 'btn sm primary', onclick: () => { for (const { e } of pendingOnly) { const s = usualShift(e.id); setManual(e.id, date, { in: s.start, out: s.end, absence: null }); } toast('اتسجّلوا حضور بمواعيد الشيفت'); render(); } }, 'كلهم حضور بمواعيد الشيفت'),
          h('button', { class: 'btn sm danger', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ اضغط تاني', () => { for (const { e } of pendingOnly) setManual(e.id, date, { absence: 'absent' }); toast('اتسجّلوا غياب'); render(); }) }, 'كلهم غياب'))));
    }
    for (const x of rows) kids.push(dayCard(x.e, x.r, future));
    root.replaceChildren(...kids);
    if (UI.focusEmp) { const el = $('emp-' + UI.focusEmp); UI.focusEmp = ''; if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
  }
  function chip(label, n, color) { return h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${color}` }), label, h('b', null, n)); }

  function dayCard(e, r, future) {
    const k = e.id + '|' + r.date, man = S.manual[k] || {}, perm = S.perms[k] || {};
    const beforeDevice = S.settings.deviceFrom && r.date < S.settings.deviceFrom;
    const isAbsence = ['absent', 'excused', 'leave'].includes(man.absence);
    const hasTimes = r.in != null || r.out != null;
    const mode = isAbsence ? man.absence : (hasTimes || UI.openPresent.has(k)) ? 'present' : '';
    const code = future && r.code === 'pending' ? 'future' : r.code;
    const statusTxt = future && r.code === 'pending' ? 'لسه' : r.status;

    const devLine = r.punches ? `الجهاز: حضور ${C(r.devIn) || '—'} · انصراف ${C(r.devOut) || '—'}` : beforeDevice ? 'قبل تشغيل الجهاز — سجّل يدوي' : future ? '' : 'مفيش بصمات من الجهاز';
    const metaBits = [`كود ${e.id}`, r.shift && mode === 'present' ? `شيفت ${r.shift}` : null, devLine].filter(Boolean);

    const segBtn = (v, label) => h('button', { class: `s-${v}` + (mode === v ? ' on' : ''), onclick: () => {
      if (v === 'present') { UI.openPresent.add(k); setManual(e.id, r.date, { absence: null }); }
      else if (mode === v) { setManual(e.id, r.date, { absence: null }); UI.openPresent.delete(k); }
      else { setManual(e.id, r.date, { absence: v, in: null, out: null }); UI.openPresent.delete(k); }
      render();
    } }, label);

    const body = [];
    if (mode === 'present') {
      const timeInput = (field, val, dev, label) => {
        const inp = h('input', { type: 'time', value: C(val), class: man[field] ? 'edited' : '', 'aria-label': label, onchange: ev => {
          const v = ev.target.value;
          setManual(e.id, r.date, { [field]: v && v !== C(dev) ? v : null, absence: null }); render();
        } });
        return h('div', null, h('label', { class: 'f' }, label), inp, man[field] && dev != null ? h('div', { class: 'dev' }, `الجهاز: ${C(dev)}`) : null);
      };
      body.push(h('div', { class: 'times' }, timeInput('in', r.in, r.devIn, 'الحضور'), timeInput('out', r.out, r.devOut, 'الانصراف')));
      if (r.worked != null) {
        body.push(h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', null, D(r.worked)), h('span', null, 'ساعات')),
          h('div', { class: 'stat' + (r.late ? ' bad' : '') }, h('b', null, D(r.late)), h('span', null, 'تأخير')),
          h('div', { class: 'stat' + (r.early ? ' bad' : '') }, h('b', null, D(r.early)), h('span', null, 'بدري')),
          h('div', { class: 'stat' + (r.overtime ? ' good' : '') }, h('b', null, D(r.overtime)), h('span', null, 'زيادة'))));
      } else if (r.code === 'missing') {
        body.push(h('div', { class: 'warn-line' }, `ناقص وقت ${r.missingField === 'in' ? 'الحضور' : 'الانصراف'} — اكتبه فوق`));
      }
      const shiftSel = h('select', { 'aria-label': 'الشيفت', onchange: ev => { setManual(e.id, r.date, { shift: ev.target.value || null }); render(); } },
        h('option', { value: '' }, 'شيفت تلقائي' + (r.shift && !man.shift ? ` (${r.shift})` : '')), ...S.settings.shifts.map(s => h('option', { value: s.id }, `${s.name} ${s.start}–${s.end}`)));
      shiftSel.value = man.shift || '';
      const tools = [shiftSel];
      if (r.in == null || r.out == null) tools.push(h('button', { class: 'btn ghost sm', onclick: () => {
        const s = S.settings.shifts.find(x => x.id === man.shift) || usualShift(e.id);
        setManual(e.id, r.date, { in: r.in == null ? s.start : man.in, out: r.out == null ? s.end : man.out }); render();
      } }, 'املا بمواعيد الشيفت'));
      body.push(h('div', { class: 'row-tools' }, ...tools));
      const tg = (f, label) => h('button', { class: 'tg' + (perm[f] ? ' on' : ''), onclick: () => {
        const p = Object.assign({}, S.perms[k] || {}, { [f]: !perm[f] });
        if (p.late || p.early) S.perms[k] = p; else delete S.perms[k];
        save(); render();
      } }, (perm[f] ? '✓ ' : '+ ') + label);
      body.push(h('div', { class: 'toggles' }, tg('late', 'تأخير بإذن'), tg('early', 'انصراف بدري بإذن')));
    }
    const hasManual = !!S.manual[k];
    return h('div', { class: 'emp' + (!future && (r.code === 'pending' || r.code === 'missing') ? ' need' : ''), id: 'emp-' + e.id },
      h('div', { class: 'emp-head' },
        h('div', null, h('div', { class: 'emp-name', dir: 'auto' }, e.name), h('div', { class: 'emp-meta' }, metaBits.join(' · '))),
        h('span', { class: 'pill c-' + code }, statusTxt)),
      h('div', { class: 'seg' }, segBtn('present', 'حاضر'), segBtn('absent', 'غياب'), segBtn('excused', 'غياب بإذن'), segBtn('leave', 'إجازة')),
      ...body,
      hasManual && r.punches ? h('div', { style: 'margin-top:6px;text-align:left' }, h('button', { class: 'btn ghost sm', onclick: () => { delete S.manual[k]; UI.openPresent.delete(k); save(); render(); toast('رجع زي بيانات الجهاز'); } }, 'رجّع زي الجهاز')) : null);
  }

  /* ======================= شاشة الشهر ======================= */
  function renderMonth() {
    const root = $('tab-month'), m = UI.month, rng = monthRange(m);
    $('subtitle').textContent = 'تقرير ' + monthLabel(m);
    const shiftM = d => { const [y, mo] = m.split('-').map(Number), t = new Date(y, mo - 1 + d, 1); UI.month = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; render(); };
    const kids = [navBar(monthLabel(m), m === monthOf(todayKey()) ? 'الشهر الحالي' : 'شهر قديم', 'month', m, v => { UI.month = v; render(); }, () => shiftM(-1), () => shiftM(1))];
    if (rng.future) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'الشهر ده لسه مجاش'))); return; }
    const all = computeRange(rng.from, rng.to);
    if (!all.length) { root.replaceChildren(...kids, h('div', { class: 'card empty' }, h('b', null, 'مفيش بيانات للشهر ده'), 'مفيش موظفين كانوا شغالين الشهر ده.')); return; }

    const pend = pendingIn(m);
    if (pend.length) kids.push(h('div', { class: 'banner' }, h('span', null, `${pend.length} تسجيل ناقص — التقرير مش هيبقى كامل`), h('button', { class: 'btn sm', onclick: () => goDay(pend[0]) }, 'كمّل التسجيل')));
    else kids.push(h('div', { class: 'banner ok' }, h('span', null, rng.to < rng.end ? `كل الأيام لحد ${fmtDate(rng.to)} متسجلة` : 'الشهر متسجّل كامل ✓')));

    const tot = f => all.reduce((a, e) => a + (e.summary[f] || 0), 0);
    kids.push(h('div', { class: 'totals' },
      h('div', { class: 'total' }, h('b', null, D(tot('worked')).split(':')[0]), h('span', null, 'ساعة شغل')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, tot('absent')), h('span', null, 'يوم غياب')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--rose)' }, D(tot('late'))), h('span', null, 'تأخير')),
      h('div', { class: 'total' }, h('b', { style: 'color:var(--green)' }, D(tot('overtime'))), h('span', null, 'زيادة'))));

    const v = S.view;
    if (v.emp && !all.some(e => e.id === v.emp)) v.emp = '';
    const empSel = h('select', { 'aria-label': 'الموظف', onchange: ev => { v.emp = ev.target.value; save(); render(); } },
      h('option', { value: '' }, 'كل الموظفين'), ...all.map(e => h('option', { value: e.id }, e.name)));
    empSel.value = v.emp;
    const typeBtn = (t, l) => h('button', { class: v.type === t ? 'on' : '', onclick: () => { v.type = t; save(); render(); } }, l);
    kids.push(h('div', { class: 'ctrls' }, h('div', { class: 'seg two' }, typeBtn('summary', 'شامل'), typeBtn('detail', 'مفصّل')), empSel));

    const list = v.emp ? all.filter(e => e.id === v.emp) : all;
    if (v.type === 'summary') for (const e of list) kids.push(monthRow(e));
    else for (const e of list) kids.push(...detailTable(e));
    kids.push(h('button', { class: 'btn primary block', style: 'margin-top:6px', onclick: () => exportExcel(list, rng) }, h('span', { html: ICON.xls, style: 'display:inline-flex' }), `تحميل Excel — ${v.type === 'summary' ? 'شامل' : 'مفصّل'}${v.emp ? ' — ' + list[0].name : ''}`));
    root.replaceChildren(...kids);
  }
  function monthRow(e) {
    const s = e.summary, c = (label, val, color) => val ? h('span', { class: 'chip' }, h('span', { class: 'dot', style: `background:${color}` }), label, h('b', null, val)) : null;
    return h('button', { class: 'mrow', onclick: () => { S.view.emp = e.id; S.view.type = 'detail'; save(); render(); window.scrollTo(0, 0); } },
      h('div', { class: 'mrow-top' }, h('div', null, h('div', { class: 'emp-name', dir: 'auto' }, e.name), h('div', { class: 'emp-meta' }, `كود ${e.id}${e.offDay ? ' · إجازته ' + e.offDay : ''}`)),
        h('div', { class: 'hrs' }, D(s.worked), h('small', null, ' ساعة'))),
      h('div', { class: 'chips' },
        c('حضور', s.present + s.offwork, 'var(--green)'), c('غياب', s.absent, 'var(--rose)'), c('غياب بإذن', s.excused, 'var(--violet)'), c('إجازة', s.leave, 'var(--violet)'),
        c('تأخير', s.late ? D(s.late) : 0, 'var(--rose)'), c('بدري', s.early ? D(s.early) : 0, 'var(--rose)'), c('زيادة', s.overtime ? D(s.overtime) : 0, 'var(--green)'),
        c('مستني', s.pending + s.missing, 'var(--amber-ink)')));
  }
  const DETAIL_COLS = ['اليوم', 'الحالة', 'الحضور', 'الانصراف', 'ساعات', 'تأخير', 'بدري', 'زيادة', 'الشيفت', 'إذن'];
  function detailTable(e) {
    const s = e.summary, td = (v, cls) => h('td', { class: cls || null }, v || '');
    const body = e.rows.map(r => h('tr', { onclick: () => goDay(r.date, e.id) },
      td(`${E.DAY_NAMES[r.weekday]} ${+r.date.slice(8)}`), h('td', null, h('span', { class: 'pill c-' + r.code }, r.status)),
      td(C(r.in)), td(C(r.out)), td(D(r.worked)), td(r.late ? D(r.late) : '', 'bad'), td(r.early ? D(r.early) : '', 'bad'), td(r.overtime ? D(r.overtime) : '', 'good'),
      td(r.shift), td([r.lateExcused ? 'تأخير ' + D(r.lateExcused) : '', r.earlyExcused ? 'بدري ' + D(r.earlyExcused) : ''].filter(Boolean).join(' · '))));
    const tot = h('tr', { class: 'tot' }, h('td', { colspan: 2 }, 'الإجمالي'), td(''), td(''), td(D(s.worked)), td(D(s.late)), td(D(s.early)), td(D(s.overtime)), td(''),
      td([s.lateExcused ? 'تأخير ' + D(s.lateExcused) : '', s.earlyExcused ? 'بدري ' + D(s.earlyExcused) : ''].filter(Boolean).join(' · ')));
    return [h('div', { class: 'emp-title' }, h('span', { dir: 'auto' }, e.name), h('span', { class: 'muted' }, 'اضغط على أي يوم تعدّله')),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, DETAIL_COLS.map(c => h('th', null, c)))), h('tbody', null, body, tot)))];
  }

  /* ======================= Excel ======================= */
  function exportExcel(list, rng) {
    const dur = min => ({ t: 'n', v: (min || 0) / 1440, z: '[h]:mm' }), txt = v => ({ t: 's', v: v == null ? '' : String(v) }), num = v => ({ t: 'n', v: v || 0 });
    const isSum = S.view.type === 'summary', single = !!S.view.emp;
    const title = `${isSum ? 'تقرير شامل' : 'تقرير مفصّل'} — ${single ? list[0].name : 'كل الموظفين'} — ${monthLabel(UI.month)} (من ${fmtDate(rng.from)} إلى ${fmtDate(rng.to)})`;
    const aoa = [[txt(title)], []]; let widths;
    if (isSum) {
      const head = ['الكود', 'الاسم', 'يوم الإجازة', 'أيام الحضور', 'أيام الغياب', 'غياب بإذن', 'إجازة', 'إجازة أسبوعية', 'شغل يوم إجازة', 'مستني تسجيل', 'ساعات العمل', 'التأخير', 'أيام التأخير', 'تأخير بإذن', 'انصراف بدري', 'أيام الانصراف بدري', 'انصراف بدري بإذن', 'الزيادة'];
      aoa.push(head.map(txt));
      for (const e of list) { const s = e.summary; aoa.push([txt(e.id), txt(e.name), txt(e.offDay), num(s.present + s.offwork), num(s.absent), num(s.excused), num(s.leave), num(s.off), num(s.offwork), num(s.pending + s.missing), dur(s.worked), dur(s.late), num(s.lateDays), dur(s.lateExcused), dur(s.early), num(s.earlyDays), dur(s.earlyExcused), dur(s.overtime)]); }
      widths = [8, 24, 11, 11, 11, 10, 8, 13, 13, 12, 12, 10, 11, 11, 12, 16, 16, 10];
    } else {
      aoa.push(['الكود', 'الاسم', 'التاريخ', 'اليوم', 'الشيفت', 'الحضور', 'الانصراف', 'ساعات العمل', 'التأخير', 'تأخير بإذن', 'انصراف بدري', 'انصراف بإذن', 'الزيادة', 'الحالة'].map(txt));
      for (const e of list) {
        for (const x of e.rows) aoa.push([txt(e.id), txt(e.name), txt(fmtDate(x.date)), txt(x.dayName), txt(x.shift), txt(C(x.in)), txt(C(x.out)),
          x.worked == null ? txt('') : dur(x.worked), x.late ? dur(x.late) : txt(''), x.lateExcused ? dur(x.lateExcused) : txt(''),
          x.early ? dur(x.early) : txt(''), x.earlyExcused ? dur(x.earlyExcused) : txt(''), x.overtime ? dur(x.overtime) : txt(''), txt(x.status)]);
        const s = e.summary;
        aoa.push([txt(''), txt(`إجمالي ${e.name}`), txt(''), txt(''), txt(''), txt(''), txt(''), dur(s.worked), dur(s.late), dur(s.lateExcused), dur(s.early), dur(s.earlyExcused), dur(s.overtime),
          txt(`حضور ${s.present + s.offwork} · غياب ${s.absent} · غياب بإذن ${s.excused} · إجازة ${s.leave + s.off}${s.pending + s.missing ? ' · مستني تسجيل ' + (s.pending + s.missing) : ''}`)]);
        aoa.push([]);
      }
      widths = [8, 22, 12, 10, 9, 9, 9, 11, 9, 11, 11, 12, 9, 34];
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: widths.length - 1 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isSum ? 'شامل' : 'مفصل');
    wb.Workbook = { Views: [{ RTL: true }] };
    const fname = `attendance_${UI.month}_${isSum ? 'summary' : 'detailed'}${single ? '_emp' + list[0].id : '_all'}.xlsx`;
    saveFile(fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }))
      .catch(err => toast('مقدرتش أحفظ الملف: ' + (err.message || err)));
  }

  /* ======================= الموظفين ======================= */
  function renderEmps() {
    $('subtitle').textContent = `${sortedIds().length} موظف`;
    const today = todayKey(), ids = sortedIds();
    const active = ids.filter(id => !(S.employees[id].end && S.employees[id].end < today)), gone = ids.filter(id => !active.includes(id));
    const item = id => {
      const e = S.employees[id], sh = S.settings.shifts.find(s => s.id === e.shift);
      const off = e.off === '' || e.off == null ? 'يوم الإجازة مش متحدد ⚠' : 'إجازته ' + E.DAY_NAMES[+e.off];
      const name = empName(id);
      return h('button', { class: 'li' + (gone.includes(id) ? ' gone' : ''), onclick: () => empSheet(id) },
        h('span', { class: 'avatar' }, name.trim().charAt(0) || '؟'),
        h('span', { class: 'grow' }, h('div', { class: 't', dir: 'auto' }, name),
          h('div', { class: 's' }, [`كود ${id}`, off, sh ? 'شيفت ' + sh.name : 'شيفت تلقائي', e.end ? `ساب ${fmtDate(e.end)}` : null].filter(Boolean).join(' · '))),
        h('span', { html: ICON.chev, style: 'display:inline-flex' }));
    };
    const kids = [h('button', { class: 'btn primary block', style: 'margin-bottom:12px', onclick: () => empSheet(null) }, h('span', { html: ICON.plus, style: 'display:inline-flex' }), 'موظف جديد')];
    if (!ids.length) kids.push(h('div', { class: 'card empty' }, h('b', null, 'لسه مفيش موظفين'), 'بيتضافوا لوحدهم لما ترفع ملف الجهاز، أو ضيفهم من الزرار اللي فوق.'));
    if (active.length) kids.push(h('div', { class: 'sec-title' }, 'شغالين'), h('div', { class: 'list' }, active.map(item)));
    if (gone.length) kids.push(h('div', { class: 'sec-title' }, 'سابوا الشغل (موجودين في تقارير الشهور القديمة)'), h('div', { class: 'list' }, gone.map(item)));
    $('tab-emps').replaceChildren(...kids);
  }
  function empSheet(id) {
    const isNew = id == null, e = isNew ? { name: '', off: '', shift: '', start: todayKey(), end: '' } : Object.assign({}, S.employees[id]);
    const f = (label, el) => h('div', { class: 'field' }, h('label', { class: 'f' }, label), el);
    const idIn = h('input', { inputmode: 'numeric', value: isNew ? '' : id, disabled: !isNew, placeholder: 'نفس الكود المتسجّل في جهاز البصمة' });
    const nameIn = h('input', { dir: 'auto', value: e.name || (isNew ? '' : S.names[id] || '') });
    const offIn = h('select', null, h('option', { value: '' }, '— مش متحدد —'), E.DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))); offIn.value = e.off == null ? '' : String(e.off);
    const shIn = h('select', null, h('option', { value: '' }, 'تلقائي (حسب البصمة)'), S.settings.shifts.map(s => h('option', { value: s.id }, `${s.name} ${s.start}–${s.end}`))); shIn.value = e.shift || '';
    const stIn = h('input', { type: 'date', value: e.start || '' }), enIn = h('input', { type: 'date', value: e.end || '' });
    const msg = h('div');
    const saveBtn = h('button', { class: 'btn primary', style: 'flex:1', onclick: () => {
      const nid = isNew ? idIn.value.trim() : id;
      if (!nid) { idIn.focus(); return; }
      if (isNew && S.employees[nid]) { msg.replaceChildren(h('div', { class: 'warn-line' }, `الكود ${nid} متسجّل قبل كده باسم ${empName(nid)}`)); return; }
      if (isNew) delete S.removed[nid];
      S.employees[nid] = Object.assign(S.employees[nid] || {}, { name: nameIn.value.trim(), off: offIn.value, shift: shIn.value, start: stIn.value, end: enIn.value });
      save(); $('sheet').close(); toast(isNew ? `اتضاف ${empName(nid)}` : 'اتحفظ'); render();
    } }, isNew ? 'إضافة' : 'حفظ');
    const kids = [h('h2', null, isNew ? 'موظف جديد' : empName(id)),
      h('div', { class: 'grid2' }, f('الكود في الجهاز', idIn), f('الاسم', nameIn)),
      h('div', { class: 'grid2' }, f('يوم الإجازة الأسبوعية', offIn), f('الشيفت', shIn)),
      h('div', { class: 'grid2' }, f('بدأ الشغل يوم', stIn), f('ساب الشغل يوم (لو مشي)', enIn)),
      h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'الشيفت "تلقائي" يعني التطبيق بيعرفه من وقت البصمة كل يوم. لو موظف مشي اكتب يوم ما ساب — بيفضل في تقارير الشهور القديمة.'),
      msg, h('div', { class: 'btns' }, saveBtn, h('button', { class: 'btn', onclick: () => $('sheet').close() }, 'إلغاء'))];
    if (!isNew) kids.push(h('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line)' },
      h('button', { class: 'btn danger block', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ هيتمسح من كل الشهور — اضغط تاني', () => {
        delete S.employees[id]; S.removed[id] = true;
        for (const k in S.manual) if (k.startsWith(id + '|')) delete S.manual[k];
        for (const k in S.perms) if (k.startsWith(id + '|')) delete S.perms[k];
        S.punches = S.punches.filter(p => p.id !== id);
        if (S.view.emp === id) S.view.emp = '';
        save(); $('sheet').close(); toast('اتحذف'); render();
      }) }, 'حذف الموظف نهائيًا')));
    openSheet(kids);
  }
  function openSheet(kids) { $('sheet-in').replaceChildren(...kids); $('sheet').showModal(); }
  $('sheet').addEventListener('click', ev => { if (ev.target === $('sheet')) $('sheet').close(); });

  /* ======================= الإعدادات ======================= */
  function renderSettings() {
    $('subtitle').textContent = 'الإعدادات';
    const st = S.settings, b = S.backup;
    const row = (title, sub, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, h('b', null, title), sub ? h('span', null, sub) : null), ctrl);
    const numIn = (key, min, max) => h('input', { type: 'number', min, max, inputmode: 'numeric', value: st[key], onchange: ev => { const v = parseInt(ev.target.value, 10); if (!isNaN(v) && v >= min) { st[key] = v; save(); toast('اتحفظ'); } } });

    const dataCard = h('div', { class: 'card' }, h('h2', null, 'ملفات الجهاز'),
      row('الاعتماد على الجهاز من يوم', 'بصمات الجهاز قبل اليوم ده بتتجاهل (فترة التجربة) وتسجّلها يدوي', h('input', { type: 'date', value: st.deviceFrom || '', onchange: ev => { st.deviceFrom = ev.target.value; save(); toast('اتحفظ'); } })),
      h('div', { class: 'btns', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => $('file').click() }, 'رفع ملف الجهاز')),
      S.imports.length ? h('ul', { class: 'file-list' }, S.imports.slice(0, 5).map(i => h('li', null, `${fmtDate(i.at)} — ${i.name} — ${i.count} بصمة جديدة`))) : h('p', { class: 'muted' }, 'لسه مرفعتش ملفات. كل ملف بترفعه بيتجمع مع اللي قبله.'));

    const shiftCard = h('div', { class: 'card' }, h('h2', null, 'الشيفتات'),
      ...st.shifts.map((s, i) => h('div', { class: 'shift' },
        h('div', null, h('label', { class: 'f' }, 'الاسم'), h('input', { value: s.name, onchange: ev => { s.name = ev.target.value; save(); } })),
        h('div', null, h('label', { class: 'f' }, 'من'), h('input', { type: 'time', value: s.start, onchange: ev => { s.start = ev.target.value; save(); } })),
        h('div', null, h('label', { class: 'f' }, 'لـ'), h('input', { type: 'time', value: s.end, onchange: ev => { s.end = ev.target.value; save(); } })),
        h('button', { class: 'btn danger sm', disabled: st.shifts.length <= 1, style: 'min-height:44px', onclick: ev => confirmBtn(ev.currentTarget, 'تاني', () => { st.shifts.splice(i, 1); save(); render(); }) }, 'حذف'))),
      h('button', { class: 'btn sm', onclick: () => { const ids = new Set(st.shifts.map(s => s.id)); let n = 1; while (ids.has('s' + n)) n++; st.shifts.push({ id: 's' + n, name: 'شيفت ' + (st.shifts.length + 1), start: '08:00', end: '16:00' }); save(); render(); } }, '+ شيفت جديد'));

    const rulesCard = h('div', { class: 'card' }, h('h2', null, 'قواعد الحساب'),
      row('فترة السماح في التأخير', 'بالدقايق — جه 10:20 والسماح 15 = 5 دقايق تأخير', numIn('grace', 0, 120)),
      row('البصمة المكررة', 'بصمتين من نفس النوع في أقل من كام دقيقة = بصمة واحدة', numIn('dedupeMinutes', 0, 60)),
      row('آخر اليوم', 'البصمة قبل الساعة دي الفجر تتبع اليوم اللي قبله', numIn('dayCutHour', 0, 12)),
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
      h('button', { class: 'btn danger', onclick: ev => confirmBtn(ev.currentTarget, 'متأكد؟ اضغط تاني للمسح', () => { S = blank(); save(); toast('اتمسح كل حاجة'); render(); }) }, 'مسح كل البيانات'));

    $('tab-settings').replaceChildren(dataCard, backupCard, shiftCard, rulesCard, dangerCard);
    if (isNative()) listAutoBackups();
  }

  /* ======================= النسخ الاحتياطي ======================= */
  const AB_DIR = 'الحضور والانصراف';
  const backupJson = () => JSON.stringify(Object.assign({ app: 'attendance', exported: new Date().toISOString() }, S));
  function restoreText(text) {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== 'object' || !obj.settings) throw new Error();
      delete obj.app; delete obj.exported;
      S = Object.assign(blank(), obj); normalize(); save(); toast('اترجعت النسخة الاحتياطية'); render();
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

  /* ======================= رفع ملف الجهاز ======================= */
  $('upload-btn').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      let parsed;
      if (/\.(dat|txt)$/i.test(f.name)) {
        const text = await f.text(), p = E.parseAttlogText(text);
        parsed = p ? { kind: 'raw', punches: p, dates: [], names: {} } : parseWorkbook(XLSX.read(text, { type: 'string' }));
      } else parsed = parseWorkbook(XLSX.read(await f.arrayBuffer(), { type: 'array' }));
      const range = E.dataRange(parsed);
      if (!range) throw new Error('الملف مفيهوش تواريخ');
      let addedEmp = 0;
      const ids = new Set(parsed.punches.map(p => p.id).concat(Object.keys(parsed.names)));
      for (const id of ids) {
        if (parsed.names[id] && !S.names[id]) S.names[id] = parsed.names[id];
        if (S.removed[id]) continue;
        if (!S.employees[id]) { S.employees[id] = { name: parsed.names[id] || '', off: '', shift: '', start: range.from, end: '' }; addedEmp++; }
        else if (!S.employees[id].name && parsed.names[id]) S.employees[id].name = parsed.names[id];
      }
      const added = mergePunches(parsed.punches);
      S.imports.unshift({ name: f.name, at: todayKey(), count: added, from: range.from, to: range.to }); S.imports = S.imports.slice(0, 50);
      save();
      toast(`اتقرا الملف: ${added} بصمة جديدة` + (addedEmp ? ` و${addedEmp} موظف جديد` : ''));
      UI.month = monthOf(range.to);
      if (addedEmp) go('emps'); else render();
    } catch (e) { console.error(e); toast('مقدرتش أقرا الملف: ' + (e.message || e)); }
    ev.target.value = '';
  });
  function parseWorkbook(wb) {
    let best = null, err = null;
    for (const name of wb.SheetNames) {
      try { const d = E.parseRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })); if (!best || d.punches.length > best.punches.length) best = d; } catch (e) { err = e; }
    }
    if (!best) throw err || new Error('الملف فاضي');
    return best;
  }

  /* ======================= البداية ======================= */
  normalize(); save();
  if (isNative()) $('file').removeAttribute('accept'); // عشان ملفات .dat تبان في اختيار الملفات
  render();
  autoBackup();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayKey();
    if (UI.lastSeen && UI.lastSeen !== t && UI.date === UI.lastSeen) UI.date = t; // يوم جديد
    if (UI.lastSeen && monthOf(UI.lastSeen) !== monthOf(t) && UI.month === monthOf(UI.lastSeen)) UI.month = monthOf(t); // شهر جديد
    UI.lastSeen = t; render(); autoBackup();
  });
  UI.lastSeen = todayKey();
  if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
