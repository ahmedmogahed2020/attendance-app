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
    deviceFrom: '2026-11-06',
    style: 'vivid',      // شكل التطبيق: vivid / default / dark / minimal // بصمات الجهاز قبل اليوم ده (فترة التجربة) بتتجاهل
    dedupeMinutes: 10,   // بصمتين ورا بعض في أقل من 10 دقايق = بصمة واحدة
    ambiguousMinutes: 120,
    shifts: [
      { id: 'm', name: 'صباحي', start: '10:00', end: '18:00' },
      { id: 'e', name: 'مسائي', start: '15:00', end: '23:00' }
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
  function shiftsOf(settings) {
    return (settings.shifts || []).map(s => {
      const st = hm(s.start), en0 = hm(s.end);
      const en = en0 <= st ? en0 + 1440 : en0;
      return { ...s, st, en, len: en - st };
    }).filter(s => s.st != null && s.en != null);
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

  function tinDev(P) { if (!P.length) return null; if (P.some(p => p.type)) { const a = P.filter(p => p.type === 'in'); return a.length ? a[0].t : null; } return P[0].t; }
  function toutDev(P) { if (!P.length) return null; if (P.some(p => p.type)) { const a = P.filter(p => p.type === 'out'); return a.length ? a[a.length - 1].t : null; } return P.length > 1 ? P[P.length - 1].t : null; }

  /** ساعات الموظف بالدقايق (0 = حسب الشيفت) */
  function hoursOf(emp) { const h = parseFloat(emp && emp.hours); return h > 0 && h < 24 ? Math.round(h * 60) : 0; }

  function nearestShift(t, shifts, field) {
    let best = null, bd = Infinity, second = Infinity;
    for (const s of shifts) {
      const d = Math.abs(t - s[field]);
      if (d < bd) { second = bd; bd = d; best = s; } else if (d < second) second = d;
    }
    return { shift: best, gap: second - bd };
  }

  /**
   * state: {settings, employees:{id:{name, off}}, perms:{'id|date':{late,early}}, manual:{'id|date':{in,out,shift}}}
   * data: نتيجة parseRows
   * range: {from, to}
   */
  function compute(state, data, range) {
    const settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    const shifts = shiftsOf(settings);
    const byId = Object.fromEntries(shifts.map(s => [s.id, s]));
    const grace = +settings.grace || 0;
    const groups = groupPunches(data ? data.punches : [], settings);
    const manual = state.manual || {}, perms = state.perms || {};

    const ids = new Set(Object.keys(state.employees || {}));
    if (!state.onlyListed) for (const k in groups) ids.add(k.split('|')[0]);
    const from = dayNum(range.from), to = dayNum(range.to);

    const result = [];
    for (const id of [...ids].sort((a, b) => (+a - +b) || a.localeCompare(b))) {
      const emp = (state.employees || {})[id] || {};
      if (emp.hidden) continue;
      const off = emp.off === '' || emp.off == null ? null : +emp.off;
      const days = [];
      // المرحلة 1: تحديد الحضور/الانصراف والشيفت الواضح
      for (let n = from; n <= to; n++) {
        const key = keyFromNum(n), k = id + '|' + key;
        if ((emp.start && key < emp.start) || (emp.end && key > emp.end)) continue; // قبل ما يبدأ أو بعد ما ساب الشغل
        const man = manual[k] || {};
        let P = groups[k] || [];
        const devP = P;
        let tin = null, tout = null;
        if (man.absence) P = [];
        if (P.some(p => p.type)) {
          // الجهاز بيحدد نوع البصمة: أول بصمة حضور وآخر بصمة انصراف
          const ins = P.filter(p => p.type === 'in').map(p => p.t), outs = P.filter(p => p.type === 'out').map(p => p.t);
          tin = ins.length ? Math.min(...ins) : null; tout = outs.length ? Math.max(...outs) : null;
          if (tin != null && tout != null && tout <= tin) tout = null;
        } else {
          tin = P.length >= 1 ? P[0].t : null; tout = P.length >= 2 ? P[P.length - 1].t : null;
          if (P.length === 1 && shifts.length) {
            // بصمة واحدة من غير نوع: أقرب لميعاد حضور ولا انصراف؟
            let bestIn = Infinity, bestOut = Infinity;
            for (const s of shifts) { bestIn = Math.min(bestIn, Math.abs(P[0].t - s.st)); bestOut = Math.min(bestOut, Math.abs(P[0].t - s.en)); }
            if (bestOut < bestIn) { tout = P[0].t; tin = null; }
          }
        }
        const mIn = hm(man.in), mOut = hm(man.out);
        if (mIn != null) tin = mIn;
        if (mOut != null) { tout = mOut; if (tin != null && tout < tin) tout += 1440; }
        const devIn = tinDev(devP), devOut = toutDev(devP);
        const fixed = emp.shift && byId[emp.shift] ? byId[emp.shift] : null;
        let shift = man.shift && byId[man.shift] ? byId[man.shift] : fixed, ambiguous = false;
        if (!shift && shifts.length) {
          if (tin != null) { const r = nearestShift(tin, shifts, 'st'); shift = r.shift; ambiguous = r.gap < settings.ambiguousMinutes; }
          else if (tout != null) { const r = nearestShift(tout, shifts, 'en'); shift = r.shift; ambiguous = r.gap < settings.ambiguousMinutes; }
        }
        days.push({ key, k, P: devP, devIn, devOut, tin, tout, shift, ambiguous, absence: man.absence || '', manualShift: !!(man.shift && byId[man.shift]) || !!fixed, manual: mIn != null || mOut != null || !!man.absence });
      }
      // المرحلة 2: الحالات المحيّرة تاخد الشيفت الغالب للموظف
      const cnt = {};
      for (const d of days) if (d.shift && !d.ambiguous) cnt[d.shift.id] = (cnt[d.shift.id] || 0) + 1;
      const major = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      for (const d of days) if (d.ambiguous && !d.manualShift && major && byId[major]) d.shift = byId[major];

      // المرحلة 3: الحساب
      for (const d of days) {
        const wd = weekday(d.key), isOff = off === wd;
        const perm = perms[d.k] || {};
        const row = {
          id, date: d.key, weekday: wd, dayName: DAY_NAMES[wd],
          shift: d.shift ? d.shift.name : '', shiftId: d.shift ? d.shift.id : '',
          in: d.tin, out: d.tout, devIn: d.devIn, devOut: d.devOut, punches: d.P.length, manual: d.manual,
          worked: null, late: null, lateExcused: 0, early: null, earlyExcused: 0, overtime: null,
          status: '', code: '', permLate: !!perm.late, permEarly: !!perm.early
        };
        if (d.tin == null && d.tout == null) {
          row.shift = ''; row.shiftId = '';
          if (d.absence === 'leave') { row.code = 'leave'; row.status = 'إجازة'; }
          else if (isOff && !d.absence) { row.code = 'off'; row.status = 'إجازة أسبوعية'; }
          else if (d.absence === 'excused') { row.code = 'excused'; row.status = 'غياب بإذن'; }
          else if (d.absence === 'absent') { row.code = 'absent'; row.status = 'غياب'; }
          else { row.code = 'pending'; row.status = 'مستني تسجيلك'; }
        } else if (d.tin == null || d.tout == null) {
          row.code = 'missing'; row.status = d.tin == null ? 'بصمة حضور ناقصة' : 'بصمة انصراف ناقصة';
          row.missingField = d.tin == null ? 'in' : 'out';
        } else if (isOff) {
          row.code = 'offwork'; row.status = 'شغل يوم إجازة';
          row.worked = d.tout - d.tin; row.late = 0; row.early = 0; row.overtime = row.worked;
        } else {
          row.code = 'present'; row.status = 'حاضر';
          row.worked = d.tout - d.tin;
          const s = d.shift;
          if (s) {
            // نهاية اليوم = بداية الشيفت + ساعات الموظف (لو متحددة) أو نهاية الشيفت
            const en = hoursOf(emp) ? s.st + hoursOf(emp) : s.en;
            row.required = en - s.st;
            const rawLate = d.tin - s.st;
            let late = rawLate > grace ? rawLate - grace : 0;
            let early = Math.max(0, en - d.tout);
            row.overtime = Math.max(0, d.tout - en);
            if (perm.late && late > 0) { row.lateExcused = late; late = 0; }
            if (perm.early && early > 0) { row.earlyExcused = early; early = 0; }
            row.late = late; row.early = early;
          } else { row.late = 0; row.early = 0; row.overtime = 0; }
          if (row.manual) row.status = 'حاضر (يدوي)';
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
        offDay: off == null ? '' : DAY_NAMES[off],
        rows,
        summary: {
          present: count('present'), absent: count('absent'), excused: count('excused'), leave: count('leave'), pending: count('pending'), off: count('off'), offwork: count('offwork'), missing: count('missing'),
          worked: sum('worked'), required: sum('required'), late: sum('late'), lateDays: rows.filter(r => r.late > 0).length,
          lateExcused: sum('lateExcused'), early: sum('early'), earlyDays: rows.filter(r => r.early > 0).length,
          earlyExcused: sum('earlyExcused'), overtime: sum('overtime')
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

  return { stateOf, hoursOf, DEFAULT_SETTINGS, DAY_NAMES, parseRows, parseAttlogText, compute, dataRange, fmtClock, fmtDur, hm, weekday, dayNum, keyFromNum };
});
