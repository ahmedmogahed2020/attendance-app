/* محرك حساب الحضور والانصراف — يعمل في المتصفح وفي Node للاختبار */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  const DEFAULT_SETTINGS = {
    grace: 15,           // دقائق السماح في التأخير
    dayCutHour: 5,       // البصمة قبل الساعة 5 الفجر تتبع اليوم السابق
    deviceFrom: '2026-11-06', // بصمات الجهاز قبل اليوم ده (فترة التجربة) بتتجاهل
    style: 'vivid',      // شكل التطبيق: vivid / default / dark / minimal
    hoursGrace: 10,      // سماح نقص الساعات لموظفين "ساعات بس"
    dedupeMinutes: 10,   // بصمتين ورا بعض في أقل من 10 دقايق = بصمة واحدة
    ambiguousMinutes: 120,
    shifts: [
      { id: 'm', name: 'صباحي', start: '10:00', end: '18:00' },
      { id: 'e', name: 'مسائي', start: '15:00', end: '23:00' },
      { id: 'r', name: 'رمضان (مقسوم)', start: '10:00', end: '14:00', start2: '20:00', end2: '00:00', ruleOnly: true }
    ],
    holidays: [],
    // أيام بمواعيد خاصة: يوم في الأسبوع / تاريخ / فترة ← شيفت
    rules: [
      { id: 'fri', name: 'الجمعة', kind: 'weekday', weekday: 5, shift: 'e', on: true },
      { id: 'ram', name: 'رمضان', kind: 'range', from: '', to: '', shift: 'r', on: false }
    ]
  };

  /* ---------- أدوات الوقت والتاريخ ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  function dayNum(key) { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
  function keyFromNum(n) { const dt = new Date(n * 86400000); return dateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function weekday(key) { return new Date(dayNum(key) * 86400000).getUTCDay(); }
  function hm(str) { // "10:30" -> 630
    if (str == null || str === '') return null;
    const m = String(str).match(/(\d{1,2}):(\d{2})/); if (!m) return null;
    return +m[1] * 60 + +m[2];
  }
  function fmtClock(min) { if (min == null) return ''; let x = ((min % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; }
  function fmtDur(min) { if (min == null) return ''; const s = min < 0 ? '-' : ''; min = Math.abs(Math.round(min)); return `${s}${Math.floor(min / 60)}:${pad(min % 60)}`; }

  /* ---------- قراءة القيم ---------- */
  const norm = h => String(h == null ? '' : h).toLowerCase().replace(/[\s._\-\/\\()]/g, '');

  function parseTimeStr(s) {
    const m = String(s).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|ص|م|ã|Õ|Ù…|Øµ|مساء|صباح)?/i);
    if (!m) return null;
    let h = +m[1]; const mi = +m[2]; const ap = (m[4] || '').toLowerCase().replace(/\./g, '');
    // الجهاز بيكتب م/ص بترميز عربي قديم (Windows-1256) فبتتقري ã و Õ
    if (['pm', 'م', 'ã', 'ù…', 'مساء'].includes(ap)) { if (h < 12) h += 12; }
    else if (['am', 'ص', 'õ', 'øµ', 'صباح'].includes(ap)) { if (h === 12) h = 0; }
    if (h > 47 || mi > 59) return null;
    return h * 60 + mi;
  }

  function parseDateStr(s, order) {
    s = String(s);
    let m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return { key: dateKey(+m[1], +m[2], +m[3]), rest: s.replace(m[0], ' ') };
    m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
      const [d, mo] = order === 'MDY' ? [b, a] : [a, b];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return { key: dateKey(y, mo, d), rest: s.replace(m[0], ' ') };
    }
    return null;
  }

  function serialToParts(v) { // رقم تاريخ إكسل
    const days = Math.floor(v + 1e-9);
    const min = Math.round((v - days) * 1440);
    if (days < 1) return { key: null, min };
    const n = days - 25569; // 1970-01-01
    return { key: keyFromNum(n), min };
  }

  function detectOrder(values) {
    let dmy = false, mdy = false;
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const m = v.match(/(?:^|[^\d])(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
      if (!m) continue;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    }
    return mdy && !dmy ? 'MDY' : 'DMY';
  }

  function cellDate(v, order) { // -> key
    if (v == null || v === '') return null;
    if (typeof v === 'number') return serialToParts(v).key;
    if (v instanceof Date) return dateKey(v.getFullYear(), v.getMonth() + 1, v.getDate());
    const d = parseDateStr(v, order); return d ? d.key : null;
  }
  function cellTime(v) { // -> minutes
    if (v == null || v === '') return null;
    if (typeof v === 'number') return serialToParts(v).min;
    if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
    return parseTimeStr(v);
  }
  function cellDateTime(v, order) { // -> {key, min}
    if (v == null || v === '') return null;
    if (typeof v === 'number') { const p = serialToParts(v); return p.key ? p : null; }
    if (v instanceof Date) return { key: dateKey(v.getFullYear(), v.getMonth() + 1, v.getDate()), min: v.getHours() * 60 + v.getMinutes() };
    const d = parseDateStr(v, order); if (!d) return null;
    const t = parseTimeStr(d.rest); if (t == null) return null;
    return { key: d.key, min: t };
  }

  /* ---------- قراءة الملفات ---------- */
  const COLS = {
    id: ['acno', 'no', 'id', 'userid', 'enrollno', 'enrollnumber', 'empno', 'employeeid', 'empid', 'personid', 'personnelid', 'badgenumber', 'pin', 'رقم', 'الرقم', 'كود', 'الكود', 'رقمالموظف', 'كودالموظف', 'number', 'staffid'],
    name: ['name', 'الاسم', 'اسم', 'username', 'employeename', 'firstname', 'fullname', 'اسمالموظف'],
    date: ['date', 'التاريخ', 'تاريخ', 'day'],
    time: ['time', 'الوقت', 'وقت'],
    datetime: ['datetime', 'checktime', 'punchtime', 'clocktime', 'timestamp', 'attendancetime', 'verifytime', 'recordtime', 'التاريخوالوقت', 'وقتالبصمة', 'time'],
    clockin: ['clockin', 'checkin', 'in', 'حضور', 'الحضور', 'وقتالحضور'],
    clockout: ['clockout', 'checkout', 'out', 'انصراف', 'الانصراف', 'وقتالانصراف'],
    newstate: ['newstate', 'الحالةالجديدة', 'correctedstate'],
    exception: ['exception', 'الاستثناء'],
    state: ['state', 'status', 'checktype', 'inout', 'punchstate', 'attstate', 'attendancestate', 'punchtype', 'checkstate', 'الحالة', 'نوعالبصمة', 'حالةالبصمة', 'نوعالحركة']
  };
  /** نوع البصمة: حضور / انصراف (من زرار الحالة في الجهاز) */
  function stateOf(v) {
    if (v == null || v === '') return null;
    const s = String(v).trim().toLowerCase().replace(/[\s_\-\/.]/g, '');
    if (/break|استراحة/.test(s)) return null;
    if (['0', '4', 'i', 'in', 'cin', 'checkin', 'clockin', 'otin', 'دخول', 'حضور'].includes(s)) return 'in';
    if (['1', '5', 'o', 'out', 'cout', 'checkout', 'clockout', 'otout', 'خروج', 'انصراف'].includes(s)) return 'out';
    if (/out|انصراف|خروج/.test(s)) return 'out';
    if (/in|حضور|دخول/.test(s)) return 'in';
    return null;
  }
  function findCol(headers, names) {
    for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; }
    return -1;
  }

  function parseAttlogText(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const punches = []; let ok = 0;
    for (const l of lines) {
      const m = l.match(/^\s*([^\s,;]+)[\s,;]+(?:"?([^\t,;"]*?)"?[\t,;]+)?(\d{4}-\d{1,2}-\d{1,2}[ T]+\d{1,2}:\d{2}(?::\d{2})?)(.*)$/);
      if (!m) continue; ok++;
      const dt = cellDateTime(m[3].replace('T', ' '), 'DMY');
      // ملف attlog: الكود، الوقت، طريقة التحقق، الحالة (0 حضور / 1 انصراف)...
      const rest = (m[4] || '').split(/[\t,;]+|\s+/).filter(Boolean);
      const type = rest.length >= 2 ? stateOf(rest[1]) : null;
      if (dt) punches.push({ id: m[1], name: '', key: dt.key, min: dt.min, type });
    }
    return ok >= Math.max(1, lines.length * 0.5) ? punches : null;
  }

  /** rows: array of arrays (أول شيت). يرجع {kind, punches, dates, names} */
  function parseRows(rows) {
    let hi = -1, headers = null;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const h = (rows[i] || []).map(norm);
      if (findCol(h, COLS.id) >= 0 && (findCol(h, COLS.datetime) >= 0 || findCol(h, COLS.date) >= 0)) { hi = i; headers = h; break; }
    }
    if (hi < 0) throw new Error('مش لاقي أعمدة رقم الموظف والتاريخ في الملف');
    const body = rows.slice(hi + 1).filter(r => r && r.some(c => c !== '' && c != null));
    const order = detectOrder(body.flat());
    const cId = findCol(headers, COLS.id), cName = findCol(headers, COLS.name);
    const cIn = findCol(headers, COLS.clockin), cOut = findCol(headers, COLS.clockout);
    const cDate = findCol(headers, COLS.date), cState = findCol(headers, COLS.state), cNew = findCol(headers, COLS.newstate), cExc = findCol(headers, COLS.exception);
    const punches = [], dates = new Set(), names = {};
    const id = r => String(r[cId] == null ? '' : r[cId]).trim().replace(/\.0$/, '');

    if (cIn >= 0 && cOut >= 0 && cDate >= 0) { // تقرير الجهاز المحسوب
      for (const r of body) {
        const i = id(r); if (!i) continue;
        const key = cellDate(r[cDate], order); if (!key) continue;
        dates.add(key); if (cName >= 0 && r[cName]) names[i] = String(r[cName]).trim();
        const tIn = cellTime(r[cIn]), tOut = cellTime(r[cOut]);
        if (tIn != null) punches.push({ id: i, key, min: tIn, type: 'in' });
        if (tOut != null) punches.push({ id: i, key, min: (tIn != null && tOut < tIn) ? tOut + 1440 : tOut, type: 'out' });
      }
      return { kind: 'report', punches, dates: [...dates], names };
    }

    // سجل بصمات خام
    let cDT = -1;
    const cTime = findCol(headers, COLS.time);
    if (cDate >= 0 && cTime >= 0 && cTime !== cDate) cDT = -1; else cDT = findCol(headers, COLS.datetime);
    for (const r of body) {
      const i = id(r); if (!i) continue;
      let dt = null;
      if (cDT >= 0) dt = cellDateTime(r[cDT], order);
      if (!dt && cDate >= 0) {
        const key = cellDate(r[cDate], order);
        const t = cTime >= 0 ? cellTime(r[cTime]) : (typeof r[cDate] === 'string' ? parseTimeStr((parseDateStr(r[cDate], order) || {}).rest || '') : (typeof r[cDate] === 'number' ? serialToParts(r[cDate]).min : null));
        if (key && t != null) dt = { key, min: t };
      }
      if (!dt) continue;
      if (cName >= 0 && r[cName]) names[i] = String(r[cName]).trim();
      // New State = نوع البصمة بعد ما اتعدّل في الجهاز، بيغلب على State
      const nt = cNew >= 0 ? stateOf(r[cNew]) : null, ot = cState >= 0 ? stateOf(r[cState]) : null;
      punches.push({ id: i, key: dt.key, min: dt.min, type: nt || ot, changed: !!(nt && nt !== ot), exc: cExc >= 0 ? String(r[cExc] || '').trim() : '' });
    }
    if (!punches.length) throw new Error('الملف اتقري بس مفيهوش بصمات مفهومة');
    return { kind: 'raw', punches, dates: [], names, hasState: cState >= 0 };
  }

  /* ---------- الحساب ---------- */
  /** الشيفت = فترة أو فترتين (مقسوم). st/en بالدقايق من أول اليوم، والنهاية بعد 12 بالليل بتعدّي 1440 */
  function shiftsOf(settings) {
    return (settings.shifts || []).map(s => {
      const per = [];
      const add = (a, b) => { let st = hm(a), en = hm(b); if (st == null || en == null) return; if (per.length && st < per[0].st) st += 1440; while (en <= st) en += 1440; per.push({ st, en }); };
      add(s.start, s.end); if (s.start2 && s.end2) add(s.start2, s.end2);
      if (!per.length) return null;
      return { ...s, periods: per, st: per[0].st, en: per[per.length - 1].en, len: per.reduce((a, p) => a + p.en - p.st, 0), split: per.length > 1 };
    }).filter(Boolean);
  }
  /** الإجازة الرسمية اللي بتنطبق على يوم (لو فيه) */
  function holidayFor(settings, key) {
    return (settings.holidays || []).find(x => x && x.on !== false && x.from && key >= x.from && key <= (x.to || x.from)) || null;
  }
  /** القاعدة اللي بتنطبق على يوم (تاريخ/فترة أولوية عن يوم الأسبوع) */
  function ruleFor(settings, key) {
    const rules = (settings.rules || []).filter(r => r && r.on !== false && r.shift);
    const wd = weekday(key);
    return rules.find(r => r.kind === 'date' && r.from === key) || rules.find(r => r.kind === 'range' && r.from && r.to && r.from <= key && key <= r.to) || rules.find(r => r.kind === 'weekday' && +r.weekday === wd) || null;
  }

  /** يجمع البصمات لكل موظف/يوم بعد تطبيق حد اليوم وإزالة التكرار */
  function groupPunches(punches, settings) {
    const cut = (settings.dayCutHour ?? 5) * 60, dd = settings.dedupeMinutes ?? 10;
    const map = {};
    for (const p of punches) {
      const abs = dayNum(p.key) * 1440 + p.min;
      const dn = Math.floor((abs - cut) / 1440);
      const dk = keyFromNum(dn);
      if (settings.deviceFrom && dk < settings.deviceFrom) continue;
      const k = p.id + '|' + dk;
      (map[k] = map[k] || []).push({ t: abs - dn * 1440, type: p.type || null });
    }
    for (const k in map) {
      const a = map[k].sort((x, y) => x.t - y.t), out = [];
      for (const p of a) { const last = out[out.length - 1]; if (!last || p.t - last.t >= dd || p.type !== last.type) out.push(p); }
      map[k] = out;
    }
    return map;
  }
  /** يحوّل البصمات لفترات وجود [{in,out}] — حضور يفتح فترة وانصراف يقفلها */
  function segmentsOf(P) {
    if (!P.length) return [];
    if (P.some(p => p.type)) {
      const segs = []; let cur = null;
      for (const p of P) {
        if (p.type === 'in') { if (cur && cur.out == null) continue; cur = { in: p.t, out: null }; segs.push(cur); }
        else if (p.type === 'out') { if (cur) { if (cur.in != null && p.t <= cur.in) continue; cur.out = p.t; } else { cur = { in: null, out: p.t }; segs.push(cur); } } // انصراف ورا انصراف = آخر واحد
      }
      return segs;
    }
    if (P.length >= 4 && P.length % 2 === 0) { const segs = []; for (let i = 0; i < P.length; i += 2) segs.push({ in: P[i].t, out: P[i + 1].t }); return segs; }
    return P.length === 1 ? [{ in: P[0].t, out: null, lone: true }] : [{ in: P[0].t, out: P[P.length - 1].t }];
  }
  function tinDev(P) { const s = segmentsOf(P); return s.length ? s[0].in : null; }
  function toutDev(P) { const s = segmentsOf(P); return s.length ? s[s.length - 1].out : null; }

  /** ساعات الموظف بالدقايق (0 = حسب الشيفت) */
  function hoursOf(emp) { const h = parseFloat(emp && emp.hours); return h > 0 && h < 24 ? Math.round(h * 60) : 0; }
  const isHoursMode = emp => emp && emp.mode === 'hours';

  function nearestShift(t, shifts, field) {
    let best = null, bd = Infinity, second = Infinity;
    for (const s of shifts) {
      const d = Math.abs(t - s[field]);
      if (d < bd) { second = bd; bd = d; best = s; } else if (d < second) second = d;
    }
    return { shift: best, gap: second - bd };
  }

  /**
   * state: {settings, employees:{id:{name, off, mode, hours, shift}}, perms:{'id|date':{late,early,short}}, manual:{'id|date':{in,out,shift,absence}}}
   */
  const GC = { key: null, val: null };
  function compute(state, data, range) {
    const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    const shifts = shiftsOf(settings);
    const autoShifts = shifts.filter(s => !s.ruleOnly);
    const byId = Object.fromEntries(shifts.map(s => [s.id, s]));
    const grace = +settings.grace || 0, hGrace = settings.hoursGrace == null ? 10 : +settings.hoursGrace;
    // تجميع البصمات بيتحفظ طول ما البصمات والإعدادات مش متغيرين (data.ver)
    const gk = data && data.ver != null ? `${data.ver}|${settings.dayCutHour}|${settings.dedupeMinutes}|${settings.deviceFrom}` : null;
    let groups;
    if (gk && GC.key === gk) groups = GC.val; else { groups = groupPunches(data ? data.punches : [], settings); if (gk) { GC.key = gk; GC.val = groups; } }
    const manual = state.manual || {}, perms = state.perms || {};

    const ids = new Set(Object.keys(state.employees || {}));
    if (!state.onlyListed) for (const k in groups) ids.add(k.split('|')[0]);
    const from = dayNum(range.from), to = dayNum(range.to);

    const result = [];
    for (const id of [...ids].sort((a, b) => (+a - +b) || a.localeCompare(b))) {
      const emp = (state.employees || {})[id] || {};
      if (emp.hidden) continue;
      const hoursMode = isHoursMode(emp);
      const off = emp.off === '' || emp.off == null ? null : +emp.off;
      const days = [];
      // المرحلة 1: فترات الوجود والشيفت
      for (let n = from; n <= to; n++) {
        const key = keyFromNum(n), k = id + '|' + key;
        if ((emp.start && key < emp.start) || (emp.end && key > emp.end)) continue;
        const man = manual[k] || {};
        const devP = groups[k] || [];
        let segs = man.absence ? [] : segmentsOf(devP).map(s => ({ ...s }));
        if (segs.length === 1 && segs[0].lone && autoShifts.length) {
          // بصمة واحدة من غير نوع: أقرب لميعاد حضور ولا انصراف؟
          let bi = Infinity, bo = Infinity; const t = segs[0].in;
          for (const s of autoShifts) { bi = Math.min(bi, Math.abs(t - s.st)); bo = Math.min(bo, Math.abs(t - s.en)); }
          if (bo < bi) segs = [{ in: null, out: t }];
        }
        const mIn = hm(man.in), mOut = hm(man.out);
        if (mIn != null) { if (segs.length) segs[0].in = mIn; else segs = [{ in: mIn, out: null }]; }
        if (mOut != null) { if (!segs.length) segs = [{ in: null, out: null }]; const L = segs[segs.length - 1]; L.out = mOut; if (L.in != null && L.out < L.in) L.out += 1440; }
        const tin = segs.length ? segs[0].in : null, tout = segs.length ? segs[segs.length - 1].out : null;
        // الشيفت: يدوي ← قاعدة اليوم ← ثابت للموظف ← تخمين
        const rule = hoursMode ? null : ruleFor(settings, key);
        const fixed = emp.shift && byId[emp.shift] ? byId[emp.shift] : null;
        let shift = null, ambiguous = false, locked = false;
        if (!hoursMode) {
          if (man.shift && byId[man.shift]) { shift = byId[man.shift]; locked = true; }
          else if (rule && byId[rule.shift]) { shift = byId[rule.shift]; locked = true; }
          else if (fixed) { shift = fixed; locked = true; }
          else if (autoShifts.length) {
            if (tin != null) { const r = nearestShift(tin, autoShifts, 'st'); shift = r.shift; ambiguous = r.gap < settings.ambiguousMinutes; }
            else if (tout != null) { const r = nearestShift(tout, autoShifts, 'en'); shift = r.shift; ambiguous = r.gap < settings.ambiguousMinutes; }
          }
        }
        days.push({ key, k, P: devP, segs, devIn: tinDev(devP), devOut: toutDev(devP), tin, tout, shift, ambiguous, rule, absence: man.absence || '', locked, manual: mIn != null || mOut != null || !!man.absence });
      }
      // المرحلة 2: الحالات المحيّرة تاخد الشيفت الغالب للموظف
      const cnt = {};
      for (const d of days) if (d.shift && !d.ambiguous && !d.locked) cnt[d.shift.id] = (cnt[d.shift.id] || 0) + 1;
      const major = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      for (const d of days) if (d.ambiguous && !d.locked && major && byId[major]) d.shift = byId[major];

      // المرحلة 3: الحساب
      for (const d of days) {
        const wd = weekday(d.key), hol = holidayFor(settings, d.key), isOff = off === wd || !!hol;
        const perm = perms[d.k] || {};
        const complete = d.segs.filter(s => s.in != null && s.out != null);
        const broken = d.segs.find(s => s.in == null || s.out == null);
        const row = {
          id, date: d.key, weekday: wd, dayName: DAY_NAMES[wd], mode: hoursMode ? 'hours' : 'shift',
          shift: hoursMode ? 'ساعات' : d.shift ? d.shift.name : '', shiftId: d.shift ? d.shift.id : '', rule: d.rule ? (d.rule.name || '') : '',
          periods: d.shift && !hoursMode ? d.shift.periods : null,
          in: d.tin, out: d.tout, segs: d.segs, devIn: d.devIn, devOut: d.devOut, punches: d.P.length, manual: d.manual,
          worked: null, late: null, lateExcused: 0, early: null, earlyExcused: 0, overtime: null, short: 0, shortExcused: 0,
          status: '', code: '', permLate: !!perm.late, permEarly: !!perm.early, permShort: !!perm.short
        };
        if (!d.segs.length) {
          row.shift = hoursMode ? 'ساعات' : ''; row.shiftId = '';
          if (d.absence === 'leave') { row.code = 'leave'; row.status = 'إجازة'; }
          else if (hol && !d.absence) { row.code = 'holiday'; row.status = 'إجازة رسمية' + (hol.name ? ': ' + hol.name : ''); }
          else if (isOff && !d.absence) { row.code = 'off'; row.status = 'إجازة أسبوعية'; }
          else if (d.absence === 'excused') { row.code = 'excused'; row.status = 'غياب بإذن'; }
          else if (d.absence === 'absent') { row.code = 'absent'; row.status = 'غياب'; }
          else { row.code = 'pending'; row.status = 'مستني تسجيلك'; }
        } else if (broken) {
          row.code = 'missing';
          row.missingField = broken.in == null ? 'in' : 'out';
          row.status = row.missingField === 'in' ? 'بصمة حضور ناقصة' : 'بصمة انصراف ناقصة';
        } else {
          row.worked = complete.reduce((a, s) => a + s.out - s.in, 0);
          row.late = 0; row.early = 0; row.overtime = 0;
          if (isOff) { row.code = 'offwork'; row.status = hol ? 'شغل يوم إجازة رسمية' : 'شغل يوم إجازة'; row.overtime = row.worked; }
          else if (hoursMode) {
            row.code = 'present'; row.status = 'حاضر';
            const req = hoursOf(emp) || 480; row.required = req;
            const diff = req - row.worked;
            row.short = diff > hGrace ? diff : 0;
            row.overtime = Math.max(0, row.worked - req);
            if (perm.short && row.short) { row.shortExcused = row.short; row.short = 0; }
          } else {
            row.code = 'present'; row.status = 'حاضر';
            const s = d.shift;
            if (s) {
              let per = s.periods.map(p => ({ ...p }));
              // ساعات الموظف بتغيّر نهاية الشيفت العادي (مش المقسوم)
              if (per.length === 1 && hoursOf(emp)) per[0].en = per[0].st + hoursOf(emp);
              row.periods = per;
              row.required = per.reduce((a, p) => a + p.en - p.st, 0);
              let late = 0, early = 0, ot = 0, missed = 0;
              if (per.length === 1) {
                const raw = d.tin - per[0].st; late = raw > grace ? raw - grace : 0;
                early = Math.max(0, per[0].en - d.tout); ot = Math.max(0, d.tout - per[0].en);
              } else {
                // الشيفت المقسوم: كل فترة بتتقارن بفترة الوجود اللي بتغطيها أكتر
                const used = new Set();
                for (const p of per) {
                  let best = -1, bo = 0;
                  complete.forEach((sg, i) => { const o = Math.min(sg.out, p.en) - Math.max(sg.in, p.st); if (!used.has(i) && o > bo) { bo = o; best = i; } });
                  if (best < 0) { early += p.en - p.st; missed++; continue; }
                  used.add(best); const sg = complete[best];
                  const raw = sg.in - p.st; late += raw > grace ? raw - grace : 0;
                  early += Math.max(0, p.en - sg.out); ot += Math.max(0, sg.out - p.en);
                }
                row.missedPeriods = missed;
              }
              if (perm.late && late > 0) { row.lateExcused = late; late = 0; }
              if (perm.early && early > 0) { row.earlyExcused = early; early = 0; }
              row.late = late; row.early = early; row.overtime = ot;
            }
          }
          if (row.manual && row.code === 'present') row.status = 'حاضر (يدوي)';
        }
        if (row.manual && row.code === 'offwork') row.status += ' (يدوي)';
        d.row = row;
      }
      const rows = days.map(d => d.row);
      if (!rows.length) continue;
      const sum = f => rows.reduce((a, r) => a + (r[f] || 0), 0);
      const count = c => rows.filter(r => r.code === c).length;
      result.push({
        id, name: emp.name || (data && data.names && data.names[id]) || ('موظف ' + id),
        offDay: off == null ? '' : DAY_NAMES[off], mode: hoursMode ? 'hours' : 'shift',
        rows,
        summary: {
          present: count('present'), absent: count('absent'), excused: count('excused'), leave: count('leave'), pending: count('pending'), off: count('off'), holiday: count('holiday'), offwork: count('offwork'), missing: count('missing'),
          worked: sum('worked'), required: sum('required'), late: sum('late'), lateDays: rows.filter(r => r.late > 0).length,
          lateExcused: sum('lateExcused'), early: sum('early'), earlyDays: rows.filter(r => r.early > 0).length,
          earlyExcused: sum('earlyExcused'), overtime: sum('overtime'), short: sum('short'), shortDays: rows.filter(r => r.short > 0).length, shortExcused: sum('shortExcused')
        }
      });
    }
    return result;
  }

  function dataRange(data) {
    const ks = [...(data.dates || []), ...data.punches.map(p => p.key)].sort();
    if (!ks.length) return null;
    return { from: ks[0], to: ks[ks.length - 1] };
  }

  return { holidayFor, stateOf, hoursOf, shiftsOf, ruleFor, segmentsOf, DEFAULT_SETTINGS, DAY_NAMES, parseRows, parseAttlogText, compute, dataRange, fmtClock, fmtDur, hm, weekday, dayNum, keyFromNum };
});
