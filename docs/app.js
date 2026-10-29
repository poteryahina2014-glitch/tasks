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
  space: localGet('space') === 'work' ? 'work' : 'personal', // режим «Личное / Работа» (своё на каждом устройстве)
  templates: [],
  projects: [],
  tpl: null,              // шаблон в окне редактирования
  showDone: localGet('done') === '1', // показывать выполненные («Сделано сегодня», отметки в календаре)
  noDate: localGet('nodate') === '1', // «Разделы»: только задачи без срока
  hRange: +localGet('hrange') || 30,  // «Привычки»: за сколько дней статистика
  hLogs: null,            // история привычек за год (грузится, когда открыта вкладка)
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
// n рабочих дней вперёд (пн–пт; праздники пока не учитываются)
function addWorkDays(s, n) {
  while (n > 0) { s = addDays(s, 1); if (isodow(s) <= 5) n--; }
  return s;
}

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
// Задачи выключенного раздела нигде не показываются, кроме самого раздела в «Разделах».
const pausedSec = id => !!(id && (S.sections.find(s => s.id === id) || {}).paused);
const activeAll = () => S.tasks.filter(t => !t.done_on);
// Режим: раздел относится к личному или рабочему; задача без раздела — по своему полю space.
const spaceOfSec = sec => (sec && sec.space) || 'personal';
const spaceOf = t => {
  const sec = t.section_id && S.sections.find(x => x.id === t.section_id);
  return sec ? spaceOfSec(sec) : t.space || 'personal';
};
const secsOf = space => S.sections.filter(x => spaceOfSec(x) === space);
const mySecs = () => secsOf(S.space);
const active = () => activeAll().filter(t => !pausedSec(t.section_id) && spaceOf(t) === S.space);
// рабочие события — в личном календаре видны бледно, как «занято»
const busyEvents = () => (S.space === 'personal'
  ? activeAll().filter(t => isEvent(t) && spaceOf(t) === 'work' && !pausedSec(t.section_id)) : []);
const isEvent = t => t.kind === 'event';
const hhmm = s => (s ? s.slice(0, 5) : '');
const fmtH = h => String(Math.round(h * 10) / 10).replace('.', ','); // 2.5 → «2,5»
// готовые часы для «Напомнить»
const REMIND_TIMES = ['07:00', '09:00', '12:00', '14:00', '17:00', '20:00'];
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
  const [tasks, sections, logs, templates, projects] = await Promise.all([
    call(sb.from('tasks').select('*').or(`done_on.is.null,done_on.gte.${monthFrom},project_id.not.is.null`).order('position').order('created_at')),
    call(sb.from('sections').select('*').order('position').order('created_at')),
    call(sb.from('task_log').select('task_id,day,status,done_on').gte('day', monthFrom).order('id')),
    call(sb.from('templates').select('*').order('created_at')),
    call(sb.from('projects').select('*').eq('archived', false).order('created_at', { ascending: false })),
  ]);
  S.tasks = tasks;
  S.sections = sections;
  S.logs = logs;
  S.templates = templates;
  S.projects = projects;
  S.loaded = true;
  S.hLogs = null;
  if (await autoGenerate()) return load(); // закончился период — шаблоны создали задачи
  render();
  renderReview();
  firstHelp();
}

// Шаги проекта, которые надо сделать раньше и которые ещё не сделаны (удалённые не считаются)
const waitsFor = t => (t.after_ids || []).map(byId).filter(x => x && !x.done_on);

// Подпункты задачи: [{t: текст, d: сделано}]
const subsOf = t => Array.isArray(t.checklist) ? t.checklist : [];
const cleanSubs = list => list.map(s => ({ t: (s.t || '').trim(), d: !!s.d })).filter(s => s.t);

// У повторяющейся задачи следующий раз подпункты снова не отмечены и план не назначен.
async function resetRepeat(t) {
  if (!t.repeat_unit) return;
  const upd = {};
  if (subsOf(t).some(s => s.d)) upd.checklist = subsOf(t).map(s => ({ ...s, d: false }));
  if (t.plan_date) upd.plan_date = null;
  if (Object.keys(upd).length) await call(sb.from('tasks').update(upd).eq('id', t.id));
}

async function toggleSub(t, i) {
  t.checklist = subsOf(t).map((s, k) => k === i ? { ...s, d: !s.d } : s);
  render();
  await call(sb.from('tasks').update({ checklist: t.checklist }).eq('id', t.id));
}

async function complete(t, doneOn = today()) {
  await call(sb.rpc('complete_task', { p_task: t.id, p_done_on: doneOn }));
  await resetRepeat(t);
  if (t.pet) S.petJoy = { pet: t.pet, at: Date.now() }; // питомец радуется — сердечки
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
  updatePets();
  updateDust();
  if (!S.user) return renderLogin();
  if (!S.loaded) { $app.innerHTML = '<div class="empty">Загружаю…</div>'; return; }
  const views = { today: renderToday, calendar: renderCalendar, sections: renderSections, habits: renderHabits, plan: renderPlan };
  if (S.view === 'nodate') { S.view = 'sections'; S.noDate = true; } // вкладки «Без срока» нет — это фильтр в «Разделах»
  if (!views[S.view]) S.view = 'sections'; // была вкладка «Проекты» — теперь проекты живут в «Разделах»
  if (S.view === 'plan' && !planOn()) S.view = 'today';
  document.body.className = 'v-' + S.view + (S.space === 'work' ? ' work' : '');
  $app.innerHTML = views[S.view]() + meterCard('side') + `
    ${S.pick ? pickBar() : '<button class="fab" data-act="new" title="Новая задача">+</button>'}
    <nav class="bottom">
      ${[['today', 'Сегодня'], ['calendar', 'Календарь'], ['sections', 'Разделы'], ['habits', 'Привычки']]
        .concat(planOn() ? [['plan', 'План']] : []).map(([k, n]) => `<button class="pill ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}</button>`).join('')}
    </nav>`;
}

function taskRow(t, opts = {}) {
  const sec = sectionOf(t);
  // слева — только название (и то, что важно прочитать: «ждёт», пометка); остальные отметки — справа
  const meta = [];
  const tags = [];
  const due = upcoming(t);
  if (t.start_time) tags.push(`<span class="time">${timeLabel(t)}</span>`);
  if (t.start_date && !isEvent(t) && t.start_date > today()) tags.push(`<span>с ${dateLabel(t.start_date)}</span>`);
  if (opts.date && due) tags.push(`<span class="${due < today() && !isEvent(t) ? 'late' : ''}">${t.start_date && !isEvent(t) ? 'до ' : ''}${dateLabel(due)}${t.end_date ? ' — ' + dateLabel(t.end_date) : ''}</span>`);
  // у запланированной задачи дедлайн виден всегда; красный — прошёл или план позже него
  if (t.plan_date && t.due_date && !opts.date && !opts.done)
    tags.push(`<span class="${t.due_date < today() || t.plan_date > t.due_date ? 'late' : ''}">до ${dateLabel(t.due_date)}</span>`);
  if (t.estimate) tags.push(`<span>⏱ ${fmtH(t.estimate)} ч</span>`);
  if (isEvent(t) && !opts.mark) opts = { ...opts, mark: '•', markStyle: 'border-color:var(--accent);color:var(--accent)' };
  if (sec && !opts.noSection) tags.push(`<span>${esc(sec.name)}</span>`);
  const rep = repeatLabel(t);
  if (rep) tags.push(`<span>↻ ${esc(rep)}</span>`);
  const subs = subsOf(t);
  if (subs.length) tags.push(`<span>☑ ${subs.filter(s => s.d).length}/${subs.length}</span>`);
  if (t.remind_at) tags.push(`<span>🔔 ${hhmm(t.remind_at)}</span>`);
  if (t.decor && DECOR[t.decor]) tags.push(`<span title="${DECOR[t.decor].name}">${DECOR[t.decor].icon}</span>`);
  if (t.pet && PETS[t.pet]) tags.push(`<span title="${esc(petName(t.pet))}">${PETS[t.pet].icon}</span>`);
  if (opts.note) meta.push(`<span class="${opts.noteCls || ''}">${opts.note}</span>`);
  // ждёт другие шаги проекта; красным — если они запланированы позже этой задачи
  const waits = opts.done ? [] : waitsFor(t);
  if (waits.length) {
    const later = planDay(t) && waits.some(w => !planDay(w) || planDay(w) > planDay(t));
    meta.unshift(`<span class="lock ${later ? 'late' : ''}" title="${later ? 'Эти шаги ещё не запланированы раньше' : ''}">🔒 ждёт: ${waits.map(w => esc(w.title)).join(', ')}</span>`);
  }
  // подпункты видны под задачей и отмечаются прямо там (не в календарных отметках и не у сделанных)
  const subList = subs.length && !opts.mark && !opts.done
    ? `<div class="subs">${subs.map((s, i) => `<button class="sub ${s.d ? 'on' : ''}" data-act="sub" data-id="${t.id}" data-v="${i}"><i>${s.d ? '✓' : ''}</i><span>${esc(s.t)}</span></button>`).join('')}</div>`
    : '';
  const picked = S.pick && S.pick.has(t.id);
  const dusty = !opts.done && t.decor === 'dust' && petLate(t) >= DUST_DAYS;
  const cls = `task ${t.kind === 'habit' ? 'habit' : ''} ${waits.length ? 'locked' : ''} ${opts.done ? 'done' : ''} ${picked ? 'picked' : ''} ${opts.busy ? 'busy' : ''} ${dusty ? 'dusty' : ''}`;
  // mark — значок без действия (прошлые отметки и будущие повторы в календаре)
  const check = S.pick && opts.drag
    ? `<div class="check pick">${picked ? '✓' : ''}</div>`
    : opts.mark
      ? `<div class="check" style="${opts.markStyle || ''}">${opts.mark}</div>`
      : `<button class="check" data-act="${opts.done ? 'undo' : 'done'}" data-id="${t.id}" title="${opts.done ? 'Отменить' : 'Сделано'}">✓</button>`;
  // drag — строка в «Разделах»: её можно перетаскивать и выбирать
  const dnd = opts.drag ? ` data-drag="${t.id}" data-sec="${t.section_id || ''}"${S.pick ? '' : ' draggable="true"'}`
    : opts.plan ? ` data-plan="${t.id}" draggable="true"` : ''; // plan — карточка в «Плане», тащится по дням
  const act = S.pick && opts.drag ? 'pick' : 'edit';
  // строка залита бледным цветом своего раздела
  const tint = sec ? ` style="--sec:${esc(sec.color)}"` : '';
  return `<div class="${cls}${sec ? ' tinted' : ''}"${tint}${dnd}${S.pick && opts.drag ? ` data-act="pick" data-id="${t.id}"` : ''}>
    ${check}
    <div class="body" data-act="${act}" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
      ${subList}
    </div>
    ${tags.length ? `<div class="tags" data-act="${act}" data-id="${t.id}">${tags.join('')}</div>` : ''}
    ${dusty ? WEB : ''}
  </div>`;
}

function renderToday() {
  const now = new Date();
  const t0 = today();
  const due = active().filter(t => !isEvent(t) && reviewDay(t) && reviewDay(t) <= t0)
    .sort((a, b) => (a.start_time || '99') < (b.start_time || '99') ? -1 : 1);
  const habits = due.filter(t => t.kind === 'habit');
  const tasks = due.filter(t => t.kind !== 'habit');
  const started = t => t.start_date && t.start_date <= t0;
  // начатые, но со сроком позже — «в работе»
  const inWork = active().filter(t => !isEvent(t) && !t.plan_date && started(t) && (!t.due_date || t.due_date > t0)).sort(byPos);
  const events = [...new Map((occurrences(t0, t0)[t0] || []).filter(o => isEvent(o.t) && spaceOf(o.t) === S.space).map(o => [o.t.id, o.t])).values()]
    .sort((a, b) => (a.start_time || '') < (b.start_time || '') ? -1 : 1);
  // сделано сегодня: последние отметки «done» сегодняшним числом
  const doneIds = [...new Set(S.logs.filter(l => l.status === 'done' && l.done_on === t0).map(l => l.task_id))];
  const doneToday = S.showDone ? doneIds.map(id => S.tasks.find(t => t.id === id)).filter(Boolean) : [];

  let html = `<header class="top"><h1>Сегодня <span class="sub">${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS_OF[now.getMonth()]}</span></h1><div class="tools">${MODE()}${GEAR}</div></header>`;
  html += meterCard('top');
  if (!due.length && !doneToday.length && !events.length && !inWork.length) {
    html += '<div class="empty">Задач на сегодня нет.<br>Нажми «+», чтобы добавить.</div>';
  }
  if (events.length) html += '<h2>События</h2>' + events.map(t => taskRow(t)).join('');
  if (habits.length) html += '<h2>Привычки</h2>' + habits.map(t => taskRow(t)).join('');
  if (tasks.length) html += '<h2>Задачи</h2>' + tasks.map(t => taskRow(t)).join('');
  if (inWork.length) html += '<h2>В работе</h2>' + inWork.map(t => taskRow(t, { date: true })).join('');
  if (doneToday.length) html += '<h2>Сделано сегодня</h2>' + doneToday.map(t => taskRow(t, { done: true })).join('');
  return html;
}

function occurrences(from, to) {
  const map = {};
  const add = (d, item) => (map[d] = map[d] || []).push(item);
  for (const t of active().concat(busyEvents())) {
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
    if (t && spaceOf(t) === S.space && !pausedSec(t.section_id)) add(l.day, { t, kind: l.status });
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
    .filter(o => o.kind !== 'moved' && (o.kind !== 'done' || S.showDone) && calVisible(o) && !seen.has(o.t.id + o.kind) && seen.add(o.t.id + o.kind))
    .sort((a, b) => (a.t.start_time || '99') < (b.t.start_time || '99') ? -1 : (a.t.start_time || '99') > (b.t.start_time || '99') ? 1 : 0);
}

const itemCls = o => (spaceOf(o.t) !== S.space ? 'busy ' : '') + itemClsBase(o);
const itemClsBase = o => o.kind === 'done' ? 'd' : o.kind === 'missed' ? 'm' : isEvent(o.t) ? 'e' : o.t.kind === 'habit' ? 'h' : '';

function occRow(o) {
  if (spaceOf(o.t) !== S.space) return taskRow(o.t, { busy: true, mark: '•', markStyle: 'color:var(--muted)', note: 'работа' });
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
    .concat(mySecs().filter(s => !s.paused).map(s => `<button class="pill ${c.hidden.includes(s.id) ? '' : 'on'}" data-act="cal-sec" data-id="${s.id}"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</button>`))
    .concat([`<button class="pill ${c.hidden.includes('none') ? '' : 'on'}" data-act="cal-sec" data-id="none">Без раздела</button>`]);

  const items = dayItems(occ, S.day);
  // события на несколько дней — в «весь день», а не в расписании
  const timed = items.filter(o => o.t.start_time && !(o.t.end_date && o.t.end_date > o.t.due_date));
  const rest = items.filter(o => !timed.includes(o));
  const d = parse(S.day);
  return `<header class="top"><h1>Календарь</h1>
      <div class="seg"><button class="pill ${week ? '' : 'on'}" data-act="cal-mode" data-v="month">Месяц</button><button class="pill ${week ? 'on' : ''}" data-act="cal-mode" data-v="week">Неделя</button></div><div class="tools">${MODE()}${GEAR}</div>
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

// фильтр «Без срока» — только задачи без даты
const noDateOk = t => !S.noDate || (!isEvent(t) && !t.due_date);
const sectionTasks = secId => activeAll().filter(t => (t.section_id || null) === secId && spaceOf(t) === S.space && !eventOver(t) && noDateOk(t)).sort(byPos);

function renderSections() {
  const sel = S.section;
  const count = id => sectionTasks(id).length;
  // слева (на телефоне — строкой сверху): разделы; на них можно бросать задачи
  const item = (id, name, color, n) => `<button class="pill side-item ${sel === id ? 'on' : ''} ${pausedSec(id) ? 'paused' : ''}" data-act="section" data-id="${id || ''}" data-drop-sec="${id || ''}">
      ${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}<span class="name">${esc(name)}</span>${pausedSec(id) ? '<span class="n" title="Раздел выключен">⏸</span>' : n ? `<span class="n">${n}</span>` : ''}</button>`;
  const side = [`<button class="pill side-item ${sel === null ? 'on' : ''}" data-act="section" data-id="">Все<span class="n">${active().filter(t => !eventOver(t) && noDateOk(t)).length}</span></button>`]
    .concat(mySecs().map(s => item(s.id, s.name, s.color, count(s.id))))
    .concat(count(null) ? [item('none', 'Без раздела', null, count(null))] : [])
    .concat(['<button class="pill side-item add" data-act="new-section">+ Раздел</button>'])
    .concat(S.space === 'work' ? ['<button class="pill side-item add tpl-btn" data-act="templates">⟳ Шаблоны</button>'] : []);

  const groups = sel === null
    ? mySecs().map(s => [s.id, s.name, s.color]).concat([[null, 'Без раздела', null]])
    : [[sel === 'none' ? null : sel, ...(sel === 'none' ? ['Без раздела', null] : [sectionOf({ section_id: sel })?.name, sectionOf({ section_id: sel })?.color])]];
  let body = '';
  for (const [id, name, color] of groups) {
    const all = sectionTasks(id);
    // задачи проектов — отдельными блоками с прогрессом вверху раздела
    const projs = S.noDate ? [] : S.projects.filter(p => !p.archived && ((p.section_id || null) === id || all.some(t => t.project_id === p.id)));
    const list = all.filter(t => !projs.some(p => p.id === t.project_id));
    const paused = pausedSec(id);
    if (sel === null && !all.length && !projs.length && (id === null || S.noDate)) continue;
    const head = `<h2 class="group ${paused ? 'paused' : ''}" data-drop-sec="${id || ''}">${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(name || '')}
      ${paused ? '<span class="off">⏸ выключен</span>' : ''}
      ${id ? `<button class="edit-sec" data-act="edit-section" data-id="${id}" title="Изменить раздел">✎</button>` : ''}</h2>`;
    if (paused) {
      // в «Все» задачи выключенного раздела свёрнуты; в самом разделе — видны, но бледные
      body += head + `<div class="paused-note">Задачи этого раздела (${list.length}) скрыты в «Сегодня», календаре и утренней проверке.
        <button class="link" data-act="s-pause" data-id="${id}">▶ Включить раздел</button></div>`;
      if (sel === null) continue;
      body += `<div class="paused-list">${all.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')}</div>`;
      continue;
    }
    body += head + projs.map(p => projectBlock(p, all)).join('') + (list.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')
      || (projs.length ? '' : `<div class="empty small" data-drop-sec="${id || ''}">${S.noDate ? 'Задач без срока нет' : 'Пусто' + (S.pick ? '' : ' — перетащи сюда задачу')}</div>`));
  }
  const tools = S.pick
    ? '<button class="pill" data-act="pick-all">Выбрать все</button>'
    : '<button class="pill" data-act="pick-start">Выбрать</button>';
  const filter = `<button class="pill ${S.noDate ? 'on' : ''}" data-act="nodate" title="Показать только задачи без срока">Без срока</button>`;
  return `<header class="top"><h1>Разделы</h1><div class="tools">${filter}${tools}${MODE()}${GEAR}</div></header>
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

// ---------- план недели (рабочий режим, только компьютер) ----------
const DAY_NORM = 8, DAY_MAX = 11; // часов в день: до 8 — обычно, до 11 — плотно, больше — перегруз
const planOn = () => S.space === 'work' && matchMedia('(min-width: 900px)').matches;
// не сделано в запланированный день — переезжает на сегодня
const planDay = t => (t.plan_date && t.plan_date < today() ? today() : t.plan_date);
const minutes = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const planTasks = () => active().filter(t => !isEvent(t) && t.kind !== 'habit');

// Загрузка дня: встречи (события со временем), запланированные задачи, уже сделанное; сумма часов.
function dayLoad(d, occ) {
  const t0 = today();
  const tasks = planTasks().filter(t => planDay(t) === d).sort(byPos);
  const meets = [...new Map((occ[d] || []).filter(o => isEvent(o.t) && o.t.start_time && o.t.end_time).map(o => [o.t.id, o.t])).values()]
    .sort((a, b) => (a.start_time < b.start_time ? -1 : 1));
  const done = d <= t0 ? [...new Set(S.logs.filter(l => l.status === 'done' && l.done_on === d).map(l => l.task_id))]
    .map(byId).filter(t => t && spaceOf(t) === S.space && t.kind !== 'habit' && !isEvent(t)) : [];
  const h = meets.reduce((s, t) => s + Math.max(0, minutes(t.end_time) - minutes(t.start_time)) / 60, 0)
    + tasks.concat(done).reduce((s, t) => s + (+t.estimate || 0), 0);
  return { tasks, meets, done, h, noEst: tasks.filter(t => !t.estimate).length };
}

const loadCls = h => (h > DAY_MAX ? 'over' : h > DAY_NORM ? 'warn' : '');

function renderPlan() {
  const t0 = today();
  const ws = S.planWeek || weekStart(t0);
  const occ = occurrences(ws, addDays(ws, 6));
  // пн–пт; суббота и воскресенье — только если на них что-то есть
  const days = [...Array(7)].map((_, i) => addDays(ws, i)).filter((d, i) => i < 5 || dayLoad(d, occ).tasks.length || dayLoad(d, occ).meets.length);
  const cols = days.map(d => {
    const L = dayLoad(d, occ);
    const cls = loadCls(L.h);
    const pd = parse(d);
    return `<div class="pcol ${d === t0 ? 'today' : ''} ${d < t0 ? 'past' : ''}" data-pday="${d}">
      <div class="phead"><b>${WD[isodow(d) - 1]}, ${pd.getDate()} ${MONTHS_OF[pd.getMonth()].slice(0, 3)}</b>
        <span class="hours ${cls}" title="Рабочий день ${DAY_NORM} ч, больше ${DAY_MAX} ч — перегруз">${cls === 'over' ? '⚠ ' : ''}${fmtH(L.h)} ч</span></div>
      <div class="pbar ${cls}"><i style="width:${Math.min(100, L.h / DAY_MAX * 100)}%"></i></div>
      ${L.noEst ? `<div class="pnote">без оценки: ${L.noEst}</div>` : ''}
      ${L.meets.map(t => `<div class="meet" data-act="edit" data-id="${t.id}"><span class="time">${timeLabel(t)}</span> ${esc(t.title)}</div>`).join('')}
      ${L.tasks.map(t => taskRow(t, { plan: true, noSection: true, ...(t.plan_date < t0 ? { note: 'план был ' + dateLabel(t.plan_date), noteCls: 'late' } : {}) })).join('')}
      ${L.done.map(t => taskRow(t, { done: true, noSection: true })).join('')}
    </div>`;
  }).join('');
  const free = planTasks().filter(t => !t.plan_date).sort((a, b) => ((a.due_date || '9') < (b.due_date || '9') ? -1 : 1));
  const label = ws === weekStart(t0) ? 'Эта неделя' : `${dateLabel(ws)} — ${dateLabel(addDays(ws, 6))}`;
  return `<header class="top"><h1>План</h1>
      <div class="seg"><button class="pill" data-act="pweek" data-n="-1">‹</button><button class="pill" data-act="pweek" data-n="0">${label}</button><button class="pill" data-act="pweek" data-n="1">›</button></div>
      <div class="tools">${MODE()}${GEAR}</div></header>
    <div class="plan" style="grid-template-columns:repeat(${days.length}, minmax(0, 1fr)) minmax(250px, 1.4fr)">
      ${cols}
      <div class="pcol unplanned" data-pday="">
        <div class="phead"><b>Не распланировано</b><span class="hours">${free.length}</span></div>
        <div class="pnote">Перетащи задачу на день. Обратно сюда — снять план.</div>
        ${free.map(t => taskRow(t, { plan: true, date: true, noSection: true })).join('') || '<div class="empty small">Всё распланировано</div>'}
      </div>
    </div>`;
}

// Перетаскивание карточек «Плана» между днями
let planId = null;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-plan]');
  if (!c) return;
  planId = c.dataset.plan;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', planId);
  c.classList.add('dragging');
});
document.addEventListener('dragend', () => { planId = null; });
document.addEventListener('dragover', e => {
  if (!planId) return;
  const col = e.target.closest('[data-pday]');
  clearDrop();
  if (!col || (col.dataset.pday && col.dataset.pday < today())) return;
  e.preventDefault();
  col.classList.add('drop-in');
});
document.addEventListener('drop', async e => {
  if (!planId) return;
  const col = e.target.closest('[data-pday]');
  const t = byId(planId);
  clearDrop();
  if (!col || !t) return;
  e.preventDefault();
  const d = col.dataset.pday || null;
  if (d && d < today()) return;
  if ((t.plan_date || null) === d) return;
  t.plan_date = d;
  render();
  if (d) {
    const h = dayLoad(d, occurrences(d, d)).h;
    if (h > DAY_MAX) toast(`⚠ ${dateLabel(d)}: ${fmtH(h)} ч — больше ${DAY_MAX}`);
  }
  await call(sb.from('tasks').update({ plan_date: d }).eq('id', t.id));
});

// ---------- привычки: как получалось следовать ----------
// История за год грузится, когда открыта вкладка (в обычной загрузке — только 2 месяца).
async function loadHabitLogs(ids) {
  S.hLogs = [];
  if (!ids.length) return;
  S.hLogs = await call(sb.from('task_log').select('task_id,day,status').in('task_id', ids).gte('day', addDays(today(), -365)).order('id'));
  if (S.view === 'habits') render();
}

// Дни привычки за последние n дней: 'done' / 'missed' / '' (не нужно было или ещё не отмечено)
function habitDays(t, n) {
  const st = {};
  for (const l of (S.hLogs && S.hLogs.length ? S.hLogs : S.logs)) if (l.task_id === t.id && (l.status === 'done' || l.status === 'missed')) st[l.day] = l.status;
  const days = [];
  for (let i = n - 1; i >= 0; i--) { const d = addDays(today(), -i); days.push([d, st[d] || '']); }
  return days;
}

function habitCard(t) {
  const days = habitDays(t, S.hRange);
  const marked = days.filter(([, s]) => s);
  const done = marked.filter(([, s]) => s === 'done').length;
  // серии считаются по отмеченным дням (дни, когда привычка не нужна, не прерывают серию)
  let best = 0, run = 0;
  for (const [, s] of marked) { run = s === 'done' ? run + 1 : 0; best = Math.max(best, run); }
  const pct = marked.length ? Math.round(done / marked.length * 100) : 0;
  const sec = sectionOf(t);
  const fmt = d => `${parse(d).getDate()} ${MONTHS_OF[parse(d).getMonth()]}`;
  return `<div class="hcard"${sec ? ` style="--sec:${esc(sec.color)}"` : ''} data-act="edit" data-id="${t.id}">
    <div class="hhead"><b>${esc(t.title)}</b><span class="tags">${repeatLabel(t) ? '↻ ' + esc(repeatLabel(t)) : ''}${sec ? ' · ' + esc(sec.name) : ''}</span></div>
    ${marked.length ? `<div class="hnums">
      <div><b>${done} из ${marked.length}</b><span>сделано</span></div>
      <div><b class="${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}">${pct}%</b><span>получилось</span></div>
      <div><b>${run}</b><span>подряд сейчас</span></div>
      <div><b>${best}</b><span>лучшая серия</span></div>
      <div><b>${marked.length - done}</b><span>пропусков</span></div>
    </div>` : '<div class="hint">Пока нет отметок за это время.</div>'}
    <div class="hgrid r${S.hRange}">${days.map(([d, s]) => `<i class="${s}" title="${fmt(d)}${s === 'done' ? ' — сделано' : s === 'missed' ? ' — пропущено' : ''}"></i>`).join('')}</div>
  </div>`;
}

function renderHabits() {
  const list = activeAll().filter(t => t.kind === 'habit' && spaceOf(t) === S.space).sort(byPos);
  if (!S.hLogs) loadHabitLogs(list.map(t => t.id));
  const ranges = [[30, '30 дней'], [90, '3 месяца'], [365, 'год']];
  let html = `<header class="top"><h1>Привычки</h1>
    <div class="seg">${ranges.map(([n, l]) => `<button class="pill ${S.hRange === n ? 'on' : ''}" data-act="h-range" data-v="${n}">${l}</button>`).join('')}</div>
    <div class="tools">${MODE()}${GEAR}</div></header>`;
  if (!list.length) return html + '<div class="empty">Привычек пока нет.<br>В окне задачи выбери вид «Привычка».</div>';
  html += '<div class="legend"><i class="done"></i> сделано <i class="missed"></i> пропущено <i></i> не нужно было / ещё не отмечено</div>';
  return html + list.map(habitCard).join('');
}

// ---------- картинки у задач ----------
const DECOR = {
  dust: { icon: '🕸', name: 'Пыль и паутина', hint: 'Пыль и паутина — если задача просрочена на 4 дня и больше (уборка).' },
  meter: { icon: '🔢', name: 'Счётчики', hint: 'Счётчики — когда подошёл срок (или «Начать с»), сбоку появляется картинка «Пора передать показания».' },
};
const DUST_DAYS = 4;

// Паутинка в углу строки задачи
const WEB = `<svg class="web" viewBox="0 0 60 60" aria-hidden="true"><g stroke="#cfd3e6" stroke-width="1" fill="none" opacity=".75">
  <path d="M60 0L4 56M60 0L28 58M60 0L58 4M60 0L46 60M60 0L2 30M60 0L30 2"/>
  <path d="M48 0Q50 10 60 12M36 0Q40 20 60 24M22 0Q30 30 60 38M10 2Q22 40 58 52"/></g>
  <path d="M46 26v8" stroke="#cfd3e6" stroke-width=".8"/><circle cx="46" cy="36" r="2.6" fill="#2a2b36" stroke="#cfd3e6" stroke-width=".6"/></svg>`;

// Насколько запущена уборка: 0 — чисто, 1 — паутина в углу, 2 — паутина в обоих углах и много пыли
function dustLevel() {
  const n = Math.max(0, ...active().filter(t => t.decor === 'dust').map(petLate));
  return n >= DUST_DAYS * 2 ? 2 : n >= DUST_DAYS ? 1 : 0;
}

// Паутина по углам экрана и летающая пыль — свой слой поверх всего, мышку не ловит.
let $dust = null;
function updateDust() {
  const lvl = S.user && S.loaded && S.view !== 'plan' ? dustLevel() : 0;
  if (!$dust) {
    if (!lvl) return;
    $dust = document.createElement('div');
    $dust.id = 'dust';
    document.body.append($dust);
  }
  if ($dust.dataset.lvl === String(lvl)) return;
  $dust.dataset.lvl = lvl;
  const motes = Array.from({ length: lvl === 2 ? 26 : 12 }, () =>
    `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:-${(Math.random() * 14).toFixed(1)}s;animation-duration:${(10 + Math.random() * 8).toFixed(1)}s;--s:${(2 + Math.random() * 3).toFixed(1)}px"></i>`).join('');
  $dust.innerHTML = lvl ? `<svg class="corner r" viewBox="0 0 60 60">${WEB.slice(WEB.indexOf('<g'), -6)}</svg>${lvl === 2 ? `<svg class="corner l" viewBox="0 0 60 60">${WEB.slice(WEB.indexOf('<g'), -6)}</svg>` : ''}${motes}` : '';
}

// Счётчики: подошёл срок — картинка сбоку (на телефоне — вверху «Сегодня»)
// where: 'side' — сбоку на широком экране (на всех вкладках), 'top' — вверху «Сегодня» на остальных экранах
function meterCard(where) {
  const t0 = today();
  const due = active().filter(t => t.decor === 'meter' && !isEvent(t) && ((reviewDay(t) && reviewDay(t) <= t0) || (t.start_date && t.start_date <= t0)));
  if (!due.length || S.view === 'plan') return '';
  return `<aside class="meter-card ${where}">
    ${meterSVG()}
    <div class="meter-text"><b>Пора передать показания!</b>
      ${due.map(t => `<div class="meter-task"><button class="check" data-act="done" data-id="${t.id}" title="Передала">✓</button>
        <button class="link" data-act="edit" data-id="${t.id}">${esc(t.title)}</button></div>`).join('')}</div>
  </aside>`;
}

// Счётчик: окошко с цифрами (последняя крутится), колёсико и стрелка
const meterSVG = () => `<svg class="meter-svg" viewBox="0 0 160 120" aria-hidden="true">
  <rect x="6" y="10" width="148" height="100" rx="16" fill="#3a3d4d" stroke="#5a5f78" stroke-width="2"/>
  <rect x="6" y="10" width="148" height="22" rx="11" fill="#4a4e63"/>
  <text x="80" y="26" text-anchor="middle" fill="#cfd3e6" font-size="11" font-family="sans-serif">м³</text>
  <rect x="18" y="42" width="124" height="30" rx="5" fill="#16161c"/>
  ${[0, 1, 2, 3].map(i => `<rect x="${22 + i * 24}" y="45" width="20" height="24" rx="3" fill="#f2f2f5"/><text x="${32 + i * 24}" y="63" text-anchor="middle" font-size="17" font-weight="700" font-family="monospace" fill="#16161c">${'0472'[i]}</text>`).join('')}
  <rect x="118" y="45" width="20" height="24" rx="3" fill="#e05a5a"/>
  <svg x="118" y="45" width="20" height="24" viewBox="0 0 20 24"><g class="roll">${[8, 9, 0, 1].map((d, i) => `<text x="10" y="${18 + i * 24}" text-anchor="middle" font-size="17" font-weight="700" font-family="monospace" fill="#fff">${d}</text>`).join('')}</g></svg>
  <circle cx="44" cy="92" r="11" fill="#16161c"/><g class="spin-wheel" style="transform-origin:44px 92px"><path d="M44 83v18M35 92h18M38 86l12 12M50 86l-12 12" stroke="#8fb3ff" stroke-width="2.4"/></g>
  <circle cx="116" cy="92" r="11" fill="#f2f2f5"/><path class="needle" d="M116 92l0 -9" stroke="#e05a5a" stroke-width="2.4" stroke-linecap="round" style="transform-origin:116px 92px"/>
  <text x="80" y="97" text-anchor="middle" fill="#9aa1bd" font-size="9" font-family="sans-serif">ГАЗ · ВОДА</text>
</svg>`;

// ---------- питомцы (личный режим, широкий экран) ----------
const PETS = { cat: { icon: '🐱', def: 'Котик' }, bird: { icon: '🦜', def: 'Попугай' } };
const petName = p => S.user?.user_metadata?.pets?.[p] || PETS[p].def;
const MOODS = { happy: 'Доволен', meh: 'Немного грустит', sad: 'Очень грустит', faint: 'В обмороке!' };
const moodOf = n => (n <= 0 ? 'happy' : n === 1 ? 'meh' : n <= 3 ? 'sad' : 'faint');

// Насколько задача запущена: у привычки — сколько раз подряд пропущена,
// у обычной — сколько дней прошло от первоначального срока (утренняя проверка переносит его на сегодня).
function petLate(t) {
  const logs = S.logs.filter(l => l.task_id === t.id);
  let i = logs.length;
  while (i > 0 && logs[i - 1].status !== 'done') i--;
  const tail = logs.slice(i);
  if (t.kind === 'habit') return tail.filter(l => l.status === 'missed').length + (t.due_date && t.due_date < today() ? 1 : 0);
  const moved = tail.find(l => l.status === 'moved');
  const since = moved ? moved.day : t.due_date;
  return since && since < today() ? daysBetween(since, today()) : 0;
}

function petState(p) {
  const late = activeAll().filter(t => t.pet === p && !pausedSec(t.section_id))
    .map(t => [t, petLate(t)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return { mood: moodOf(late.length ? late[0][1] : 0), late };
}

async function renamePet(p) {
  const name = prompt('Как зовут питомца?', petName(p));
  if (name === null || !name.trim()) return;
  const pets = { ...(S.user.user_metadata.pets || {}), [p]: name.trim() };
  const { data, error } = await sb.auth.updateUser({ data: { pets } });
  if (error) return toast('Не получилось сохранить: ' + error.message);
  S.user = data.user;
  render();
}

// Питомцы живут в своём слое позади задач (#pets): при перерисовке экрана анимации не сбрасываются.
const P = { cat: { side: 'left', moving: false, dir: 'right' }, bird: { side: 'right', moving: false } };
const MOVE_MS = { cat: 16000, bird: 3200 };
let $pets = null;
const petsShown = () => !!(S.user && S.loaded && S.space === 'personal' && S.view !== 'plan' && S.tasks.some(t => t.pet));

function updatePets() {
  if (!$pets) {
    if (!petsShown()) return;
    $pets = document.createElement('div');
    $pets.id = 'pets';
    $pets.innerHTML = `<div class="perch left">${perchSVG()}</div><div class="perch right">${perchSVG(true)}</div>
      <aside class="pet cat"></aside><aside class="pet bird"></aside>`;
    document.body.prepend($pets);
    petsLoop();
  }
  $pets.hidden = !petsShown();
  if (!$pets.hidden) Object.keys(PETS).forEach(fillPet);
}

// Перерисовать питомца, только если что-то поменялось (настроение, поза, подписи).
function fillPet(p) {
  const el = $pets.querySelector('.pet.' + p);
  const st = petState(p);
  const pose = P[p].moving ? (p === 'cat' ? 'walk' : 'fly') : st.mood;
  const arrived = P[p].arrived && Date.now() - P[p].arrived < 1500; // только что пришёл — садится
  el.className = `pet ${p} m-${st.mood} ${P[p].side}${P[p].moving ? ' moving' : ''}${arrived ? ' arrived' : ''}`;
  const joy = S.petJoy && S.petJoy.pet === p && Date.now() - S.petJoy.at < 4000 ? S.petJoy.at : 0;
  const why = st.late.slice(0, 3).map(([t, n]) => `<li>${esc(t.title)} — ${t.kind === 'habit' ? `пропущено ${n} р.` : `${n} дн.`}</li>`).join('');
  const sig = JSON.stringify([pose, P[p].dir, petName(p), why, joy]);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const pic = pose === 'walk' ? catWalkSVG(P[p].dir === 'left') : pose === 'fly' ? birdFlySVG() : p === 'cat' ? catSVG(pose) : birdSVG(pose);
  const text = `<button class="pet-name" data-act="pet-name" data-v="${p}" title="Переименовать">${esc(petName(p))}</button>
      <div class="pet-mood">${MOODS[st.mood]}</div>${why ? `<ul class="pet-why">${why}</ul>` : ''}`;
  el.innerHTML = (joy ? '<div class="hearts"><span>♥</span><span>♥</span><span>♥</span></div>' : '')
    + (p === 'cat' ? `<div class="pet-text">${text}</div>${pic}` : pic + `<div class="pet-text">${text}</div>`);
}

// Иногда кот проходит позади задач на другую сторону, а Яша перелетает на другую ветку.
function petsLoop() {
  setTimeout(() => { petMove(); petsLoop(); }, 25000 + Math.random() * 35000);
}

function petMove(p = Math.random() < .5 ? 'cat' : 'bird') {
  if (!$pets || $pets.hidden || document.hidden || P[p].moving) return;
  const mood = petState(p).mood;
  if (mood === 'faint' || mood === 'sad' || (p === 'bird' && mood !== 'happy')) return; // грустным не до прогулок
  const to = P[p].side === 'left' ? 'right' : 'left';
  P[p].moving = true;
  P[p].dir = to;
  fillPet(p);
  void $pets.querySelector('.pet.' + p).offsetWidth; // зафиксировать старое место, чтобы сработал плавный переход
  P[p].side = to;
  fillPet(p);
  setTimeout(() => { P[p].moving = false; P[p].arrived = Date.now(); fillPet(p); }, MOVE_MS[p]);
}

// Глаза: открытые (с морганием), полуприкрытые, грустные со слезой, крестики.
function petEyes(mood, xs, y, iris, lid) {
  if (mood === 'faint') return xs.map(x => `<path d="M${x - 6} ${y - 6}l12 12M${x + 6} ${y - 6}l-12 12" stroke="#9aa1bd" stroke-width="3.5" stroke-linecap="round"/>`).join('');
  const eye = x => iris
    ? `<ellipse cx="${x}" cy="${y}" rx="10" ry="${mood === 'sad' ? 9 : 11}" fill="${iris}"/><ellipse cx="${x}" cy="${y + (mood === 'sad' ? 3 : 1)}" rx="${mood === 'sad' ? 4 : 3}" ry="${mood === 'sad' ? 5 : 8}" fill="#0a0a0a"/><circle cx="${x + 3}" cy="${y - 4}" r="2.2" fill="#fff"/>`
    : `<circle cx="${x}" cy="${y}" r="5" fill="#16161c"/><circle cx="${x + 1.6}" cy="${y - 1.8}" r="1.5" fill="#fff"/>`;
  let s = `<g class="${mood === 'happy' ? 'blink' : ''}">${xs.map(eye).join('')}</g>`;
  const r = iris ? 12 : 6;
  if (mood === 'meh') s += xs.map(x => `<rect x="${x - r}" y="${y - r - 1}" width="${r * 2}" height="${r + 1}" fill="${lid}"/>`).join('');
  if (mood === 'sad') {
    const [a, b] = xs;
    s += `<path d="M${a - 10} ${y - r - 2}L${a + 8} ${y - r - 8}M${b + 10} ${y - r - 2}L${b - 8} ${y - r - 8}" stroke="${iris ? '#6a7090' : '#8a6d20'}" stroke-width="3" stroke-linecap="round"/>`
      + `<path class="tear" d="M${a - 4} ${y + r}q-4 7 0 10q4-3 0-10z" fill="#8fb3ff"/>`;
  }
  return s;
}

const dizzy = (x, y) => `<g class="stars" style="transform-origin:${x}px ${y}px"><text x="${x - 22}" y="${y}" fill="#f2c26b" font-size="14">✦</text><text x="${x + 12}" y="${y - 6}" fill="#f2c26b" font-size="11">✦</text><text x="${x - 4}" y="${y - 16}" fill="#f2c26b" font-size="9">✦</text></g>`;

// Чёрный кот, сидит анфас. В обмороке — лежит на боку.
function catSVG(mood) {
  const sad = mood === 'sad' || mood === 'faint';
  const ears = sad
    ? '<path d="M62 74L34 52L90 56Z" fill="#14141b"/><path d="M64 68L46 56L82 59Z" fill="#d98a9a" opacity=".6"/><path d="M138 74L166 52L110 56Z" fill="#14141b"/><path d="M136 68L154 56L118 59Z" fill="#d98a9a" opacity=".6"/>'
    : '<path d="M62 78L60 28L96 55Z" fill="#14141b"/><path d="M67 68L66 42L87 57Z" fill="#d98a9a" opacity=".7"/><path d="M138 78L140 28L104 55Z" fill="#14141b"/><path d="M133 68L134 42L113 57Z" fill="#d98a9a" opacity=".7"/>';
  const mouth = {
    happy: '<path d="M100 103q-5 6-10 2M100 103q5 6 10 2" stroke="#8a90aa" stroke-width="2" fill="none" stroke-linecap="round"/>',
    meh: '<path d="M93 108h14" stroke="#8a90aa" stroke-width="2" stroke-linecap="round"/>',
    sad: '<path d="M90 112q10-8 20 0" stroke="#8a90aa" stroke-width="2" fill="none" stroke-linecap="round"/>',
    faint: '<path d="M93 106q7 5 14 0" stroke="#8a90aa" stroke-width="2" fill="none"/><ellipse cx="103" cy="111" rx="4" ry="5" fill="#e8909f"/>',
  }[mood];
  const cat = `<path class="${mood === 'happy' ? 'tail' : ''}" d="M138 182C186 178 192 128 172 108C165 100 156 107 163 115C177 131 170 160 136 168Z" fill="#14141b"/>
    <ellipse cx="100" cy="150" rx="48" ry="45" fill="#14141b"/>
    <ellipse cx="100" cy="158" rx="24" ry="28" fill="#1f1f29"/>
    <ellipse cx="80" cy="192" rx="14" ry="8" fill="#1b1b24"/><ellipse cx="120" cy="192" rx="14" ry="8" fill="#1b1b24"/>
    ${ears}
    <ellipse cx="100" cy="85" rx="44" ry="38" fill="#14141b"/>
    ${petEyes(mood, [82, 118], 82, '#cde05a', '#14141b')}
    <path d="M95 97h10l-5 6z" fill="#d98a9a"/>
    ${mouth}
    <path d="M72 100L40 94M72 104L40 106M128 100L160 94M128 104L160 106" stroke="#4a4f63" stroke-width="1.5" stroke-linecap="round"/>`;
  return `<svg class="pet-svg" viewBox="0 0 200 210" aria-hidden="true">
    <ellipse cx="100" cy="198" rx="72" ry="8" fill="#000" opacity=".3"/>
    ${mood === 'faint' ? catLying() + dizzy(56, 112) : `<g class="${mood === 'happy' ? 'breathe' : ''}">${cat}</g>`}
  </svg>`;
}

// Кот в обмороке: лежит пластом, голова на полу, хвост вытянут, язык наружу.
const catLying = () => `<path d="M164 184C182 186 194 184 198 178" stroke="#14141b" stroke-width="12" fill="none" stroke-linecap="round"/>
    <ellipse cx="116" cy="172" rx="60" ry="24" fill="#14141b"/>
    <ellipse cx="150" cy="192" rx="16" ry="6" fill="#1b1b24"/><ellipse cx="96" cy="194" rx="16" ry="6" fill="#1b1b24"/>
    <path d="M34 150L10 140L36 128Z" fill="#14141b"/><path d="M60 128L58 102L80 124Z" fill="#14141b"/>
    <ellipse cx="54" cy="160" rx="36" ry="30" fill="#14141b"/>
    ${petEyes('faint', [42, 66], 154)}
    <path d="M51 170h8l-4 5z" fill="#d98a9a"/>
    <path d="M47 178q8 5 16 0" stroke="#8a90aa" stroke-width="2" fill="none"/><ellipse cx="57" cy="183" rx="4" ry="5" fill="#e8909f"/>
    <path d="M28 172L6 170M80 172L100 168" stroke="#4a4f63" stroke-width="1.5" stroke-linecap="round"/>`;

// Кот идёт (вид сбоку, мордой вправо; left — развернуть влево). Лапы шагают, хвост покачивается.
function catWalkSVG(left) {
  const leg = (x, cls) => `<rect class="leg ${cls}" x="${x}" y="96" width="13" height="46" rx="6.5" fill="#14141b" style="transform-origin:${x + 6.5}px 100px"/>`;
  return `<svg class="pet-svg walk" viewBox="0 0 260 160" aria-hidden="true" style="${left ? 'transform:scaleX(-1)' : ''}">
    <ellipse cx="135" cy="150" rx="95" ry="7" fill="#000" opacity=".3"/>
    <g class="stride">
      <path class="wtail" d="M66 84C34 74 30 34 46 22" stroke="#14141b" stroke-width="11" fill="none" stroke-linecap="round" style="transform-origin:66px 84px"/>
      ${leg(74, 'a')}${leg(94, 'b')}${leg(166, 'b')}${leg(186, 'a')}
      <ellipse cx="132" cy="92" rx="72" ry="32" fill="#14141b"/>
      <path d="M186 52L190 20L210 44Z" fill="#14141b"/><path d="M190 46L192 28L203 42Z" fill="#d98a9a" opacity=".7"/>
      <path d="M212 46L228 18L232 50Z" fill="#14141b"/><path d="M216 44L226 28L228 46Z" fill="#d98a9a" opacity=".7"/>
      <circle cx="208" cy="72" r="30" fill="#14141b"/>
      <g class="blink" style="transform-origin:220px 66px"><ellipse cx="220" cy="66" rx="7" ry="8" fill="#cde05a"/><ellipse cx="222" cy="67" rx="2.2" ry="6" fill="#0a0a0a"/><circle cx="223" cy="63" r="1.6" fill="#fff"/></g>
      <path d="M234 76l3 5h-6z" fill="#d98a9a"/>
      <path d="M232 82L258 76M232 85L258 88" stroke="#4a4f63" stroke-width="1.5" stroke-linecap="round"/>
    </g>
  </svg>`;
}

// Яша в полёте: крылья раскрыты и машут, лапки поджаты.
const birdFlySVG = () => `<svg class="pet-svg fly" viewBox="0 0 200 210" aria-hidden="true">
    <path d="M94 150L90 196L104 196L106 150Z" fill="#7d808d"/>
    <g class="wing l" style="transform-origin:76px 100px"><path d="M76 96Q34 60 6 58Q30 92 86 112Z" fill="#80838f"/><path d="M60 82Q36 70 18 66" stroke="#eef0f4" stroke-width="5" fill="none" stroke-linecap="round"/></g>
    <g class="wing r" style="transform-origin:124px 100px"><path d="M124 96Q166 60 194 58Q170 92 114 112Z" fill="#80838f"/><path d="M140 82Q164 70 182 66" stroke="#eef0f4" stroke-width="5" fill="none" stroke-linecap="round"/></g>
    <ellipse cx="100" cy="115" rx="30" ry="42" fill="#9a9dab"/>
    <ellipse cx="100" cy="125" rx="17" ry="26" fill="#aeb1bd"/>
    <path d="M98 46Q104 22 124 16M94 47Q96 26 112 14M104 46Q116 32 132 30" stroke="#f3d36b" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="100" cy="70" r="28" fill="#f3d36b"/>
    <circle cx="82" cy="80" r="8" fill="#f08a3c"/><circle cx="118" cy="80" r="8" fill="#f08a3c"/>
    ${petEyes('happy', [89, 111], 66, null, '#f3d36b')}
    <path d="M94 76Q100 92 106 76Z" fill="#b8a898"/>
  </svg>`;

// Ветка для Яши (с двух сторон экрана; flip — зеркально)
const perchSVG = flip => `<svg class="pet-svg" viewBox="0 0 200 210" aria-hidden="true" style="${flip ? 'transform:scaleX(-1)' : ''}">
    <path d="M4 170Q60 160 180 164" stroke="#8a6a4a" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M150 164q10-14 24-12M40 166q-6-14 6-22" stroke="#6f8f5a" stroke-width="4" fill="none" stroke-linecap="round"/>
    <ellipse cx="174" cy="150" rx="7" ry="4" fill="#6f8f5a" transform="rotate(-30 174 150)"/><ellipse cx="47" cy="143" rx="6" ry="3.5" fill="#6f8f5a" transform="rotate(60 47 143)"/>
  </svg>`;

// Корелла: серая, жёлтая голова с хохолком, оранжевые щёчки, на жёрдочке. В обмороке — лежит под жёрдочкой.
function birdSVG(mood) {
  const crest = {
    happy: '<path d="M98 46Q92 18 110 4M94 48Q82 24 92 10M104 46Q110 26 126 18" stroke="#f3d36b" stroke-width="6" fill="none" stroke-linecap="round"/>',
    meh: '<path d="M98 45Q104 22 124 16M94 47Q96 26 112 14M104 46Q116 32 132 30" stroke="#f3d36b" stroke-width="6" fill="none" stroke-linecap="round"/>',
    sad: '<path d="M100 44Q118 38 134 46M96 46Q116 32 132 36M104 46Q120 44 132 54" stroke="#e2c45e" stroke-width="6" fill="none" stroke-linecap="round"/>',
    faint: '<path d="M100 44Q118 40 130 52M96 46Q114 36 128 42" stroke="#e2c45e" stroke-width="6" fill="none" stroke-linecap="round"/>',
  }[mood];
  const bird = `<path d="M92 150L84 204L100 204L108 150Z" fill="#7d808d"/>
    <ellipse cx="100" cy="115" rx="32" ry="44" fill="#9a9dab"/>
    <ellipse cx="100" cy="125" rx="18" ry="28" fill="#aeb1bd"/>
    <path d="M70 98Q62 140 92 166Q82 130 84 98Z" fill="#80838f"/><path d="M130 98Q138 140 108 166Q118 130 116 98Z" fill="#80838f"/>
    <path d="M72 108Q70 128 82 144M128 108Q130 128 118 144" stroke="#eef0f4" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M90 154v8M110 154v8" stroke="#c9a9a0" stroke-width="4" stroke-linecap="round"/>
    <g class="${mood === 'happy' ? 'crest' : ''}">${crest}</g>
    <circle cx="100" cy="70" r="28" fill="#f3d36b"/>
    <circle cx="82" cy="80" r="8" fill="#f08a3c"/><circle cx="118" cy="80" r="8" fill="#f08a3c"/>
    ${petEyes(mood, [89, 111], 66, null, '#f3d36b')}
    <path d="M94 76Q100 ${mood === 'faint' ? 88 : 92} 106 76Z" fill="#b8a898"/>`;
  return `<svg class="pet-svg" viewBox="0 0 200 210" aria-hidden="true">
    <ellipse cx="100" cy="202" rx="70" ry="6" fill="#000" opacity=".3"/>
    ${mood === 'faint' ? `<g transform="translate(96 190) rotate(90) scale(.66) translate(-104 -110)">${bird}</g>${dizzy(124, 182)}` : `<g class="${mood === 'happy' ? 'bob' : ''}">${bird}</g>`}
  </svg>`;
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
      <select class="inp" id="b-section">${opt(KEEP, '— не менять —')}${opt('', 'Без раздела')}${mySecs().map(s => opt(s.id, esc(s.name))).join('')}</select></div>
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
const GEAR = '<button class="icon" data-act="help" title="Справка">?</button><button class="icon" data-act="settings" title="Настройки">⚙</button>';

// ---------- справка ----------
const HELP = [
  ['Сегодня', 'Всё, что нужно сделать сегодня: привычки, задачи (и просроченные), события. Кружок — отметить. Нажать на отметку ещё раз — отменить.'],
  ['Новая задача', '«+» внизу. Вид: <b>задача</b>, <b>привычка</b> (вода, зарядка) или <b>событие</b> (встреча, его не отмечают). Можно указать срок, время, повтор, напоминание и раздел.'],
  ['Повтор', 'Каждый день / неделю / месяц / N дней или по дням недели. «От выполнения»: следующий срок считается от дня, когда сделали, а не от старого срока.'],
  ['Утренняя проверка', 'Утром спросит, что сделано из вчерашнего. Несделанная задача переедет на сегодня. У привычки засчитается пропуск.'],
  ['Привычки', 'Вкладка со статистикой: сколько дней из 30 / 3 месяцев / года получилось, серия подряд, лучшая серия, пропуски и квадратики по дням.'],
  ['Календарь', 'Месяц или неделя, фильтры по разделам. Нажми на день: там расписание и свободное время между делами.'],
  ['Разделы', 'Папки для задач. ✎ у раздела: название, цвет, «выключить» на время (задачи прячутся, но не удаляются). «Без срока» вверху — показать только задачи без даты. «Выбрать» меняет сразу несколько задач. На компьютере задачи можно перетаскивать мышкой.'],
  ['Быстрое меню', 'Долгое нажатие на задачу (на компьютере — правая кнопка): на сегодня, на завтра, в другой раздел.'],
  ['🏠 / 💼', 'Личное и работа отдельно, переключатель вверху. В работе есть «Шаблоны»: повторяющиеся проекты из шагов (например, квартальная отчётность), создаются сами.'],
  ['Подпункты', 'В окне задачи «+ Подпункт»: письма, проверки и т.п. Отмечаются прямо под задачей. В шаблоне у шага — «+ подзадача».'],
  ['План (работа, компьютер)', '«Срок» — дедлайн, «План» — день, когда делаешь, и сколько часов займёт. Во вкладке «План» неделя: задачи перетаскиваются по дням, вверху сумма часов вместе со встречами. Больше 8 ч — жёлтым, больше 11 ч — ⚠ красным.'],
  ['Порядок шагов', 'У задачи проекта — «Делать после» (в шаблоне — «после шагов: 1, 2»). Пока те шаги не сделаны, у задачи 🔒 «ждёт: …»; красный — если они запланированы позже. Ничего не запрещается.'],
  ['Питомцы', 'В окне задачи (в личном режиме) — «Питомец». На широком экране по бокам сидят кот и попугай: доволен, если всё сделано, грустит от пропусков, после 4 дней — в обмороке. Нажми на имя, чтобы переименовать.'],
  ['Картинки', 'В окне задачи — «Картинка». 🕸 Пыль и паутина: уборка просрочена на 4+ дня — появляется паутина и летает пыль. 🔢 Счётчики: подошёл срок — вверху «Сегодня» (на компьютере сбоку) картинка «Пора передать показания».'],
  ['⚙ Настройки', 'Уведомления, имя для приветствия, показ выполненных.'],
  ['Устройства', 'Всё хранится в облаке. Входи с той же почтой на телефоне и компьютере. На телефоне: Chrome → ⋮ → «Установить приложение».'],
];

function openHelp(first = false) {
  $modal.dataset.kind = 'help';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet help">
    <h3>${first ? 'Добро пожаловать! Коротко о главном' : 'Справка'}</h3>
    ${HELP.map(([h, t]) => `<div class="help-item"><b>${h}</b><div>${t}</div></div>`).join('')}
    ${first ? '<div class="msg">Эту справку всегда можно открыть снова: «?» вверху.</div>' : ''}
    <div class="actions"><span></span><button class="btn main" data-act="close">Понятно</button></div>
  </div></div>`;
}

// Новому пользователю (ещё ничего нет) справка показывается один раз; отметка — в аккаунте.
function firstHelp() {
  if (S.helpShown || S.user?.user_metadata?.help_seen || S.tasks.length || S.sections.length || $modal.dataset.kind) return;
  S.helpShown = true;
  openHelp(true);
  sb.auth.updateUser({ data: { help_seen: true } }).then(({ data }) => { if (data?.user) S.user = data.user; });
}

function openSettings() {
  $modal.dataset.kind = 'settings';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>Настройки</h3>
    <div class="menu">
      <button class="btn ${S.showDone ? 'on' : ''}" data-act="show-done">${S.showDone ? '✓ ' : ''}Показывать выполненные</button>
      <button class="btn" data-act="set-name">Имя для приветствия: ${userName() ? esc(userName()) : 'не задано'}</button>
      <button class="btn" data-act="import">Загрузить задачи из файла</button>
      <button class="btn" data-act="logout">Выйти из аккаунта</button>
    </div>
    <h2>Уведомления</h2>
    <div id="push-box"><div class="msg">Проверяю…</div></div>
    <div class="actions"><span></span><button class="btn" data-act="close">Закрыть</button></div>
  </div></div>`;
  renderPush();
}

// Имя для приветствия — у каждого своё, хранится в аккаунте (user_metadata), база не нужна.
const userName = () => (S.user?.user_metadata?.name || '').trim();
async function setName() {
  const name = prompt('Как тебя зовут? (для приветствия)', userName());
  if (name === null) return;
  const { data, error } = await sb.auth.updateUser({ data: { name: name.trim() } });
  if (error) return toast('Не получилось сохранить: ' + error.message);
  S.user = data.user;
  openSettings();
}

// ---------- уведомления ----------
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64key = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pushSub() {
  if (!pushOk()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Часть настроек про уведомления: включены ли на этом устройстве + вечернее напоминание.
async function renderPush() {
  const box = document.getElementById('push-box');
  if (!box) return;
  if (!pushOk()) { box.innerHTML = '<div class="msg">Этот браузер не умеет уведомления. На телефоне открой установленное приложение.</div>'; return; }
  const sub = await pushSub();
  const on = sub && Notification.permission === 'granted';
  const { data: pref, error } = await sb.from('prefs').select('*').maybeSingle();
  if (error) { box.innerHTML = '<div class="msg err">База ещё не готова к уведомлениям — нужно запустить 005_push.sql.</div>'; return; }
  const p = pref || { daily_on: true, daily_time: '20:00' };
  const t = hhmm(p.daily_time);
  box.innerHTML = `
    <div class="msg">${on ? '🔔 На этом устройстве уведомления включены.' : Notification.permission === 'denied'
      ? 'Уведомления запрещены в настройках браузера/телефона для этого приложения — разреши их там.' : 'На этом устройстве уведомления выключены.'}</div>
    <div class="menu">
      ${on ? '<button class="btn" data-act="push-test">Прислать проверочное уведомление</button><button class="btn" data-act="push-off">Выключить на этом устройстве</button>'
        : '<button class="btn main" data-act="push-on">Включить уведомления на этом устройстве</button>'}
      <button class="btn ${p.daily_on ? 'on' : ''}" data-act="daily-on">${p.daily_on ? '✓ ' : ''}Вечером напоминать, что не сделано сегодня</button>
    </div>
    <div class="wds remind" style="margin-top:8px;${p.daily_on ? '' : 'display:none'}">
      ${REMIND_TIMES.map(h => `<button class="pill ${h === t ? 'on' : ''}" data-act="daily-time" data-v="${h}">${+h.slice(0, 2)}:00</button>`).join('')}
      <input class="inp ${REMIND_TIMES.includes(t) ? '' : 'on'}" id="daily-time" type="time" value="${t}" title="Своё время">
    </div>`;
  box.dataset.on = p.daily_on ? '1' : '';
  document.getElementById('daily-time').onchange = ev => ev.target.value && savePrefs({ daily_time: ev.target.value });
}

async function savePrefs(row) {
  await call(sb.from('prefs').upsert({ user_id: S.user.id, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...row }));
  renderPush();
}

async function pushOn() {
  if (await Notification.requestPermission() !== 'granted') { renderPush(); return toast('Без разрешения уведомления не придут'); }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(CONFIG.vapid) });
  const j = sub.toJSON();
  await call(sb.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
  await savePrefs({});
  toast('Уведомления включены');
}

async function pushOff() {
  const sub = await pushSub();
  if (sub) {
    await call(sb.from('push_subs').delete().eq('endpoint', sub.endpoint));
    await sub.unsubscribe();
  }
  renderPush();
}

// Проверка всей цепочки: сервер присылает уведомление на это устройство.
async function pushTest() {
  const sub = await pushSub();
  if (!sub) return;
  try {
    const r = await fetch(CONFIG.url + '/functions/v1/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: sub.endpoint }),
    });
    toast(r.ok ? 'Отправлено — уведомление придёт через пару секунд' : 'Сервер ответил ошибкой ' + r.status);
  } catch { toast('Не получилось связаться с сервером — функция notify создана?'); }
}

// ---------- вход ----------
function renderLogin(msg = '', err = false) {
  $modal.innerHTML = '';
  $app.innerHTML = `<div class="login">
    <h1>Задачи</h1>
    <div class="field"><label>Почта</label><input class="inp" id="email" type="email" autocomplete="email"></div>
    <div class="field"><label>Пароль</label><input class="inp" id="pass" type="password" autocomplete="current-password"></div>
    <div class="field"><label>Имя для приветствия (только при регистрации)</label><input class="inp" id="name" autocomplete="given-name"></div>
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
    : await sb.auth.signUp({ email, password, options: { data: { name: document.getElementById('name').value.trim() } } });
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
// Запланированная задача живёт по плану: в проверку попадает, когда прошёл день плана (не дедлайн).
const reviewDay = t => t.plan_date || t.due_date;
function reviewList() {
  const t0 = today();
  return active().filter(t => !isEvent(t) && reviewDay(t) && reviewDay(t) < t0).sort((a, b) => reviewDay(a) < reviewDay(b) ? -1 : 1);
}

function renderReview() {
  const list = reviewList();
  if (!list.length) {
    if ($modal.dataset.kind === 'review') { $modal.innerHTML = ''; $modal.dataset.kind = ''; }
    return;
  }
  const onlyYesterday = list.every(t => reviewDay(t) === addDays(today(), -1));
  $modal.dataset.kind = 'review';
  $modal.innerHTML = `<div class="overlay"><div class="sheet review">
    <h3>Привет${userName() ? ', ' + esc(userName()) : ''}! ${onlyYesterday ? 'Что из вчерашнего получилось сделать?' : 'Что из этого получилось сделать?'}</h3>
    ${list.map(t => `<div class="task ${t.kind === 'habit' ? 'habit' : ''}">
      <div class="body"><div class="title">${esc(t.title)}</div>
        <div class="meta"><span>${t.plan_date ? 'план: ' : ''}${dateLabel(reviewDay(t))}</span><span>${t.kind === 'habit' ? 'привычка' : 'задача'}</span>${t.plan_date && t.due_date ? `<span>дедлайн ${dateLabel(t.due_date)}</span>` : ''}</div></div>
      <div class="yn">
        <button class="btn good" data-act="r-yes" data-id="${t.id}">Сделано</button>
        <button class="btn" data-act="r-no" data-id="${t.id}" title="${t.kind === 'habit' && t.repeat_unit ? 'Засчитать пропуск' : 'Перенести на сегодня'}">Не сделано</button>
      </div></div>`).join('')}
  </div></div>`;
}

// ---------- окно задачи ----------
function openEdit(t) {
  const isNew = !t.id;
  S.edit = { ...t, remind_at_was: t.remind_at, checklist: subsOf(t).map(s => ({ ...s })), had_subs: subsOf(t).length > 0 };
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
    <div class="field" id="f-startdate-box"><label>Начать с (можно не указывать)</label>
      <input class="inp" id="f-startdate" type="date" value="${e.start_date || ''}"></div>
    <div class="field" id="f-plan-box"><label>План: в какой день делаю («Срок» выше — дедлайн)</label>
      <div class="row"><input class="inp" id="f-plan" type="date" value="${e.plan_date || ''}" style="flex:1">
        займёт <input class="inp num" id="f-est" type="number" min="0" step="0.5" value="${e.estimate || ''}" style="max-width:70px"> ч</div></div>
    <div class="field" id="f-end-box"><label>По какое число (если событие на несколько дней)</label>
      <input class="inp" id="f-enddate" type="date" value="${e.end_date || ''}"></div>
    <div class="field"><label>Время (можно не указывать)</label>
      <div class="row">с <input class="inp" id="f-start" type="time" value="${hhmm(e.start_time)}">
        до <input class="inp" id="f-end" type="time" value="${hhmm(e.end_time)}"></div></div>
    <div class="field" id="f-remind-box"><label>Напомнить на телефон (в день срока)</label>
      <div class="wds remind">
        <button class="pill" data-act="remind" data-v="">Нет</button>
        ${REMIND_TIMES.map(h => `<button class="pill" data-act="remind" data-v="${h}">${h.replace(/^0/, '').slice(0, -3)}:00</button>`).join('')}
        <input class="inp" id="f-remind" type="time" title="Своё время" value="${hhmm(e.remind_at)}">
      </div></div>
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
    ${e.project_id && projectTasks(e.project_id).some(x => x.id !== e.id) ? `<div class="field"><label>Делать после (шаги этого проекта)</label>
      <div class="wds after">${projectTasks(e.project_id).filter(x => x.id !== e.id).map(x => `<button class="pill" data-act="after" data-v="${x.id}">${x.done_on ? '✓ ' : ''}${esc(x.title)}</button>`).join('')}</div></div>` : ''}
    <div class="field" id="f-subs-box"><label>Подпункты (письма, проверки и т.п.)</label>
      <div id="f-subs"></div>
      <button class="link" data-act="sub-add">+ Подпункт</button></div>
    ${S.space === 'personal' || e.pet ? `<div class="field" id="f-pet-box"><label>Питомец (грустит, если задача пропущена)</label>
      <div class="row">${[['', 'Нет'], ...Object.keys(PETS).map(p => [p, PETS[p].icon + ' ' + esc(petName(p))])]
        .map(([p, n]) => `<button class="pill" data-act="pet" data-v="${p}">${n}</button>`).join('')}</div></div>` : ''}
    ${S.space === 'personal' || e.decor ? `<div class="field" id="f-decor-box"><label>Картинка</label>
      <div class="row">${[['', 'Нет'], ...Object.entries(DECOR).map(([k, d]) => [k, d.icon + ' ' + d.name])]
        .map(([k, n]) => `<button class="pill" data-act="decor" data-v="${k}">${n}</button>`).join('')}</div>
      <div class="hint">${Object.values(DECOR).map(d => d.icon + ' ' + d.hint).join('<br>')}</div></div>` : ''}
    <div class="field"><label>Раздел</label>
      <select class="inp" id="f-section"><option value="">Без раздела</option>
        ${mySecs().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Заметка</label><textarea class="inp" id="f-notes">${esc(e.notes || '')}</textarea></div>
    <div class="actions">
      ${isNew ? '<span></span>' : '<button class="btn danger" data-act="delete">Удалить</button>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="save">Сохранить</button></div>
    </div>
  </div></div>`;
  document.getElementById('f-unit').value = e.repeat_unit || '';
  document.getElementById('f-section').value = e.section_id || '';
  document.getElementById('f-unit').onchange = ev => { e.repeat_unit = ev.target.value || null; syncEdit(); };
  document.getElementById('f-remind').onchange = ev => { e.remind_at = ev.target.value || null; syncEdit(); };
  renderSubs();
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
  q('[data-act=pet]').forEach(b => b.classList.toggle('on', b.dataset.v === (e.pet || '')));
  q('[data-act=decor]').forEach(b => b.classList.toggle('on', b.dataset.v === (e.decor || '')));
  q('[data-act=after]').forEach(b => b.classList.toggle('on', (e.after_ids || []).includes(b.dataset.v)));
  const rem = hhmm(e.remind_at);
  q('[data-act=remind]').forEach(b => b.classList.toggle('on', b.dataset.v.slice(0, 5) === rem));
  document.getElementById('f-remind').value = rem;
  document.getElementById('f-remind').classList.toggle('on', !!rem && !REMIND_TIMES.some(h => h.startsWith(rem)));
  document.getElementById('f-every-box').style.display = e.repeat_unit ? '' : 'none';
  document.getElementById('f-wd-box').style.display = e.repeat_unit === 'week' ? '' : 'none';
  // у события нет выполнения: «от дня выполнения» не нужно, зато есть «по какое число»
  document.getElementById('f-from-box').style.display = e.repeat_unit && !isEvent(e) ? '' : 'none';
  document.getElementById('f-end-box').style.display = isEvent(e) ? '' : 'none';
  document.getElementById('f-startdate-box').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-nodate').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-date-label').textContent = isEvent(e) ? 'Дата' : 'Срок';
  document.getElementById('f-subs-box').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-plan-box').style.display = planFields(e) ? '' : 'none';
}

// План и оценка часов — у обычных задач рабочего режима
const planFields = e => !isEvent(e) && e.kind !== 'habit' && (S.space === 'work' || (e.id && spaceOf(e) === 'work'));

// Подпункты в окне задачи: галочка, текст, ✕.
function renderSubs() {
  document.getElementById('f-subs').innerHTML = S.edit.checklist.map((s, i) => `<div class="subrow">
      <button class="sub-box ${s.d ? 'on' : ''}" data-act="sub-m" data-v="${i}">${s.d ? '✓' : ''}</button>
      <input class="inp" data-sub="${i}" placeholder="Что сделать" value="${esc(s.t)}">
      <button class="icon small" data-act="sub-del" data-v="${i}" title="Убрать">✕</button>
    </div>`).join('');
}

document.addEventListener('input', ev => {
  const i = ev.target.dataset.sub;
  if (i !== undefined && S.edit) S.edit.checklist[i].t = ev.target.value;
});

// Галочка в окне уже сохранённой задачи сохраняется сразу (даже если окно закроют без «Сохранить»).
async function toggleSubModal(i) {
  const e = S.edit;
  e.checklist[i].d = !e.checklist[i].d;
  renderSubs();
  if (!e.id) return;
  const t = byId(e.id);
  const saved = subsOf(t).map(s => ({ ...s }));
  if (saved[i] && saved[i].t === e.checklist[i].t.trim()) {
    saved[i].d = e.checklist[i].d;
    t.checklist = saved;
    await call(sb.from('tasks').update({ checklist: saved }).eq('id', e.id));
  }
}

function closeModal() {
  S.edit = null;
  S.tpl = null;
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
    start_date: isEvent(e) ? null : document.getElementById('f-startdate').value || null,
    remind_at: document.getElementById('f-remind').value || null,
  };
  // время поменяли — сегодня напомнить заново
  if (hhmm(row.remind_at) !== hhmm(e.remind_at_was)) row.reminded_on = null;
  // пока база не обновлена (005_push.sql), не трогаем новые поля у задач без напоминания
  if (!row.remind_at && !e.remind_at_was) { delete row.remind_at; delete row.reminded_on; }
  if (planFields(e)) {
    row.plan_date = document.getElementById('f-plan').value || null;
    row.estimate = parseFloat(document.getElementById('f-est').value.replace(',', '.')) || null;
  } else if (e.plan_date || e.estimate) { row.plan_date = null; row.estimate = null; }
  if (e.pet || (byId(e.id) || {}).pet) row.pet = e.pet || null;
  if (e.decor || (byId(e.id) || {}).decor) row.decor = e.decor || null; // пока 010 не запущен, у задач без картинки поле не отправляем
  // «делать после» отправляем, только если поменяли
  const wasAfter = (byId(e.id) || {}).after_ids || [];
  const nowAfter = e.after_ids || [];
  if (nowAfter.length !== wasAfter.length || nowAfter.some(x => !wasAfter.includes(x))) row.after_ids = nowAfter.length ? nowAfter : null;
  const subs = isEvent(e) ? [] : cleanSubs(e.checklist);
  if (subs.length || e.had_subs) row.checklist = subs.length ? subs : null;
  const sec = S.sections.find(x => x.id === row.section_id);
  row.space = sec ? spaceOfSec(sec) : e.id ? e.space || S.space : S.space;
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
    ${sec ? `<div class="field"><label>Режим (задачи раздела переедут вместе с ним)</label>
      <select class="inp" id="s-space">${Object.entries(SPACES).map(([k, n]) => `<option value="${k}" ${spaceOfSec(sec) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
    <div class="actions">
      ${sec ? `<div class="row"><button class="btn danger" data-act="s-delete" data-id="${sec.id}">Удалить</button>
        <button class="btn" data-act="s-pause" data-id="${sec.id}" title="${sec.paused ? 'Снова показывать задачи раздела' : 'Временно скрыть задачи раздела, не удаляя'}">${sec.paused ? '▶ Включить' : '⏸ Выключить'}</button></div>` : '<span></span>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="s-save" data-id="${sec?.id || ''}">Сохранить</button></div>
    </div></div></div>`;
  document.getElementById('s-name').focus();
}

async function saveSection(id) {
  const name = document.getElementById('s-name').value.trim();
  if (!name) return toast('Напиши название');
  const color = $modal.querySelector('[data-act=s-color].on').dataset.v;
  if (id) {
    const space = document.getElementById('s-space').value;
    await call(sb.from('sections').update({ name, color, space }).eq('id', id));
    if (space !== S.space) { S.section = null; toast(`Раздел «${name}» теперь в режиме «${SPACES[space]}»`); }
  }
  else {
    const [s] = await call(sb.from('sections').insert({ name, color, position: S.sections.length, space: S.space }).select());
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
  if (!confirm(`Загрузить ${tasks.length} задач и ${newSecs.length} новых разделов?\nЕсли этот файл уже загружали, задачи повторятся.`)) return;
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

// Выключить / включить раздел. При включении устаревшие сроки переносятся вперёд:
// повторяющиеся — на ближайший повтор не раньше сегодня, остальные — на сегодня,
// чтобы утренняя проверка не спрашивала про всё время, пока раздел был выключен.
async function togglePause(id) {
  const sec = S.sections.find(s => s.id === id);
  const paused = !sec.paused;
  await call(sb.from('sections').update({ paused }).eq('id', id));
  if (!paused) {
    const t0 = today();
    const late = S.tasks.filter(t => t.section_id === id && !t.done_on && !isEvent(t) && t.due_date && t.due_date < t0);
    await Promise.all(late.map(t => {
      let d = t.due_date;
      if (!t.repeat_unit) d = t0;
      for (let i = 0; i < 2000 && d < t0; i++) d = nextDue(d, t.repeat_every, t.repeat_unit, t.repeat_weekdays);
      return call(sb.from('tasks').update({ due_date: d }).eq('id', t.id));
    }));
  }
  closeModal();
  await load();
  toast(paused ? `Раздел «${sec.name}» выключен` : `Раздел «${sec.name}» включён`);
}

// ---------- режимы «Личное / Работа» ----------
const SPACES = { personal: '🏠 Личное', work: '💼 Работа' };
const MODE = () => `<button class="pill mode" data-act="space" title="Переключить на «${S.space === 'work' ? 'Личное' : 'Работа'}»">${SPACES[S.space].replace(' ', ' <span class="txt">')}</span></button>`;

function setSpace(space) {
  S.space = space;
  localSet('space', space);
  S.section = null;
  S.pick = null;
  render();
  renderReview();
}

// ---------- проекты и шаблоны (рабочий режим) ----------
const QUARTERS = ['I', 'II', 'III', 'IV'];
const PERIODS = { month: 'Каждый месяц', quarter: 'Каждый квартал', year: 'Каждый год' };

// Последний закончившийся период на дату d: ключ, подпись и последний день.
function lastPeriod(period, d = today()) {
  const t = parse(d);
  let y = t.getFullYear();
  let m = t.getMonth(); // 0–11, текущий месяц
  if (period === 'month') {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    return { key: `${y}-${pad(m + 1)}`, label: `${MONTHS[m]} ${y}`, end: iso(new Date(y, m + 1, 0)), month: m + 1 };
  }
  if (period === 'quarter') {
    let q = Math.floor(m / 3) - 1;
    if (q < 0) { q = 3; y -= 1; }
    return { key: `${y}-Q${q + 1}`, label: `${QUARTERS[q]} кв. ${y}`, end: iso(new Date(y, q * 3 + 3, 0)) };
  }
  return { key: `${y - 1}`, label: `${y - 1} год`, end: `${y - 1}-12-31` };
}

// Число day в n-м месяце после конца периода (31 в 30-дневном месяце → 30).
function dayAfter(end, n, day) {
  const e = parse(end);
  const last = new Date(e.getFullYear(), e.getMonth() + n + 1, 0).getDate();
  return iso(new Date(e.getFullYear(), e.getMonth() + n, Math.min(day, last)));
}

// Создать проект и задачи шаблона за период p. Дубль (с другого устройства) база не пустит.
async function createProject(tpl, p) {
  const sec = S.sections.find(s => s.id === tpl.section_id);
  const { data, error } = await sb.from('projects')
    .insert({ template_id: tpl.id, period: p.key, title: `${tpl.title} — ${p.label}`, section_id: tpl.section_id }).select();
  if (error) {
    if (error.code !== '23505') toast('Ошибка: ' + error.message);
    return false;
  }
  const steps = (tpl.steps || []).filter(s => s.title);
  const rows = steps.map((s, i) => ({
    title: s.title,
    project_id: data[0].id,
    section_id: tpl.section_id,
    space: sec ? sec.space || 'work' : 'work',
    position: i,
    start_date: s.start_day ? dayAfter(p.end, s.month || 1, s.start_day) : null,
    due_date: s.due_day ? dayAfter(p.end, s.month || 1, s.due_day) : null,
    ...(s.subs && s.subs.length ? { checklist: s.subs.map(x => ({ t: x, d: false })) } : {}),
    ...(s.hours ? { estimate: s.hours } : {}),
  }));
  if (rows.length) {
    const made = (await call(sb.from('tasks').insert(rows).select('id,position'))) || [];
    // «после шагов» (номера) → id созданных задач
    const idAt = n => (made.find(x => x.position === n - 1) || {}).id;
    await Promise.all(steps.map((s, i) => [s, idAt(i + 1)]).filter(([s, id]) => id && s.after && s.after.length)
      .map(([s, id]) => call(sb.from('tasks').update({ after_ids: s.after.map(idAt).filter(Boolean) }).eq('id', id))));
  }
  // ручное создание за старый период не должно откатывать автосоздание назад
  if (!tpl.last_period || p.key > tpl.last_period) await call(sb.from('templates').update({ last_period: p.key }).eq('id', tpl.id));
  return true;
}

// Новый период закончился (или закончится через lead_days рабочих дней) — создать задачи по шаблонам
// (только за последний период, без «догонки»).
const periodFor = tpl => lastPeriod(tpl.period, addWorkDays(today(), tpl.lead_days || 0));
let generating = false;
async function autoGenerate() {
  if (generating) return false;
  generating = true;
  let made = false;
  try {
    for (const tpl of S.templates) {
      if (!tpl.last_period) continue; // первый раз создаётся вручную при сохранении шаблона
      const p = periodFor(tpl);
      if (tpl.period === 'month' && tpl.months && tpl.months.length && !tpl.months.includes(p.month)) continue;
      if (tpl.last_period >= p.key) continue;
      if (await createProject(tpl, p)) made = true;
    }
  } finally { generating = false; }
  return made;
}

const projectTasks = id => S.tasks.filter(t => t.project_id === id).sort(byPos);

// Проект внутри раздела: заголовок с прогрессом и ближайшим сроком, под ним невыполненные шаги.
function projectBlock(p, inSection) {
  const steps = projectTasks(p.id);
  const done = steps.filter(t => t.done_on).length;
  const left = steps.filter(t => !t.done_on && t.due_date).map(t => t.due_date).sort()[0];
  const days = left ? daysBetween(today(), left) : null;
  const pct = steps.length ? Math.round(done / steps.length * 100) : 0;
  const open = inSection.filter(t => t.project_id === p.id);
  return `<div class="project">
    <div class="p-head">
      <b>${esc(p.title)}</b>
      <span class="p-meta">${done} из ${steps.length}${left ? ` · ближайший срок ${dateLabel(left)}${days < 0 ? ' <span class="late">просрочено</span>' : days <= 2 ? ` <span class="warn">через ${days} дн.</span>` : ''}` : ''}</span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${open.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')}
    ${!open.length ? `<button class="link" data-act="p-archive" data-id="${p.id}">${steps.length && done === steps.length ? 'Всё готово — убрать в архив' : 'Убрать в архив'}</button>` : ''}
  </div>`;
}

// Список шаблонов
function openTemplates() {
  $modal.dataset.kind = 'templates';
  const rows = S.templates.map(t => `<button class="btn tpl-row" data-act="tpl-edit" data-id="${t.id}">
      <b>${esc(t.title)}</b><span>${PERIODS[t.period]}${t.period === 'month' && t.months && t.months.length ? ': ' + t.months.map(m => MONTHS[m - 1].slice(0, 3)).join(', ') : ''} · шагов: ${(t.steps || []).length}</span></button>`).join('');
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet">
    <h3>Шаблоны</h3>
    <div class="msg" style="margin:-6px 0 12px">Шаблон сам создаёт проект с задачами, когда заканчивается месяц, квартал или год (можно заранее — за несколько рабочих дней). Проект появляется в «Разделах», в разделе шаблона. Сроки шагов — числа месяца после конца периода.</div>
    <h2>Мои шаблоны</h2>
    <div class="menu">${rows || '<div class="empty small">Шаблонов пока нет</div>'}</div>
    <h2>Новый шаблон</h2>
    <div class="row">
      <button class="btn" data-act="tpl-new">С нуля</button>
      <button class="btn" data-act="tpl-example" data-v="report">Квартальная отчётность</button>
      <button class="btn" data-act="tpl-example" data-v="monthly">Ежемесячные дела</button>
    </div>
    <div class="actions"><span></span><button class="btn" data-act="close">Закрыть</button></div>
  </div></div>`;
}

const EXAMPLES = {
  report: {
    title: 'Квартальная отчётность', period: 'quarter', months: [], lead_days: 3, steps: [
      { title: 'Кеш фло', due_day: 12, month: 1 },
      { title: 'Аренда по МСФЗ 16', due_day: 12, month: 1 },
      { title: 'Снять базу, посчитать ОКЗ', start_day: 12, due_day: 20, month: 1 },
      { title: 'Авансы и обесценение', start_day: 13, due_day: 20, month: 1 },
      { title: 'Залить в базу ОКЗ и аренду', due_day: 20, month: 1, after: [2, 3] },
      { title: 'Подготовить отчётность', due_day: 25, month: 1, after: [1, 4, 5] },
      { title: 'Проверить и подать отчётность', due_day: 30, month: 1, after: [6] },
    ],
  },
  monthly: {
    title: 'Ежемесячные дела', period: 'month', months: [], lead_days: 3, steps: [
      { title: 'Оценка урожая на дату сбора', start_day: 10, month: 1 },
    ],
  },
};

// Окно шаблона. Шаги редактируются прямо в таблице.
function openTemplate(tpl) {
  const t = JSON.parse(JSON.stringify(tpl));
  t.steps = t.steps && t.steps.length ? t.steps : [{ title: '', month: 1 }];
  t.months = t.months || [];
  if (t.lead_days == null) t.lead_days = t.id ? 0 : 3;
  S.tpl = t;
  $modal.dataset.kind = 'template';
  const work = secsOf('work');
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet wide">
    <h3>${t.id ? 'Шаблон' : 'Новый шаблон'}</h3>
    <div class="field"><input class="inp" id="t-title" placeholder="Название, например «Квартальная отчётность»" value="${esc(t.title || '')}"></div>
    <div class="field seg">${Object.entries(PERIODS).map(([k, n]) => `<button class="pill" data-act="t-period" data-v="${k}">${n}</button>`).join('')}</div>
    <div class="field" id="t-months-box"><label>В какие месяцы (по месяцу, за который считаем; не выбрано — каждый месяц)</label>
      <div class="wds months">${MONTHS.map((m, i) => `<button class="pill" data-act="t-month" data-v="${i + 1}">${m.slice(0, 3)}</button>`).join('')}</div></div>
    <div class="field"><label>Создавать заранее</label>
      <div class="row">за <input class="inp num" id="t-lead" type="number" min="0" max="20" value="${t.lead_days}" style="max-width:70px"> рабочих дн. до конца периода (0 — на следующий день после конца)</div></div>
    <div class="field"><label>Раздел для задач</label>
      <select class="inp" id="t-section"><option value="">Без раздела</option>${work.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Шаги: «с» и «до» — числа месяца; «мес.» — какой по счёту месяц после конца периода (1 — следующий). У шага могут быть подзадачи — без своих сроков.</label>
      <div id="t-steps"></div>
      <button class="link" data-act="t-add">+ Шаг</button></div>
    ${t.id ? `<div class="field"><label>Создать задачи вручную (если не хочешь ждать конца периода)</label>
      <div class="row"><select class="inp" id="t-run" style="flex:1">${periodChoices(t.period).map(p => `<option value="${p.key}">${p.label}</option>`).join('')}</select>
      <button class="btn" data-act="t-run">Создать задачи</button></div></div>
      <div class="field"><button class="link" data-act="t-copy">Сделать копию шаблона (например, для годовой отчётности)</button></div>` : ''}
    <div class="actions">
      ${t.id ? '<button class="btn danger" data-act="t-delete">Удалить</button>' : '<span></span>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="t-save">Сохранить</button></div>
    </div>
  </div></div>`;
  document.getElementById('t-section').value = t.section_id || (work[0] && !t.id ? work[0].id : '');
  renderSteps();
  syncTemplate();
}

function renderSteps() {
  const num = (i, k, ph) => `<input class="inp num" type="number" min="1" max="31" data-step="${i}" data-k="${k}" placeholder="${ph}" value="${S.tpl.steps[i][k] || ''}">`;
  document.getElementById('t-steps').innerHTML = '<div class="step head"><span>№</span><span>Шаг</span><span>с</span><span>до</span><span>мес.</span><span>часов</span><span></span></div>'
    + S.tpl.steps.map((s, i) => `<div class="step">
      <span class="step-n">${i + 1}</span>
      <input class="inp" data-step="${i}" data-k="title" placeholder="Что сделать" value="${esc(s.title || '')}">
      ${num(i, 'start_day', 'с')}${num(i, 'due_day', 'до')}
      <input class="inp num" type="number" min="1" max="12" data-step="${i}" data-k="month" title="Месяц после конца периода" value="${s.month || 1}">
      <input class="inp num" type="number" min="0" step="0.5" data-step="${i}" data-k="hours" title="Сколько примерно часов займёт" placeholder="ч" value="${s.hours || ''}">
      <button class="icon small" data-act="t-del-step" data-v="${i}" title="Убрать шаг">✕</button>
    </div>
    <div class="t-subs">${(s.subs || []).map((x, j) => `<div class="subrow">
        <span class="sub-dash">└</span>
        <input class="inp" data-tstep="${i}" data-tsub="${j}" placeholder="Подзадача" value="${esc(x)}">
        <button class="icon small" data-act="t-del-sub" data-v="${i}:${j}" title="Убрать">✕</button>
      </div>`).join('')}
      <div class="row t-after"><button class="link small" data-act="t-add-sub" data-v="${i}">+ подзадача</button>
        <label>после шагов <input class="inp" data-step="${i}" data-k="after" placeholder="напр. 1, 2" value="${(s.after || []).join(', ')}"></label></div></div>`).join('');
}

function syncTemplate() {
  const t = S.tpl;
  $modal.querySelectorAll('[data-act=t-period]').forEach(b => b.classList.toggle('on', b.dataset.v === t.period));
  $modal.querySelectorAll('[data-act=t-month]').forEach(b => b.classList.toggle('on', t.months.includes(+b.dataset.v)));
  document.getElementById('t-months-box').style.display = t.period === 'month' ? '' : 'none';
}

// Поля шагов сохраняются в S.tpl при вводе.
document.addEventListener('input', ev => {
  if (ev.target.dataset.tsub !== undefined && S.tpl) {
    S.tpl.steps[ev.target.dataset.tstep].subs[ev.target.dataset.tsub] = ev.target.value;
    return;
  }
  const i = ev.target.dataset.step;
  if (i === undefined || !S.tpl) return;
  const k = ev.target.dataset.k;
  if (k === 'after') {
    S.tpl.steps[i].after = [...new Set(ev.target.value.split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n !== +i + 1))];
    return;
  }
  S.tpl.steps[i][k] = k === 'title' ? ev.target.value : k === 'hours' ? parseFloat(ev.target.value) || null : parseInt(ev.target.value) || null;
});

// silent — только сохранить и вернуть шаблон (для «Создать задачи»), без вопросов и закрытия окна
async function saveTemplate(silent = false) {
  const t = S.tpl;
  const title = document.getElementById('t-title').value.trim();
  if (!title) return toast('Напиши название шаблона');
  const row = {
    title,
    period: t.period,
    months: t.period === 'month' && t.months.length ? [...t.months].sort((a, b) => a - b) : null,
    section_id: document.getElementById('t-section').value || null,
    steps: t.steps.filter(s => s.title && s.title.trim()).map((s, _, all) => ({
      title: s.title.trim(), start_day: s.start_day || null, due_day: s.due_day || null, month: s.month || 1,
      subs: (s.subs || []).map(x => x.trim()).filter(Boolean),
      hours: s.hours || null,
      after: (s.after || []).filter(n => n <= all.length),
    })),
    lead_days: Math.max(0, parseInt(document.getElementById('t-lead').value) || 0),
  };
  let tpl;
  if (t.id) [tpl] = await call(sb.from('templates').update(row).eq('id', t.id).select());
  else [tpl] = await call(sb.from('templates').insert(row).select());
  if (silent) return tpl;
  if (!t.id) {
    // за уже закончившийся период — спросить; дальше шаблон работает сам
    const p = periodFor(tpl);
    const fits = tpl.period !== 'month' || !tpl.months || !tpl.months.length || tpl.months.includes(p.month);
    if (fits && confirm(`Создать задачи сейчас — за ${p.label}?\nДальше шаблон будет создавать их сам, когда закончится следующий период.`)) await createProject(tpl, p);
    else await call(sb.from('templates').update({ last_period: p.key }).eq('id', tpl.id));
  }
  S.tpl = null;
  closeModal();
  await load();
}

// Периоды на выбор для ручного создания: позапрошлый, прошлый, текущий.
function periodChoices(period) {
  const p0 = lastPeriod(period);
  const step = { month: 1, quarter: 3, year: 12 }[period];
  return [lastPeriod(period, p0.end), p0, lastPeriod(period, addMonths(today(), step))];
}

// Сохранить шаблон (без закрытия) и создать задачи за выбранный период.
async function runTemplate() {
  const t = S.tpl;
  const p = periodChoices(t.period).find(x => x.key === document.getElementById('t-run').value);
  if (S.projects.some(x => x.template_id === t.id && x.period === p.key)
    || !confirm(`Создать задачи за ${p.label}? Сначала шаблон сохранится.`)) {
    if (S.projects.some(x => x.template_id === t.id && x.period === p.key)) toast(`За ${p.label} задачи уже созданы`);
    return;
  }
  const tpl = await saveTemplate(true);
  if (!tpl) return;
  if (await createProject(tpl, p)) toast(`Создано: ${tpl.title} — ${p.label}`);
  else toast(`За ${p.label} задачи уже созданы`);
  closeModal();
  await load();
}

async function deleteTemplate() {
  if (!confirm('Удалить шаблон? Уже созданные проекты и задачи останутся.')) return;
  await call(sb.from('templates').delete().eq('id', S.tpl.id));
  S.tpl = null;
  closeModal();
  await load();
}

// ---------- нажатия ----------
const byId = id => S.tasks.find(t => t.id === id);
const BUSY = new Set(['t-save', 't-run', 't-delete', 'p-archive', 's-pause', 'login', 'signup', 'done', 'undo', 'save', 'delete', 's-save', 's-delete', 'r-yes', 'r-no', 'bulk-save', 'bulk-delete']);

// ---------- быстрое меню (правая кнопка мыши / долгое нажатие на телефоне) ----------
const $ctx = document.createElement('div');
$ctx.id = 'ctx';
document.body.appendChild($ctx);
const hideCtx = () => $ctx.classList.remove('show');

function openCtx(t, x, y) {
  const t0 = today();
  const t1 = addDays(t0, 1);
  const item = (v, text, on) => `<button data-act="cm" data-id="${t.id}" data-v="${v}" class="${on ? 'on' : ''}">${text}</button>`;
  const secs = mySecs().filter(s => !s.paused).map(s => [s.id, s.name, s.color]).concat([['', 'Без раздела', null]]);
  $ctx.innerHTML = `<div class="ctx-title">${esc(t.title)}</div>`
    + item('d:' + t0, 'На сегодня', t.due_date === t0)
    + item('d:' + t1, 'На завтра', t.due_date === t1)
    + (t.repeat_unit ? '' : item('d:', 'Без срока', !t.due_date))
    + '<div class="ctx-sep">В раздел</div>'
    + secs.map(([id, name, color]) => item('s:' + id, `${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(name)}`, (t.section_id || '') === id)).join('')
    + '<hr>'
    + `<button data-act="cm-edit" data-id="${t.id}">Изменить…</button>`;
  $ctx.classList.add('show');
  // не вылезать за край экрана
  const w = $ctx.offsetWidth, h = $ctx.offsetHeight;
  $ctx.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  $ctx.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
}

// Поменять срок (d:ГГГГ-ММ-ДД, d: — без срока) или раздел (s:id, s: — без раздела); с «Отменить».
async function quick(t, v) {
  const [k, val] = [v.slice(0, 2), v.slice(2) || null];
  const row = k === 'd:' ? { due_date: val } : { section_id: val, space: S.space };
  const old = Object.fromEntries(Object.keys(row).map(f => [f, t[f] ?? null]));
  if (Object.keys(row).every(f => old[f] === row[f])) return;
  await call(sb.from('tasks').update(row).eq('id', t.id));
  await load();
  const sec = k === 's:' && S.sections.find(s => s.id === val);
  toast(k === 'd:' ? (val ? `Срок: ${dateLabel(val)}` : 'Без срока') : `В раздел «${sec ? sec.name : 'Без раздела'}»`,
    async () => { await call(sb.from('tasks').update(old).eq('id', t.id)); await load(); });
}

document.addEventListener('contextmenu', ev => {
  const el = ev.target.closest('.task [data-id]');
  const t = el && byId(el.dataset.id);
  if (!t || S.pick || $modal.dataset.kind) return;
  ev.preventDefault();
  openCtx(t, ev.clientX, ev.clientY);
});
addEventListener('scroll', hideCtx, { passive: true });
addEventListener('resize', hideCtx);

// где нажали кнопку мыши: окно закрывается, только если и нажали, и отпустили на фоне
let downAt = null;
document.addEventListener('pointerdown', ev => { downAt = ev.target; });

document.addEventListener('click', async ev => {
  if (!ev.target.closest('#ctx')) hideCtx();
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const v = el.dataset.v;
  // щелчок внутри окна, а не по фону; и не выделение текста, отпущенное за краем окна
  if (act === 'close-bg' && (ev.target !== el || downAt !== el)) return;
  if (BUSY.has(act)) el.disabled = true; // от двойного нажатия, пока ждём базу
  try {
    switch (act) {
      case 'login': case 'signup': await auth(act); break;
      case 'logout': closeModal(); await sb.auth.signOut(); break;
      case 'set-name': await setName(); break;
      case 'settings': openSettings(); break;
      case 'help': openHelp(); break;
      case 'show-done': S.showDone = !S.showDone; localSet('done', S.showDone ? '1' : ''); openSettings(); render(); break;
      case 'push-on': await pushOn(); break;
      case 'push-off': await pushOff(); break;
      case 'push-test': await pushTest(); break;
      case 'daily-on': await savePrefs({ daily_on: !document.getElementById('push-box').dataset.on }); break;
      case 'daily-time': await savePrefs({ daily_time: v }); break;
      case 'cm': hideCtx(); await quick(byId(id), v); break;
      case 'cm-edit': hideCtx(); openEdit(byId(id)); break;
      case 'space': setSpace(S.space === 'work' ? 'personal' : 'work'); break;
      case 'templates': openTemplates(); break;
      case 'tpl-new': openTemplate({ period: 'quarter', months: [], steps: [] }); break;
      case 'tpl-edit': openTemplate(S.templates.find(t => t.id === id)); break;
      case 'tpl-example': openTemplate(EXAMPLES[v]); break;
      case 't-period': S.tpl.period = v; syncTemplate(); break;
      case 't-month': S.tpl.months = S.tpl.months.includes(+v) ? S.tpl.months.filter(m => m !== +v) : S.tpl.months.concat(+v); syncTemplate(); break;
      case 't-add': S.tpl.steps.push({ title: '', month: 1 }); renderSteps(); break;
      case 't-del-step': {
        // номера в «после шагов» сдвигаются вместе со шагами
        const n = +v + 1;
        S.tpl.steps.splice(+v, 1);
        S.tpl.steps.forEach(s => { if (s.after) s.after = s.after.filter(x => x !== n).map(x => (x > n ? x - 1 : x)); });
        renderSteps();
        break;
      }
      case 't-save': await saveTemplate(); break;
      case 't-delete': await deleteTemplate(); break;
      case 't-run': await runTemplate(); break;
      case 't-copy': {
        const { id: _, last_period: __, ...rest } = S.tpl;
        openTemplate({ ...rest, title: (document.getElementById('t-title').value.trim() || rest.title) + ' (копия)', section_id: document.getElementById('t-section').value || null });
        break;
      }
      case 'p-archive': await call(sb.from('projects').update({ archived: true }).eq('id', id)); await load(); break;
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
      case 'nodate': S.noDate = !S.noDate; localSet('nodate', S.noDate ? '1' : ''); render(); break;
      case 'h-range': S.hRange = +v; localSet('hrange', v); render(); break;
      case 'decor': S.edit.decor = v || null; syncEdit(); break;
      case 'view': S.view = v; S.pick = null; localSet('view', v); render(); scrollTo(0, 0); break;
      case 'done': el.classList.add('ok'); await complete(byId(id)); break;
      case 'undo': await undo(byId(id)); break;
      case 'sub': await toggleSub(byId(id), +v); break;
      case 'pweek': S.planWeek = +el.dataset.n ? addDays(S.planWeek || weekStart(today()), 7 * el.dataset.n) : null; render(); break;
      case 'sub-m': await toggleSubModal(+v); break;
      case 'sub-add':
        S.edit.checklist.push({ t: '', d: false });
        renderSubs();
        $modal.querySelector(`[data-sub="${S.edit.checklist.length - 1}"]`).focus();
        break;
      case 'sub-del': S.edit.checklist.splice(+v, 1); renderSubs(); break;
      case 't-add-sub': (S.tpl.steps[+v].subs ||= []).push(''); renderSteps(); break;
      case 't-del-sub': { const [i, j] = v.split(':').map(Number); S.tpl.steps[i].subs.splice(j, 1); renderSteps(); break; }
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
      case 'pet': S.edit.pet = v || null; syncEdit(); break;
      case 'pet-name': await renamePet(v); break;
      case 'after': {
        const set = new Set(S.edit.after_ids || []);
        set.has(v) ? set.delete(v) : set.add(v);
        S.edit.after_ids = [...set];
        syncEdit();
        break;
      }
      case 'remind': S.edit.remind_at = v || null; syncEdit(); break;
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
      case 'section': S.section = id || null; render(); scrollTo(0, 0); break;
      case 'new-section': openSection(null); break;
      case 'edit-section': openSection(S.sections.find(s => s.id === id)); break;
      case 's-color': $modal.querySelectorAll('[data-act=s-color]').forEach(b => b.classList.toggle('on', b === el)); break;
      case 's-save': await saveSection(id); break;
      case 's-delete': await deleteSection(id); break;
      case 's-pause': await togglePause(id); break;
      case 'import': closeModal(); document.getElementById('import-file').click(); break;
      case 'r-yes': { const t = byId(id); await call(sb.rpc('complete_task', { p_task: id, p_done_on: reviewDay(t) })); await resetRepeat(t); await load(); break; }
      // запланированная задача: «не сделано» переносит план на сегодня, дедлайн не трогаем
      case 'r-no':
        if (byId(id).plan_date) await call(sb.from('tasks').update({ plan_date: today() }).eq('id', id));
        else await call(sb.rpc('miss_task', { p_task: id, p_today: today() }));
        await load();
        break;
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
  if (ev.key === 'Escape') hideCtx();
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
