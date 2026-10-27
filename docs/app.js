// Таск-менеджер: экран «Сегодня», календарь, разделы, утренняя проверка.
// Данные — Supabase (таблицы и функции в supabase/schema.sql).

const sb = supabase.createClient(CONFIG.url, CONFIG.key);
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const SECTION_COLORS = ['#8fb3ff', '#c3a6ff', '#8fd6a0', '#f2c26b', '#f2808a', '#7fd8e8', '#ffab7a', '#e6a3d6'];

const S = {
  user: null,
  tasks: [],
  sections: [],
  logs: [],
  view: localGet('view') || 'today',
  section: null,          // выбранный раздел на вкладке «Разделы» (null — все)
  month: null,            // первый день месяца в календаре
  day: null,              // выбранный день в календаре
  edit: null,             // задача в окне редактирования
  loaded: false,
  cal: loadCal(),         // календарь: режим (месяц/неделя) и фильтры
};

function loadCal() {
  // hidden — скрытые разделы ('none' — без раздела); всё, что светится, показывается
  const def = { mode: 'month', habits: true, hidden: [] };
  try {
    const c = { ...def, ...JSON.parse(localGet('cal') || '{}') };
    delete c.sections;
    return c;
  } catch { return def; }
}
const saveCal = () => localSet('cal', JSON.stringify(S.cal));

// ---------- даты (всё в местном времени, строки 'YYYY-MM-DD') ----------
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const isodow = s => (parse(s).getDay() + 6) % 7 + 1;
const weekStart = s => addDays(s, 1 - isodow(s));
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);

function addMonths(s, n) {
  // как в Postgres: 31 января + 1 месяц = 28/29 февраля
  const d = parse(s);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d.getDate(), last));
  return iso(t);
}

// Тот же расчёт, что next_due в базе (здесь — только для показа повторов в календаре).
function nextDue(from, every, unit, weekdays) {
  every = every || 1;
  if (unit === 'week' && weekdays && weekdays.length) {
    const w0 = weekStart(from);
    let d = addDays(from, 1);
    for (let i = 0; i < 400; i++) {
      if (weekdays.includes(isodow(d)) && (daysBetween(w0, weekStart(d)) / 7) % every === 0) return d;
      d = addDays(d, 1);
    }
  }
  if (unit === 'day') return addDays(from, every);
  if (unit === 'week') return addDays(from, 7 * every);
  if (unit === 'month') return addMonths(from, every);
  return addMonths(from, 12 * every);
}

function dateLabel(s) {
  const diff = daysBetween(today(), s);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  const d = parse(s);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${WD[isodow(s) - 1]}, ${d.getDate()} ${MONTHS_OF[d.getMonth()].slice(0, 3)}${y}`;
}

function repeatLabel(t) {
  if (!t.repeat_unit) return '';
  const n = t.repeat_every || 1;
  const u = t.repeat_unit;
  let s;
  if (u === 'week' && t.repeat_weekdays && t.repeat_weekdays.length) {
    s = (n > 1 ? `раз в ${n} нед.: ` : '') + [...t.repeat_weekdays].sort().map(d => WD[d - 1]).join(', ');
  } else if (n === 1) {
    s = { day: 'каждый день', week: 'каждую неделю', month: 'каждый месяц', year: 'каждый год' }[u];
  } else {
    s = `каждые ${n} ${{ day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' }[u]}`;
  }
  if (t.repeat_from === 'done') s += ' от выполнения';
  return s;
}

// ---------- мелочи ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function localGet(k) { try { return localStorage.getItem('tm.' + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem('tm.' + k, v); } catch { } }

let toastTimer;
function toast(text, undo) {
  $toast.innerHTML = `<span>${esc(text)}</span>` + (undo ? '<button data-act="toast-undo">Отменить</button>' : '');
  $toast.classList.add('show');
  $toast.onclick = async e => {
    if (e.target.dataset.act !== 'toast-undo') return;
    $toast.classList.remove('show');
    await undo();
  };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), undo ? 5000 : 3000);
}

async function call(promise) {
  const { data, error } = await promise;
  if (error) { toast('Ошибка: ' + error.message); throw error; }
  return data;
}

const sectionOf = t => S.sections.find(s => s.id === t.section_id);
const active = () => S.tasks.filter(t => !t.done_on);
const isEvent = t => t.kind === 'event';
const hhmm = s => (s ? s.slice(0, 5) : '');
const timeLabel = t => (t.start_time ? hhmm(t.start_time) + (t.end_time ? '–' + hhmm(t.end_time) : '') : '');
const cap = s => s[0].toUpperCase() + s.slice(1);
// событие прошло и больше не повторится
const eventOver = t => isEvent(t) && !t.repeat_unit && (t.end_date || t.due_date) < today();

// Ближайшая дата события, начиная с сегодня (у повторяющегося события срок не сдвигается).
function upcoming(t) {
  let d = t.due_date;
  if (!isEvent(t) || !t.repeat_unit || !d) return d;
  for (let i = 0; i < 2000 && d < today(); i++) d = nextDue(d, t.repeat_every, t.repeat_unit, t.repeat_weekdays);
  return d;
}

// Статистика привычки за последние 30 дней (до вчера включительно + сегодня, если уже отмечено).
function habitStats(t) {
  const from = addDays(today(), -29);
  const logs = S.logs.filter(l => l.task_id === t.id && l.day >= from && l.day <= today());
  const done = new Set(logs.filter(l => l.status === 'done').map(l => l.day));
  const missed = new Set(logs.filter(l => l.status === 'missed').map(l => l.day));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today(), -i);
    days.push(done.has(d) ? 'done' : missed.has(d) ? 'missed' : '');
  }
  return { done: done.size, total: done.size + missed.size, days };
}

// ---------- данные ----------
async function load() {
  const since = addDays(today(), -62);
  const monthFrom = S.month && S.month < since ? S.month : since;
  const [tasks, sections, logs] = await Promise.all([
    call(sb.from('tasks').select('*').or(`done_on.is.null,done_on.gte.${monthFrom}`).order('position').order('created_at')),
    call(sb.from('sections').select('*').order('position').order('created_at')),
    call(sb.from('task_log').select('task_id,day,status,done_on').gte('day', monthFrom).order('id')),
  ]);
  S.tasks = tasks;
  S.sections = sections;
  S.logs = logs;
  S.loaded = true;
  render();
  renderReview();
}

async function complete(t, doneOn = today()) {
  await call(sb.rpc('complete_task', { p_task: t.id, p_done_on: doneOn }));
  await load();
  const next = S.tasks.find(x => x.id === t.id);
  const msg = next && !next.done_on && next.due_date ? `Готово! Следующий раз: ${dateLabel(next.due_date)}` : 'Готово!';
  toast(msg, async () => { await call(sb.rpc('undo_last', { p_task: t.id })); await load(); });
}

async function undo(t) {
  await call(sb.rpc('undo_last', { p_task: t.id }));
  await load();
}

// ---------- экраны ----------
function render() {
  if (!S.user) return renderLogin();
  if (!S.loaded) { $app.innerHTML = '<div class="empty">Загружаю…</div>'; return; }
  const views = { today: renderToday, calendar: renderCalendar, sections: renderSections };
  document.body.className = 'v-' + S.view;
  $app.innerHTML = views[S.view]() + `
    ${S.pick ? pickBar() : '<button class="fab" data-act="new" title="Новая задача">+</button>'}
    <nav class="bottom">
      ${[['today', 'Сегодня'], ['calendar', 'Календарь'], ['sections', 'Разделы']]
        .map(([k, n]) => `<button class="pill ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}</button>`).join('')}
    </nav>`;
}

function taskRow(t, opts = {}) {
  const sec = sectionOf(t);
  const meta = [];
  const due = upcoming(t);
  if (opts.date && due) meta.push(`<span class="${due < today() && !isEvent(t) ? 'late' : ''}">${dateLabel(due)}${t.end_date ? ' — ' + dateLabel(t.end_date) : ''}</span>`);
  if (t.start_time) meta.unshift(`<span class="time">${timeLabel(t)}</span>`);
  if (isEvent(t) && !opts.mark) opts = { ...opts, mark: '•', markStyle: 'border-color:var(--accent);color:var(--accent)' };
  if (sec && !opts.noSection) meta.push(`<span><i class="dot" style="background:${esc(sec.color)}"></i>${esc(sec.name)}</span>`);
  const rep = repeatLabel(t);
  if (rep) meta.push(`<span>↻ ${esc(rep)}</span>`);
  if (t.kind === 'habit') {
    const st = habitStats(t);
    if (st.total) meta.push(`<span class="stat">${st.done} из ${st.total} за 30 дн.</span>`);
  }
  if (opts.note) meta.unshift(`<span class="${opts.noteCls || ''}">${opts.note}</span>`);
  const picked = S.pick && S.pick.has(t.id);
  const cls = `task ${t.kind === 'habit' ? 'habit' : ''} ${opts.done ? 'done' : ''} ${picked ? 'picked' : ''}`;
  // mark — значок без действия (прошлые отметки и будущие повторы в календаре)
  const check = S.pick && opts.drag
    ? `<div class="check pick">${picked ? '✓' : ''}</div>`
    : opts.mark
      ? `<div class="check" style="${opts.markStyle || ''}">${opts.mark}</div>`
      : `<button class="check" data-act="${opts.done ? 'undo' : 'done'}" data-id="${t.id}" title="${opts.done ? 'Отменить' : 'Сделано'}">✓</button>`;
  // drag — строка в «Разделах»: её можно перетаскивать и выбирать
  const dnd = opts.drag ? ` data-drag="${t.id}" data-sec="${t.section_id || ''}"${S.pick ? '' : ' draggable="true"'}` : '';
  const act = S.pick && opts.drag ? 'pick' : 'edit';
  return `<div class="${cls}"${dnd}${S.pick && opts.drag ? ` data-act="pick" data-id="${t.id}"` : ''}>
    ${check}
    <div class="body" data-act="${act}" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}

function renderToday() {
  const now = new Date();
  const t0 = today();
  const due = active().filter(t => !isEvent(t) && t.due_date && t.due_date <= t0)
    .sort((a, b) => (a.start_time || '99') < (b.start_time || '99') ? -1 : 1);
  const habits = due.filter(t => t.kind === 'habit');
  const tasks = due.filter(t => t.kind !== 'habit');
  const noDate = active().filter(t => !isEvent(t) && !t.due_date);
  const events = [...new Map((occurrences(t0, t0)[t0] || []).filter(o => isEvent(o.t)).map(o => [o.t.id, o.t])).values()]
    .sort((a, b) => (a.start_time || '') < (b.start_time || '') ? -1 : 1);
  // сделано сегодня: последние отметки «done» сегодняшним числом
  const doneIds = [...new Set(S.logs.filter(l => l.status === 'done' && l.done_on === t0).map(l => l.task_id))];
  const doneToday = doneIds.map(id => S.tasks.find(t => t.id === id)).filter(Boolean);

  let html = `<header class="top"><div><h1>Сегодня</h1><div class="sub">${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS_OF[now.getMonth()]}</div></div>${GEAR}</header>`;
  if (!due.length && !noDate.length && !doneToday.length && !events.length) {
    html += '<div class="empty">Задач на сегодня нет.<br>Нажми «+», чтобы добавить.</div>';
  }
  if (events.length) html += '<h2>События</h2>' + events.map(t => taskRow(t)).join('');
  if (habits.length) html += '<h2>Привычки</h2>' + habits.map(t => taskRow(t)).join('');
  if (tasks.length) html += '<h2>Задачи</h2>' + tasks.map(t => taskRow(t)).join('');
  if (noDate.length) html += '<h2>Без срока</h2>' + noDate.map(t => taskRow(t)).join('');
  if (doneToday.length) html += '<h2>Сделано сегодня</h2>' + doneToday.map(t => taskRow(t, { done: true })).join('');
  return html;
}

// Что стоит на дни from…to: сроки, будущие повторы, события (и на несколько дней), прошлые отметки.
function occurrences(from, to) {
  const map = {};
  const add = (d, item) => (map[d] = map[d] || []).push(item);
  for (const t of active()) {
    if (!t.due_date) continue;
    const span = t.end_date && t.end_date > t.due_date ? daysBetween(t.due_date, t.end_date) : 0;
    const put = (d, kind) => {
      for (let i = 0; i <= span; i++) {
        const x = addDays(d, i);
        if (x >= from && x <= to) add(x, { t, kind });
      }
    };
    let d = t.due_date;
    put(d, 'due');
    // у задач повторы показываем вперёд от текущего срока; у событий срок не сдвигается — считаем от первой даты
    if (!t.repeat_unit || (!isEvent(t) && d < today())) continue;
    for (let i = 0; i < 2000; i++) {
      d = nextDue(d, t.repeat_every, t.repeat_unit, t.repeat_weekdays);
      if (!d || d > to) break;
      if (addDays(d, span) >= from) put(d, 'repeat');
    }
  }
  for (const l of S.logs) {
    if (l.day < from || l.day > to) continue;
    const t = S.tasks.find(x => x.id === l.task_id);
    if (t) add(l.day, { t, kind: l.status });
  }
  return map;
}

// Фильтры календаря: привычки и разделы (ничего не выбрано — все разделы).
function calVisible(o) {
  if (!S.cal.habits && o.t.kind === 'habit') return false;
  return !S.cal.hidden.includes(o.t.section_id || 'none');
}

function dayItems(occ, d) {
  const seen = new Set();
  return (occ[d] || [])
    .filter(o => o.kind !== 'moved' && calVisible(o) && !seen.has(o.t.id + o.kind) && seen.add(o.t.id + o.kind))
    .sort((a, b) => (a.t.start_time || '99') < (b.t.start_time || '99') ? -1 : (a.t.start_time || '99') > (b.t.start_time || '99') ? 1 : 0);
}

const itemCls = o => o.kind === 'done' ? 'd' : o.kind === 'missed' ? 'm' : isEvent(o.t) ? 'e' : o.t.kind === 'habit' ? 'h' : '';

function occRow(o) {
  if (o.kind === 'done') return taskRow(o.t, { done: true, mark: '✓' });
  if (o.kind === 'missed') return taskRow(o.t, { mark: '✕', markStyle: 'border-color:var(--bad);color:var(--bad)', note: 'пропущено', noteCls: 'late' });
  if (o.kind === 'repeat' && !isEvent(o.t)) return taskRow(o.t, { mark: '↻', markStyle: 'color:var(--muted)', note: 'повтор' });
  return taskRow(o.t);
}

// Расписание дня: занятое время и свободные промежутки между ним.
function schedule(items) {
  if (!items.length) return '';
  const free = (a, b) => (a < b ? `<div class="free">Свободно ${a}–${b}</div>` : '');
  let cur = '00:00';
  let html = '';
  for (const o of items) {
    const s = hhmm(o.t.start_time);
    const e = o.t.end_time ? hhmm(o.t.end_time) : s;
    html += free(cur, s) + occRow(o);
    if (e > cur) cur = e;
  }
  return '<h2>Расписание</h2>' + html + free(cur, '24:00');
}

function renderCalendar() {
  const t0 = today();
  const c = S.cal;
  const week = c.mode === 'week';
  if (!S.month) S.month = t0.slice(0, 8) + '01';
  if (!S.day) S.day = t0;
  let start, end, title;
  if (week) {
    start = weekStart(S.day);
    end = addDays(start, 6);
    const a = parse(start), b = parse(end);
    title = a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${b.getDate()} ${MONTHS_OF[b.getMonth()]}`
      : `${a.getDate()} ${MONTHS_OF[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS_OF[b.getMonth()].slice(0, 3)}`;
  } else {
    start = weekStart(S.month);
    end = addDays(weekStart(addDays(addMonths(S.month, 1), -1)), 6);
    const m = parse(S.month);
    title = `${cap(MONTHS[m.getMonth()])} ${m.getFullYear()}`;
  }
  const occ = occurrences(start, end);

  let cells = week ? '' : WD.map(w => `<div class="wd">${w}</div>`).join('');
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const items = dayItems(occ, d);
    const cls = ['day', !week && d.slice(0, 7) !== S.month.slice(0, 7) ? 'out' : '', d === t0 ? 'today' : '', d === S.day ? 'sel' : ''].join(' ');
    const dots = items.slice(0, 6).map(o => `<i class="${itemCls(o)}"></i>`).join('');
    const shown = week ? items : items.slice(0, 3);
    const lines = shown.map(o => {
      const sec = sectionOf(o.t);
      return `<span class="ci ${itemCls(o)}"${sec ? ` style="border-color:${esc(sec.color)}"` : ''}>${o.t.start_time ? `<b>${hhmm(o.t.start_time)}</b> ` : ''}${esc(o.t.title)}</span>`;
    }).join('') + (items.length > shown.length ? `<span class="more">ещё ${items.length - shown.length}</span>` : '');
    const head = week ? `<span class="dn">${WD[isodow(d) - 1]}, ${parse(d).getDate()}</span>` : `<span class="dn">${parse(d).getDate()}</span>`;
    cells += `<button class="${cls}" data-act="day" data-d="${d}">${head}<span class="dots">${dots}</span><span class="lines">${lines}</span></button>`;
  }

  const filters = [`<button class="pill ${c.habits ? 'on' : ''}" data-act="cal-habits">Привычки</button>`]
    .concat(S.sections.map(s => `<button class="pill ${c.hidden.includes(s.id) ? '' : 'on'}" data-act="cal-sec" data-id="${s.id}"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</button>`))
    .concat([`<button class="pill ${c.hidden.includes('none') ? '' : 'on'}" data-act="cal-sec" data-id="none">Без раздела</button>`]);

  const items = dayItems(occ, S.day);
  // события на несколько дней — в «весь день», а не в расписании
  const timed = items.filter(o => o.t.start_time && !(o.t.end_date && o.t.end_date > o.t.due_date));
  const rest = items.filter(o => !timed.includes(o));
  const d = parse(S.day);
  return `<header class="top"><h1>Календарь</h1>
      <div class="tools"><div class="seg"><button class="pill ${week ? '' : 'on'}" data-act="cal-mode" data-v="month">Месяц</button><button class="pill ${week ? 'on' : ''}" data-act="cal-mode" data-v="week">Неделя</button></div>${GEAR}</div>
    </header>
    <div class="chips">${filters.join('')}</div>
    <div class="cal-head">
      <button data-act="nav" data-n="-1">‹</button>
      <b>${title}</b>
      <button data-act="nav" data-n="1">›</button>
    </div>
    <div class="cal ${week ? 'week' : 'month'}">${cells}</div>
    <h2>${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_OF[d.getMonth()]}</h2>
    ${schedule(timed)}
    ${timed.length && rest.length ? '<h2>Без времени</h2>' : ''}
    ${rest.map(occRow).join('')}
    ${items.length ? '' : '<div class="empty">На этот день ничего нет</div>'}`;
}

// Порядок внутри раздела: ручной (position), при равенстве — по сроку.
function byPos(a, b) {
  return (a.position || 0) - (b.position || 0)
    || (upcoming(a) || '9999').localeCompare(upcoming(b) || '9999')
    || (a.created_at || '').localeCompare(b.created_at || '');
}

const sectionTasks = secId => active().filter(t => (t.section_id || null) === secId && !eventOver(t)).sort(byPos);

function renderSections() {
  const sel = S.section;
  const count = id => sectionTasks(id).length;
  // слева (на телефоне — строкой сверху): разделы; на них можно бросать задачи
  const item = (id, name, color, n) => `<button class="pill side-item ${sel === id ? 'on' : ''}" data-act="section" data-id="${id || ''}" data-drop-sec="${id || ''}">
      ${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}<span class="name">${esc(name)}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  const side = [`<button class="pill side-item ${sel === null ? 'on' : ''}" data-act="section" data-id="">Все<span class="n">${active().filter(t => !eventOver(t)).length}</span></button>`]
    .concat(S.sections.map(s => item(s.id, s.name, s.color, count(s.id))))
    .concat(count(null) ? [item('none', 'Без раздела', null, count(null))] : [])
    .concat(['<button class="pill side-item add" data-act="new-section">+ Раздел</button>']);

  const groups = sel === null
    ? S.sections.map(s => [s.id, s.name, s.color]).concat([[null, 'Без раздела', null]])
    : [[sel === 'none' ? null : sel, ...(sel === 'none' ? ['Без раздела', null] : [sectionOf({ section_id: sel })?.name, sectionOf({ section_id: sel })?.color])]];
  let body = '';
  for (const [id, name, color] of groups) {
    const list = sectionTasks(id);
    if (sel === null && !list.length && id === null) continue;
    const head = `<h2 class="group" data-drop-sec="${id || ''}">${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(name || '')}
      ${id ? `<button class="edit-sec" data-act="edit-section" data-id="${id}" title="Изменить раздел">✎</button>` : ''}</h2>`;
    body += head + (list.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')
      || `<div class="empty small" data-drop-sec="${id || ''}">Пусто${S.pick ? '' : ' — перетащи сюда задачу'}</div>`);
  }
  const tools = S.pick
    ? '<button class="pill" data-act="pick-all">Выбрать все</button>'
    : '<button class="pill" data-act="pick-start">Выбрать</button>';
  return `<header class="top"><h1>Разделы</h1><div class="tools">${tools}${GEAR}</div></header>
    <div class="split">
      <nav class="side">${side.join('')}</nav>
      <div class="main">${body || '<div class="empty">Здесь пока пусто</div>'}</div>
    </div>`;
}

// ---------- перетаскивание мышкой (в «Разделах») ----------
let dragId = null;
const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(e => e.classList.remove('drop-before', 'drop-after', 'drop-in'));

document.addEventListener('dragstart', e => {
  const row = e.target.closest && e.target.closest('[data-drag]');
  if (!row) return;
  dragId = row.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  row.classList.add('dragging');
});

document.addEventListener('dragend', () => {
  dragId = null;
  clearDrop();
  document.querySelectorAll('.dragging').forEach(e => e.classList.remove('dragging'));
});

function dropTarget(e) {
  const row = e.target.closest('[data-drag]');
  if (row && row.dataset.drag !== dragId) {
    const r = row.getBoundingClientRect();
    return { row, after: e.clientY > r.top + r.height / 2 };
  }
  const sec = e.target.closest('[data-drop-sec]');
  return sec ? { sec } : null;
}

document.addEventListener('dragover', e => {
  if (!dragId) return;
  const t = dropTarget(e);
  clearDrop();
  if (!t) return;
  e.preventDefault();
  if (t.row) t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
  else t.sec.classList.add('drop-in');
});

document.addEventListener('drop', async e => {
  if (!dragId) return;
  const t = dropTarget(e);
  const id = dragId;
  clearDrop();
  if (!t) return;
  e.preventDefault();
  try {
    if (t.row) await moveTask(id, t.row.dataset.sec || null, t.row.dataset.drag, t.after);
    else await moveTask(id, t.sec.dataset.dropSec === 'none' ? null : t.sec.dataset.dropSec || null, null, true);
  } catch (err) { console.error(err); await load(); }
});

// Переставить задачу: в раздел secId, перед/после задачи targetId (или в конец).
async function moveTask(id, secId, targetId, after) {
  const t = byId(id);
  const list = sectionTasks(secId).filter(x => x.id !== id);
  const i = targetId ? list.findIndex(x => x.id === targetId) + (after ? 1 : 0) : list.length;
  list.splice(i, 0, t);
  const changes = [];
  list.forEach((x, k) => {
    const upd = {};
    if ((x.position || 0) !== k) upd.position = k;
    if (x.id === id && (x.section_id || null) !== secId) upd.section_id = secId;
    if (Object.keys(upd).length) { Object.assign(x, upd); changes.push([x.id, upd]); }
  });
  render();
  await Promise.all(changes.map(([cid, upd]) => call(sb.from('tasks').update(upd).eq('id', cid))));
}

// ---------- выбор нескольких задач ----------
function pickBar() {
  const n = S.pick.size;
  return `<div class="pickbar">
    <span>Выбрано: ${n}</span>
    <button class="btn main" data-act="bulk" ${n ? '' : 'disabled'}>Изменить</button>
    <button class="btn danger" data-act="bulk-delete" ${n ? '' : 'disabled'}>Удалить</button>
    <button class="btn" data-act="pick-end">Готово</button>
  </div>`;
}

const KEEP = '__keep';

function openBulk() {
  $modal.dataset.kind = 'bulk';
  S.bulk = { weekdays: [], from: 'due' };
  const opt = (v, n) => `<option value="${v}">${n}</option>`;
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>Изменить задачи: ${S.pick.size}</h3>
    <div class="msg" style="margin:-6px 0 12px">Меняется только то, где выбрано не «не менять».</div>
    <div class="field"><label>Срок</label>
      <select class="inp" id="b-datemode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить дату')}${opt('none', 'Без срока')}</select>
      <input class="inp" id="b-date" type="date" value="${today()}" style="margin-top:8px"></div>
    <div class="field"><label>Повтор</label>
      <div class="row">
        <select class="inp" id="b-unit">${opt(KEEP, '— не менять —')}${opt('', 'Не повторять')}${opt('day', 'Дни')}${opt('week', 'Недели')}${opt('month', 'Месяцы')}${opt('year', 'Годы')}</select>
        <span id="b-every-box" class="row" style="flex:1">каждые <input class="inp" id="b-every" type="number" min="1" value="1" style="max-width:80px"></span>
      </div></div>
    <div class="field" id="b-wd-box"><label>Дни недели (можно не выбирать)</label>
      <div class="wds">${WD.map((w, i) => `<button class="pill" data-act="b-wd" data-v="${i + 1}">${w}</button>`).join('')}</div></div>
    <div class="field" id="b-from-box"><label>Новый срок считать</label>
      <div class="seg">
        <button class="pill" data-act="b-from" data-v="due">от старого срока</button>
        <button class="pill" data-act="b-from" data-v="done">от дня выполнения</button>
      </div></div>
    <div class="field"><label>Вид</label>
      <select class="inp" id="b-kind">${opt(KEEP, '— не менять —')}${opt('task', 'Обычная')}${opt('habit', 'Привычка')}${opt('event', 'Событие')}</select></div>
    <div class="field"><label>Раздел</label>
      <select class="inp" id="b-section">${opt(KEEP, '— не менять —')}${opt('', 'Без раздела')}${S.sections.map(s => opt(s.id, esc(s.name))).join('')}</select></div>
    <div class="actions"><span></span>
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="bulk-save">Применить</button></div>
    </div>
  </div></div>`;
  ['b-datemode', 'b-unit'].forEach(id => { document.getElementById(id).onchange = syncBulk; });
  syncBulk();
}

function syncBulk() {
  const unit = document.getElementById('b-unit').value;
  document.getElementById('b-date').style.display = document.getElementById('b-datemode').value === 'set' ? '' : 'none';
  document.getElementById('b-every-box').style.display = unit && unit !== KEEP ? '' : 'none';
  document.getElementById('b-wd-box').style.display = unit === 'week' ? '' : 'none';
  document.getElementById('b-from-box').style.display = unit && unit !== KEEP ? '' : 'none';
  $modal.querySelectorAll('[data-act=b-wd]').forEach(b => b.classList.toggle('on', S.bulk.weekdays.includes(+b.dataset.v)));
  $modal.querySelectorAll('[data-act=b-from]').forEach(b => b.classList.toggle('on', b.dataset.v === S.bulk.from));
}

async function saveBulk() {
  const ids = [...S.pick];
  const v = id => document.getElementById(id).value;
  const upd = {};
  if (v('b-datemode') === 'set') upd.due_date = v('b-date') || today();
  if (v('b-datemode') === 'none') upd.due_date = null;
  if (v('b-unit') !== KEEP) {
    const unit = v('b-unit') || null;
    upd.repeat_unit = unit;
    upd.repeat_every = unit ? Math.max(1, parseInt(v('b-every')) || 1) : null;
    upd.repeat_weekdays = unit === 'week' && S.bulk.weekdays.length ? [...S.bulk.weekdays].sort() : null;
    upd.repeat_from = S.bulk.from;
  }
  if (v('b-kind') !== KEEP) upd.kind = v('b-kind');
  if (v('b-section') !== KEEP) upd.section_id = v('b-section') || null;
  if (!Object.keys(upd).length) return toast('Ничего не выбрано для изменения');
  await call(sb.from('tasks').update(upd).in('id', ids));
  // у повтора должен быть срок: где его нет — сегодня
  if (upd.repeat_unit && !('due_date' in upd)) await call(sb.from('tasks').update({ due_date: today() }).in('id', ids).is('due_date', null));
  S.pick = null;
  closeModal();
  await load();
  toast(`Изменено задач: ${ids.length}`);
}

async function deleteBulk() {
  const ids = [...S.pick];
  if (!confirm(`Удалить задачи (${ids.length}) совсем? Их история тоже удалится.`)) return;
  await call(sb.from('tasks').delete().in('id', ids));
  S.pick = null;
  await load();
}

// ---------- настройки (шестерёнка) ----------
const GEAR = '<button class="icon" data-act="settings" title="Настройки">⚙</button>';

function openSettings() {
  $modal.dataset.kind = 'settings';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>Настройки</h3>
    <div class="menu">
      <button class="btn" data-act="import">Загрузить задачи из файла</button>
      <button class="btn" data-act="logout">Выйти из аккаунта</button>
    </div>
    <div class="actions"><span></span><button class="btn" data-act="close">Закрыть</button></div>
  </div></div>`;
}

// ---------- вход ----------
function renderLogin(msg = '', err = false) {
  $modal.innerHTML = '';
  $app.innerHTML = `<div class="login">
    <h1>Задачи</h1>
    <div class="field"><label>Почта</label><input class="inp" id="email" type="email" autocomplete="email"></div>
    <div class="field"><label>Пароль</label><input class="inp" id="pass" type="password" autocomplete="current-password"></div>
    <div class="row"><button class="btn main" data-act="login">Войти</button><button class="btn" data-act="signup">Зарегистрироваться</button></div>
    <div class="msg ${err ? 'err' : ''}">${esc(msg)}</div>
  </div>`;
}

async function auth(kind) {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('pass').value;
  if (!email || !password) return renderLogin('Введи почту и пароль', true);
  const { data, error } = kind === 'login'
    ? await sb.auth.signInWithPassword({ email, password })
    : await sb.auth.signUp({ email, password });
  if (error) return renderLogin(authError(error), true);
  if (kind === 'signup' && !data.session) renderLogin('Готово! Открой письмо от Supabase, подтверди почту и потом войди.');
}

function authError(e) {
  const m = e.message || '';
  if (/invalid login/i.test(m)) return 'Неверная почта или пароль';
  if (/not confirmed/i.test(m)) return 'Почта ещё не подтверждена — открой письмо от Supabase';
  if (/at least 6/i.test(m)) return 'Пароль должен быть не короче 6 символов';
  if (/already registered/i.test(m)) return 'Такая почта уже зарегистрирована — просто войди';
  return m;
}

// ---------- утренняя проверка ----------
function reviewList() {
  const t0 = today();
  return active().filter(t => !isEvent(t) && t.due_date && t.due_date < t0).sort((a, b) => a.due_date < b.due_date ? -1 : 1);
}

function renderReview() {
  const list = reviewList();
  if (!list.length) {
    if ($modal.dataset.kind === 'review') { $modal.innerHTML = ''; $modal.dataset.kind = ''; }
    return;
  }
  const onlyYesterday = list.every(t => t.due_date === addDays(today(), -1));
  $modal.dataset.kind = 'review';
  $modal.innerHTML = `<div class="overlay"><div class="sheet review">
    <h3>Привет, ${esc(CONFIG.name)}! ${onlyYesterday ? 'Что из вчерашнего ты успела сделать?' : 'Что из этого ты успела сделать?'}</h3>
    ${list.map(t => `<div class="task ${t.kind === 'habit' ? 'habit' : ''}">
      <div class="body"><div class="title">${esc(t.title)}</div>
        <div class="meta"><span>${dateLabel(t.due_date)}</span><span>${t.kind === 'habit' ? 'привычка' : 'задача'}</span></div></div>
      <div class="yn">
        <button class="btn good" data-act="r-yes" data-id="${t.id}">Сделала</button>
        <button class="btn" data-act="r-no" data-id="${t.id}" title="${t.kind === 'habit' && t.repeat_unit ? 'Засчитать пропуск' : 'Перенести на сегодня'}">Не сделала</button>
      </div></div>`).join('')}
  </div></div>`;
}

// ---------- окно задачи ----------
function openEdit(t) {
  const isNew = !t.id;
  S.edit = { ...t };
  const e = S.edit;
  const st = !isNew && e.kind === 'habit' ? habitStats(e) : null;
  $modal.dataset.kind = 'edit';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>${isNew ? 'Новая запись' : isEvent(e) ? 'Событие' : 'Задача'}</h3>
    <div class="field"><input class="inp" id="f-title" placeholder="Название" value="${esc(e.title || '')}"></div>
    <div class="field seg" id="f-kind">
      <button class="pill" data-act="kind" data-v="task">Обычная</button>
      <button class="pill" data-act="kind" data-v="habit">Привычка</button>
      <button class="pill" data-act="kind" data-v="event">Событие</button>
    </div>
    ${st ? `<div class="stats">За 30 дней: <b>${st.done} из ${st.total}</b>
      <div class="strip">${st.days.map(d => `<i class="${d}"></i>`).join('')}</div></div>` : ''}
    <div class="field"><label id="f-date-label">Срок</label>
      <input class="inp" id="f-date" type="date" value="${e.due_date || ''}" style="margin-bottom:8px">
      <div class="row">
        <button class="pill" data-act="date" data-v="0">Сегодня</button>
        <button class="pill" data-act="date" data-v="1">Завтра</button>
        <button class="pill" data-act="date" data-v="" id="f-nodate">Без срока</button>
      </div></div>
    <div class="field" id="f-end-box"><label>По какое число (если событие на несколько дней)</label>
      <input class="inp" id="f-enddate" type="date" value="${e.end_date || ''}"></div>
    <div class="field"><label>Время (можно не указывать)</label>
      <div class="row">с <input class="inp" id="f-start" type="time" value="${hhmm(e.start_time)}">
        до <input class="inp" id="f-end" type="time" value="${hhmm(e.end_time)}"></div></div>
    <div class="field"><label>Повтор</label>
      <div class="row">
        <select class="inp" id="f-unit">
          <option value="">Не повторять</option>
          <option value="day">Дни</option><option value="week">Недели</option>
          <option value="month">Месяцы</option><option value="year">Годы</option>
        </select>
        <span id="f-every-box" class="row" style="flex:1">каждые <input class="inp" id="f-every" type="number" min="1" value="${e.repeat_every || 1}" style="max-width:80px"></span>
      </div></div>
    <div class="field" id="f-wd-box"><label>Дни недели (можно не выбирать)</label>
      <div class="wds">${WD.map((w, i) => `<button class="pill" data-act="wd" data-v="${i + 1}">${w}</button>`).join('')}</div></div>
    <div class="field" id="f-from-box"><label>Новый срок считать</label>
      <div class="seg">
        <button class="pill" data-act="from" data-v="due">от старого срока</button>
        <button class="pill" data-act="from" data-v="done">от дня выполнения</button>
      </div></div>
    <div class="field"><label>Раздел</label>
      <select class="inp" id="f-section"><option value="">Без раздела</option>
        ${S.sections.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Заметка</label><textarea class="inp" id="f-notes">${esc(e.notes || '')}</textarea></div>
    <div class="actions">
      ${isNew ? '<span></span>' : '<button class="btn danger" data-act="delete">Удалить</button>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="save">Сохранить</button></div>
    </div>
  </div></div>`;
  document.getElementById('f-unit').value = e.repeat_unit || '';
  document.getElementById('f-section').value = e.section_id || '';
  document.getElementById('f-unit').onchange = ev => { e.repeat_unit = ev.target.value || null; syncEdit(); };
  syncEdit();
  if (isNew) document.getElementById('f-title').focus();
}

// Показ/скрытие частей окна по выбранным значениям.
function syncEdit() {
  const e = S.edit;
  const q = s => $modal.querySelectorAll(s);
  q('[data-act=kind]').forEach(b => b.classList.toggle('on', b.dataset.v === e.kind));
  q('[data-act=from]').forEach(b => b.classList.toggle('on', b.dataset.v === e.repeat_from));
  q('[data-act=wd]').forEach(b => b.classList.toggle('on', (e.repeat_weekdays || []).includes(+b.dataset.v)));
  document.getElementById('f-every-box').style.display = e.repeat_unit ? '' : 'none';
  document.getElementById('f-wd-box').style.display = e.repeat_unit === 'week' ? '' : 'none';
  // у события нет выполнения: «от дня выполнения» не нужно, зато есть «по какое число»
  document.getElementById('f-from-box').style.display = e.repeat_unit && !isEvent(e) ? '' : 'none';
  document.getElementById('f-end-box').style.display = isEvent(e) ? '' : 'none';
  document.getElementById('f-nodate').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-date-label').textContent = isEvent(e) ? 'Дата' : 'Срок';
}

function closeModal() {
  S.edit = null;
  $modal.innerHTML = '';
  $modal.dataset.kind = '';
  renderReview();
}

async function saveEdit() {
  const e = S.edit;
  const title = document.getElementById('f-title').value.trim();
  if (!title) return toast('Напиши, что сделать');
  const row = {
    title,
    kind: e.kind,
    due_date: document.getElementById('f-date').value || null,
    repeat_unit: e.repeat_unit || null,
    repeat_every: e.repeat_unit ? Math.max(1, parseInt(document.getElementById('f-every').value) || 1) : null,
    repeat_weekdays: e.repeat_unit === 'week' && e.repeat_weekdays && e.repeat_weekdays.length ? e.repeat_weekdays : null,
    repeat_from: e.repeat_from || 'due',
    section_id: document.getElementById('f-section').value || null,
    notes: document.getElementById('f-notes').value.trim() || null,
    start_time: document.getElementById('f-start').value || null,
    end_time: document.getElementById('f-end').value || null,
    end_date: null,
  };
  if (!row.start_time) row.end_time = null;
  if ((row.repeat_unit || isEvent(row)) && !row.due_date) row.due_date = today();
  if (isEvent(row)) {
    row.repeat_from = 'due';
    const end = document.getElementById('f-enddate').value;
    if (end && end > row.due_date) row.end_date = end;
  }
  if (e.id) await call(sb.from('tasks').update(row).eq('id', e.id));
  else await call(sb.from('tasks').insert(row));
  closeModal();
  await load();
}

async function deleteEdit() {
  if (!confirm('Удалить задачу совсем? Её история тоже удалится.')) return;
  await call(sb.from('tasks').delete().eq('id', S.edit.id));
  closeModal();
  await load();
}

// ---------- разделы ----------
function openSection(sec) {
  $modal.dataset.kind = 'section';
  const color = sec?.color || SECTION_COLORS[S.sections.length % SECTION_COLORS.length];
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>${sec ? 'Раздел' : 'Новый раздел'}</h3>
    <div class="field"><input class="inp" id="s-name" placeholder="Название" value="${esc(sec?.name || '')}"></div>
    <div class="field seg">${SECTION_COLORS.map(c => `<button class="pill ${c === color ? 'on' : ''}" data-act="s-color" data-v="${c}"><i class="dot" style="background:${c};margin:0"></i></button>`).join('')}</div>
    <div class="actions">
      ${sec ? `<button class="btn danger" data-act="s-delete" data-id="${sec.id}">Удалить</button>` : '<span></span>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="s-save" data-id="${sec?.id || ''}">Сохранить</button></div>
    </div></div></div>`;
  document.getElementById('s-name').focus();
}

async function saveSection(id) {
  const name = document.getElementById('s-name').value.trim();
  if (!name) return toast('Напиши название');
  const color = $modal.querySelector('[data-act=s-color].on').dataset.v;
  if (id) await call(sb.from('sections').update({ name, color }).eq('id', id));
  else {
    const [s] = await call(sb.from('sections').insert({ name, color, position: S.sections.length }).select());
    S.section = s.id;
  }
  closeModal();
  await load();
}

async function deleteSection(id) {
  if (!confirm('Удалить раздел? Задачи из него останутся, просто без раздела.')) return;
  await call(sb.from('sections').delete().eq('id', id));
  S.section = null;
  closeModal();
  await load();
}

// ---------- загрузка из файла (todoist.json от tools/todoist_export.py) ----------
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Не получилось прочитать файл'); }
  const tasks = data.tasks || [];
  const newSecs = (data.sections || []).filter(s => !S.sections.some(x => x.name === s.name));
  if (!tasks.length) return toast('В файле нет задач');
  if (!confirm(`Загрузить ${tasks.length} задач и ${newSecs.length} новых разделов?\nЕсли уже загружала этот файл, задачи повторятся.`)) return;
  if (newSecs.length) {
    await call(sb.from('sections').insert(newSecs.map((s, i) => ({ name: s.name, color: s.color, position: S.sections.length + i }))));
  }
  const secs = await call(sb.from('sections').select('id,name'));
  const secId = name => (secs.find(s => s.name === name) || {}).id || null;
  const rows = tasks.map(t => ({
    title: t.title,
    notes: t.notes || null,
    kind: t.kind || 'task',
    section_id: t.section ? secId(t.section) : null,
    due_date: t.due_date || null,
    start_time: t.start_time || null,
    end_time: t.end_time || null,
    repeat_unit: t.repeat_unit || null,
    repeat_every: t.repeat_unit ? t.repeat_every || 1 : null,
    repeat_weekdays: t.repeat_unit === 'week' ? t.repeat_weekdays || null : null,
    repeat_from: t.repeat_from || 'due',
  }));
  for (let i = 0; i < rows.length; i += 200) await call(sb.from('tasks').insert(rows.slice(i, i + 200)));
  await load();
  toast(`Загружено задач: ${rows.length}`);
}

document.addEventListener('change', async ev => {
  if (ev.target.id !== 'import-file' || !ev.target.files[0]) return;
  try { await importFile(ev.target.files[0]); } catch (e) { console.error(e); }
  ev.target.value = '';
});

// ---------- нажатия ----------
const byId = id => S.tasks.find(t => t.id === id);
const BUSY = new Set(['login', 'signup', 'done', 'undo', 'save', 'delete', 's-save', 's-delete', 'r-yes', 'r-no', 'bulk-save', 'bulk-delete']);

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const v = el.dataset.v;
  if (act === 'close-bg' && ev.target !== el) return; // щелчок внутри окна, а не по фону
  if (BUSY.has(act)) el.disabled = true; // от двойного нажатия, пока ждём базу
  try {
    switch (act) {
      case 'login': case 'signup': await auth(act); break;
      case 'logout': closeModal(); await sb.auth.signOut(); break;
      case 'settings': openSettings(); break;
      case 'pick-start': S.pick = new Set(); render(); break;
      case 'pick-end': S.pick = null; render(); break;
      case 'pick': S.pick.has(id) ? S.pick.delete(id) : S.pick.add(id); render(); break;
      case 'pick-all': $app.querySelectorAll('[data-drag]').forEach(r => S.pick.add(r.dataset.drag)); render(); break;
      case 'bulk': openBulk(); break;
      case 'bulk-save': await saveBulk(); break;
      case 'bulk-delete': await deleteBulk(); break;
      case 'b-wd': {
        const set = new Set(S.bulk.weekdays);
        set.has(+v) ? set.delete(+v) : set.add(+v);
        S.bulk.weekdays = [...set];
        syncBulk();
        break;
      }
      case 'b-from': S.bulk.from = v; syncBulk(); break;
      case 'view': S.view = v; S.pick = null; localSet('view', v); render(); scrollTo(0, 0); break;
      case 'done': el.classList.add('ok'); await complete(byId(id)); break;
      case 'undo': await undo(byId(id)); break;
      case 'edit': openEdit(byId(id)); break;
      case 'new': {
        const due = S.view === 'calendar' ? S.day : S.view === 'today' ? today() : null;
        openEdit({ kind: 'task', due_date: due, repeat_from: 'due', section_id: S.view === 'sections' ? S.section : null });
        break;
      }
      case 'close': case 'close-bg': closeModal(); break;
      case 'save': await saveEdit(); break;
      case 'delete': await deleteEdit(); break;
      case 'kind':
        S.edit.kind = v;
        if (v === 'habit' && !S.edit.repeat_unit) {
          S.edit.repeat_unit = 'day';
          document.getElementById('f-unit').value = 'day';
          if (!document.getElementById('f-date').value) document.getElementById('f-date').value = today();
        }
        if (v === 'event' && !document.getElementById('f-date').value) document.getElementById('f-date').value = S.view === 'calendar' ? S.day : today();
        syncEdit();
        break;
      case 'from': S.edit.repeat_from = v; syncEdit(); break;
      case 'wd': {
        const set = new Set(S.edit.repeat_weekdays || []);
        set.has(+v) ? set.delete(+v) : set.add(+v);
        S.edit.repeat_weekdays = [...set].sort();
        syncEdit();
        break;
      }
      case 'date': document.getElementById('f-date').value = v === '' ? '' : addDays(today(), +v); break;
      case 'day': S.day = el.dataset.d; render(); break;
      case 'nav':
        if (S.cal.mode === 'week') { S.day = addDays(S.day, 7 * el.dataset.n); S.month = S.day.slice(0, 8) + '01'; }
        else { S.month = addMonths(S.month, +el.dataset.n); S.day = S.month; }
        render();
        if (S.month < addDays(today(), -62)) await load();
        break;
      case 'cal-mode': S.cal.mode = v; saveCal(); S.month = S.day.slice(0, 8) + '01'; render(); break;
      case 'cal-habits': S.cal.habits = !S.cal.habits; saveCal(); render(); break;
      case 'cal-sec': {
        const set = new Set(S.cal.hidden);
        set.has(id) ? set.delete(id) : set.add(id);
        S.cal.hidden = [...set];
        saveCal();
        render();
        break;
      }
      case 'section': S.section = id || null; render(); break;
      case 'new-section': openSection(null); break;
      case 'edit-section': openSection(S.sections.find(s => s.id === id)); break;
      case 's-color': $modal.querySelectorAll('[data-act=s-color]').forEach(b => b.classList.toggle('on', b === el)); break;
      case 's-save': await saveSection(id); break;
      case 's-delete': await deleteSection(id); break;
      case 'import': closeModal(); document.getElementById('import-file').click(); break;
      case 'r-yes': { const t = byId(id); await call(sb.rpc('complete_task', { p_task: id, p_done_on: t.due_date })); await load(); break; }
      case 'r-no': await call(sb.rpc('miss_task', { p_task: id, p_today: today() })); await load(); break;
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (el.isConnected) el.disabled = false;
  }
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'pass') auth('login');
  if (ev.key === 'Enter' && ev.target.id === 'f-title') saveEdit();
  if (ev.key === 'Enter' && ev.target.id === 's-name') saveSection($modal.querySelector('[data-act=s-save]').dataset.id);
  if (ev.key === 'Escape' && $modal.dataset.kind && $modal.dataset.kind !== 'review') closeModal();
});

// ---------- синхронизация ----------
// Свежие данные — при возвращении в приложение и раз в минуту, пока оно на экране.
let lastDay = today();
function refresh() {
  if (!S.user || document.hidden) return;
  if (today() !== lastDay) { lastDay = today(); S.day = null; S.month = null; }
  load().catch(() => { });
}
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 60000);

sb.auth.onAuthStateChange((event, session) => {
  const was = S.user?.id;
  S.user = session?.user || null;
  if (!S.user) { S.loaded = false; render(); return; }
  if (was !== S.user.id) { render(); setTimeout(() => load().catch(() => { }), 0); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
