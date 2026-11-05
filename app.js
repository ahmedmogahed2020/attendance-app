/* واجهة أبلكيشن الحضور والانصراف */
(function () {
  'use strict';
  const E = window.Engine;
  const KEY = 'attendance_state_v1';
  const $ = id => document.getElementById(id);

  /* ---------- الحالة والحفظ ---------- */
  function blank() {
    return { settings: JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS)), employees: {}, perms: {}, manual: {}, punches: [], names: {}, removed: {}, imports: [], view: { type: 'summary', emp: '' } };
  }
  function migrate() {
    // النسخة الأولى كانت بتحفظ آخر ملف بس — نحوّله لسجل البصمات المتجمع
    if (S.data) { mergePunches(S.data.punches || []); Object.assign(S.names, S.data.names || {}); if (S.fileName) S.imports.push({ name: S.fileName, at: todayKey(), count: (S.data.punches || []).length }); delete S.data; delete S.fileName; delete S.range; }
    for (const id in S.employees) if (S.employees[id].hidden) { S.removed[id] = true; delete S.employees[id]; }
  }
  function mergePunches(list) {
    const seen = new Set(S.punches.map(p => `${p.id}|${p.key}|${p.min}|${p.type || ''}`)); let added = 0;
    for (const p of list) { const k = `${p.id}|${p.key}|${p.min}|${p.type || ''}`; if (!seen.has(k)) { seen.add(k); S.punches.push({ id: p.id, key: p.key, min: p.min, type: p.type || null }); added++; } }
    return added;
  }
  let S = blank();
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* التخزين مش متاح */ }
  S.settings = Object.assign(JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS)), S.settings || {});
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { flash($('import-msg'), 'err', 'مش قادر أحفظ على الموبايل — المساحة ممكن تكون مليانة.'); } }

  /* ---------- أدوات ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  function flash(box, kind, msg) { box.replaceChildren(h('div', { class: 'alert ' + kind }, msg)); }
  const D = E.fmtDur, C = E.fmtClock;
  const fmtDate = k => { const [y, m, d] = k.split('-'); return `${+d}/${+m}/${y}`; };
  const shortDate = k => { const [, m, d] = k.split('-'); return `${+d}/${+m}`; };
  const empName = id => (S.employees[id] && S.employees[id].name) || S.names[id] || ('موظف ' + id);
  const todayKey = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const monthLabel = m => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y}`; };
  const thisMonth = () => todayKey().slice(0, 7);
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  /** حفظ ملف: في التطبيق بيفتح قائمة المشاركة/الحفظ، وفي المتصفح بينزل عادي */
  async function saveFile(name, mime, base64, text) {
    if (isNative()) {
      const P = window.Capacitor.Plugins, F = P.Filesystem, Sh = P.Share;
      const r = await F.writeFile(text != null ? { path: name, data: text, directory: 'CACHE', encoding: 'utf8' } : { path: name, data: base64, directory: 'CACHE' });
      try { await Sh.share({ title: name, dialogTitle: 'احفظ الملف أو ابعته', files: [r.uri] }); } catch (e) { if (!/cancel/i.test(String(e && e.message))) throw e; }
      return;
    }
    const blob = text != null ? new Blob([text], { type: mime }) : new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mime });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const sortedIds = () => Object.keys(S.employees).sort((a, b) => (+a - +b) || a.localeCompare(b));

  /* ---------- التبويبات ---------- */
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    window.scrollTo(0, 0);
    renderAll();
  }));

  /* ---------- قراءة الملف ---------- */
  $('file').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    const box = $('import-msg');
    try {
      let data = null;
      const lower = f.name.toLowerCase();
      if (/\.(dat|txt)$/.test(lower)) {
        const text = await f.text();
        const p = E.parseAttlogText(text);
        if (p) data = { kind: 'raw', punches: p, dates: [], names: {} };
        else { const wb = XLSX.read(text, { type: 'string' }); data = parseWorkbook(wb); }
      } else {
        const buf = await f.arrayBuffer();
        data = parseWorkbook(XLSX.read(buf, { type: 'array' }));
      }
      const range = E.dataRange(data);
      if (!range) throw new Error('الملف مفيهوش تواريخ');
      let addedEmp = 0, skipped = 0;
      const ids = new Set(data.punches.map(p => p.id).concat(Object.keys(data.names)));
      for (const id of ids) {
        if (data.names[id] && !S.names[id]) S.names[id] = data.names[id];
        if (S.removed[id]) { skipped++; continue; }
        if (!S.employees[id]) { S.employees[id] = { name: data.names[id] || '', off: '', start: range.from }; addedEmp++; }
        else if (!S.employees[id].name && data.names[id]) S.employees[id].name = data.names[id];
      }
      const added = mergePunches(data.punches);
      S.imports.unshift({ name: f.name, at: todayKey(), count: added, from: range.from, to: range.to }); S.imports = S.imports.slice(0, 50);
      save();
      $('month').value = range.to.slice(0, 7);
      const kindTxt = data.kind === 'report' ? 'تقرير الجهاز' : 'سجل البصمات';
      flash(box, 'ok', `تمام — ${kindTxt} من ${fmtDate(range.from)} لـ ${fmtDate(range.to)}: ${added} بصمة جديدة` + (data.punches.length - added ? ` (و${data.punches.length - added} كانت موجودة قبل كده)` : '') + (addedEmp ? ` — اتضاف ${addedEmp} موظف جديد` : '') + (skipped ? ` — اتجاهل ${skipped} موظف محذوف` : ''));
      renderAll();
    } catch (e) {
      console.error(e);
      flash(box, 'err', 'مقدرتش أقرا الملف: ' + (e.message || e));
    }
    ev.target.value = '';
  });

  function parseWorkbook(wb) {
    let best = null, err = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      try { const d = E.parseRows(rows); if (!best || d.punches.length > best.punches.length) best = d; } catch (e) { err = e; }
    }
    if (!best) throw err || new Error('الملف فاضي');
    return best;
  }

  /* ---------- الحساب ---------- */
  function currentMonth() { const m = $('month').value; return /^\d{4}-\d{2}$/.test(m) ? m : thisMonth(); }
  function currentRange() {
    const m = currentMonth(), [y, mo] = m.split('-').map(Number);
    const from = `${m}-01`, last = `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
    const today = todayKey();
    return { from, to: last < today ? last : today, monthEnd: last, future: from > today };
  }
  function computeNow() {
    const r = currentRange(); if (r.future) return [];
    return E.compute(Object.assign({}, S, { onlyListed: true }), { punches: S.punches, names: S.names }, r);
  }

  /* ---------- شاشة التقرير ---------- */
  function renderReport() {
    const last = S.imports[0];
    $('file-info').textContent = last ? `آخر ملف: ${last.name} (${fmtDate(last.at)}) — كل الملفات بتتجمع مع بعض` : 'Excel أو ملف السجل (attlog) من الجهاز';
    if (!$('month').value) $('month').value = thisMonth();
    const rng = currentRange();
    $('subtitle').textContent = `شهر ${monthLabel(currentMonth())}` + (currentMonth() === thisMonth() ? ' (الشهر الحالي)' : '');
    $('month-label').textContent = monthLabel(currentMonth());
    $('month-today').hidden = currentMonth() === thisMonth();
    const has = sortedIds().length > 0;
    $('report-card').hidden = false;
    if (!has) { $('missing-card').hidden = true; $('notices').replaceChildren(); $('report-out').replaceChildren(h('div', { class: 'card empty' }, 'لسه مفيش موظفين. ارفع ملف الجهاز من فوق، أو ضيف الموظفين من شاشة "الموظفين".')); return; }
    if (rng.future) { $('missing-card').hidden = true; $('notices').replaceChildren(); $('report-out').replaceChildren(h('div', { class: 'card empty' }, 'الشهر ده لسه مجاش.')); return; }
    // اختيار الموظف
    const sel = $('emp-sel'), cur = S.view.emp || '';
    sel.replaceChildren(h('option', { value: '' }, 'كل الموظفين'), ...sortedIds().map(id => h('option', { value: id }, `${empName(id)} (${id})`)));
    sel.value = cur; if (sel.value !== cur) { S.view.emp = ''; sel.value = ''; }
    document.querySelectorAll('#type-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view.type));

    const res = computeNow() || [];
    // تنبيهات
    const notes = [];
    const noOff = res.filter(e => !e.offDay).map(e => e.name);
    if (noOff.length) notes.push(h('div', { class: 'alert warn' }, `مفيش يوم إجازة متحدد لـ: ${noOff.join('، ')}. يوم إجازتهم هيظهر مستني تسجيلك. `, h('button', { class: 'small', onclick: () => document.querySelector('nav [data-tab=emps]').click() }, 'حدد من هنا')));
    $('notices').replaceChildren(...notes);

    // الأيام اللي مستنية تسجيلك
    const todo = [];
    for (const e of res) for (const r of e.rows) if (r.code === 'missing' || r.code === 'pending') todo.push({ e, r });
    todo.sort((a, b) => b.r.date.localeCompare(a.r.date) || a.e.id.localeCompare(b.e.id, undefined, { numeric: true }));
    $('missing-card').hidden = !todo.length;
    $('missing-count').textContent = todo.length;
    const pendingCount = todo.filter(x => x.r.code === 'pending').length;
    const bulk = $('bulk-absent');
    bulk.hidden = !pendingCount;
    bulk.textContent = `اعتبر كل الأيام الفاضية (${pendingCount}) غياب`;
    const setManual = (id, date, patch) => {
      const k = id + '|' + date; const m = Object.assign(S.manual[k] || {}, patch);
      for (const f in m) if (m[f] === undefined || m[f] === '') delete m[f];
      if (Object.keys(m).length) S.manual[k] = m; else delete S.manual[k];
      save(); renderAll();
    };
    $('missing-list').replaceChildren(...todo.map(({ e, r }) => {
      const who = h('div', { class: 'who' }, h('b', null, e.name), `${r.dayName} ${shortDate(r.date)} — `);
      if (r.code === 'missing') {
        const inp = h('input', { type: 'time', 'aria-label': r.missingField === 'in' ? 'وقت الحضور' : 'وقت الانصراف' });
        who.append(`${r.missingField === 'in' ? 'انصراف ' + C(r.out) : 'حضور ' + C(r.in)} — ناقص ${r.missingField === 'in' ? 'الحضور' : 'الانصراف'}`);
        return h('div', { class: 'miss' }, who, inp,
          h('button', { class: 'small primary', onclick: () => { if (!inp.value) { inp.focus(); return; } setManual(e.id, r.date, { [r.missingField]: inp.value }); } }, 'حفظ'));
      }
      who.append('مفيش ولا بصمة');
      const tIn = h('input', { type: 'time', 'aria-label': 'وقت الحضور' }), tOut = h('input', { type: 'time', 'aria-label': 'وقت الانصراف' });
      const times = h('div', { class: 'pend-times', hidden: true },
        h('div', null, h('label', null, 'الحضور'), tIn), h('div', null, h('label', null, 'الانصراف'), tOut),
        h('button', { class: 'small primary', onclick: () => { if (!tIn.value) return tIn.focus(); if (!tOut.value) return tOut.focus(); setManual(e.id, r.date, { in: tIn.value, out: tOut.value, absence: undefined }); } }, 'حفظ'));
      return h('div', { class: 'pend' }, who,
        h('div', { class: 'pend-btns' },
          h('button', { class: 'small danger', onclick: () => setManual(e.id, r.date, { absence: 'absent' }) }, 'غياب'),
          h('button', { class: 'small', onclick: () => setManual(e.id, r.date, { absence: 'excused' }) }, 'غياب بإذن'),
          h('button', { class: 'small', onclick: () => { times.hidden = !times.hidden; if (!times.hidden) tIn.focus(); } }, 'سجّل حضور وانصراف')),
        times);
    }));

    // النتيجة
    const empSel = S.view.emp;
    const list = empSel ? res.filter(e => e.id === empSel) : res;
    const out = $('report-out');
    if (!list.length) { out.replaceChildren(h('div', { class: 'card empty' }, 'مفيش موظفين شغالين في الشهر ده.')); return; }
    if (S.view.type === 'summary') out.replaceChildren(h('div', { class: 'card' }, h('h2', null, `تقرير شامل — ${monthLabel(currentMonth())}${rng.to < rng.monthEnd ? ' (لحد ' + fmtDate(rng.to) + ')' : ''}`), ...list.map(summaryCard)));
    else out.replaceChildren(h('div', { class: 'card' }, h('h2', null, `تقرير مفصّل — ${monthLabel(currentMonth())}${rng.to < rng.monthEnd ? ' (لحد ' + fmtDate(rng.to) + ')' : ''}`),
      h('p', { class: 'muted', style: 'margin-top:0' }, 'اضغط على أي يوم عشان تعدّل الوقت أو تسجّل إذن.'), ...list.map(detailTable)));
  }

  function stat(label, val, cls) { return h('div', { class: 'stat ' + (cls || '') }, h('b', null, val), h('span', null, label)); }
  function summaryCard(e) {
    const s = e.summary;
    return h('div', { class: 'emp-card' },
      h('h3', null, e.name, h('small', null, `كود ${e.id}${e.offDay ? ' · إجازته ' + e.offDay : ''}`)),
      h('div', { class: 'stats' },
        stat('ساعات العمل', D(s.worked), 'good'),
        stat('أيام الحضور', s.present + s.offwork),
        stat('أيام الغياب', s.absent, s.absent ? 'bad' : ''),
        stat('غياب بإذن', s.excused),
        stat('التأخير', D(s.late), s.late ? 'bad' : ''),
        stat('انصراف بدري', D(s.early), s.early ? 'bad' : ''),
        stat('الزيادة', D(s.overtime), s.overtime ? 'good' : ''),
        stat('تأخير بإذن', D(s.lateExcused)),
        stat('انصراف بإذن', D(s.earlyExcused)),
        stat('إجازات', s.off),
        s.offwork ? stat('شغل يوم إجازة', s.offwork) : null,
        s.missing ? stat('بصمات ناقصة', s.missing, 'warn') : null,
        s.pending ? stat('مستني تسجيلك', s.pending, 'warn') : null));
  }

  const DETAIL_COLS = ['التاريخ', 'اليوم', 'الشيفت', 'الحضور', 'الانصراف', 'ساعات العمل', 'التأخير', 'تأخير بإذن', 'انصراف بدري', 'انصراف بإذن', 'الزيادة', 'الحالة'];
  function detailTable(e) {
    const s = e.summary;
    const body = e.rows.map(r => h('tr', { class: 'click', onclick: () => openDay(e, r) },
      h('td', null, shortDate(r.date)), h('td', null, r.dayName), h('td', null, r.shift),
      h('td', null, C(r.in)), h('td', null, C(r.out)), h('td', null, D(r.worked)),
      h('td', null, r.late ? D(r.late) : ''), h('td', null, r.lateExcused ? D(r.lateExcused) : ''),
      h('td', null, r.early ? D(r.early) : ''), h('td', null, r.earlyExcused ? D(r.earlyExcused) : ''),
      h('td', null, r.overtime ? D(r.overtime) : ''),
      h('td', null, h('span', { class: 'tag t-' + r.code }, r.status))));
    const total = h('tr', { class: 'total' }, h('td', { colspan: 5 }, 'الإجمالي'), h('td', null, D(s.worked)), h('td', null, D(s.late)), h('td', null, D(s.lateExcused)),
      h('td', null, D(s.early)), h('td', null, D(s.earlyExcused)), h('td', null, D(s.overtime)), h('td', null, `حضور ${s.present + s.offwork} · غياب ${s.absent} · بإذن ${s.excused}`));
    return h('div', null, h('div', { class: 'emp-title' }, `${e.name} — كود ${e.id}`),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, DETAIL_COLS.map(c => h('th', null, c)))), h('tbody', null, body, total))));
  }

  $('bulk-absent').addEventListener('click', () => {
    const btn = $('bulk-absent');
    if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'متأكد؟ اضغط تاني'; setTimeout(() => { delete btn.dataset.confirm; renderReport(); }, 4000); return; }
    delete btn.dataset.confirm;
    for (const e of computeNow() || []) for (const r of e.rows) if (r.code === 'pending') { const k = e.id + '|' + r.date; S.manual[k] = Object.assign(S.manual[k] || {}, { absence: 'absent' }); }
    save(); renderAll();
  });
  $('type-seg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; S.view.type = b.dataset.v; save(); renderReport(); });
  $('emp-sel').addEventListener('change', ev => { S.view.emp = ev.target.value; save(); renderReport(); });
  const shiftMonth = d => { const [y, m] = currentMonth().split('-').map(Number); const t = new Date(y, m - 1 + d, 1); $('month').value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; renderReport(); };
  $('month-prev').addEventListener('click', () => shiftMonth(-1));
  $('month-next').addEventListener('click', () => shiftMonth(1));
  $('month-today').addEventListener('click', () => { $('month').value = thisMonth(); renderReport(); });
  $('month').addEventListener('change', renderReport);

  /* ---------- نافذة تعديل اليوم ---------- */
  let dlgCtx = null;
  function openDay(e, r) {
    dlgCtx = { id: e.id, date: r.date };
    const k = e.id + '|' + r.date, m = S.manual[k] || {}, p = S.perms[k] || {};
    $('d-title').textContent = `${e.name} — ${r.dayName} ${fmtDate(r.date)}`;
    $('d-sub').textContent = r.punches ? `بصمات الجهاز: ${r.punches} — ${r.status}` : `مفيش بصمات من الجهاز — ${r.status}`;
    $('d-in').value = m.in || ''; $('d-out').value = m.out || '';
    $('d-in').placeholder = C(r.in); $('d-out').placeholder = C(r.out);
    const sel = $('d-shift');
    sel.replaceChildren(h('option', { value: '' }, 'تلقائي' + (r.shift && !m.shift ? ` (${r.shift})` : '')), ...S.settings.shifts.map(s => h('option', { value: s.id }, `${s.name} ${s.start}–${s.end}`)));
    sel.value = m.shift || '';
    $('d-plate').checked = !!p.late; $('d-pearly').checked = !!p.early;
    $('d-abs').value = m.absence || '';
    $('d-abs-wrap').hidden = !!r.punches;
    $('day-dlg').showModal();
  }
  $('d-cancel').addEventListener('click', () => $('day-dlg').close());
  $('d-save').addEventListener('click', () => {
    const k = dlgCtx.id + '|' + dlgCtx.date;
    const m = { in: $('d-in').value || undefined, out: $('d-out').value || undefined, shift: $('d-shift').value || undefined, absence: (!$('d-abs-wrap').hidden && $('d-abs').value) || undefined };
    if (m.in || m.out) m.absence = undefined;
    if (m.in || m.out || m.shift || m.absence) S.manual[k] = JSON.parse(JSON.stringify(m)); else delete S.manual[k];
    setPerm(dlgCtx.id, dlgCtx.date, $('d-plate').checked, $('d-pearly').checked);
    save(); $('day-dlg').close(); renderAll();
  });
  function setPerm(id, date, late, early) {
    const k = id + '|' + date;
    if (late || early) S.perms[k] = { late: !!late, early: !!early }; else delete S.perms[k];
  }

  /* ---------- تصدير Excel ---------- */
  const dur = min => ({ t: 'n', v: (min || 0) / 1440, z: '[h]:mm' });
  const txt = v => ({ t: 's', v: v == null ? '' : String(v) });
  const num = v => ({ t: 'n', v: v || 0 });
  $('export').addEventListener('click', () => {
    const res = computeNow(); if (!res || !res.length) return;
    const r = currentRange();
    const list = S.view.emp ? res.filter(e => e.id === S.view.emp) : res;
    const isSum = S.view.type === 'summary';
    if (!list.length) return;
    const title = `${isSum ? 'تقرير شامل' : 'تقرير مفصّل'}${S.view.emp ? ' — ' + list[0].name : ' — كل الموظفين'} — شهر ${monthLabel(currentMonth())} (من ${fmtDate(r.from)} إلى ${fmtDate(r.to)})`;
    const aoa = [[txt(title)], []];
    let widths;
    if (isSum) {
      const head = ['الكود', 'الاسم', 'يوم الإجازة', 'أيام الحضور', 'أيام الغياب', 'غياب بإذن', 'إجازات', 'شغل يوم إجازة', 'بصمات ناقصة', 'مستني تسجيل', 'ساعات العمل', 'التأخير', 'أيام التأخير', 'تأخير بإذن', 'انصراف بدري', 'أيام الانصراف بدري', 'انصراف بدري بإذن', 'الزيادة'];
      aoa.push(head.map(txt));
      for (const e of list) {
        const s = e.summary;
        aoa.push([txt(e.id), txt(e.name), txt(e.offDay), num(s.present + s.offwork), num(s.absent), num(s.excused), num(s.off), num(s.offwork), num(s.missing), num(s.pending), dur(s.worked), dur(s.late), num(s.lateDays), dur(s.lateExcused), dur(s.early), num(s.earlyDays), dur(s.earlyExcused), dur(s.overtime)]);
      }
      widths = [8, 24, 11, 11, 11, 10, 9, 13, 12, 12, 12, 10, 11, 11, 12, 16, 16, 10];
    } else {
      const head = ['الكود', 'الاسم', ...DETAIL_COLS];
      aoa.push(head.map(txt));
      for (const e of list) {
        for (const x of e.rows) aoa.push([txt(e.id), txt(e.name), txt(fmtDate(x.date)), txt(x.dayName), txt(x.shift), txt(C(x.in)), txt(C(x.out)),
          x.worked == null ? txt('') : dur(x.worked), x.late ? dur(x.late) : txt(''), x.lateExcused ? dur(x.lateExcused) : txt(''),
          x.early ? dur(x.early) : txt(''), x.earlyExcused ? dur(x.earlyExcused) : txt(''), x.overtime ? dur(x.overtime) : txt(''), txt(x.status)]);
        const s = e.summary;
        aoa.push([txt(''), txt(`إجمالي ${e.name}`), txt(''), txt(''), txt(''), txt(''), txt(''), dur(s.worked), dur(s.late), dur(s.lateExcused), dur(s.early), dur(s.earlyExcused), dur(s.overtime),
          txt(`حضور ${s.present + s.offwork} · غياب ${s.absent} · غياب بإذن ${s.excused} · إجازات ${s.off}${s.missing ? ' · ناقص ' + s.missing : ''}${s.pending ? ' · مستني تسجيل ' + s.pending : ''}`)]);
        aoa.push([]);
      }
      widths = [8, 22, 12, 10, 9, 9, 9, 11, 9, 11, 11, 13, 9, 30];
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: widths.length - 1 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isSum ? 'شامل' : 'مفصل');
    wb.Workbook = { Views: [{ RTL: true }] };
    const fname = `attendance_${currentMonth()}_${isSum ? 'summary' : 'detailed'}${S.view.emp ? '_emp' + S.view.emp : '_all'}.xlsx`;
    saveFile(fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }))
      .catch(e => flash($('import-msg'), 'err', 'مقدرتش أحفظ الملف: ' + (e.message || e)));
  });

  /* ---------- الأذونات ---------- */
  function renderPerms() {
    const sel = $('p-emp'), cur = sel.value;
    sel.replaceChildren(...sortedIds().map(id => h('option', { value: id }, `${empName(id)} (${id})`)));
    if (cur) sel.value = cur;
    if (!$('p-date').value) $('p-date').value = todayKey();
    const items = Object.entries(S.perms).map(([k, v]) => { const [id, date] = k.split('|'); return { id, date, ...v }; })
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    $('p-list').replaceChildren(...(items.length ? items.map(p => h('div', { class: 'list-item' },
      h('div', null, h('b', null, empName(p.id)), h('div', { class: 'muted' }, `${E.DAY_NAMES[E.weekday(p.date)]} ${fmtDate(p.date)} — ${[p.late && 'تأخير بإذن', p.early && 'انصراف بدري بإذن'].filter(Boolean).join(' + ')}`)),
      h('button', { class: 'small danger', onclick: () => { delete S.perms[p.id + '|' + p.date]; save(); renderAll(); } }, 'حذف'))) : [h('div', { class: 'empty' }, 'مفيش أذونات لسه.')]));
  }
  $('p-add').addEventListener('click', () => {
    const id = $('p-emp').value, date = $('p-date').value, late = $('p-late').checked, early = $('p-early').checked;
    if (!id) return flash($('p-msg'), 'err', 'مفيش موظفين — ارفع ملف الجهاز أو ضيف موظف الأول.');
    if (!date) return flash($('p-msg'), 'err', 'اختار اليوم.');
    if (!late && !early) return flash($('p-msg'), 'err', 'اختار نوع الإذن.');
    const k = id + '|' + date, old = S.perms[k] || {};
    setPerm(id, date, late || old.late, early || old.early); save();
    flash($('p-msg'), 'ok', `اتسجّل الإذن لـ ${empName(id)} يوم ${fmtDate(date)}`);
    renderPerms();
  });

  /* ---------- الموظفين ---------- */
  function renderEmps() {
    const ids = sortedIds(), today = todayKey();
    const offSelect = (val, onchange) => { const el = h('select', { 'aria-label': 'يوم الإجازة', onchange }, h('option', { value: '' }, '— مش متحدد —'), ...E.DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))); el.value = val == null ? '' : String(val); return el; };
    $('emp-list').replaceChildren(...(ids.length ? ids.map(id => {
      const e = S.employees[id], left = e.end && e.end < today;
      const field = (label, el) => h('div', null, h('label', null, label), el);
      const del = h('button', { class: 'small danger', onclick: () => {
        if (!del.dataset.confirm) { del.dataset.confirm = '1'; del.textContent = 'متأكد؟ هيتمسح من كل الشهور'; setTimeout(() => { delete del.dataset.confirm; del.textContent = 'حذف نهائي'; }, 4000); return; }
        delete S.employees[id]; S.removed[id] = true;
        for (const k in S.manual) if (k.startsWith(id + '|')) delete S.manual[k];
        for (const k in S.perms) if (k.startsWith(id + '|')) delete S.perms[k];
        S.punches = S.punches.filter(p => p.id !== id);
        if (S.view.emp === id) S.view.emp = '';
        save(); renderAll();
      } }, 'حذف نهائي');
      return h('div', { class: 'emp-card', style: left ? 'opacity:.6' : '' },
        h('h3', null, h('span', null, `كود ${id}`, left ? h('small', null, ' · ساب الشغل') : null), del),
        h('div', { class: 'row' },
          field('الاسم', h('input', { dir: 'auto', value: e.name || '', placeholder: empName(id), onchange: ev => { e.name = ev.target.value.trim(); save(); } })),
          field('يوم الإجازة الأسبوعية', offSelect(e.off, ev => { e.off = ev.target.value; save(); }))),
        h('div', { class: 'row', style: 'margin-top:8px' },
          field('بدأ الشغل يوم', h('input', { type: 'date', value: e.start || '', onchange: ev => { e.start = ev.target.value; save(); } })),
          field('ساب الشغل يوم (لو مشي)', h('input', { type: 'date', value: e.end || '', onchange: ev => { e.end = ev.target.value; save(); renderEmps(); } }))));
    }) : [h('div', { class: 'empty' }, 'لسه مفيش موظفين. ارفع ملف الجهاز أو ضيفهم من تحت.')]));
    if (!$('e-start').value) $('e-start').value = today;
    if (!$('e-off').options.length) { $('e-off').replaceChildren(h('option', { value: '' }, '— مش متحدد —'), ...E.DAY_NAMES.map((n, i) => h('option', { value: String(i) }, n))); }
  }
  $('e-add').addEventListener('click', () => {
    const id = $('e-id').value.trim(), msg = $('e-msg');
    if (!id) { $('e-id').focus(); return; }
    if (S.employees[id]) return flash(msg, 'err', `الكود ${id} متسجّل قبل كده باسم ${empName(id)}.`);
    delete S.removed[id];
    S.employees[id] = { name: $('e-name').value.trim(), off: $('e-off').value, start: $('e-start').value || todayKey() };
    flash(msg, 'ok', `اتضاف ${empName(id)}. لازم يتسجّل على جهاز البصمة بنفس الكود ${id}.`);
    $('e-id').value = ''; $('e-name').value = ''; $('e-off').value = ''; save(); renderAll();
  });

  /* ---------- الإعدادات ---------- */
  function renderSettings() {
    const st = S.settings;
    $('s-grace').value = st.grace; $('s-dedupe').value = st.dedupeMinutes; $('s-cut').value = st.dayCutHour;
    $('shift-list').replaceChildren(...st.shifts.map((s, i) => h('div', { class: 'shift-row' },
      h('div', null, h('label', null, 'الاسم'), h('input', { value: s.name, onchange: ev => { s.name = ev.target.value; save(); } })),
      h('div', null, h('label', null, 'البداية'), h('input', { type: 'time', value: s.start, onchange: ev => { s.start = ev.target.value; save(); } })),
      h('div', null, h('label', null, 'النهاية'), h('input', { type: 'time', value: s.end, onchange: ev => { s.end = ev.target.value; save(); } })),
      h('button', { class: 'small danger', disabled: st.shifts.length <= 1, onclick: () => { st.shifts.splice(i, 1); save(); renderSettings(); } }, 'حذف'))));
  }
  $('shift-add').addEventListener('click', () => {
    const ids = new Set(S.settings.shifts.map(s => s.id)); let n = 1; while (ids.has('s' + n)) n++;
    S.settings.shifts.push({ id: 's' + n, name: 'شيفت ' + (S.settings.shifts.length + 1), start: '08:00', end: '16:00' }); save(); renderSettings();
  });
  const numSetting = (id, key) => $(id).addEventListener('change', ev => { const v = parseInt(ev.target.value, 10); if (!isNaN(v) && v >= 0) { S.settings[key] = v; save(); } });
  numSetting('s-grace', 'grace'); numSetting('s-dedupe', 'dedupeMinutes'); numSetting('s-cut', 'dayCutHour');

  $('backup').addEventListener('click', () => {
    saveFile(`attendance_backup_${todayKey()}.json`, 'application/json', null, JSON.stringify(S)).catch(e => alertBox('err', 'مقدرتش أعمل النسخة: ' + (e.message || e)));
  });
  $('restore').addEventListener('change', async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || typeof obj !== 'object' || !obj.settings) throw new Error();
      S = Object.assign(blank(), obj); migrate(); save(); $('month').value = thisMonth(); renderAll(); alertBox('ok', 'اترجعت النسخة الاحتياطية.');
    } catch (e) { alertBox('err', 'الملف ده مش نسخة احتياطية سليمة.'); }
    ev.target.value = '';
  });
  $('reset').addEventListener('click', () => {
    const btn = $('reset');
    if (btn.dataset.confirm) { S = blank(); save(); $('month').value = thisMonth(); delete btn.dataset.confirm; btn.textContent = 'مسح كل البيانات'; renderAll(); return; }
    btn.dataset.confirm = '1'; btn.textContent = 'متأكد؟ اضغط تاني للمسح';
    setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'مسح كل البيانات'; }, 4000);
  });
  function alertBox(kind, msg) { const c = document.querySelector('#tab-settings .card:last-child'); const old = c.querySelector('.alert'); if (old) old.remove(); c.append(h('div', { class: 'alert ' + kind, style: 'margin-top:10px' }, msg)); }

  function renderAll() { renderReport(); renderPerms(); renderEmps(); renderSettings(); }
  migrate(); save();
  // في تطبيق الأندرويد: نشيل فلتر نوع الملف عشان ملفات .dat من الجهاز تبان في اختيار الملفات
  if (isNative()) { $('file').removeAttribute('accept'); $('restore').removeAttribute('accept'); }
  renderAll();

  if (!isNative() && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
