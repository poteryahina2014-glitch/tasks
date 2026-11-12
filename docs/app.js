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
  bg: localGet('bg') !== '0', // вид за окном на фоне
  noDate: localGet('nodate') === '1', // «Разделы»: только задачи без срока
  sizes: (localGet('sizes') || '').split(',').filter(Boolean), // «Разделы»: показать только эти размеры (пусто — все)
  hRange: +localGet('hrange') || 30,
  tRange: +localGet('trange') || 30,  // «Время»: за сколько дней  // «Привычки»: за сколько дней статистика
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

// Цикл «on дней делать, off пропускать» от первого дня anchor (то же, что next_cycle в базе).
function cycleOn(d, on, off, anchor) {
  const len = on + off;
  return ((daysBetween(anchor, d) % len) + len) % len < on;
}
function nextCycle(from, on, off, anchor) {
  let d = addDays(from, 1);
  for (let i = 0; i < on + off && !cycleOn(d, on, off, anchor); i++) d = addDays(d, 1);
  return d;
}
// Следующий срок задачи после d, с любым видом повтора.
const nextOf = (t, d) => t.repeat_unit === 'cycle'
  ? nextCycle(d, t.repeat_every || 1, t.repeat_off || 1, t.repeat_anchor || d)
  : nextDue(d, t.repeat_every, t.repeat_unit, t.repeat_weekdays);

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
  if (u === 'cycle') return `цикл: ${n} дн. да, ${t.repeat_off || 1} нет`;
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
// Спит: случай (☀) или задача «Следом», пока её не разбудили (нет срока). Нигде не видна, кроме окна главной задачи.
const asleep = t => t.kind === 'occasion' || (!!t.wake_after && !t.due_date);
const activeAll = () => S.tasks.filter(t => !t.done_on && !asleep(t));
// Режим: раздел относится к личному или рабочему; задача без раздела — по своему полю space.
const spaceOfSec = sec => (sec && sec.space) || 'personal';
const spaceOf = t => {
  const sec = t.section_id && S.sections.find(x => x.id === t.section_id);
  return sec ? spaceOfSec(sec) : t.space || 'personal';
};
const secsOf = space => S.sections.filter(x => spaceOfSec(x) === space);
const mySecs = () => secsOf(S.space);
// «тихая» задача (картинка «Книги»): в списках, утренней проверке, календаре и погоде её нет — только книги на подоконнике
const quiet = t => t.decor === 'books';
const active = () => activeAll().filter(t => !quiet(t) && !pausedSec(t.section_id) && spaceOf(t) === S.space);
const booksNow = () => activeAll().filter(t => quiet(t) && t.due_date && t.due_date <= today() && !pausedSec(t.section_id) && spaceOf(t) === S.space);
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
  for (let i = 0; i < 2000 && d < today(); i++) d = nextOf(t, d);
  return d;
}

// Сколько засчитано за отметку: сделано — 1, частично (часть подпунктов) — доля, пропуск — 0.
const logVal = l => l.status === 'done' ? 1 : +l.part || 0;
const isPart = l => l.status === 'missed' && +l.part > 0;
const num1 = x => String(Math.round(x * 100) / 100).replace('.', ',');
// квадратик дня: класс и (для частичного) заливка по доле
const dayCell = (s, p, extra = '') => s === 'part'
  ? `<i class="part" style="--p:${Math.round(p * 100)}%"${extra}></i>`
  : `<i class="${s}"${extra}></i>`;

// Статистика привычки за последние 30 дней (до вчера включительно + сегодня, если уже отмечено).
function habitStats(t) {
  const days = habitDays(t, 30, S.logs);
  const marked = days.filter(([, s]) => s);
  return { done: num1(marked.reduce((a, [, , p]) => a + p, 0)), total: marked.length, days };
}

// ---------- данные ----------
async function load() {
  const since = addDays(today(), -62);
  const monthFrom = S.month && S.month < since ? S.month : since;
  const [tasks, sections, logs, templates, projects, times] = await Promise.all([
    call(sb.from('tasks').select('*').or(`done_on.is.null,done_on.gte.${monthFrom},project_id.not.is.null`).order('position').order('created_at')),
    call(sb.from('sections').select('*').order('position').order('created_at')),
    call(sb.from('task_log').select('*').gte('day', monthFrom).order('id')),
    call(sb.from('templates').select('*').order('created_at')),
    call(sb.from('projects').select('*').order('created_at', { ascending: false })),
    // фактическое время (017_time.sql); пока таблицы нет — просто пусто, без ошибки
    sb.from('time_log').select('*').gte('day', addDays(today(), -400)).order('day').then(r => (r.error ? null : r.data)),
  ]);
  S.tasks = tasks;
  S.sections = sections;
  S.logs = logs;
  S.templates = templates;
  S.allProjects = projects; // с архивными — для статистики шаблонов
  S.projects = projects.filter(p => !p.archived);
  S.times = times || [];
  S.timeOn = !!times;
  S.loaded = true;
  S.hLogs = null;
  if (await autoGenerate()) return load(); // закончился период — шаблоны создали задачи
  await ideaExpire().catch(() => { });
  render();
  renderReview();
  if (S.offer && ($modal.dataset.kind === 'offer' || S.offer.hidden)) renderOffer(); // окно предложений открыто — обновить список
  firstHelp();
  maybeOffer();
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

// Задачи «Следом» просыпаются: срок — сегодня (даже если главную отметили за вчера), висят, пока не сделаны.
async function wakeKids(t) {
  const n = S.tasks.filter(x => x.wake_after === t.id && !x.due_date && !x.done_on).length;
  if (n) await call(sb.from('tasks').update({ due_date: today() }).eq('wake_after', t.id).is('due_date', null).is('done_on', null));
  return n;
}
// Отметку главной задачи отменили — разбуженные сегодня снова засыпают.
async function sleepKids(t) {
  if (S.tasks.some(x => x.wake_after === t.id && x.due_date === today()))
    await call(sb.from('tasks').update({ due_date: null }).eq('wake_after', t.id).eq('due_date', today()));
}

async function complete(t, doneOn = today()) {
  await call(sb.rpc('complete_task', { p_task: t.id, p_done_on: doneOn }));
  await resetRepeat(t);
  const woke = await wakeKids(t);
  if (t.pet) S.petJoy = { pets: petsOf(t), at: Date.now() }; // питомцы радуются — сердечки
  await load();
  const next = S.tasks.find(x => x.id === t.id);
  let msg = next && !next.done_on && next.due_date ? `Готово! Следующий раз: ${dateLabel(next.due_date)}` : 'Готово!';
  if (woke) msg += ` На сегодня добавлено: ${woke}`;
  toast(msg, async () => { await call(sb.rpc('undo_last', { p_task: t.id })); await sleepKids(t); await load(); });
}

async function undo(t) {
  await call(sb.rpc('undo_last', { p_task: t.id }));
  await sleepKids(t);
  await load();
}

// ---------- экраны ----------
function render() {
  updateBg();
  updatePets();
  updateDust();
  if (!S.user) return renderLogin();
  if (!S.loaded) { $app.innerHTML = '<div class="empty">Загружаю…</div>'; return; }
  const views = { today: renderToday, calendar: renderCalendar, sections: renderSections, habits: renderHabits, plan: renderPlan, time: renderTime };
  if (S.view === 'nodate') { S.view = 'sections'; S.noDate = true; } // вкладки «Без срока» нет — это фильтр в «Разделах»
  if (!views[S.view]) S.view = 'sections'; // была вкладка «Проекты» — теперь проекты живут в «Разделах»
  if ((S.view === 'plan' || S.view === 'time') && !planOn()) S.view = 'today';
  if (S.view === 'habits' && S.space === 'work') S.view = 'today'; // в работе привычек нет
  document.body.className = 'v-' + S.view + (S.space === 'work' ? ' work' : '') + (petsShown() ? ' pets' : '') + (S.bg ? ' bg' : '');
  $app.innerHTML = views[S.view]() + meterCard('side') + `
    ${S.pick ? pickBar() : '<button class="fab" data-act="new" aria-label="Новая задача">+</button>'}
    <nav class="bottom">
      ${[['today', 'Сегодня'], ['calendar', 'Календарь'], ['sections', 'Разделы']].concat(S.space === 'work' ? [] : [['habits', 'Привычки']])
        .concat(planOn() ? [['plan', 'План'], ['time', 'Время']] : []).map(([k, n]) => `<button class="pill ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}</button>`).join('')}
    </nav>`;
}

function taskRow(t, opts = {}) {
  const sec = sectionOf(t);
  // слева — только название (и то, что важно прочитать: «ждёт», пометка); остальные отметки — справа
  const meta = [];
  const tags = [];
  const due = upcoming(t);
  // на сколько дней просрочено (так же, как считают питомцы и погода)
  const lateN = !opts.done && !isEvent(t) && t.kind !== 'habit' ? petLate(t) : 0;
  if (lateN) tags.push(`<span class="late" title="Просрочено на ${lateN} дн. (с первоначального срока)">⏳${lateN} д</span>`);
  if (t.start_time) tags.push(`<span class="time">${timeLabel(t)}</span>`);
  if (t.start_date && !isEvent(t) && t.start_date > today()) tags.push(`<span>с ${dateLabel(t.start_date)}</span>`);
  if (opts.date && due) tags.push(`<span class="${due < today() && !isEvent(t) ? 'late' : ''}">${t.start_date && !isEvent(t) ? 'до ' : ''}${dateLabel(due)}${t.end_date ? ' — ' + dateLabel(t.end_date) : ''}</span>`);
  // у запланированной задачи дедлайн виден всегда; красный — прошёл или план позже него
  if (t.plan_date && t.due_date && !opts.date && !opts.done)
    tags.push(`<span class="${t.due_date < today() || t.plan_date > t.due_date ? 'late' : ''}">до ${dateLabel(t.due_date)}</span>`);
  const spent = spentOf(t.id);
  if (spent) tags.push(`<span class="${t.estimate && spent > t.estimate * 1.2 ? 'late' : ''}" title="Потрачено по факту${t.estimate ? ' / оценка' : ''}">⏱ ${fmtH(spent)}${t.estimate ? ' / ' + fmtH(t.estimate) : ''} ч</span>`);
  else if (t.estimate) tags.push(`<span>⏱ ${fmtH(t.estimate)} ч</span>`);
  const size = sizeOf(t);
  const slotName = SLOTS[t.slot] && (size === 'mid' || size === 'idea') ? SLOTS[t.slot].name.toLowerCase() : '';
  if (size) tags.push(`<span title="${SIZES[size].name}${slotName ? ', ' + slotName : ''}">${SIZES[size].icon}${slotName ? ' ' + slotName : ''}</span>`);
  if (isEvent(t) && !opts.mark) opts = { ...opts, mark: '•', markStyle: 'border-color:var(--accent);color:var(--accent)' };
  if (sec && !opts.noSection) tags.push(`<span>${esc(sec.name)}</span>`);
  const rep = repeatLabel(t);
  if (rep) tags.push(`<span>↻ ${esc(rep)}</span>`);
  const subs = subsOf(t);
  if (t.remind_at || t.remind_days) tags.push(`<span>🔔 ${[hhmm(t.remind_at), t.remind_days ? 'за ' + t.remind_days + ' дн.' : ''].filter(Boolean).join(', ')}</span>`);
  const how = t.project_id && spaceOf(t) === 'work' ? stepOf(t) : null;
  if (how && (how.step?.howto || how.tpl.memo)) tags.push(`<span class="howto-tag" data-act="howto" data-id="${t.id}" aria-label="Как делать">📖</span>`);
  if (t.decor && DECOR[t.decor]) tags.push(`<span title="${DECOR[t.decor].name}">${DECOR[t.decor].icon}</span>`);
  if (shownPets(t).length) tags.push(`<span title="${shownPets(t).map(p => esc(petName(p))).join(' и ')}">${shownPets(t).map(p => PETS[p].icon).join('')}</span>`);
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
  const dusty = !opts.done && t.decor === 'dust' && petLate(t) >= lim('dust');
  const cls = `task ${t.kind === 'habit' ? 'habit' : ''} ${waits.length ? 'locked' : ''} ${opts.done ? 'done' : ''} ${picked ? 'picked' : ''} ${opts.busy ? 'busy' : ''} ${dusty ? 'dusty' : ''} ${subList ? 'has-subs' : ''} ${opts.noslot ? 'noslot' : ''}`;
  // mark — значок без действия (прошлые отметки и будущие повторы в календаре)
  const check = S.pick && opts.drag
    ? `<div class="check pick">${picked ? '✓' : ''}</div>`
    : opts.mark
      ? `<div class="check" style="${opts.markStyle || ''}">${opts.mark}</div>`
      : `<button class="check" data-act="${opts.done ? 'undo' : 'done'}" data-id="${t.id}" title="${opts.done ? 'Отменить' : 'Сделано'}">✓</button>`;
  // drag — строка в «Разделах»: её можно перетаскивать и выбирать
  const dnd = opts.drag ? ` data-drag="${t.id}" data-sec="${t.section_id || ''}"${S.pick ? '' : ' draggable="true"'}`
    : opts.plan ? ` data-plan="${t.id}" draggable="true"` // plan — карточка в «Плане», тащится по дням
    : opts.sdrag ? ` data-sdrag="${t.id}" draggable="true"` : ''; // sdrag — «Сегодня» на компьютере, тащится в окошки
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
  // День по частям (её решение 12.11.2026): ☀ утро (пятиминутки) → 🍽 обед → 🌆 после работы → 🌙 после ужина → остальное.
  // Окошки в будни видны всегда, со свободными ячейками по 30 мин; задачи туда ставит она сама (перетаскиванием или меню).
  const personal = S.space === 'personal';
  const fit = personal ? dayFit(t0) : { inSlot: {}, slots: {}, room: () => 0, weekend: true };
  const slotted = personal && !fit.weekend;
  const drag = slotted && matchMedia('(min-width: 900px)').matches;
  const ORDER = { lunch: 1, after: 2, eve: 3 };
  const ideaEve = t => personal && sizeOf(t) === 'idea'; // вдохновение в выходные — «вечером»
  const rank = t => (fit.inSlot[t.id] ? ORDER[fit.inSlot[t.id]] : sizeOf(t) === 'quick' ? 0 : ideaEve(t) ? 3 : 4);
  const sorted = due.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
  const GROUPS = [[0, null, slotted ? '☀ Утро' : '⚡ пятиминутки'], [1, 'lunch'], [2, 'after'], [3, 'eve', '🌙 вечером'], [4, null, 'остальное']];
  const used = GROUPS.filter(([r, k]) => sorted.some(t => rank(t) === r) || (slotted && fit.slots[k]));
  let groups = '';
  for (const [r, k, label] of used) {
    const items = sorted.filter(t => rank(t) === r);
    const sl = slotted && fit.slots[k];
    const rows = items.map(t => taskRow(t, { sdrag: drag })).join('');
    if (sl) {
      const s = slotOf(k);
      const evs = sl.items.filter(i => i.ev).map(i => `<div class="scell item ev" data-act="edit" data-id="${i.t.id}"><span>${hhmm(i.t.start_time)} ${esc(i.t.title)}</span><b>${i.min} мин</b></div>`).join('');
      const free = Math.max(0, Math.floor(fit.room(k) / CELL));
      groups += `<div class="period" data-sdrop="${k}"><div class="group-sep"><span>${SLOT_ICON[k]} ${SLOTS[k].name}, ${s.from}–${s.to}</span></div>
        ${rows}${evs}${'<div class="scell empty">свободно</div>'.repeat(free)}</div>`;
    } else {
      const head = used.length > 1 ? `<div class="group-sep"><span>${label}</span></div>` : '';
      groups += slotted ? `<div class="period" data-sdrop="none">${head}${rows}</div>` : head + rows;
    }
  }
  const started = t => t.start_date && t.start_date <= t0;
  // начатые, но со сроком позже — «в работе»
  const inWork = S.space === 'work' ? [] : active().filter(t => !isEvent(t) && !t.plan_date && started(t) && (!t.due_date || t.due_date > t0)).sort(byPos);
  const events = [...new Map((occurrences(t0, t0)[t0] || []).filter(o => isEvent(o.t) && spaceOf(o.t) === S.space).map(o => [o.t.id, o.t])).values()]
    .sort((a, b) => (a.start_time || '') < (b.start_time || '') ? -1 : 1);
  // сделано сегодня: последние отметки «done» сегодняшним числом
  const doneIds = [...new Set(S.logs.filter(l => l.status === 'done' && l.done_on === t0).map(l => l.task_id))];
  const doneToday = S.showDone ? doneIds.map(id => S.tasks.find(t => t.id === id)).filter(Boolean) : [];

  let html = `<header class="top"><h1>Сегодня <span class="sub">${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS_OF[now.getMonth()]}</span></h1><div class="tools">${MODE()}${GEARS.v}</div></header>`;
  html += meterCard('top');
  if (!due.length && !doneToday.length && !events.length && !inWork.length) {
    html += '<div class="empty">Задач на сегодня нет.<br>Нажми «+», чтобы добавить.</div>';
  }
  if (events.length) html += '<h2>События</h2>' + events.map(t => taskRow(t)).join('');
  let list = '';
  if (groups) list += groups;
  if (inWork.length) list += '<h2>В работе</h2>' + inWork.map(t => taskRow(t, { date: true })).join('');
  if (doneToday.length) list += '<h2>Сделано сегодня</h2>' + doneToday.map(t => taskRow(t, { done: true })).join('');
  return html + list;
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
      d = nextOf(t, d);
      if (!d || d > to || (t.repeat_until && d > t.repeat_until)) break;
      if (addDays(d, span) >= from) put(d, 'repeat');
    }
  }
  for (const l of S.logs) {
    if (l.day < from || l.day > to) continue;
    const t = S.tasks.find(x => x.id === l.task_id);
    if (t && spaceOf(t) === S.space && !pausedSec(t.section_id)) add(l.day, { t, kind: l.status, part: +l.part || 0 });
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
  if (o.kind === 'missed' && o.part) return taskRow(o.t, { mark: '½', markStyle: 'border-color:var(--warn);color:var(--warn)', note: `сделано на ${Math.round(o.part * 100)}%` });
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
      <div class="seg"><button class="pill ${week ? '' : 'on'}" data-act="cal-mode" data-v="month">Месяц</button><button class="pill ${week ? 'on' : ''}" data-act="cal-mode" data-v="week">Неделя</button></div><div class="tools">${MODE()}${GEARS.v}</div>
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
// фильтр по размеру: светится = показано, ничего не выбрано — все
// 'none' — задачи без размера (события не считаются)
const sizeOk = t => !S.sizes.length || S.sizes.includes(sizeOf(t) || (isEvent(t) ? '' : 'none'));
const filterOk = t => noDateOk(t) && sizeOk(t);
const sectionTasks = secId => activeAll().filter(t => (t.section_id || null) === secId && spaceOf(t) === S.space && !eventOver(t) && filterOk(t)).sort(byPos);

function renderSections() {
  const sel = S.section;
  const count = id => sectionTasks(id).length;
  // слева (на телефоне — строкой сверху): разделы; на них можно бросать задачи
  const item = (id, name, color, n) => `<button class="pill side-item ${sel === id ? 'on' : ''} ${pausedSec(id) ? 'paused' : ''}" data-act="section" data-id="${id || ''}" data-drop-sec="${id || ''}">
      ${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}<span class="name">${esc(name)}</span>${pausedSec(id) ? '<span class="n" title="Раздел выключен">⏸</span>' : n ? `<span class="n">${n}</span>` : ''}</button>`;
  const side = [`<button class="pill side-item ${sel === null ? 'on' : ''}" data-act="section" data-id="">Все<span class="n">${active().filter(t => !eventOver(t) && filterOk(t)).length}</span></button>`]
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
    const projs = S.noDate || S.sizes.length ? [] : S.projects.filter(p => !p.archived && ((p.section_id || null) === id || all.some(t => t.project_id === p.id)));
    const list = all.filter(t => !projs.some(p => p.id === t.project_id));
    const paused = pausedSec(id);
    if (sel === null && !all.length && !projs.length && (id === null || S.noDate || S.sizes.length)) continue;
    const head = `<h2 class="group ${paused ? 'paused' : ''}" data-drop-sec="${id || ''}">${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(name || '')}
      ${paused ? '<span class="off">⏸ выключен</span>' : ''}
      ${list.length > 1 && !paused ? `<button class="az" data-act="sort-az" data-id="${id || 'none'}">А→Я</button>` : ''}
      ${id ? `<button class="edit-sec" data-act="edit-section" data-id="${id}" aria-label="Изменить раздел">✎</button>` : ''}</h2>`;
    if (paused) {
      // в «Все» задачи выключенного раздела свёрнуты; в самом разделе — видны, но бледные
      body += head + `<div class="paused-note">Задачи этого раздела (${list.length}) скрыты в «Сегодня», календаре и утренней проверке.
        <button class="link" data-act="s-pause" data-id="${id}">▶ Включить раздел</button></div>`;
      if (sel === null) continue;
      body += `<div class="paused-list">${all.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')}</div>`;
      continue;
    }
    body += head + projs.map(p => projectBlock(p, all)).join('') + (list.map(t => taskRow(t, { date: true, noSection: true, drag: true })).join('')
      || (projs.length ? '' : `<div class="empty small" data-drop-sec="${id || ''}">${S.noDate || S.sizes.length ? 'Таких задач нет' : 'Пусто' + (S.pick ? '' : ' — перетащи сюда задачу')}</div>`));
  }
  const tools = S.pick
    ? '<button class="pill pick-btn" data-act="pick-all" aria-label="Выбрать все">☑</button>'
    : '<button class="pill pick-btn" data-act="pick-start" aria-label="Выбрать">☐</button>';
  const filter = `<button class="pill ${S.noDate ? 'on' : ''}" data-act="nodate">Без срока</button>`;
  const sizes = `<div class="seg sizes">${Object.entries(SIZES).map(([k, z]) => `<button class="pill ${S.sizes.includes(k) ? 'on' : ''}" data-act="size-filter" data-v="${k}" aria-label="${z.title}">${z.icon}</button>`).join('')}<button class="pill ${S.sizes.includes('none') ? 'on' : ''}" data-act="size-filter" data-v="none" aria-label="Без размера">○</button></div>`;
  return `<header class="top"><h1>Разделы</h1>${sizes}<div class="tools">${filter}${tools}${MODE()}${GEARS.v}</div></header>
    <div class="split">
      <nav class="side">${side.join('')}</nav>
      <div class="main">${body || '<div class="empty">Здесь пока пусто</div>'}</div>
    </div>`;
}

// ---------- перетаскивание мышкой (в «Разделах») ----------
let dragId = null;
const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(e => e.classList.remove('drop-before', 'drop-after', 'drop-in'));

// у кнопки-значка при наведении — подсказка с её названием (её решение 09.11.2026): title берём из aria-label
document.addEventListener('mouseover', e => {
  const b = e.target.closest && e.target.closest('button[aria-label], a[aria-label], .pick-n');
  if (b && !b.title) b.title = b.getAttribute('aria-label');
});

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

// Кнопка «А→Я»: порядок задач раздела по алфавиту записывается в position — дальше можно двигать вручную.
async function sortAZ(secId) {
  const list = sectionTasks(secId).sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true, sensitivity: 'base' }));
  const changes = [];
  list.forEach((x, k) => { if ((x.position || 0) !== k) { x.position = k; changes.push([x.id, k]); } });
  render();
  await Promise.all(changes.map(([cid, k]) => call(sb.from('tasks').update({ position: k }).eq('id', cid))));
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
      ${dayFact(d) ? `<div class="pnote fact">по факту: ${fmtH(dayFact(d))} ч</div>` : ''}
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
      <div class="tools">${MODE()}${GEARS.v}</div></header>
    <div class="plan" style="grid-template-columns:repeat(${days.length}, minmax(0, 1fr)) minmax(250px, 1.4fr)">
      ${cols}
      <div class="pcol unplanned" data-pday="">
        <div class="phead"><b>Не распланировано</b><span class="hours">${free.length}</span></div>
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

// ---------- фактическое время (рабочий режим) ----------
// Записи по дням в time_log: «11 нояб — 1,5 ч». Итог задачи — сумма записей.
const timesOf = id => (S.times || []).filter(x => x.task_id === id);
const spentOf = id => timesOf(id).reduce((s, x) => s + +x.hours, 0);
const dayFact = d => (S.times || []).filter(x => x.day === d).reduce((s, x) => s + +x.hours, 0);
// «1,5», «1.5», «1:30», «90м» → часы
function parseH(v) {
  v = String(v || '').trim().replace(',', '.');
  if (/^\d+:\d{1,2}$/.test(v)) { const [h, m] = v.split(':').map(Number); return h + m / 60; }
  if (/^\d+\s*м/.test(v)) return parseInt(v) / 60;
  return parseFloat(v) || 0;
}
const round4 = h => Math.round(h * 4) / 4; // до четверти часа

// Блок «Потрачено» в окне задачи (только у сохранённой задачи).
function renderSpent() {
  const box = document.getElementById('f-spent');
  if (!box || !S.edit) return;
  if (!S.timeOn) { box.innerHTML = '<div class="hint">Чтобы записывать потраченное время, запусти в Supabase файл 017_time.sql.</div>'; return; }
  if (!S.edit.id) { box.innerHTML = ''; return; }
  const list = timesOf(S.edit.id).slice().sort((a, b) => (a.day < b.day ? 1 : -1));
  const total = list.reduce((s, x) => s + +x.hours, 0);
  box.innerHTML = `<div class="row spent-row"><span>Потрачено по факту: <b>${fmtH(total)} ч</b></span>
      <input class="inp num" id="f-sp-h" placeholder="ч" style="max-width:64px">
      <input class="inp" id="f-sp-d" type="date" value="${today()}" style="max-width:150px">
      <button class="btn small" data-act="sp-add">+ Записать</button></div>
    ${list.length ? `<div class="wds spent-list">${list.map(x => `<span class="chip">${dateLabel(x.day)} · ${fmtH(+x.hours)} ч<button class="icon small" data-act="sp-del" data-v="${x.id}" aria-label="Убрать запись">✕</button></span>`).join('')}</div>` : ''}`;
}

async function addSpent() {
  const h = round4(parseH(document.getElementById('f-sp-h').value));
  const day = document.getElementById('f-sp-d').value || today();
  if (!(h > 0) || h > 24) return toast('Напиши, сколько часов: например 1,5');
  const [row] = await call(sb.from('time_log').insert({ task_id: S.edit.id, day, hours: h }).select());
  S.times.push(row);
  renderSpent();
  syncEdit();
  render();
  toast(`Записано: ${fmtH(h)} ч за ${dateLabel(day)}`);
}

async function delSpent(id) {
  await call(sb.from('time_log').delete().eq('id', id));
  S.times = S.times.filter(x => String(x.id) !== String(id));
  renderSpent();
  syncEdit();
  render();
}

// Сколько в среднем по факту занимает шаг шаблона: сделанные задачи прошлых периодов (последние 6), где время записано.
function factAvg(tplId, title, i) {
  const projs = (S.allProjects || []).filter(p => p.template_id === tplId).sort((a, b) => (a.period < b.period ? 1 : -1));
  const vals = [];
  for (const p of projs) {
    const ts = S.tasks.filter(t => t.project_id === p.id);
    const t = ts.find(x => x.title === title) || ts.find(x => x.position === i);
    const h = t && t.done_on ? spentOf(t.id) : 0;
    if (h > 0) vals.push(h);
    if (vals.length >= 6) break;
  }
  return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
}

const periodName = p => (p.title || '').split(' — ').pop();

// В окне шаблона: план и факт по периодам, среднее по шагам.
function tplStatsHTML(t) {
  if (!t.id || !S.timeOn) return '';
  const projs = (S.allProjects || []).filter(p => p.template_id === t.id).sort((a, b) => (a.period < b.period ? 1 : -1)).slice(0, 12);
  if (!projs.length) return '';
  const rows = projs.map(p => {
    const ts = S.tasks.filter(x => x.project_id === p.id);
    const plan = ts.reduce((s, x) => s + (+x.estimate || 0), 0);
    const fact = ts.reduce((s, x) => s + spentOf(x.id), 0);
    const done = ts.filter(x => x.done_on).length;
    return `<tr><td>${esc(periodName(p))}</td><td>${plan ? fmtH(plan) + ' ч' : '—'}</td>
      <td class="${plan && fact > plan * 1.2 ? 'late' : ''}">${fact ? fmtH(fact) + ' ч' : '—'}</td><td>${done} из ${ts.length}</td></tr>`;
  }).join('');
  const avgs = (t.steps || []).filter(s => s.title).map((s, i) => [s, factAvg(t.id, s.title, i)]).filter(([, a]) => a);
  return `<div class="field"><label>Время по периодам</label>
    <table class="ttable"><tr><th>Период</th><th>План</th><th>Факт</th><th>Сделано</th></tr>${rows}</table>
    ${avgs.length ? `<div class="hint" style="margin-top:6px">В среднем по факту: ${avgs.map(([s, a]) => `${esc(s.title)} — <b>${fmtH(a.avg)} ч</b> (${a.n} пер.)`).join('; ')}</div>` : ''}</div>`;
}

// ---------- вкладка «Время» (рабочий режим, компьютер) ----------
const T_RANGES = [[7, 'Неделя'], [30, 'Месяц'], [90, '3 месяца']];
function renderTime() {
  const t0 = today();
  const from = addDays(t0, 1 - S.tRange);
  const head = `<header class="top"><h1>Время</h1>
    <div class="seg">${T_RANGES.map(([n, l]) => `<button class="pill ${S.tRange === n ? 'on' : ''}" data-act="t-range" data-v="${n}">${l}</button>`).join('')}</div>
    <div class="tools">${MODE()}${GEARS.v}</div></header>`;
  if (!S.timeOn) return head + '<div class="empty">Чтобы записывать потраченное время, запусти в Supabase файл 017_time.sql.</div>';
  const known = id => byId(id) || (S.timeTasks || {})[id];
  const list = S.times.filter(x => x.day >= from && x.day <= t0);
  // задачи, которых нет в обычной загрузке (давно сделанные), подгрузить один раз
  const miss = [...new Set(list.map(x => x.task_id))].filter(id => !known(id) && !(S.timeTried || new Set()).has(id));
  if (miss.length) {
    (S.timeTried ||= new Set()); miss.forEach(id => S.timeTried.add(id));
    sb.from('tasks').select('id,title,estimate,project_id,section_id,space,done_on').in('id', miss).then(r => {
      S.timeTasks = { ...(S.timeTasks || {}), ...Object.fromEntries((r.data || []).map(x => [x.id, x])) };
      if (S.view === 'time') render();
    });
  }
  if (!list.length) return head + '<div class="empty">За этот срок время не записано</div>';
  const total = list.reduce((s, x) => s + +x.hours, 0);
  // по дням
  const days = [...Array(S.tRange)].map((_, i) => addDays(from, i));
  const byDay = Object.fromEntries(days.map(d => [d, 0]));
  list.forEach(x => { byDay[x.day] += +x.hours; });
  const worked = days.filter(d => byDay[d] > 0).length;
  const max = Math.max(DAY_NORM, ...Object.values(byDay));
  const bars = days.map(d => `<div class="tbar ${isodow(d) > 5 ? 'we' : ''}" title="${dateLabel(d)}: ${fmtH(byDay[d])} ч"><i style="height:${byDay[d] / max * 100}%"></i>${S.tRange <= 30 ? `<span>${parse(d).getDate()}</span>` : ''}</div>`).join('');
  // по дням недели: в среднем за такой день (считаются только дни, когда время записывали)
  const wd = [...Array(7)].map((_, i) => {
    const ds = days.filter(d => isodow(d) === i + 1 && byDay[d] > 0);
    const sum = ds.reduce((s, d) => s + byDay[d], 0);
    return { name: WD[i], avg: ds.length ? sum / ds.length : 0 };
  });
  const wmax = Math.max(1, ...wd.map(w => w.avg));
  // по задачам
  const per = {};
  list.forEach(x => { per[x.task_id] = (per[x.task_id] || 0) + +x.hours; });
  const rows = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([id, h]) => {
    const t = known(id);
    const p = t && t.project_id && (S.allProjects || []).find(x => x.id === t.project_id);
    const all = spentOf(id);
    const est = t && +t.estimate;
    return `<tr ${byId(id) ? `data-act="edit" data-id="${id}" class="click"` : ''}><td>${t ? esc(t.title) : '<span class="muted">задача удалена</span>'}${p ? ` <span class="muted">· ${esc(periodName(p))}</span>` : ''}${t && t.done_on ? ' ✓' : ''}</td>
      <td>${fmtH(h)} ч</td><td>${all !== h ? fmtH(all) + ' ч' : ''}</td>
      <td class="${est && all > est * 1.2 ? 'late' : ''}">${est ? fmtH(est) + ' ч' : '—'}</td></tr>`;
  }).join('');
  // шаблоны: сколько обычно занимает каждый шаг
  const tpls = S.templates.map(tp => [tp, (tp.steps || []).filter(s => s.title).map((s, i) => [s, factAvg(tp.id, s.title, i)]).filter(([, a]) => a)]).filter(([, a]) => a.length);
  return head + `<div class="time-view">
    <div class="tsum">За ${T_RANGES.find(r => r[0] === S.tRange)[1].toLowerCase()}: <b>${fmtH(total)} ч</b> · дней с записями: ${worked} · в среднем <b>${fmtH(worked ? total / worked : 0)} ч</b> за такой день</div>
    <h2>По дням</h2><div class="tbars r${S.tRange}">${bars}</div>
    <h2>По дням недели, в среднем</h2>
    <div class="twd">${wd.map(w => `<div><span>${w.name}</span><div class="bar"><i style="width:${w.avg / wmax * 100}%"></i></div><b>${w.avg ? fmtH(w.avg) + ' ч' : '—'}</b></div>`).join('')}</div>
    <h2>По задачам</h2>
    <table class="ttable"><tr><th>Задача</th><th>За этот срок</th><th>Всего</th><th>Оценка</th></tr>${rows}</table>
    ${tpls.length ? `<h2>Шаблоны: сколько обычно занимает</h2>${tpls.map(([tp, a]) => `<div class="tpl-time"><b>${esc(tp.title)}</b>
      ${a.map(([s, x]) => `<div>${esc(s.title)} — <b>${fmtH(x.avg)} ч</b> <span class="muted">(среднее за ${x.n} пер.${s.hours ? `, в шаблоне ${fmtH(s.hours)} ч` : ''})</span></div>`).join('')}</div>`).join('')}` : ''}
  </div>`;
}

// ---------- привычки: как получалось следовать ----------
// История за год грузится, когда открыта вкладка (в обычной загрузке — только 2 месяца).
async function loadHabitLogs(ids) {
  S.hLogs = [];
  if (!ids.length) return;
  S.hLogs = await call(sb.from('task_log').select('*').in('task_id', ids).gte('day', addDays(today(), -365)).order('id'));
  if (S.view === 'habits') render();
}

// Дни привычки за последние n дней: [день, 'done' / 'part' / 'missed' / '' (не нужно было или ещё не отмечено), доля]
function habitDays(t, n, src = S.hLogs && S.hLogs.length ? S.hLogs : S.logs) {
  const st = {};
  for (const l of src) if (l.task_id === t.id && (l.status === 'done' || l.status === 'missed')) st[l.day] = l;
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today(), -i), l = st[d];
    days.push(l ? [d, isPart(l) ? 'part' : l.status, logVal(l)] : [d, '', 0]);
  }
  return days;
}

function habitCard(t) {
  const days = habitDays(t, S.hRange);
  const marked = days.filter(([, s]) => s);
  const done = marked.reduce((a, [, , p]) => a + p, 0);
  const parts = marked.filter(([, s]) => s === 'part').length;
  // серии считаются по отмеченным дням (дни, когда привычка не нужна, не прерывают серию); частично — серия рвётся
  let best = 0, run = 0;
  for (const [, s] of marked) { run = s === 'done' ? run + 1 : 0; best = Math.max(best, run); }
  const pct = marked.length ? Math.round(done / marked.length * 100) : 0;
  const sec = sectionOf(t);
  const fmt = d => `${parse(d).getDate()} ${MONTHS_OF[parse(d).getMonth()]}`;
  return `<div class="hcard"${sec ? ` style="--sec:${esc(sec.color)}"` : ''} data-act="edit" data-id="${t.id}">
    <div class="hhead"><b>${esc(t.title)}</b><span class="tags">${repeatLabel(t) ? '↻ ' + esc(repeatLabel(t)) : ''}${sec ? ' · ' + esc(sec.name) : ''}</span></div>
    ${marked.length ? `<div class="hnums">
      <div><b>${num1(done)} из ${marked.length}</b><span>сделано</span></div>
      <div><b class="${pct >= 80 ? 'ok' : pct >= 50 ? 'mid' : 'low'}">${pct}%</b><span>получилось</span></div>
      <div><b>${run}</b><span>подряд сейчас</span></div>
      <div><b>${best}</b><span>лучшая серия</span></div>
      <div><b>${marked.filter(([, s]) => s === 'missed').length}</b><span>пропусков</span></div>
      ${parts ? `<div><b>${parts}</b><span>частично</span></div>` : ''}
    </div>` : '<div class="hint">Пока нет отметок за это время.</div>'}
    <div class="hgrid r${S.hRange}">${days.map(([d, s, p]) => dayCell(s, p, ` title="${fmt(d)}${s === 'done' ? ' — сделано' : s === 'part' ? ` — сделано на ${Math.round(p * 100)}%` : s === 'missed' ? ' — пропущено' : ''}"`)).join('')}</div>
  </div>`;
}

function renderHabits() {
  const list = activeAll().filter(t => t.kind === 'habit' && spaceOf(t) === S.space).sort(byPos);
  if (!S.hLogs) loadHabitLogs(list.map(t => t.id));
  const ranges = [[30, '30 дней'], [90, '3 месяца'], [365, 'год']];
  let html = `<header class="top"><h1>Привычки</h1>
    <div class="seg">${ranges.map(([n, l]) => `<button class="pill ${S.hRange === n ? 'on' : ''}" data-act="h-range" data-v="${n}">${l}</button>`).join('')}</div>
    <div class="tools">${MODE()}${GEARS.v}</div></header>`;
  if (!list.length) return html + '<div class="empty">Привычек пока нет.<br>В окне задачи выбери вид «Привычка».</div>';
  html += '<div class="legend"><i class="done"></i> сделано <i class="missed"></i> пропущено <i class="part" style="--p:50%"></i> частично <i></i> не нужно было / ещё не отмечено</div>';
  return html + list.map(habitCard).join('');
}

// ---------- картинки у задач ----------
const DECOR = {
  dust: { icon: '🕸', name: 'Пыль и паутина', get hint() { return `Пыль и паутина — если задача просрочена на ${lim('dust')} дн. и больше (уборка).`; } },
  books: { icon: '📚', name: 'Книги', hint: 'Только картинкой: в списках задачи нет, на подоконнике лежат книги' },
  meter: { icon: '🔢', name: 'Счётчики', hint: 'Счётчики — когда подошёл срок (или «Начать с»), сбоку появляется счётчик (газ, вода или свет — по названию задачи). Его можно перетащить мышкой.' },
};

// Паутинка в углу строки задачи
const WEB = `<svg class="web" viewBox="0 0 60 60" aria-hidden="true"><g stroke="#cfd3e6" stroke-width="1" fill="none" opacity=".75">
  <path d="M60 0L4 56M60 0L28 58M60 0L58 4M60 0L46 60M60 0L2 30M60 0L30 2"/>
  <path d="M48 0Q50 10 60 12M36 0Q40 20 60 24M22 0Q30 30 60 38M10 2Q22 40 58 52"/></g>
  <path d="M46 26v8" stroke="#cfd3e6" stroke-width=".8"/><circle cx="46" cy="36" r="2.6" fill="#2a2b36" stroke="#cfd3e6" stroke-width=".6"/></svg>`;

// Сколько дней запущена уборка (худшая задача с пылью)
const dustDays = () => Math.max(0, ...active().filter(t => t.decor === 'dust').map(petLate));

// Случайные числа, одинаковые при каждой перерисовке: пятно №i всегда на своём месте, с каждым днём добавляются новые
function seeded(i) {
  let x = (i + 1) * 2654435761 >>> 0;
  return () => { x = (x ^ (x >>> 15)) * 2246822507 >>> 0; x = (x ^ (x >>> 13)) * 3266489909 >>> 0; return ((x ^= x >>> 16) >>> 0) / 4294967296; };
}

// Паутина по углам, летающая пыль и пыльные пятна по экрану — свой слой поверх всего, мышку не ловит.
// Чем дольше просрочена уборка, тем больше пятен и они гуще (дней после порога «пыль» = k).
let $dust = null;
function updateDust() {
  const n = S.user && S.loaded && S.view !== 'plan' ? dustDays() : 0;
  const k = n >= lim('dust') ? Math.min(n - lim('dust') + 1, 20) : 0;
  const lvl = !k ? 0 : n >= lim('dust2') ? 2 : 1;
  if (!$dust) {
    if (!k) return;
    $dust = document.createElement('div');
    $dust.id = 'dust';
    document.body.append($dust);
  }
  if ($dust.dataset.k === String(k)) return;
  $dust.dataset.k = k;
  const motes = Array.from({ length: Math.min(8 + k * 3, 60) }, () =>
    `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:-${(Math.random() * 14).toFixed(1)}s;animation-duration:${(10 + Math.random() * 8).toFixed(1)}s;--s:${(2 + Math.random() * 3).toFixed(1)}px"></i>`).join('');
  const spots = Array.from({ length: Math.min(k * 3, 50) }, (_, i) => {
    const r = seeded(i);
    const size = (90 + r() * 220) * Math.min(Math.max(innerWidth / 1400, .4), 1);
    const a = Math.min(.18 + k * .025, .6) * (.6 + r() * .4);
    return `<b style="left:${(r() * 100).toFixed(1)}%;top:${(r() * 100).toFixed(1)}%;width:${size.toFixed(0)}px;height:${(size * (.6 + r() * .5)).toFixed(0)}px;rotate:${(r() * 180).toFixed(0)}deg;opacity:${a.toFixed(2)}"></b>`;
  }).join('');
  const web = WEB.slice(WEB.indexOf('<g'), -6);
  $dust.style.setProperty('--haze', Math.min(k * .012, .2).toFixed(3));
  $dust.innerHTML = k ? `<div class="haze"></div>${spots}<svg class="corner r" viewBox="0 0 60 60">${web}</svg>${lvl === 2 ? `<svg class="corner l" viewBox="0 0 60 60">${web}</svg>` : ''}${motes}` : '';
}

// ---------- вид за окном (фон) ----------
// Каждый день свой вид; время суток — настоящее; погода — от того, как идут дела сегодня (без привычек):
// чем больше сделано, тем меньше туч и ярче солнце; всё сделано — радуга (ночью — падающая звезда);
// есть просрочка ≥ lim('sad') дней — дождь, ≥ lim('faint') — гроза. Выключается в ⚙ (tm.bg).
const SCENES = ['city', 'forest', 'sea', 'mountains', 'village', 'winter'];
const SCENE_NAMES = { city: 'город', forest: 'лес', sea: 'море', mountains: 'горы', village: 'деревня', winter: 'зима' };
const SKY = { night: ['#0b1026', '#1c2346'], dawn: ['#3b4a7a', '#f2a46b'], day: ['#4f8fd6', '#a9d4f5'], evening: ['#2f2f63', '#e2795a'] };
const DARK = { night: .55, evening: .28, dawn: .18, day: 0 };

function mixHex(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function bgState() {
  const t0 = today();
  const h = new Date().getHours();
  const tod = h < 6 || h >= 22 ? 'night' : h < 9 ? 'dawn' : h < 18 ? 'day' : 'evening';
  // привычки на погоду не влияют — только обычные задачи
  const left = active().filter(t => !isEvent(t) && t.kind !== 'habit' && reviewDay(t) && reviewDay(t) <= t0);
  const done = new Set(S.logs.filter(l => l.status === 'done' && l.done_on === t0 && S.tasks.some(t => t.id === l.task_id && t.kind !== 'habit' && spaceOf(t) === S.space)).map(l => l.task_id)).size;
  // её решение: дело портит погоду, только когда его время прошло (окошко закончилось, прошло время задачи,
  // или срок был раньше сегодня); без окошка и времени — не портит до конца дня. Сделанное — делает ярче.
  const now = h * 60 + new Date().getMinutes();
  const fit = S.space === 'personal' ? dayFit(t0) : { inSlot: {} };
  const passed = t => {
    if (reviewDay(t) < t0) return true;
    const k = fit.inSlot[t.id];
    if (k) return now >= toMin(slotOf(k).to);
    if (t.start_time) return now >= toMin(t.end_time || t.start_time);
    return false;
  };
  const missed = left.filter(passed).length;
  const p = missed + done ? done / (missed + done) : 1;
  const late = Math.max(0, ...left.map(petLate));
  const day = Math.floor(Date.parse(t0) / 864e5);
  return {
    scene: SCENES[day % SCENES.length], tod, p: Math.round(p * 10) / 10, all: !left.length && done > 0,
    bright: left.length + done ? Math.round(done / (left.length + done) * 4) / 4 : 0, // доля сделанного — солнце ярче
    rain: late >= lim('faint') ? 2 : late >= lim('sad') ? 1 : 0, late: late > 0,
  };
}

let $bg = null;
function updateBg() {
  const on = S.bg && S.user && S.loaded;
  if (!$bg) {
    if (!on) return;
    $bg = document.createElement('div');
    $bg.id = 'bg';
  }
  if (document.body.firstChild !== $bg) document.body.prepend($bg); // всегда позади питомцев
  $bg.hidden = !on;
  if (!on) return;
  const st = bgState(), fl = flowerState(), bk = booksNow().map(t => [t.id, bookVar(t)]);
  const sig = JSON.stringify([st, fl, bk]);
  if ($bg.dataset.sig === sig) return;
  $bg.dataset.sig = sig;
  $bg.innerHTML = bgSVG(st) + '<div class="frame"><i class="v"></i><i class="h"></i></div><div class="sill"></div>'
    + (fl ? `<div class="flower" title="${fl.tip}"${flowerX() !== null ? ` style="left:${flowerX() * 100}vw"` : ''}>${flowerSVG(fl)}</div>` : '')
    + bk.map(([id, v], i) => `<div class="books" data-act="book" data-id="${id}" style="right:${24 + i * 250}px">${booksSVG(v)}</div>`).join('');
}

// Книги: 5 вариантов, при каждом появлении (новый срок) — случайный, но постоянный в этот раз.
const bookVar = t => { let h = 0; for (const c of t.id + (t.due_date || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 5; };
function booksSVG(v) {
  const P = [['#b5523b', '#3f6fb0', '#5f9a5a', '#d9a441', '#7b4fa0'], ['#2f4858', '#86bbd8', '#f6ae2d', '#f26419', '#33658a'],
    ['#6d2e46', '#a26769', '#d5b9b2', '#ece2d0', '#582c4d'], ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'], ['#3d405b', '#81b29a', '#f2cc8f', '#e07a5f', '#8d5a97']][v];
  // лежащая книга: обложка, корешок с полосками, страницы справа
  const lie = (x, y, w, h, c) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${c}"/>
    <rect x="${x + w - 7}" y="${y + 2}" width="6" height="${h - 4}" fill="#f3ead6"/><path d="M${x + 6} ${y + 3}v${h - 6}M${x + 11} ${y + 3}v${h - 6}" stroke="#0003" stroke-width="1.5"/></g>`;
  // стоящая книга (можно наклонить вокруг нижнего угла)
  const up = (x, w, h, c, rot = 0) => `<g transform="rotate(${rot} ${x + (rot > 0 ? w : 0)} 110)"><rect x="${x}" y="${110 - h}" width="${w}" height="${h}" rx="2" fill="${c}"/>
    <path d="M${x + 2} ${116 - h}h${w - 4}M${x + 2} ${104}h${w - 4}" stroke="#fff6" stroke-width="2"/></g>`;
  const open = (x, y, w) => `<path d="M${x} ${y + 10}Q${x + w / 4} ${y} ${x + w / 2} ${y + 8}Q${x + w * .75} ${y} ${x + w} ${y + 10}V${y + 18}Q${x + w * .75} ${y + 9} ${x + w / 2} ${y + 16}Q${x + w / 4} ${y + 9} ${x} ${y + 18}Z" fill="#f6efdd" stroke="#c9b991"/><path d="M${x + w / 2} ${y + 8}V${y + 16}" stroke="#c9b991"/>`;
  const art = [
    lie(10, 84, 130, 26, P[0]) + lie(22, 60, 108, 24, P[1]) + lie(14, 38, 118, 22, P[2]),
    up(14, 22, 92, P[0]) + up(38, 18, 78, P[1]) + up(58, 26, 100, P[2]) + up(86, 20, 84, P[3]) + up(108, 22, 88, P[4], 18),
    lie(20, 92, 112, 18, P[0]) + lie(14, 74, 120, 18, P[1]) + lie(26, 56, 104, 18, P[2]) + lie(18, 38, 112, 18, P[3]) + lie(30, 20, 96, 18, P[4]),
    lie(12, 82, 128, 28, P[0]) + lie(24, 58, 108, 24, P[1]) + open(28, 36, 100),
    up(10, 20, 96, P[0]) + up(32, 24, 86, P[1]) + up(58, 18, 90, P[2], 12) + lie(88, 88, 64, 22, P[3]) + lie(92, 66, 56, 22, P[4]),
  ][v];
  return `<svg viewBox="0 0 160 112" aria-hidden="true">${art}</svg>`;
}
// На телефоне (и без «вида за окном») подоконника нет — книги значком в заголовке.
const booksIcon = () => (S.bg && matchMedia('(min-width: 900px)').matches) ? ''
  : booksNow().map(t => `<button class="icon" data-act="book" data-id="${t.id}" aria-label="${esc(t.title)}">📚</button>`).join('');
// Щелчок по книгам — пузырь рядом с ними: название и «✓ Готово» (вместо окна браузера).
const $bubble = document.createElement('div');
$bubble.className = 'book-bubble';
$bubble.hidden = true;
document.body.appendChild($bubble);
function bookDone(t, el) {
  if (!t || !el) return;
  if (!$bubble.hidden && $bubble.dataset.id === t.id) { $bubble.hidden = true; return; }
  $bubble.dataset.id = t.id;
  $bubble.innerHTML = `<span>${esc(t.title)}</span><button class="btn main" data-act="book-ok" data-id="${t.id}">✓ Готово</button>`;
  $bubble.hidden = false;
  const r = el.getBoundingClientRect(), w = $bubble.offsetWidth, h = $bubble.offsetHeight;
  $bubble.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
  const top = r.top - h - 12;
  $bubble.style.top = (top > 8 ? top : r.bottom + 12) + 'px';
  $bubble.classList.toggle('below', top <= 8);
}
document.addEventListener('pointerdown', ev => { if (!$bubble.hidden && !ev.target.closest('.book-bubble, [data-act=book]')) $bubble.hidden = true; });

// Цветок можно передвинуть мышкой вдоль подоконника; место — tm.flower, доля ширины экрана.
function flowerX() { const x = parseFloat(localGet('flower')); return isNaN(x) ? null : x; }
let flowerDrag = null;
document.addEventListener('pointerdown', ev => {
  const el = ev.button === 0 && ev.target.closest('#bg .flower');
  if (!el) return;
  flowerDrag = { el, x0: ev.clientX, l0: el.getBoundingClientRect().left, moved: false };
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  const d = flowerDrag;
  if (!d || (!d.moved && Math.abs(ev.clientX - d.x0) < 5)) return;
  d.moved = true;
  d.x = Math.min(Math.max(d.l0 + ev.clientX - d.x0, 0), innerWidth - d.el.offsetWidth) / innerWidth;
  d.el.style.left = d.x * 100 + 'vw';
});
document.addEventListener('pointerup', () => {
  const d = flowerDrag;
  flowerDrag = null;
  if (d?.moved) localSet('flower', String(d.x));
});

// Цветок на подоконнике живёт привычками: сколько отмечено «сделано» за 7 дней (сегодняшние не сделанные ещё не считаются).
// lvl 3 цветёт, 2 бутоны, 1 вянет, 0 засыхает; all — сегодня все привычки сделаны (прилетает бабочка).
// Какие разделы цветок не считает (напр. привычки, о которых напоминаешь другому человеку): user_metadata.flower_off, 'none' — без раздела.
const flowerOff = () => S.user?.user_metadata?.flower_off || [];
const flowerKey = t => t.section_id || 'none';

function flowerState() {
  const habits = active().filter(t => t.kind === 'habit' && !flowerOff().includes(flowerKey(t)));
  if (!habits.length) return null;
  const ids = new Set(habits.map(t => t.id));
  const t0 = today(), from = addDays(t0, -6);
  const logs = S.logs.filter(l => ids.has(l.task_id) && l.day >= from && l.day <= t0 && (l.status === 'done' || l.status === 'missed'));
  const done = logs.reduce((a, l) => a + logVal(l), 0); // частично сделанный день — по доле
  const r = logs.length ? done / logs.length : 1;
  const lvl = r >= .85 ? 3 : r >= .6 ? 2 : r >= .35 ? 1 : 0;
  const all = !habits.some(t => t.due_date && t.due_date <= t0);
  return { lvl, all, tip: `Привычки за неделю: ${num1(done)} из ${logs.length}${all ? ' · сегодня всё сделано' : ''}` };
}

// Кнопки разделов в настройках: только те, где есть привычки; светится = считается.
function flowerSecsHTML() {
  const keys = new Set(active().filter(t => t.kind === 'habit').map(flowerKey));
  if (!keys.size) return '';
  const pill = (id, label) => `<button class="pill ${flowerOff().includes(id) ? '' : 'on'}" data-act="flower-sec" data-id="${id}">${label}</button>`;
  return `<h2>Цветок</h2>
    <div class="flower-secs">${mySecs().filter(s => keys.has(s.id)).map(s => pill(s.id, `<i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}`)).join('')}${keys.has('none') ? pill('none', 'Без раздела') : ''}</div>`;
}

async function flowerSec(btn) {
  const id = btn.dataset.id, old = flowerOff();
  const set = off => {
    S.user.user_metadata.flower_off = off;
    btn.classList.toggle('on', !off.includes(id));
    render();
  };
  const off = old.includes(id) ? old.filter(x => x !== id) : [...old, id];
  set(off);
  const { error } = await sb.auth.updateUser({ data: { flower_off: off } });
  if (error) { set(old); toast('Не получилось сохранить: ' + error.message); }
}

function flowerSVG({ lvl, all }) {
  const leaf = ['#8a7a4a', '#9aa84e', '#5e9a4e', '#4f9a52'][lvl];
  const stem = ['#7a6a3e', '#7e9446', '#4f8443', '#447f45'][lvl];
  const droop = [38, 22, 0, -6][lvl]; // насколько опущены листья
  const L = (x, y, a, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${22 * s}" ry="${8 * s}" fill="${leaf}" transform="rotate(${a} ${x} ${y})"/>`;
  const bloom = (x, y, c) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="0" cy="-9" rx="6" ry="10" fill="${c}" transform="rotate(${a})"/>`).join('')}<circle r="5" fill="#f3d36b"/></g>`;
  const bud = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="8" fill="#e58aa8"/><path d="M${x - 5} ${y + 3}q5 6 10 0" fill="${leaf}"/>`;
  const heads = lvl === 3 ? bloom(60, 40, '#e8789a') + bloom(98, 58, '#f0a0b8') + bloom(30, 70, '#e8789a')
    : lvl === 2 ? bud(60, 44) + bud(96, 62)
    : lvl === 1 ? `<path d="M60 52q8 4 8 14" stroke="${stem}" stroke-width="3" fill="none"/><ellipse cx="68" cy="70" rx="5" ry="7" fill="#b07a8a"/>`
    : '';
  const fallen = lvl <= 1 ? `<ellipse cx="18" cy="196" rx="12" ry="4" fill="#8a7a4a"/>${lvl === 0 ? '<ellipse cx="112" cy="198" rx="11" ry="3.5" fill="#7a6a3e"/>' : ''}` : '';
  const fly = all ? `<g class="butterfly"><g transform="scale(1.4)"><path d="M0 0q-14-14-16 0q2 10 16 0q-10 14 2 14zM0 0q14-14 16 0q-2 10-16 0q10 14-2 14z" fill="#f3b04e"/><path d="M0-4v10" stroke="#3a2f28" stroke-width="2"/></g></g>` : '';
  return `<svg viewBox="0 0 130 210" aria-hidden="true">
    <path d="M64 150V${lvl === 0 ? 70 : 50}" stroke="${stem}" stroke-width="5" fill="none" stroke-linecap="round" transform="rotate(${lvl === 0 ? 8 : 0} 64 150)"/>
    <path d="M64 120Q40 100 32 76M66 104Q90 90 98 64" stroke="${stem}" stroke-width="4" fill="none" stroke-linecap="round"/>
    ${L(44, 126, -20 + droop)}${L(86, 118, 20 - droop)}${L(40, 96, -40 + droop, .9)}${L(88, 88, 40 - droop, .9)}${lvl ? L(62, 74, -70 + droop / 2, .8) : ''}
    ${heads}
    <path d="M30 148h70l-8 52H38z" fill="#b5623e"/><rect x="26" y="142" width="78" height="12" rx="3" fill="#c97750"/>
    ${fallen}${fly}
  </svg>`;
}

function bgSVG({ scene, tod, p, all, rain, late, bright }) {
  const gloom = Math.min(1, (1 - p) * .6 + (late ? .25 : 0) + rain * .15);
  const night = tod === 'night';
  const grey = night ? ['#11131b', '#1d2029'] : ['#69707f', '#9aa0ab'];
  const [top, bot] = SKY[tod].map((c, i) => mixHex(c, grey[i], gloom * .8));
  const r = seeded(SCENES.indexOf(scene) * 97);
  // солнце или луна: по дуге в зависимости от часа
  const hr = new Date().getHours() + new Date().getMinutes() / 60;
  const k = night ? ((hr + 2) % 24) / 8 : Math.min(Math.max((hr - 6) / 16, 0), 1);
  const cx = 200 + k * 1200, cy = 520 - Math.sin(k * Math.PI) * 380;
  const light = night
    ? `<circle cx="${cx}" cy="${cy}" r="34" fill="#f4f1e0" opacity="${.5 + .5 * (1 - gloom)}"/><circle cx="${cx + 14}" cy="${cy - 8}" r="30" fill="${top}" opacity="${.9 * (1 - gloom * .5)}"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${tod === 'day' ? 46 : 56}" fill="${tod === 'day' ? '#ffe68a' : '#ffb36b'}" opacity="${Math.max(.15, 1 - gloom)}"/>
       <circle cx="${cx}" cy="${cy}" r="${90 + (bright || 0) * 50}" fill="${tod === 'day' ? '#ffe68a' : '#ffb36b'}" opacity="${Math.max(0, .25 + (bright || 0) * .2 - gloom * .3)}"/>`;
  const stars = night || tod === 'evening'
    ? Array.from({ length: Math.round((night ? 70 : 25) * (1 - gloom * .8)) }, () => `<circle class="star" cx="${(r() * 1600).toFixed(0)}" cy="${(r() * 480).toFixed(0)}" r="${(.8 + r() * 1.6).toFixed(1)}" fill="#fff" style="animation-delay:-${(r() * 4).toFixed(1)}s"/>`).join('')
      + (all && night ? '<path class="shoot" d="M1200 90l-160 70" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>' : '')
    : '';
  const rainbow = all && !night && !rain
    ? `<g opacity=".55" fill="none" stroke-width="18">${['#e8545a', '#f2a24b', '#f2da5a', '#6fcf7a', '#5aa9e8', '#8a6fe0'].map((c, i) => `<path d="M${260 + i * 16} 700A${540 - i * 16} ${460 - i * 16} 0 0 1 ${1340 - i * 16} 700" stroke="${c}"/>`).join('')}</g>`
    : '';
  const nClouds = Math.round((1 - p) * 6) + (late ? 2 : 0) + rain * 2 + (p === 1 ? 1 : 0);
  const cloudC = mixHex(night ? '#3a3f55' : '#f5f7fb', night ? '#1a1c26' : '#5d6370', Math.min(1, gloom * 1.1));
  const clouds = Array.from({ length: nClouds }, (_, i) => {
    const q = seeded(i + 31), s = .7 + q() * .9, y = 60 + q() * 300;
    return `<g class="cloud" style="animation-duration:${(90 + q() * 90).toFixed(0)}s;animation-delay:-${(q() * 180).toFixed(0)}s"><g transform="translate(0 ${y.toFixed(0)}) scale(${s.toFixed(2)})" fill="${cloudC}" opacity="${(.75 + gloom * .25).toFixed(2)}">
      <ellipse cx="0" cy="30" rx="110" ry="34"/><ellipse cx="-50" cy="12" rx="56" ry="40"/><ellipse cx="34" cy="0" rx="66" ry="52"/></g></g>`;
  }).join('');
  const snowy = scene === 'winter';
  // капли/снежинки на высоту экрана и та же картинка над ней — сдвигаются вниз на 900 без пропусков
  const drops = rain || snowy ? Array.from({ length: snowy ? 70 + rain * 60 : 90 + rain * 70 }, () => {
    const x = (r() * 1700 - 50).toFixed(0), y = (r() * 900).toFixed(0);
    return snowy ? `<circle cx="${x}" cy="${y}" r="${(1.5 + r() * 2.5).toFixed(1)}" fill="#fff" opacity=".85"/>` : `<path d="M${x} ${y}l-8 26" stroke="#c9d6ea" stroke-width="1.6" opacity=".6"/>`;
  }).join('') : '';
  const fall = drops ? `<g class="${snowy ? 'snow' : 'rain'}">${drops}<g transform="translate(0 -900)">${drops}</g></g>` : '';
  const flash = rain === 2 ? '<rect class="flash" width="1600" height="900" fill="#fff"/>' : '';
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="bg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient></defs>
    <rect width="1600" height="900" fill="url(#bg-sky)"/>
    ${stars}${light}${rainbow}${clouds}
    ${SCENE_SVG[scene](tod, r)}
    <rect width="1600" height="900" fill="#0a0e22" opacity="${DARK[tod]}"/>
    <rect width="1600" height="900" fill="#5b616e" opacity="${(gloom * .18).toFixed(2)}"/>
    ${scene === 'city' ? cityLights(tod) : ''}
    ${fall}${flash}
  </svg>`;
}

// Пейзажи: рисуются от горизонта (≈620) вниз; r — свои случайные числа у каждого вида
const pines = (r, n, y0, h0, col, w = 1600) => Array.from({ length: n }, () => {
  const x = r() * w, h = h0 * (.7 + r() * .6);
  return `<path d="M${x.toFixed(0)} ${(y0 - h).toFixed(0)}l${(h * .28).toFixed(0)} ${h.toFixed(0)}h${(-h * .56).toFixed(0)}z" fill="${col}"/>`;
}).join('');
let CITY = [];
const SCENE_SVG = {
  city(tod, r) {
    CITY = [];
    let x = -20, out = '';
    for (const [y0, cols, hMin, hMax] of [[700, ['#3a4560', '#36405a', '#414c68'], 160, 330], [760, ['#262d40', '#2b3348', '#222839'], 120, 260]]) {
      x = -20 - r() * 60;
      while (x < 1640) {
        const w = 90 + r() * 90, h = hMin + r() * (hMax - hMin), c = cols[Math.floor(r() * cols.length)];
        out += `<rect x="${x.toFixed(0)}" y="${(y0 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 200).toFixed(0)}" fill="${c}"/>`;
        for (let wy = y0 - h + 18; wy < y0 - 20; wy += 30) for (let wx = x + 14; wx < x + w - 20; wx += 26) CITY.push([wx, wy, r()]);
        x += w + 4 + r() * 20;
      }
    }
    return out + `<rect y="830" width="1600" height="70" fill="#2a2e38"/><rect y="826" width="1600" height="6" fill="#4a505e"/>
      ${[200, 620, 1040, 1460].map(lx => `<rect x="${lx}" y="720" width="5" height="108" fill="#1b1e27"/><circle cx="${lx + 2}" cy="718" r="9" fill="${tod === 'day' ? '#9aa0ab' : '#ffd98a'}"/>`).join('')}`;
  },
  forest(tod, r) {
    return `<path d="M0 640Q400 560 800 620T1600 600V900H0z" fill="#3f6f5a"/>${pines(r, 40, 650, 150, '#2e5e4e')}
      <path d="M0 720Q500 650 1000 710T1600 690V900H0z" fill="#335a44"/>${pines(r, 26, 740, 210, '#24493d')}
      <path d="M0 800Q600 760 1100 800T1600 790V900H0z" fill="#2a4a33"/>${pines(r, 12, 830, 280, '#1a3a30')}`;
  },
  sea(tod, r) {
    const sun = tod === 'night' ? '#f4f1e0' : '#ffd98a';
    return `<rect y="600" width="1600" height="300" fill="#2a6f97"/><rect y="600" width="1600" height="300" fill="url(#bg-sky)" opacity=".25"/>
      <path d="M1100 600Q1250 540 1400 570T1600 590V600H1100z" fill="#4c6a5a"/>
      ${Array.from({ length: 14 }, (_, i) => `<path class="wave" style="animation-delay:-${(i * .7).toFixed(1)}s" d="M${(r() * 1500).toFixed(0)} ${620 + i * 20}q20 -6 40 0t40 0" stroke="#bfe0f2" stroke-width="2" fill="none" opacity=".45"/>`).join('')}
      <rect x="760" y="610" width="80" height="250" fill="${sun}" opacity=".12"/>
      <g class="boat"><path d="M1000 640h90l-14 16h-62z" fill="#e9e3d6"/><path d="M1040 640v-70l38 62z" fill="#f5f2ea"/><path d="M1036 640v-56l-28 48z" fill="#d8cfbe"/></g>
      <path d="M0 820Q400 790 800 830T1600 810V900H0z" fill="#d9c79a"/>`;
  },
  mountains(tod, r) {
    return `<path d="M-50 640L180 380L330 520L520 300L760 600L940 360L1150 580L1330 330L1650 640V900H-50z" fill="#6a7fa0"/>
      <path d="M180 380l40 46-30-8-26 22-24-20zM520 300l50 60-36-10-30 26-30-28zM940 360l46 54-34-8-26 22-28-24zM1330 330l50 58-36-10-30 24-30-26z" fill="#eef3fa"/>
      <path d="M-50 700L260 520L520 690L800 540L1100 700L1380 560L1650 700V900H-50z" fill="#4d6185"/>
      <path d="M0 770Q400 720 800 760T1600 750V900H0z" fill="#4f7a52"/>${pines(r, 18, 790, 120, '#2f5a3e')}`;
  },
  village(tod, r) {
    return `<path d="M0 660Q400 580 800 640T1600 620V900H0z" fill="#6f9a56"/>
      <path d="M0 740Q500 680 1000 730T1600 720V900H0z" fill="#5b8c4a"/>
      <g><rect x="1060" y="600" width="150" height="110" fill="#c9a77c"/><path d="M1045 604l90-70 90 70z" fill="#8a4b3a"/>
        <rect x="1150" y="640" width="34" height="70" fill="#6a4630"/><rect x="1080" y="630" width="40" height="34" fill="${tod === 'day' ? '#a9d4f5' : '#ffd98a'}"/></g>
      <g fill="#a37b52">${Array.from({ length: 30 }, (_, i) => `<rect x="${i * 54}" y="770" width="8" height="46"/>`).join('')}<rect y="784" width="1600" height="6"/><rect y="802" width="1600" height="6"/></g>
      <g><rect x="300" y="600" width="18" height="120" fill="#6a4a32"/><circle cx="309" cy="590" r="64" fill="#4a7a3c"/><circle cx="280" cy="560" r="10" fill="#e05a5a"/><circle cx="335" cy="600" r="10" fill="#e05a5a"/></g>
      <path d="M0 830Q600 800 1200 830T1600 820V900H0z" fill="#4a7a3c"/>`;
  },
  winter(tod, r) {
    return `<path d="M0 650Q400 590 800 640T1600 620V900H0z" fill="#dfe7f1"/>${pines(r, 30, 670, 160, '#3e5e5a')}
      <path d="M0 740Q500 690 1000 730T1600 720V900H0z" fill="#eef3f9"/>${pines(r, 12, 760, 230, '#2f4e4a')}
      <path d="M0 820Q600 790 1200 820T1600 810V900H0z" fill="#f7f9fc"/>
      <g><rect x="700" y="640" width="130" height="90" fill="#9c6b4e"/><path d="M688 644l77-58 77 58z" fill="#f3f6fa"/><rect x="740" y="670" width="30" height="26" fill="${tod === 'day' ? '#a9d4f5' : '#ffd98a'}"/></g>`;
  },
};
// Окна домов: вечером и ночью часть горит
function cityLights(tod) {
  const on = tod === 'night' ? .35 : tod === 'evening' ? .6 : tod === 'dawn' ? .2 : 0;
  return CITY.map(([x, y, q]) => `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="12" height="16" fill="${q < on ? '#ffd27a' : '#8fb0d0'}" opacity="${q < on ? .9 : tod === 'day' ? .35 : .12}"/>`).join('');
}

// Счётчики: подошёл срок — картинка сбоку (на телефоне — вверху «Сегодня»). Только картинка, без текста;
// щелчок — открыть задачу. Сбоку картинку можно перетащить мышкой куда угодно (место — в localStorage tm.meter).
// where: 'side' — сбоку на широком экране (на всех вкладках), 'top' — вверху «Сегодня» на остальных экранах
function meterCard(where) {
  const t0 = today();
  const due = active().filter(t => t.decor === 'meter' && !isEvent(t) && ((reviewDay(t) && reviewDay(t) <= t0) || (t.start_date && t.start_date <= t0)));
  if (!due.length || S.view === 'plan') return '';
  let pos = '';
  if (where === 'side') {
    try {
      const p = JSON.parse(localGet('meter'));
      if (p) pos = ` style="left:${p.x * 100}%;top:${p.y * 100}%;translate:none"`;
    } catch { }
  }
  return `<aside class="meter-card ${where}"${pos} title="${where === 'side' ? 'Можно перетащить мышкой' : ''}">
    ${due.map(t => `<button class="meter-btn" data-act="edit" data-id="${t.id}" title="${esc(t.title)}">${meterSVG(meterKind(t.title))}</button>`).join('')}
  </aside>`;
}

// Какой счётчик рисовать — по названию задачи
function meterKind(title) {
  const s = title.toLowerCase();
  if (/вод|water/.test(s)) return 'water';
  if (/свет|электр|light|квт/.test(s)) return 'power';
  return 'gas';
}

// Цифры: последняя (красная) крутится
const meterDigits = (x, y, n, fg, bg) => `
  ${[...n].map((d, i) => `<rect x="${x + i * 22}" y="${y}" width="19" height="24" rx="3" fill="${bg}"/><text x="${x + 9.5 + i * 22}" y="${y + 18}" text-anchor="middle" font-size="17" font-weight="700" font-family="monospace" fill="${fg}">${d}</text>`).join('')}
  <rect x="${x + n.length * 22}" y="${y}" width="19" height="24" rx="3" fill="#e05a5a"/>
  <svg x="${x + n.length * 22}" y="${y}" width="19" height="24" viewBox="0 0 19 24"><g class="roll">${[8, 9, 0, 1].map((d, i) => `<text x="9.5" y="${18 + i * 24}" text-anchor="middle" font-size="17" font-weight="700" font-family="monospace" fill="#fff">${d}</text>`).join('')}</g></svg>`;

// gas — жёлтый ящик с колёсиком, water — круглый синий с вертушкой, power — серый с мигающей лампочкой
function meterSVG(kind) {
  if (kind === 'water') return `<svg class="meter-svg" viewBox="0 0 160 150" aria-hidden="true">
    <rect x="4" y="66" width="22" height="18" rx="3" fill="#b9935a"/><rect x="134" y="66" width="22" height="18" rx="3" fill="#b9935a"/>
    <circle cx="80" cy="75" r="66" fill="#2f6fb8" stroke="#1f4f88" stroke-width="4"/>
    <circle cx="80" cy="75" r="54" fill="#eef3fa"/>
    <text x="80" y="38" text-anchor="middle" fill="#2f6fb8" font-size="12" font-weight="700" font-family="sans-serif">ВОДА</text>
    <rect x="30" y="46" width="100" height="30" rx="4" fill="#16161c"/>
    ${meterDigits(33, 49, '0123', '#16161c', '#f2f2f5')}
    <text x="80" y="90" text-anchor="middle" fill="#5a6a85" font-size="10" font-family="sans-serif">м³</text>
    <circle cx="80" cy="108" r="11" fill="#fff" stroke="#9fb3cc"/>
    <g class="spin-wheel" style="transform-origin:80px 108px"><path d="M80 99l4 9-4 9-4-9z" fill="#e05a5a"/></g>
  </svg>`;
  if (kind === 'power') return `<svg class="meter-svg" viewBox="0 0 160 130" aria-hidden="true">
    <rect x="10" y="6" width="140" height="118" rx="10" fill="#d9dbe3" stroke="#8b90a5" stroke-width="2"/>
    <text x="80" y="26" text-anchor="middle" fill="#3a3d4d" font-size="12" font-weight="700" font-family="sans-serif">СВЕТ</text>
    <rect x="24" y="36" width="112" height="32" rx="4" fill="#16161c"/>
    ${meterDigits(28, 40, '0815', '#16161c', '#f2f2f5')}
    <text x="80" y="86" text-anchor="middle" fill="#3a3d4d" font-size="10" font-family="sans-serif">кВт·ч</text>
    <circle class="lamp" cx="122" cy="104" r="5" fill="#e05a5a"/>
    <rect x="30" y="98" width="60" height="12" rx="3" fill="#b4b8c7"/>
  </svg>`;
  return `<svg class="meter-svg" viewBox="0 0 160 120" aria-hidden="true">
    <rect x="6" y="10" width="148" height="100" rx="16" fill="#e0b640" stroke="#a88420" stroke-width="2"/>
    <rect x="6" y="10" width="148" height="22" rx="11" fill="#c99c25"/>
    <text x="80" y="26" text-anchor="middle" fill="#3a2d08" font-size="12" font-weight="700" font-family="sans-serif">ГАЗ · м³</text>
    <rect x="18" y="40" width="124" height="32" rx="5" fill="#16161c"/>
    ${meterDigits(26, 44, '0472', '#16161c', '#f2f2f5')}
    <circle cx="44" cy="92" r="11" fill="#16161c"/><g class="spin-wheel" style="transform-origin:44px 92px"><path d="M44 83v18M35 92h18M38 86l12 12M50 86l-12 12" stroke="#ffd96a" stroke-width="2.4"/></g>
    <circle cx="116" cy="92" r="11" fill="#f2f2f5"/><path class="needle" d="M116 92l0 -9" stroke="#e05a5a" stroke-width="2.4" stroke-linecap="round" style="transform-origin:116px 92px"/>
  </svg>`;
}

// Перетаскивание картинки счётчиков (только та, что сбоку). Если двигали — щелчок не открывает задачу.
let meterDrag = null;
document.addEventListener('pointerdown', ev => {
  const card = ev.target.closest('.meter-card.side');
  if (!card || ev.button !== 0) return;
  const r = card.getBoundingClientRect();
  meterDrag = { card, dx: ev.clientX - r.left, dy: ev.clientY - r.top, x0: ev.clientX, y0: ev.clientY, moved: false };
});
document.addEventListener('pointermove', ev => {
  const d = meterDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return;
  d.moved = true;
  ev.preventDefault();
  const w = d.card.offsetWidth, h = d.card.offsetHeight;
  const x = Math.min(Math.max(ev.clientX - d.dx, 0), innerWidth - w);
  const y = Math.min(Math.max(ev.clientY - d.dy, 0), innerHeight - h);
  Object.assign(d.card.style, { left: x + 'px', top: y + 'px', translate: 'none' });
  d.x = x / innerWidth; d.y = y / innerHeight;
});
document.addEventListener('pointerup', () => {
  const d = meterDrag;
  meterDrag = null;
  if (!d?.moved) return;
  localSet('meter', JSON.stringify({ x: d.x, y: d.y }));
  addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
});

// ---------- питомцы (личный режим, широкий экран) ----------
const PETS = { cat: { icon: '🐱', def: 'Котик' }, bird: { icon: '🦜', def: 'Попугай' } };
// У задачи может быть один питомец или оба ('both' — общая забота: вода, миски)
const petsOf = t => (t.pet === 'both' ? ['cat', 'bird'] : PETS[t.pet] ? [t.pet] : []);
const petName = p => S.user?.user_metadata?.pets?.[p] || PETS[p].def;
// Питомца можно выключить в ⚙ (user_metadata.pets_off): его не видно, у задач не показывается значок.
// В самих задачах поле pet не трогаем — включишь обратно, всё вернётся.
const petOn = p => !(S.user?.user_metadata?.pets_off || []).includes(p);
const shownPets = t => petsOf(t).filter(petOn);
async function petToggle(btn) {
  const p = btn.dataset.v, old = S.user.user_metadata.pets_off || [];
  const set = off => { S.user.user_metadata.pets_off = off; btn.classList.toggle('on', !off.includes(p)); render(); };
  const off = old.includes(p) ? old.filter(x => x !== p) : [...old, p];
  set(off);
  const { error } = await sb.auth.updateUser({ data: { pets_off: off } });
  if (error) { set(old); toast('Не получилось сохранить: ' + error.message); }
}
const MOODS = { happy: 'Доволен', meh: 'Немного грустит', sad: 'Очень грустит', faint: 'В обмороке!' };
const moodOf = n => (n >= lim('faint') ? 'faint' : n >= lim('sad') ? 'sad' : n >= lim('meh') ? 'meh' : 'happy');

// Пороги: со скольких дней просрочки (у привычки — пропусков подряд) меняются питомцы и пыль. Хранятся в аккаунте, в ⚙ можно поменять.
const LIMITS = {
  meh: { def: 1, name: '😐 Питомец немного грустит' },
  sad: { def: 2, name: '😢 Очень грустит' },
  faint: { def: 4, name: '😵 В обмороке' },
  dust: { def: 4, name: '🕸 Паутина, пыль и пятна на экране' },
  dust2: { def: 8, name: '🕸🕸 Паутина в обоих углах, пыли больше' },
};
const lim = k => Math.max(1, +(S.user?.user_metadata?.limits?.[k]) || LIMITS[k].def);

async function saveLimits() {
  const limits = {};
  for (const k in LIMITS) limits[k] = Math.max(1, parseInt(document.getElementById('lim-' + k).value) || LIMITS[k].def);
  if (limits.meh > limits.sad || limits.sad > limits.faint) return toast('Должно идти по порядку: «немного грустит» ≤ «очень грустит» ≤ «обморок»');
  if (limits.dust > limits.dust2) return toast('Сильная пыль должна начинаться не раньше обычной');
  const { data, error } = await sb.auth.updateUser({ data: { limits } });
  if (error) return toast('Не получилось сохранить: ' + error.message);
  S.user = data.user;
  toast('Сохранено');
  render();
}

// Насколько задача запущена: у привычки — сколько раз подряд пропущена,
// у обычной — сколько дней прошло от первоначального срока (утренняя проверка переносит его на сегодня).
// Срок убран или перенесён в будущее — старые переносы из истории уже не считаются.
function petLate(t) {
  if (!t.due_date) return 0;
  const logs = S.logs.filter(l => l.task_id === t.id);
  let i = logs.length;
  while (i > 0 && logs[i - 1].status !== 'done') i--;
  const tail = logs.slice(i);
  // привычка: сделано хотя бы наполовину — питомцы не считают это пропуском
  if (t.kind === 'habit') return tail.filter(l => l.status === 'missed' && !(+l.part >= .5)).length + (t.due_date < today() ? 1 : 0);
  if (t.due_date > today()) return 0;
  const moved = tail.find(l => l.status === 'moved');
  const since = moved ? moved.day : t.due_date;
  return since && since < today() ? daysBetween(since, today()) : 0;
}

function petState(p) {
  const late = activeAll().filter(t => petsOf(t).includes(p) && !pausedSec(t.section_id))
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
const petsShown = () => !!(S.user && S.loaded && S.space === 'personal' && S.view !== 'plan' && S.tasks.some(t => shownPets(t).length));

function updatePets() {
  if (!$pets) {
    if (!petsShown()) return;
    $pets = document.createElement('div');
    $pets.id = 'pets';
    $pets.innerHTML = `<div class="perch left">${perchSVG()}</div><div class="perch right">${perchSVG(true)}</div>
      <aside class="pet cat"></aside><aside class="pet bird"></aside>`;
    if ($bg) $bg.after($pets); else document.body.prepend($pets); // вид за окном — всегда позади питомцев
    petsLoop();
  }
  $pets.hidden = !petsShown();
  for (const p in PETS) $pets.querySelector('.pet.' + p).hidden = !petOn(p);
  $pets.querySelectorAll('.perch').forEach(el => { el.hidden = !petOn('bird'); }); // жёрдочки — Яшины
  if (!$pets.hidden) { Object.keys(PETS).filter(petOn).forEach(fillPet); placePerches(); }
}

// Ветки можно перетащить мышкой (за ветку или за Яшу); места — в localStorage tm.perch, в долях экрана.
// Яша сидит там же, где его ветка; если её унесли — перелетает следом.
function perchSaved() { try { return JSON.parse(localGet('perch')) || {}; } catch { return {}; } }
function placePerches() {
  if (!$pets) return;
  const saved = perchSaved();
  const at = s => saved[s] ? { left: saved[s].x * 100 + 'vw', top: saved[s].y * 100 + 'vh' } : { left: '', top: '' };
  for (const s of ['left', 'right']) Object.assign($pets.querySelector('.perch.' + s).style, at(s));
  if (!perchDrag) Object.assign($pets.querySelector('.pet.bird').style, at(P.bird.side));
}

let perchDrag = null;
document.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || !$pets || $pets.hidden || ev.target.closest('.pet-text')) return;
  const el = ev.target.closest('#pets .perch, #pets .pet.bird:not(.moving)');
  if (!el) return;
  const side = el.classList.contains('perch') ? (el.classList.contains('left') ? 'left' : 'right') : P.bird.side;
  const perch = $pets.querySelector('.perch.' + side);
  const cs = getComputedStyle(perch);
  perchDrag = { side, perch, x0: ev.clientX, y0: ev.clientY, l0: parseFloat(cs.left), t0: parseFloat(cs.top), moved: false };
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  const d = perchDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return;
  d.moved = true;
  d.x = Math.min(Math.max(d.l0 + ev.clientX - d.x0, -60), innerWidth - 140) / innerWidth;
  d.y = Math.min(Math.max(d.t0 + ev.clientY - d.y0, 0), innerHeight - 120) / innerHeight;
  Object.assign(d.perch.style, { left: d.x * 100 + 'vw', top: d.y * 100 + 'vh' });
});
document.addEventListener('pointerup', () => {
  const d = perchDrag;
  perchDrag = null;
  if (!d?.moved) return;
  localSet('perch', JSON.stringify({ ...perchSaved(), [d.side]: { x: d.x, y: d.y } }));
  if (d.side !== P.bird.side || P.bird.moving) return placePerches();
  // унесли ветку с Яшей — он летит к ней
  P.bird.moving = true;
  fillPet('bird');
  void $pets.querySelector('.pet.bird').offsetWidth;
  placePerches();
  setTimeout(() => { P.bird.moving = false; P.bird.arrived = Date.now(); fillPet('bird'); }, MOVE_MS.bird);
  addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
});

// Перерисовать питомца, только если что-то поменялось (настроение, поза, подписи).
function fillPet(p) {
  const el = $pets.querySelector('.pet.' + p);
  const st = petState(p);
  const pose = P[p].moving ? (p === 'cat' ? 'walk' : 'fly') : st.mood;
  const arrived = P[p].arrived && Date.now() - P[p].arrived < 1500; // только что пришёл — садится
  el.className = `pet ${p} m-${st.mood} ${P[p].side}${P[p].moving ? ' moving' : ''}${arrived ? ' arrived' : ''}`;
  const joy = S.petJoy && S.petJoy.pets.includes(p) && Date.now() - S.petJoy.at < 4000 ? S.petJoy.at : 0;
  const why = st.late.slice(0, 3).map(([t, n]) => `<li>${esc(t.title)} — ${t.kind === 'habit' ? `пропущено ${n} р.` : `${n} дн.`}</li>`).join('');
  const sig = JSON.stringify([pose, P[p].dir, petName(p), why, joy]);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const pic = pose === 'walk' ? catWalkSVG(P[p].dir === 'left') : pose === 'fly' ? birdFlySVG() : p === 'cat' ? catSVG(pose) : birdSVG(pose);
  const text = `<button class="pet-name" data-act="pet-name" data-v="${p}" title="Переименовать">${esc(petName(p))}</button>
      <div class="pet-tip"><div class="pet-mood">${MOODS[st.mood]}</div>${why ? `<ul class="pet-why">${why}</ul>` : ''}</div>`; // видно при наведении
  el.innerHTML = (joy ? '<div class="hearts"><span>♥</span><span>♥</span><span>♥</span></div>' : '')
    + (p === 'cat' ? `<div class="pet-text">${text}</div>${pic}` : pic + `<div class="pet-text">${text}</div>`);
}

// Щелчок по коту — он переходит на другую сторону (если в настроении).
document.addEventListener('click', ev => {
  if (!ev.target.closest('#pets .pet.cat:not(.moving) .pet-svg')) return;
  const mood = petState('cat').mood;
  if (mood === 'sad' || mood === 'faint') return toast(`${petName('cat')} не хочет гулять — ему грустно`);
  petMove('cat');
});

// Иногда кот проходит позади задач на другую сторону, а Яша перелетает на другую ветку.
function petsLoop() {
  setTimeout(() => { petMove(); petsLoop(); }, 25000 + Math.random() * 35000);
}

function petMove(p = Math.random() < .5 ? 'cat' : 'bird') {
  if (!$pets || $pets.hidden || document.hidden || !petOn(p) || P[p].moving) return;
  const mood = petState(p).mood;
  if (mood === 'faint' || mood === 'sad' || (p === 'bird' && mood !== 'happy')) return; // грустным не до прогулок
  const to = P[p].side === 'left' ? 'right' : 'left';
  P[p].moving = true;
  P[p].dir = to;
  fillPet(p);
  void $pets.querySelector('.pet.' + p).offsetWidth; // зафиксировать старое место, чтобы сработал плавный переход
  P[p].side = to;
  fillPet(p);
  if (p === 'bird') placePerches();
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

// Подвесная жёрдочка для Яши: верёвки уходят вверх за край экрана (с двух сторон; flip — зеркально)
const perchSVG = flip => `<svg class="pet-svg" viewBox="0 0 200 210" aria-hidden="true" style="${flip ? 'transform:scaleX(-1)' : ''}">
    <path d="M36 -1600V166M164 -1600V166" stroke="#c9b48a" stroke-width="3"/>
    ${[40, 90, 128].map((y, i) => `<circle cx="36" cy="${y}" r="5" fill="${['#e58aa8', '#6fb3d2', '#f3d36b'][i]}"/><circle cx="164" cy="${y + 14}" r="5" fill="${['#6fb3d2', '#f3d36b', '#e58aa8'][i]}"/>`).join('')}
    <rect x="22" y="160" width="156" height="10" rx="5" fill="#8a6a4a"/>
    <circle cx="36" cy="165" r="6" fill="#6b5038"/><circle cx="164" cy="165" r="6" fill="#6b5038"/>
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
    <span class="pick-n" aria-label="Выбрано">${n}</span>
    <button class="btn main" data-act="bulk" aria-label="Изменить" ${n ? '' : 'disabled'}>✎</button>
    <button class="btn danger" data-act="bulk-delete" aria-label="Удалить" ${n ? '' : 'disabled'}>🗑</button>
    <button class="btn" data-act="pick-end" aria-label="Готово">✓</button>
  </div>`;
}

const KEEP = '__keep';

function openBulk() {
  $modal.dataset.kind = 'bulk';
  S.bulk = { weekdays: [], from: 'due' };
  const opt = (v, n) => `<option value="${v}">${n}</option>`;
  const personal = S.space === 'personal';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet edit fixed">
    <h3>Изменить задачи: ${S.pick.size}</h3>
    <div class="cols"><div>
    <div class="field"><label>Срок</label>
      <div class="row bpair"><select class="inp" id="b-datemode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить дату')}${opt('none', 'Без срока')}</select>
      <input class="inp" id="b-date" type="date" value="${today()}"></div></div>
    <div class="field"><label>Начать с</label>
      <div class="row bpair"><select class="inp" id="b-startmode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить дату')}${opt('none', 'Убрать')}</select>
      <input class="inp" id="b-start" type="date" value="${today()}"></div></div>
    <div class="field"><label>Время</label>
      <div class="row bpair"><select class="inp" id="b-timemode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить время')}${opt('none', 'Без времени')}</select>
      <div class="row" id="b-time-box"><input class="inp" id="b-t1" type="time" value="09:00">–<input class="inp" id="b-t2" type="time"></div></div></div>
    <div class="field"><label>Напомнить на телефон</label>
      <div class="row bpair"><select class="inp" id="b-remindmode">${opt(KEEP, '— не менять —')}${opt('set', 'В это время')}${opt('none', 'Не напоминать')}</select>
      <input class="inp" id="b-remind" type="time" value="09:00"></div></div>
    ${planOn() || S.space === 'work' ? `<div class="field"><label>План: день, когда делаю</label>
      <div class="row bpair"><select class="inp" id="b-planmode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить день')}${opt('none', 'Убрать план')}</select>
      <input class="inp" id="b-plan" type="date" value="${today()}"></div></div>
    <div class="field"><label>Займёт часов</label>
      <div class="row bpair"><select class="inp" id="b-estmode">${opt(KEEP, '— не менять —')}${opt('set', 'Поставить')}${opt('none', 'Убрать')}</select>
      <input class="inp num" id="b-est" type="number" min="0" step="0.5" value="1" style="max-width:90px"></div></div>` : ''}
    <div class="field"><label>Вид</label>
      <select class="inp" id="b-kind">${opt(KEEP, '— не менять —')}${opt('task', 'Обычная')}${opt('habit', 'Привычка')}${opt('event', 'Событие')}</select></div>
    <div class="field"><label>Раздел</label>
      <select class="inp" id="b-section">${opt(KEEP, '— не менять —')}${opt('', 'Без раздела')}${mySecs().map(s => opt(s.id, esc(s.name))).join('')}</select></div>
    </div><div>
    <div class="field"><label>Повтор</label>
      <div class="row">
        <select class="inp" id="b-unit">${opt(KEEP, '— не менять —')}${opt('', 'Не повторять')}${opt('day', 'Дни')}${opt('week', 'Недели')}${opt('month', 'Месяцы')}${opt('year', 'Годы')}</select>
        <span id="b-every-box" class="row" style="flex:1">каждые <input class="inp" id="b-every" type="number" min="1" value="1" style="max-width:80px"></span>
      </div></div>
    <div class="field" id="b-wd-box"><label>Дни недели</label>
      <div class="wds">${WD.map((w, i) => `<button class="pill" data-act="b-wd" data-v="${i + 1}">${w}</button>`).join('')}</div></div>
    <div class="field" id="b-from-box"><label>Новый срок считать</label>
      <div class="seg">
        <button class="pill" data-act="b-from" data-v="due">от старого срока</button>
        <button class="pill" data-act="b-from" data-v="done">от дня выполнения</button>
      </div></div>
    ${personal ? `<div class="field"><label>Размер</label>
      <select class="inp" id="b-size">${opt(KEEP, '— не менять —')}${opt('', 'Нет (или как у раздела)')}${Object.entries(SIZES).map(([k, z]) => opt(k, z.icon + ' ' + z.name)).join('')}</select></div>
    <div class="field" id="b-slot-box"><label>Когда</label>
      <select class="inp" id="b-slot">${opt('', 'Без окошка')}${Object.entries(SLOTS).map(([k, s]) => opt(k, s.name)).join('')}</select></div>
    <div class="field"><label>Питомец</label>
      <select class="inp" id="b-pet">${opt(KEEP, '— не менять —')}${opt('', 'Нет')}${Object.keys(PETS).filter(petOn).map(p => opt(p, PETS[p].icon + ' ' + esc(petName(p)))).join('')}${Object.keys(PETS).filter(petOn).length === 2 ? opt('both', 'Оба') : ''}</select></div>
    <div class="field"><label>Картинка</label>
      <select class="inp" id="b-decor">${opt(KEEP, '— не менять —')}${opt('', 'Нет')}${Object.entries(DECOR).map(([k, d]) => opt(k, d.icon + ' ' + d.name)).join('')}</select></div>` : ''}
    </div></div>
    <div class="actions"><span></span>
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="bulk-save">Применить</button></div>
    </div>
  </div></div>`;
  BULK_MODES.concat(['b-unit', 'b-size']).forEach(id => { const el = document.getElementById(id); if (el) el.onchange = syncBulk; });
  syncBulk();
}

// «режим → поле»: поле видно, когда выбрано «поставить»
const BULK_MODES = ['b-datemode', 'b-startmode', 'b-timemode', 'b-remindmode', 'b-planmode', 'b-estmode'];
const BULK_FIELD = { 'b-datemode': 'b-date', 'b-startmode': 'b-start', 'b-timemode': 'b-time-box', 'b-remindmode': 'b-remind', 'b-planmode': 'b-plan', 'b-estmode': 'b-est' };

function syncBulk() {
  const unit = document.getElementById('b-unit').value;
  for (const m of BULK_MODES) { const el = document.getElementById(m); if (el) document.getElementById(BULK_FIELD[m]).style.display = el.value === 'set' ? '' : 'none'; }
  const size = document.getElementById('b-size');
  if (size) document.getElementById('b-slot-box').style.display = size.value === 'mid' || size.value === 'idea' ? '' : 'none';
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
  const has = id => document.getElementById(id);
  const mode = id => (has(id) ? v(id) : KEEP);
  if (mode('b-startmode') !== KEEP) upd.start_date = mode('b-startmode') === 'set' ? v('b-start') || today() : null;
  if (mode('b-timemode') === 'set') {
    if (!v('b-t1')) return toast('Укажи время');
    upd.start_time = v('b-t1');
    upd.end_time = v('b-t2') && v('b-t2') > v('b-t1') ? v('b-t2') : null;
  }
  if (mode('b-timemode') === 'none') { upd.start_time = null; upd.end_time = null; }
  if (mode('b-remindmode') !== KEEP) { upd.remind_at = mode('b-remindmode') === 'set' ? v('b-remind') || '09:00' : null; upd.reminded_on = null; }
  if (mode('b-planmode') !== KEEP) upd.plan_date = mode('b-planmode') === 'set' ? v('b-plan') || today() : null;
  if (mode('b-estmode') !== KEEP) upd.estimate = mode('b-estmode') === 'set' ? parseFloat(v('b-est').replace(',', '.')) || null : null;
  if (mode('b-size') !== KEEP) { upd.size = v('b-size') || null; upd.slot = upd.size === 'mid' || upd.size === 'idea' ? v('b-slot') || null : null; }
  if (mode('b-pet') !== KEEP) upd.pet = v('b-pet') || null;
  if (mode('b-decor') !== KEEP) upd.decor = v('b-decor') || null;
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
const GEAR0 = '<button class="icon" data-act="pay" aria-label="Платежи">💳</button><button class="icon" data-act="occ" aria-label="Что случилось сегодня">☀</button><button class="icon" data-act="help" aria-label="Справка">?</button><button class="icon" data-act="settings" aria-label="Настройки">⚙</button>';
const GEARS = { get v() { return booksIcon() + GEAR0; } };

// ---------- случаи (☀): то, что нельзя запланировать заранее ----------
const occasions = () => S.tasks.filter(t => t.kind === 'occasion').sort(byPos);
function openOcc() {
  $modal.dataset.kind = 'occ';
  const t0 = today();
  const list = occasions();
  const lastDay = id => S.logs.filter(l => l.task_id === id && l.status === 'done').map(l => l.day).sort().pop();
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet occ">
    <h3>Что случилось сегодня?</h3>
    ${list.length ? '' : '<div class="empty small">Случаев пока нет</div>'}
    <div class="occ-list">${list.map(t => {
      const kids = S.tasks.filter(x => x.wake_after === t.id).sort(byPos);
      const last = lastDay(t.id);
      const done = last === t0;
      return `<div class="occ-row">
        <button class="btn occ-go ${done ? 'good' : ''}" data-act="occ-go" data-id="${t.id}" ${done ? 'disabled' : ''}>${done ? '✓ ' : ''}${esc(t.title)}</button>
        <button class="icon small" data-act="edit" data-id="${t.id}" aria-label="Изменить">✎</button>
        <div class="hint">${kids.length ? '→ ' + kids.map(k => esc(k.title)).join(' · ') : 'Нет задач «Следом»'}${last && !done ? ` · прошлый раз: ${dateLabel(last)}` : ''}</div>
      </div>`;
    }).join('')}</div>
    <div class="actions"><button class="link" data-act="occ-new">+ Новый случай</button><button class="btn" data-act="close">Закрыть</button></div>
  </div></div>`;
}

// ---------- платежи (💳): «дата, сумма, за что» — потом разнести в Excel, отметить «внесла» ----------
// Грузятся только при открытии окна. Внесённые хранятся в архиве (показываются за последние 3 месяца).
async function openPay() {
  $modal.dataset.kind = 'pay';
  S.pay = S.pay || { list: [], arch: false, edit: null, loaded: false, on: true };
  S.pay.edit = null;
  renderPay(true);
  await loadPay();
}
async function loadPay() {
  const { data, error } = await sb.from('payments').select('*')
    .or(`done_on.is.null,done_on.gte.${addDays(today(), -92)}`).order('paid_on').order('id');
  Object.assign(S.pay, error ? { on: false, loaded: true } : { list: data, on: true, loaded: true });
  if ($modal.dataset.kind === 'pay') renderPay();
}
const payDate = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : ''); // всегда числом: 11.11.26 (её просьба)
const money = n => (n == null || n === '' ? '' : (+n).toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 }) + ' ₴');
const parseMoney = s => { const x = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? Math.round(x * 100) / 100 : null; };
// reset — очистить поля ввода (иначе введённое сохраняется при перерисовке)
function renderPay(reset = false) {
  const p = S.pay;
  const val = id => (reset ? null : document.getElementById(id)?.value);
  const kept = { d: val('pay-d'), a: val('pay-a'), w: val('pay-w') };
  const open = p.list.filter(x => !x.done_on);
  const arch = p.list.filter(x => x.done_on).sort((a, b) => b.done_on.localeCompare(a.done_on) || b.paid_on.localeCompare(a.paid_on));
  const sum = open.reduce((s, x) => s + (+x.amount || 0), 0);
  const e = p.edit && p.list.find(x => String(x.id) === p.edit);
  const row = x => `<div class="pay-row${x.done_on ? ' done' : ''}${e && String(e.id) === String(x.id) ? ' picked' : ''}" data-act="pay-edit" data-id="${x.id}">
      <span class="pay-d">${payDate(x.paid_on)}</span><b class="pay-a">${money(x.amount)}</b><span class="pay-w">${esc(x.what)}</span>
      ${x.done_on ? `<button class="icon small" data-act="pay-back" data-id="${x.id}" aria-label="Вернуть в невнесённые">↩</button>`
        : `<button class="btn yes" data-act="pay-done" data-id="${x.id}" aria-label="Внесла">✓</button>`}</div>`;
  const list = !p.loaded ? '<div class="empty small">Загружаю…</div>'
    : !p.on ? '<div class="empty small">⚠ Нет таблицы платежей: запусти в Supabase файл 020_payments_howto.sql</div>'
    : p.arch ? (arch.map(row).join('') || '<div class="empty small">Внесённых пока нет</div>')
    : (open.map(row).join('') || '<div class="empty small">Всё внесено</div>');
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet pay">
    <h3>Платежи</h3>
    <div class="pay-form">
      <input class="inp" id="pay-d" type="date" aria-label="Дата" value="${esc(kept.d ?? (e ? e.paid_on : today()))}">
      <input class="inp" id="pay-a" inputmode="decimal" placeholder="Сумма" value="${esc(kept.a ?? (e && e.amount != null ? String(+e.amount).replace('.', ',') : ''))}">
      <input class="inp" id="pay-w" placeholder="За что" value="${esc(kept.w ?? (e ? e.what : ''))}">
      <button class="btn main" data-act="pay-save" aria-label="${e ? 'Сохранить' : 'Записать'}">${e ? '✓' : '+'}</button>
      ${e ? `<button class="icon" data-act="pay-cancel" aria-label="Не менять">✕</button><button class="icon" data-act="pay-del" aria-label="Удалить">🗑</button>` : ''}
    </div>
    <div class="seg pay-tabs"><button class="pill ${p.arch ? '' : 'on'}" data-act="pay-arch" data-v="">Не внесено: ${open.length}${sum ? ' · ' + money(sum) : ''}</button>
      <button class="pill ${p.arch ? 'on' : ''}" data-act="pay-arch" data-v="1">Внесённые</button></div>
    <div class="pay-list">${list}</div>
    <div class="actions"><span></span><button class="btn" data-act="close">Закрыть</button></div>
  </div></div>`;
}
async function savePay() {
  const p = S.pay;
  if (!p.on) return toast('Сначала запусти в Supabase файл 020_payments_howto.sql');
  const row = { paid_on: document.getElementById('pay-d').value || today(), amount: parseMoney(document.getElementById('pay-a').value),
    what: document.getElementById('pay-w').value.trim() };
  if (!row.what && row.amount == null) return toast('Напиши сумму или за что');
  const e0 = p.edit && p.list.find(y => String(y.id) === p.edit);
  if (e0) {
    await call(sb.from('payments').update(row).eq('id', e0.id));
    Object.assign(e0, row);
    p.edit = null;
  } else {
    const [x] = await call(sb.from('payments').insert(row).select());
    p.list.push(x);
    p.arch = false;
  }
  p.list.sort((a, b) => a.paid_on.localeCompare(b.paid_on) || String(a.created_at).localeCompare(String(b.created_at)));
  renderPay(true);
  document.getElementById('pay-a')?.focus();
}
async function payMark(id, done) {
  const x = S.pay.list.find(y => String(y.id) === id);
  if (!x) return;
  const old = x.done_on;
  x.done_on = done ? today() : null;
  if (S.pay.edit === id) S.pay.edit = null;
  renderPay();
  await call(sb.from('payments').update({ done_on: x.done_on }).eq('id', x.id));
  toast(done ? 'Внесено — в архиве' : 'Вернула в невнесённые', async () => {
    x.done_on = old; if ($modal.dataset.kind === 'pay') renderPay();
    await call(sb.from('payments').update({ done_on: old }).eq('id', x.id));
  });
}
async function payDelete() {
  const p = S.pay, x = p.list.find(y => String(y.id) === p.edit);
  if (!x || !confirm(`Удалить запись «${x.what || money(x.amount)}»? Вернуть её не получится.`)) return;
  await call(sb.from('payments').delete().eq('id', x.id));
  p.list = p.list.filter(y => y.id !== x.id);
  p.edit = null;
  renderPay(true);
}

// ---------- справка ----------
const HELP = [
  ['Сегодня', 'Всё, что нужно сделать сегодня: привычки, задачи (и просроченные), события. Кружок — отметить. Нажать на отметку ещё раз — отменить.'],
  ['Новая задача', '«+» внизу. Вид: <b>задача</b>, <b>привычка</b> (вода, зарядка) или <b>событие</b> (встреча, его не отмечают). Можно указать срок, время, повтор, напоминание и раздел.'],
  ['Повтор', 'Каждый день / неделю / месяц / N дней или по дням недели. «От выполнения»: следующий срок считается от дня, когда сделали, а не от старого срока.'],
  ['Утренняя проверка', 'Утром спросит, что сделано из вчерашнего: ✓ — сделано, ✕ — не сделано, в конце «Подтвердить». Несделанная задача переедет на сегодня. У привычки засчитается пропуск. У привычки с подпунктами каждый подпункт отмечается отдельно: сделано 2 из 4 — день засчитается наполовину (в статистике и цветке по доле; серию такой день прерывает, питомцы не грустят, если сделано хотя бы половина).'],
  ['Привычки', 'Вкладка со статистикой: сколько дней из 30 / 3 месяцев / года получилось, серия подряд, лучшая серия, пропуски и квадратики по дням.'],
  ['Календарь', 'Месяц или неделя, фильтры по разделам. Нажми на день: там расписание и свободное время между делами.'],
  ['Разделы', 'Папки для задач. ✎ у раздела: название, цвет, «выключить» на время (задачи прячутся, но не удаляются). «Без срока» вверху — показать только задачи без даты. ☐ («Выбрать») — изменить или удалить сразу несколько задач (☑ — выбрать все). На компьютере задачи можно перетаскивать мышкой.'],
  ['А→Я', 'Кнопка у заголовка раздела в «Разделах»: расставляет его задачи по алфавиту. Потом их можно двигать мышкой, а нажать А→Я снова — когда захочется. Новая задача встаёт в конец.'],
  ['Размер и предложения на день', 'В окне задачи — «Размер»: ⚡ пятиминутка, ◐ средняя, ● на весь день, ✦ вдохновение. В ⚙ можно задать размер сразу всем задачам раздела (например, «Проекты» — вдохновение). Каждое утро после проверки (в личном режиме) открывается окно со всеми задачами <b>без срока</b>, которые можно взять сегодня: все пятиминутки; средние — если есть свободное окошко (обед, после работы или после ужина, время — в ⚙; окошко занимают задачи, стоящие в нём на сегодня, и события в это время), в выходные — всегда; большие — в субботу и воскресенье, если на этот день ещё нет большой; вдохновение — если на сегодня ещё не взято ни вдохновение, ни большая задача. Если вечер так и остался свободным, с 16 до 19 вдохновение предлагается ещё раз. Оба окна — по одному разу в день на весь аккаунт: показалось на телефоне — на компьютере уже не появится. У задач по вдохновению нет просрочки: не сделано в свой день — задача снова без срока. «Сегодня» — ставит срок на сегодня, «Не сегодня» — предложу завтра, «Потом» — через 4 дня; то, что не выбрано, предложу завтра. Пятиминутку можно сделать в любой свободный момент, вдохновение — на вечер, если есть настроение.'],
  ['Быстрое меню', 'Долгое нажатие на задачу (на компьютере — правая кнопка): на сегодня, на завтра, в другой раздел.'],
  ['🏠 / 💼', 'Личное и работа отдельно, переключатель вверху. В работе есть «Шаблоны»: повторяющиеся проекты из шагов (например, квартальная отчётность), создаются сами.'],
  ['Шаблоны (работа)', '«⟳ Шаблоны» в колонке разделов. Шаблон сам создаёт проект с задачами, когда заканчивается месяц, квартал или год, — в разделе шаблона. <b>Какие месяцы</b>: «Только некоторые» — задачи создадутся только за отмеченные месяцы (например, оценка урожая — июль–октябрь). <b>Создавать заранее</b> за N рабочих дней до конца периода; 0 — на следующий день после конца. <b>Шаги</b>: «с» и «до» — числа месяца, «мес.» — какой по счёту месяц после конца периода (1 — следующий), «часов» — оценка (если по факту уже записано время, новые задачи получат среднее по факту). У шага могут быть подзадачи — без своих сроков; «после шагов» — номера шагов, которые надо сделать раньше. <b>Создать задачи сейчас</b> — за выбранный период, не дожидаясь конца. <b>Копия</b> — например, сделать годовую отчётность из квартальной.'],
  ['Изменить несколько', '☐ в «Разделах» → отметь задачи → ✎. Меняется только то, где выбрано не «— не менять —».'],
  ['Подпункты', 'В окне задачи «+ Подпункт»: письма, проверки и т.п. Отмечаются прямо под задачей. В шаблоне у шага — «+ подзадача».'],
  ['Потраченное время (работа)', 'В окне рабочей задачи — «Потрачено по факту»: напиши часы (1,5 или 1:30), выбери день и нажми «+ Записать». Можно записывать несколько раз — итог складывается. В строке задачи ⏱ факт / оценка (красным — если вышло больше оценки). На «Плане» у дня — «по факту». Вкладка <b>«Время»</b> (на компьютере): сколько ушло по дням, по дням недели, по задачам и сколько обычно занимают шаги шаблонов.'],
  ['Шаблон из задачи', 'В окне рабочей задачи — «⟳ Сделать шаблон из этой задачи». Выбери, за какой период эта задача (например, октябрь 2026), и какие подпункты взять. Сама задача станет первой (за этот период), следующие шаблон создаст сам — «… — ноябрь 2026». Оценка часов у новых задач — среднее фактическое время за прошлые периоды. В окне шаблона — таблица «Время по периодам».'],
  ['«Сегодня» по частям дня', 'В будни (личный режим) дела на сегодня идут по частям дня: ☀ утро — пятиминутки; 🍽 обед, 🌆 после работы, 🌙 после ужина — окошки (время — в ⚙); остальное — то, что не попало в окошки. Окошки видны всегда, пустые ячейки по 30 минут — свободное место. В окошке сами стоят только задачи со своим «Когда» (в окне задачи, у средних и вдохновения) и вдохновение без «Когда» — после ужина; остальные задачи ты расставляешь сама: на компьютере перетаскиваешь в окошко, между окошками или обратно (в утро или остальное), на телефоне — долгое нажатие → «В окошко». Это только на сегодня, «Когда» не меняется. Место в окошке занимают средние и прочие задачи (30 минут или своё время ⏱) и события в это время; пятиминутки и вдохновение показываются в окошке, но места не занимают. Если задач больше, чем ячеек, ничего не переносится — свободных ячеек просто не остаётся. В выходные окошек нет.'],
  ['Платежи 💳', 'Кнопка 💳 в заголовке — записи о платежах, по которым потом не вспомнить, за что платила (маркетплейсы, наложенный платёж и т. п.). Запись — дата (по умолчанию сегодня), сумма и за что; Enter — записать. Когда разнесла платёж в таблицу расходов, нажми ✓ — запись уходит во «Внесённые» (там ↩ возвращает обратно). Щелчок по записи — исправить или удалить её. Вверху — сколько ещё не внесено и на какую сумму. Во «Внесённых» видно последние 3 месяца.'],
  ['Шаги и подзадачи шаблона (работа)', 'В окне шаблона на вкладке «Шаги»: ⤴ у подзадачи — сделать её отдельным шагом (встанет сразу после своего шага, с теми же числами); «⤵ в подзадачи» у шага — сделать его подзадачей другого шага (выбираешь, какого, и ✓), его подзадачи и инструкция переходят туда же. Изменения сохраняются кнопкой «Сохранить»; задачи, уже созданные по шаблону, не меняются — только следующие.'],
  ['Инструкции к шаблонам 📖 (работа)', 'У каждого шага шаблона можно записать, как его делать: в окне шаблона на вкладке «Шаги» кнопка 📖 у шага. Общее для всего шаблона — вкладка «Памятка». Инструкции не копируются в задачи, а живут в шаблоне: поправила — в следующем периоде уже новая версия. У задачи из шаблона значок 📖 в строке (если инструкция есть) и «📖 Как делать» в окне задачи (вкладка «План и время») — открывают инструкцию шага и памятку, исправить можно прямо там. 📖 у названия проекта в «Разделах» — вся инструкция проекта по шагам. Строки, начинающиеся с «- » или «1. », становятся списком, ссылки нажимаются.'],
  ['План (работа, компьютер)', '«Срок» — дедлайн, «План» — день, когда делаешь, и сколько часов займёт. Во вкладке «План» неделя: задачи перетаскиваются по дням (обратно в «Не распланировано» — снять план), вверху сумма часов вместе со встречами. Больше 8 ч — жёлтым, больше 11 ч — ⚠ красным.'],
  ['☀ Случаи и «Следом»', 'Бывает то, что нельзя спланировать заранее: пришла зарплата. Нажми ☀ вверху и выбери, что случилось. У случая (и у любой задачи) в окне есть «Следом» — задачи, которые спят и нигде не видны. Отметила случай или сделала задачу (например, «Оплатить коммуналку») — задачи «Следом» появятся на сегодня и будут висеть, пока их не сделаешь. Сделала — снова засыпают до следующего раза. Отменила отметку — снова прячутся. Сумму удобно писать прямо в названии: «Отложить 2000 ₴ в конверт». Новый случай — ☀ → «+ Новый случай».'],
  ['📚 Книги на подоконнике', 'Тихое дело — без списков и напоминаний, просто намёк. Пример: ☀ → «+ Новый случай» «Купила книги» → в «Следом» задача «Каталогизировать книги» и нажми 📚 рядом с ней. Купила книги — ☀ → «Купила книги»: на подоконнике появится стопка книг (каждый раз другая, из пяти вариантов). Щелчок по книгам — «сделано?», и они исчезнут до следующего раза. На телефоне вместо подоконника — значок 📚 вверху. Любой задаче можно выбрать картинку «📚 Книги» во вкладке «Ещё» — тогда её не видно в списках, утренней проверке и календаре.'],
  ['Порядок на «Сегодня»', 'Привычки и задачи одним списком: ⚡ пятиминутки, 🍽 обед, 🌆 после работы, 🌙 после ужина, потом остальное. На телефоне у окошек видно, сколько в них места.'],
  ['Порядок шагов', 'У задачи проекта — «Делать после» (в шаблоне — «после шагов: 1, 2»). Пока те шаги не сделаны, у задачи 🔒 «ждёт: …»; красный — если они запланированы позже. Ничего не запрещается.'],
  ['Питомцы', 'В окне задачи (в личном режиме) — «Питомец». На широком экране по бокам сидят кот и попугай: доволен, если всё сделано, грустит от пропусков. Наведи на питомца — увидишь, почему грустит. Нажми на имя, чтобы переименовать. Яша перелетает, только когда доволен; кот гуляет, если не очень грустит. Подвесные жёрдочки можно перетаскивать мышкой — Яша перелетит на свою. Кот сидит на подоконнике; щёлкни по нему — перейдёт на другую сторону (если не грустит).'],
  ['Как считаются дни', 'Сколько дней до грусти, обморока и пыли — в ⚙. У обычной задачи считаются дни просрочки (с первоначального срока, даже если утренняя проверка перенесла её на сегодня), у привычки — пропуски подряд. Питомец смотрит на свою самую запущенную задачу.'],
  ['Картинки', 'В окне задачи — «Картинка». 🕸 Пыль и паутина: уборка просрочена — появляется паутина, летает пыль, и с каждым днём на экране всё больше пыльных пятен. Уберёшь — всё исчезнет. 🔢 Счётчики: в день срока (или с даты «Начать с») появляется счётчик — газ, вода или свет, по названию задачи. Пропадает, когда задача отмечена. На компьютере его можно перетащить мышкой.'],
  ['Вид за окном', 'На фоне — окно, вид за ним каждый день свой: город, лес, море, горы, деревня, зима. Время суток настоящее. Погода — от того, как идут дела сегодня (привычки не считаются). Дело портит погоду, только когда его время прошло: окошко закончилось, прошло время задачи или срок был раньше сегодня; дело без окошка и времени — не раньше конца дня. Утром ясно; чем больше сделано, тем ярче солнце; всё сделано — радуга (ночью — падающая звезда). Тучи — от дел, время которых прошло, а они не сделаны. Дождь и гроза — от самой просроченной задачи: дождь — с того же числа дней, что «очень грустит», гроза — что «обморок» (по умолчанию 2 и 4 дня, меняется в ⚙). Сколько дней просрочено — значок ⏳ у задачи. Выключается в ⚙.'],
  ['Повтор по циклу', 'Для графиков вроде «2 дня делать, 1 пропустить»: в окне задачи Повтор → «Цикл». Укажи, сколько дней делать, сколько пропускать и первый день цикла — ниже видны ближайшие дни. В дни пропуска задачи нет, и пропуском это не считается. Сбился график — поменяй первый день цикла.'],
  ['Цветок на подоконнике', 'Растёт от привычек: смотрит, сколько из отметок за последние 7 дней — «сделано». Почти всё (от 85%) — цветёт, больше половины (от 60%) — бутоны, меньше — вянет, совсем мало (меньше 35%) — засыхает, листья падают. Сегодня все привычки сделаны — прилетает бабочка. Наведи на цветок — увидишь «X из Y». Цветок можно передвинуть мышкой вдоль подоконника. В ⚙ → «Цветок» можно выбрать, привычки из каких разделов он считает. Виден, когда включён вид за окном и есть хоть одна такая привычка.'],
  ['⚙ Настройки', 'Уведомления, имя для приветствия, показ выполненных, вид за окном. <b>Размер задач по разделам</b> — все задачи раздела получат этот размер, если у задачи не выбран свой (например, «Проекты» — ✦ вдохновение). <b>Цветок</b> — привычки каких разделов он считает (светится — считается). <b>Питомцы</b> — кого показывать (светится — видно). <b>Режим раздела</b> (✎ у раздела) — задачи раздела переезжают вместе с ним.'],
  ['Устройства', 'Всё хранится в облаке. Входи с той же почтой на телефоне и компьютере. На телефоне: Chrome → ⋮ → «Установить приложение».'],
];

function openHelp(first = false) {
  $modal.dataset.kind = 'help';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet help fixed">
    <h3>${first ? 'Добро пожаловать! Коротко о главном' : 'Справка'}</h3>
    <div class="help-list">${HELP.map(([h, t]) => `<details class="help-item"><summary>${h}</summary><div>${t}</div></details>`).join('')}</div>
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
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet fixed">
    <h3>Настройки</h3>
    <div class="menu">
      <button class="btn ${S.showDone ? 'on' : ''}" data-act="show-done">${S.showDone ? '✓ ' : ''}Показывать выполненные</button>
      <button class="btn ${S.bg ? 'on' : ''}" data-act="bg-toggle">${S.bg ? '✓ ' : ''}Вид за окном на фоне</button>
      <button class="btn" data-act="set-name">Имя для приветствия: ${userName() ? esc(userName()) : 'не задано'}</button>
      <button class="btn" data-act="import">Загрузить задачи из файла</button>
      <button class="btn" data-act="logout">Выйти из аккаунта</button>
    </div>
    <h2>Питомцы и картинки</h2>
    <div class="hint">Показывать питомцев</div>
    <div class="flower-secs">${Object.keys(PETS).map(p => `<button class="pill ${petOn(p) ? 'on' : ''}" data-act="pet-toggle" data-v="${p}">${PETS[p].icon} ${esc(petName(p))}</button>`).join('')}</div>
    <div class="hint">Через сколько дней просрочки</div>
    <div class="limits">${Object.entries(LIMITS).map(([k, l]) => `<label>${l.name}<span>с <input class="inp num" id="lim-${k}" type="number" min="1" value="${lim(k)}"> дн.</span></label>`).join('')}</div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn main" data-act="limits-save">Сохранить</button></div>
    ${flowerSecsHTML()}
    ${secSizesHTML()}
    ${slotsHTML()}
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
  if (S.space === 'work') return []; // в работе утренней проверки нет (её решение 12.11.2026): итоги дня разносит сама до 17:00
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
  const ch = rvKeep(list);
  const scroll = $modal.querySelector('.rv-list')?.scrollTop || 0;
  $modal.dataset.kind = 'review';
  $modal.innerHTML = `<div class="overlay"><div class="sheet review">
    <h3>Привет${userName() ? ', ' + esc(userName()) : ''}! ${onlyYesterday ? 'Что из вчерашнего получилось сделать?' : 'Что из этого получилось сделать?'}</h3>
    <div class="rv-list">${list.map(t => {
      const head = `<div class="body"><div class="title">${esc(t.title)}</div>
        <div class="meta"><span>${t.plan_date ? 'план: ' : ''}${dateLabel(reviewDay(t))}</span><span>${t.kind === 'habit' ? 'привычка' : 'задача'}</span>${t.plan_date && t.due_date ? `<span>дедлайн ${dateLabel(t.due_date)}</span>` : ''}</div></div>`;
      // привычка с подпунктами: каждый подпункт отмечается сам, доля считается по ним
      if (rvSubs(t)) return `<div class="task habit rv-group">${head}</div>` + subsOf(t).map((s, i) => `<div class="task habit rv-sub">
        <div class="body"><div class="title">${esc(s.t)}</div></div>
        <div class="yn">
          <button class="btn yes${ch[rvKey(t)][i] === 'yes' ? ' good' : ''}" data-act="r-sy" data-id="${t.id}" data-v="${i}" aria-label="Сделано">✓</button>
          <button class="btn no${ch[rvKey(t)][i] === 'no' ? ' no-on' : ''}" data-act="r-sn" data-id="${t.id}" data-v="${i}" aria-label="Не сделано">✕</button>
        </div></div>`).join('');
      return `<div class="task ${t.kind === 'habit' ? 'habit' : ''}">${head}
      <div class="yn">
        <button class="btn yes${ch[rvKey(t)] === 'yes' ? ' good' : ''}" data-act="r-yes" data-id="${t.id}" aria-label="Сделано">✓</button>
        <button class="btn no${ch[rvKey(t)] === 'no' ? ' no-on' : ''}" data-act="r-no" data-id="${t.id}" aria-label="Не сделано">✕</button>
      </div></div>`;
    }).join('')}</div>
    <div class="rv-foot"><span class="rv-count"></span><button class="btn main" data-act="r-save">Подтвердить</button></div>
  </div></div>`;
  $modal.querySelector('.rv-list').scrollTop = scroll;
  rvCount(list);
}

// Отметки копятся в S.rv и пишутся в базу только по «Подтвердить» — можно пересмотреть.
const rvKey = t => t.id + '|' + reviewDay(t);
const rvSubs = t => t.kind === 'habit' && t.repeat_unit && subsOf(t).length > 0;
function rvKeep(list) {
  const keys = new Set(list.map(rvKey));
  S.rv = Object.fromEntries(Object.entries(S.rv || {}).filter(([k]) => keys.has(k)));
  // у привычки с подпунктами — отметка на каждый; отмеченные за день сразу «Сделано»
  for (const t of list) if (rvSubs(t) && !Array.isArray(S.rv[rvKey(t)])) S.rv[rvKey(t)] = subsOf(t).map(s => s.d ? 'yes' : undefined);
  return S.rv;
}
const rvMarked = t => { const v = S.rv[rvKey(t)]; return Array.isArray(v) ? subsOf(t).every((_, i) => v[i]) : !!v; };
function rvSubMark(el, id, i, v) {
  const t = byId(id);
  S.rv[rvKey(t)][i] = v;
  const yn = el.closest('.yn');
  yn.querySelector('[data-act=r-sy]').classList.toggle('good', v === 'yes');
  yn.querySelector('[data-act=r-sn]').classList.toggle('no-on', v === 'no');
  rvCount();
}
function rvCount(list = reviewList()) {
  const n = list.filter(rvMarked).length;
  $modal.querySelector('.rv-count').textContent = `Отмечено ${n} из ${list.length}`;
  $modal.querySelector('[data-act=r-save]').disabled = n < list.length;
}
function rvMark(el, id, v) {
  const t = byId(id);
  S.rv[rvKey(t)] = v;
  const yn = el.closest('.yn');
  yn.querySelector('[data-act=r-yes]').classList.toggle('good', v === 'yes');
  yn.querySelector('[data-act=r-no]').classList.toggle('no-on', v === 'no');
  rvCount();
}
async function rvSave() {
  for (const t of reviewList()) {
    let v = S.rv[rvKey(t)], part = null;
    if (Array.isArray(v)) {
      const yes = v.filter(x => x === 'yes').length, n = subsOf(t).length;
      if (yes === n) v = 'yes';
      else { v = 'no'; if (yes) part = Math.round(yes / n * 1000) / 1000; }
    }
    if (v === 'yes') {
      await call(sb.rpc('complete_task', { p_task: t.id, p_done_on: reviewDay(t) }));
      await resetRepeat(t);
      await wakeKids(t);
    } else if (v === 'no') {
      // запланированная задача: «не сделано» переносит план на сегодня, дедлайн не трогаем
      if (t.plan_date) await call(sb.from('tasks').update({ plan_date: today() }).eq('id', t.id));
      else await call(sb.rpc('miss_task', { p_task: t.id, p_today: today() }));
      // частично: доля сделанных подпунктов — к отметке пропуска за тот день
      if (part) await call(sb.from('task_log').update({ part }).eq('task_id', t.id).eq('day', reviewDay(t)).eq('status', 'missed'));
      // привычка: пропущенный день закрыт, следующий раз подпункты снова пустые
      if (t.kind === 'habit') await resetRepeat(t);
    }
  }
  S.rv = {};
  await load();
}

// ---------- размер задачи и предложения на день ----------
const SIZES = {
  quick: { icon: '⚡', name: 'пятиминутка', title: 'Пятиминутки', hint: 'Можно сделать в любой свободный момент' },
  mid: { icon: '◐', name: 'средняя', title: 'Средние', hint: '' },
  big: { icon: '●', name: 'на весь день', title: 'Большие', hint: 'Сегодня ничего большого не запланировано — может, взять одну?' },
  idea: { icon: '✦', name: 'вдохновение', title: 'Вдохновение', hint: 'На вечер, если есть настроение' },
};
// Свободные окошки будних дней для средних задач. Событие со временем внутри окошка его занимает.
const SLOTS = {
  lunch: { name: 'Обед', from: '12:00', to: '13:00' },
  after: { name: 'После работы', from: '17:00', to: '18:00' },
  eve: { name: 'После ужина', from: '20:00', to: '22:00' },
};
const SLOT_ICON = { lunch: '🍽', after: '🌆', eve: '🌙' };
// время окошка: своё из ⚙ (user_metadata.slots) или по умолчанию
const slotOf = k => ({ ...SLOTS[k], ...((S.user?.user_metadata?.slots || {})[k] || {}) });
const slotsHTML = () => `<h2>Свободные окошки будних дней</h2>
  <div class="limits">${Object.keys(SLOTS).map(k => `<label>${SLOTS[k].name}<span>с <input class="inp" type="time" id="slot-${k}-from" value="${slotOf(k).from}"> до <input class="inp" type="time" id="slot-${k}-to" value="${slotOf(k).to}"></span></label>`).join('')}</div>
  <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn main" data-act="slots-save">Сохранить</button></div>`;
async function saveSlots() {
  const slots = {};
  for (const k of Object.keys(SLOTS)) {
    const from = document.getElementById(`slot-${k}-from`).value, to = document.getElementById(`slot-${k}-to`).value;
    if (!from || !to || from >= to) return toast(`${SLOTS[k].name}: начало должно быть раньше конца`);
    slots[k] = { from, to };
  }
  const { data, error } = await sb.auth.updateUser({ data: { slots } });
  if (error) return toast('Не получилось сохранить: ' + error.message);
  S.user = data.user;
  toast('Сохранено');
}
const secSize = id => (S.sections.find(s => s.id === id) || {}).default_size || null;
// свой размер у задачи, иначе — размер раздела по умолчанию
const sizeOf = t => (isEvent(t) ? null : t.size || secSize(t.section_id));

// Что стоит на день d в окошках и сколько там места (в минутах). Сами задачи по окошкам не расставляются (её решение 12.11.2026):
// в окошке только задачи со своим «Когда» и те, что она перетащила на сегодня. Место занимают средние и прочие задачи
// (30 мин или своё время ⏱) и события; пятиминутки и вдохновение показываются в окошке, но места не занимают.
const MID_MIN = 30;
const toMin = s => { const [h, m] = hhmm(s).split(':'); return +h * 60 + +m; };
const taskMin = t => (t.estimate ? Math.round(t.estimate * 60) : MID_MIN);
const slotMin = t => (sizeOf(t) === 'quick' || sizeOf(t) === 'idea' ? 0 : taskMin(t)); // сколько места занимает в окошке
const slotsFor = t => sizeOf(t) === 'mid' || sizeOf(t) === 'idea'; // у кого есть «Когда»
// Окошко задачи на день d: своё «на сегодня» (перетащила — slot_now, 'none' — убрала), иначе постоянное «Когда»;
// вдохновение без «Когда» — после ужина. null — окошка нет.
function fixedSlot(t, d) {
  if (t.slot_day === d && t.slot_now) return t.slot_now;
  if (SLOTS[t.slot] && slotsFor(t)) return t.slot;
  return sizeOf(t) === 'idea' ? 'eve' : null;
}
function dayFit(d) {
  const items = active().filter(t => !isEvent(t) && reviewDay(t) === d);
  const of = s => items.filter(t => sizeOf(t) === s);
  const weekend = isodow(d) >= 6;
  // slots[k] = { cap, used, titles, items: [{ t, min, ev }] }; inSlot: id → окошко
  const slots = {}, inSlot = {};
  if (!weekend) {
    const evs = (occurrences(d, d)[d] || []).map(o => o.t).filter(t => isEvent(t) && t.start_time);
    for (const k of Object.keys(SLOTS)) {
      const s = slotOf(k), from = toMin(s.from), to = toMin(s.to);
      const sl = slots[k] = { cap: to - from, used: 0, titles: [], items: [] };
      for (const t of [...new Map(evs.map(t => [t.id, t])).values()]) {
        const a = toMin(t.start_time), e = t.end_time ? toMin(t.end_time) : null;
        const part = e === null ? (a >= from && a < to ? to - from : 0) : Math.max(0, Math.min(e, to) - Math.max(a, from));
        if (part) { sl.used += part; sl.titles.push(t.title); sl.items.push({ t, min: part, ev: true }); }
      }
    }
    for (const t of items) {
      const k = fixedSlot(t, d);
      if (!SLOTS[k]) continue;
      const sl = slots[k], m = slotMin(t);
      sl.used += m; sl.titles.push(t.title); sl.items.push({ t, min: m }); inSlot[t.id] = k;
    }
  }
  const room = k => (slots[k] ? slots[k].cap - slots[k].used : 0);
  return { weekend, slots, inSlot, room, freeSlots: Object.keys(slots).filter(k => room(k) >= MID_MIN),
    big: of('big').length, idea: of('idea').filter(t => !SLOTS[t.slot]).length };
}
// Подпись окошка для окна предложений: «свободно» / «занято 30 из 60 мин» / «заполнено»
function slotState(sl) {
  if (!sl.used) return { cls: 'good', text: 'свободно' };
  if (sl.used < sl.cap) return { cls: 'good', text: `занято ${sl.used} из ${sl.cap} мин` };
  return { cls: 'warn', text: 'заполнено' };
}
const fmtMin = m => (m >= 60 ? `${fmtH(m / 60)} ч` : `${m} мин`);
const CELL = 30;

// Окошко на сегодня: перетащила или выбрала в меню. Постоянное «Когда» не меняется; 'none' — убрать из окошка.
async function setDaySlot(t, k) {
  if (!('slot_now' in t)) return toast('Сначала запусти в Supabase файл 018_day_slot.sql');
  const d = today();
  const fit = dayFit(d);
  if ((fit.inSlot[t.id] || (fixedSlot(t, d) === 'none' ? 'none' : null)) === k) return;
  if (k === 'none' && !fit.inSlot[t.id]) return;
  const old = { slot_day: t.slot_day ?? null, slot_now: t.slot_now ?? null };
  Object.assign(t, { slot_day: d, slot_now: k });
  render();
  await call(sb.from('tasks').update({ slot_day: d, slot_now: k }).eq('id', t.id));
  toast(k === 'none' ? 'Убрано из окошка на сегодня' : `${SLOT_ICON[k]} ${SLOTS[k].name} — на сегодня`,
    async () => { Object.assign(t, old); render(); await call(sb.from('tasks').update(old).eq('id', t.id)); });
}

// Браузер не подсказывает ранее введённое в полях (её просьба 12.11.2026: отвлекает); поля входа — со своим autocomplete.
document.addEventListener('focusin', e => {
  const f = e.target;
  if (f.matches && f.matches('input:not([autocomplete]), textarea:not([autocomplete])')) f.setAttribute('autocomplete', 'off');
});

// Перетаскивание в окошки (только «Сегодня» на компьютере)
let slotDragId = null;
document.addEventListener('dragstart', e => {
  const c = e.target.closest && e.target.closest('[data-sdrag]');
  if (!c) return;
  slotDragId = c.dataset.sdrag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', slotDragId);
});
document.addEventListener('dragend', () => { slotDragId = null; document.querySelectorAll('.drop-in').forEach(x => x.classList.remove('drop-in')); });
document.addEventListener('dragover', e => {
  if (!slotDragId) return;
  const z = e.target.closest('[data-sdrop]');
  document.querySelectorAll('.drop-in').forEach(x => x !== z && x.classList.remove('drop-in'));
  if (!z) return;
  e.preventDefault();
  z.classList.add('drop-in');
});
document.addEventListener('drop', async e => {
  if (!slotDragId) return;
  const z = e.target.closest('[data-sdrop]');
  const t = byId(slotDragId);
  slotDragId = null;
  document.querySelectorAll('.drop-in').forEach(x => x.classList.remove('drop-in'));
  if (!z || !t) return;
  e.preventDefault();
  await setDaySlot(t, z.dataset.sdrop);
});

// Задачи без срока этого размера, которые сегодня можно предложить (дольше всего лежащие — первыми).
const offerList = (size, d = today()) => active()
  .filter(t => !isEvent(t) && t.kind !== 'habit' && !t.due_date && sizeOf(t) === size
    && (!t.offer_after || t.offer_after <= d) && (!t.start_date || t.start_date <= d))
  .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

// Какие группы показать: mode 'full' — утром (всё), 'eve' — вечером (только вдохновение).
function offerGroups(mode) {
  const d = today(), fit = dayFit(d);
  const groups = [];
  const add = (size, note, list = offerList(size)) => { if (list.length || note) groups.push({ size, note, list }); };
  if (mode === 'full') {
    add('quick', '');
    const midList = offerList('mid');
    if (midList.length) {
      if (fit.weekend) add('mid', 'Выходной — время найдётся', midList);
      else {
        const lines = Object.keys(SLOTS).map(k => { const s = slotOf(k), sl = fit.slots[k]; return `${s.name} (${s.from}–${s.to}): ${slotState(sl).text}${sl.titles.length ? ' — ' + sl.titles.map(esc).join(', ') : ''}`; });
        groups.push({ size: 'mid', note: lines.join('<br>'), list: fit.freeSlots.length ? midList : [], full: !fit.freeSlots.length });
      }
    }
    if (fit.weekend && !fit.big) add('big', '');
  }
  // вечер уже занят (взята задача по вдохновению или большая) — вдохновение не предлагаем
  if (!fit.idea && !fit.big) add('idea', '');
  return groups.filter(g => g.list.length || g.full);
}

// Окна предложений — раз утром и раз с 16 до 19 на весь аккаунт (отметки в user_metadata, видны всем устройствам).
async function maybeOffer() {
  if (!S.user || !S.loaded || S.space !== 'personal' || $modal.dataset.kind || S.offer || reviewList().length || S.offerBusy) return;
  const d = today(), h = new Date().getHours(), eve = h >= 16 && h < 19;
  // быстрая отметка этого устройства — чтобы не спрашивать сервер каждую минуту
  if (localGet('offer') === d && (!eve || localGet('offerEve') === d)) return;
  S.offerBusy = true;
  try {
    // свежие отметки с сервера: могли уже показать на другом устройстве
    const { data } = await sb.auth.getUser();
    if (data?.user) S.user = data.user;
    const md = S.user.user_metadata || {};
    let mode = null;
    if (md.offer_day !== d) mode = 'full';
    else if (eve && md.offer_eve !== d) mode = 'eve';
    localSet('offer', d);
    if (!mode) { if (eve) localSet('offerEve', d); return; }
    // вечером: если на вечер уже что-то взято — окна нет, но и отметку не ставим (вдруг потом отменит)
    if (mode === 'eve' && !offerGroups('eve').some(g => g.list.length)) return;
    if (eve) localSet('offerEve', d);
    const mark = { offer_day: d, ...(eve ? { offer_eve: d } : {}) };
    sb.auth.updateUser({ data: mark }).then(({ data }) => { if (data?.user) S.user = data.user; });
    if (!offerGroups(mode).some(g => g.list.length)) return;
    if ($modal.dataset.kind || reviewList().length) return;
    openOffer(mode);
  } finally { S.offerBusy = false; }
}

// У вдохновения нет просрочки: не сделано в свой день — снова без срока.
async function ideaExpire() {
  const t0 = today();
  const stale = S.tasks.filter(t => !t.done_on && !t.repeat_unit && t.kind !== 'habit' && !isEvent(t) && sizeOf(t) === 'idea' && t.due_date && t.due_date < t0);
  if (!stale.length) return;
  await call(sb.from('tasks').update({ due_date: null, plan_date: null, slot: null }).in('id', stale.map(t => t.id)));
  stale.forEach(t => { t.due_date = null; t.plan_date = null; t.slot = null; });
}

// Окно предложений — черновик: отметки можно ставить, менять и снимать, в базу всё уходит по «Сохранить».
// Список задач запоминается при открытии, чтобы выбранное «Сегодня» не пропадало из окна (вдохновений можно взять несколько).
// «Скрыть» убирает окно, не теряя отметок: внизу остаётся кнопка, чтобы вернуться.
function openOffer(mode) {
  const groups = offerGroups(mode).map(g => ({ ...g, ids: g.list.map(t => t.id) }));
  S.offer = { mode, groups, pick: {}, hidden: false };
  renderOffer();
}

function renderOffer() {
  const o = S.offer;
  if (!o) return;
  offerChip();
  if (o.hidden) return;
  const scroll = $modal.querySelector('.rv-list')?.scrollTop || 0;
  const daysLying = t => Math.max(0, Math.round((parse(today()) - parse((t.created_at || '').slice(0, 10) || today())) / 864e5));
  const btn = (t, act, label, off) => `<button class="btn ${o.pick[t.id] === act ? 'on' : ''}" data-act="${act}" data-id="${t.id}"${off ? ' disabled title="В обед уже нет места"' : ''}>${label}</button>`;
  // «В обед» у вдохновения — в будни; места в окошке вдохновение не занимает
  const lunchLeft = dayFit(today()).slots.lunch ? 1 : null;
  const lunchBtn = t => lunchLeft === null || sizeOf(t) !== 'idea' ? '' : btn(t, 'of-lunch', 'В обед');
  const row = t => {
    const sec = sectionOf(t), n = daysLying(t);
    return `<div class="task${sec ? ' tinted' : ''}${o.pick[t.id] ? ' picked' : ''}"${sec ? ` style="--sec:${esc(sec.color)}"` : ''}>
      <div class="body" data-act="edit" data-id="${t.id}"><div class="title">${esc(t.title)}</div>
        <div class="meta">${sec ? `<span>${esc(sec.name)}</span>` : ''}${n ? `<span>лежит ${n} дн.</span>` : ''}</div></div>
      <div class="yn">${lunchBtn(t)}${btn(t, 'of-today', sizeOf(t) === 'idea' && lunchLeft !== null ? 'Вечером' : 'Сегодня')}${btn(t, 'of-tomorrow', 'Не сегодня')}${btn(t, 'of-later', 'Потом')}</div></div>`;
  };
  const live = id => { const t = byId(id); return t && !t.done_on ? t : null; };
  const groups = o.groups.map(g => ({ ...g, list: g.ids.map(live).filter(Boolean) })).filter(g => g.list.length || g.full);
  const n = Object.keys(o.pick).length;
  const eve = o.mode === 'eve';
  $modal.dataset.kind = 'offer';
  $modal.innerHTML = `<div class="overlay" data-act="of-hide-bg"><div class="sheet review offer">
    <h3>${eve ? 'Может, займёмся чем-то по вдохновению?' : `${userName() ? esc(userName()) + ', что' : 'Что'} можно сделать сегодня`}</h3>
    <div class="rv-list">${groups.map(g => `<h2>${SIZES[g.size].icon} ${SIZES[g.size].title}</h2>
      ${g.note || g.full ? `<div class="hint">${g.note || ''}${g.note && g.full ? '<br>' : ''}${g.full ? 'Свободных окошек сегодня нет' : ''}</div>` : ''}
      ${g.list.map(row).join('')}`).join('') || '<div class="empty">Всё разобрано</div>'}</div>
    <div class="rv-foot"><span class="hint">Отмечено: ${n}</span>
      <button class="btn" data-act="of-hide" title="Посмотреть дела на сегодня, отметки сохранятся">Скрыть</button>
      <button class="btn main" data-act="of-close">Сохранить</button></div>
  </div></div>`;
  $modal.querySelector('.rv-list').scrollTop = scroll;
}

// Кнопка внизу экрана, пока окно предложений скрыто.
function offerChip() {
  let el = document.getElementById('offer-chip');
  const show = S.offer && S.offer.hidden;
  if (!show) { el?.remove(); return; }
  if (!el) { el = document.createElement('button'); el.id = 'offer-chip'; el.className = 'btn main'; el.dataset.act = 'of-show'; document.body.append(el); }
  const n = Object.keys(S.offer.pick).length;
  el.textContent = `${S.offer.mode === 'eve' ? '✦ Вдохновение' : '☀ Предложения'}${n ? ' · отмечено ' + n : ''}`;
}

// Повторное нажатие той же кнопки снимает отметку.
function offerAct(id, act) {
  const p = S.offer.pick;
  if (p[id] === act) delete p[id]; else p[id] = act;
  renderOffer();
}

function offerHide(hidden) {
  S.offer.hidden = hidden;
  if (hidden) { $modal.innerHTML = ''; $modal.dataset.kind = ''; }
  renderOffer();
}

// «Сегодня» — срок на сегодня; «Не сегодня» — предложить завтра; «Потом» — через 4 дня.
async function closeOffer() {
  const pick = S.offer?.pick || {};
  S.offer = null;
  offerChip();
  closeModal();
  const ids = act => Object.keys(pick).filter(id => pick[id] === act);
  const jobs = [
    [ids('of-today'), { due_date: today(), offer_after: null }],
    [ids('of-lunch'), { due_date: today(), offer_after: null, slot: 'lunch' }],
    [ids('of-tomorrow'), { offer_after: addDays(today(), 1) }],
    [ids('of-later'), { offer_after: addDays(today(), 4) }],
  ].filter(([list]) => list.length);
  for (const [list, upd] of jobs) list.forEach(id => { const t = byId(id); if (t) Object.assign(t, upd); });
  render();
  for (const [list, upd] of jobs) await call(sb.from('tasks').update(upd).in('id', list));
  load().catch(() => { });
}

// Размер по умолчанию для всех задач раздела (в ⚙).
function secSizesHTML() {
  const secs = secsOf('personal');
  if (!secs.length) return '';
  return `<h2>Размер задач по разделам</h2>
    <div class="limits">${secs.map(s => `<label><span><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</span>
      <select class="inp" data-sec-size="${s.id}"><option value="">—</option>${Object.entries(SIZES).map(([k, z]) => `<option value="${k}" ${s.default_size === k ? 'selected' : ''}>${z.icon} ${z.name}</option>`).join('')}</select></label>`).join('')}</div>`;
}

async function setSecSize(id, v) {
  const s = S.sections.find(x => x.id === id);
  const old = s.default_size;
  s.default_size = v || null;
  render();
  try { await call(sb.from('sections').update({ default_size: s.default_size }).eq('id', id)); toast('Сохранено'); }
  catch (e) { s.default_size = old; render(); }
}

document.addEventListener('change', ev => {
  const id = ev.target.dataset.secSize;
  if (id) setSecSize(id, ev.target.value);
  if (ev.target.id === 'f-section' && S.edit) syncEdit();
});

// ---------- окно задачи ----------
function openEdit(t) {
  const isNew = !t.id;
  S.edit = { ...t, remind_at_was: t.remind_at, checklist: subsOf(t).map(s => ({ ...s })), had_subs: subsOf(t).length > 0,
    kids: t.id ? S.tasks.filter(x => x.wake_after === t.id).sort(byPos).map(x => ({ id: x.id, t: x.title, on: !!x.due_date, decor: x.decor || null })) : [] };
  const e = S.edit;
  const occ = e.kind === 'occasion';
  const parent = e.wake_after && byId(e.wake_after);
  const st = !isNew && e.kind === 'habit' ? habitStats(e) : null;
  $modal.dataset.kind = 'edit';
  const kidsBox = parent ? '' : `<div class="field" id="f-kids-box"><label>Следом</label>
      <div id="f-kids"></div><button class="link" data-act="kid-add">+ Задача следом</button></div>`;
  e.tab = 'main';
  // компактно: на компьютере две колонки (когда — слева, повтор и прочее — справа), кнопки внизу всегда видны
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet edit fixed">
    <h3>${occ ? (isNew ? 'Новый случай' : 'Случай') : isNew ? 'Новая запись' : isEvent(e) ? 'Событие' : 'Задача'}</h3>
    ${parent ? `<div class="hint wake-of">↳ Следом за «${esc(parent.title)}»${e.due_date ? '' : ' — спит, пока та не отмечена'}</div>` : ''}
    <div class="field row title-row"><input class="inp" id="f-title" autocomplete="off" placeholder="Название" value="${esc(e.title || '')}">
      <div class="seg" id="f-kind">
        <button class="pill" data-act="kind" data-v="task">Обычная</button>
        <button class="pill" data-act="kind" data-v="habit">Привычка</button>
        <button class="pill" data-act="kind" data-v="event">Событие</button>
      </div></div>
    ${st ? `<div class="stats">За 30 дней: <b>${st.done} из ${st.total}</b>
      <div class="strip">${st.days.map(([, s, p]) => dayCell(s, p)).join('')}</div></div>` : ''}
    <div class="seg e-tabs" id="f-tabs">
      <button class="pill" data-act="e-tab" data-v="main">Главное</button>
      <button class="pill" data-act="e-tab" data-v="repeat">Повтор<i class="tdot"></i></button>
      <button class="pill" data-act="e-tab" data-v="plan">План и время<i class="tdot"></i></button>
      <button class="pill" data-act="e-tab" data-v="more">Ещё<i class="tdot"></i></button>
    </div>
    <div class="e-pane" data-pane="main">
    <div class="cols"><div id="f-when">
    <div class="field"><label id="f-date-label">Срок</label>
      <div class="row"><input class="inp" id="f-date" type="date" value="${e.due_date || ''}">
        <button class="pill" data-act="date" data-v="0">Сегодня</button>
        <button class="pill" data-act="date" data-v="1">Завтра</button>
        <button class="pill" data-act="date" data-v="" id="f-nodate">Без срока</button>
      </div></div>
    <div class="pair">
    <div class="field" id="f-startdate-box"><label>Начать с</label>
      <input class="inp" id="f-startdate" type="date" value="${e.start_date || ''}"></div>
    <div class="field" id="f-end-box"><label>По какое число</label>
      <input class="inp" id="f-enddate" type="date" value="${e.end_date || ''}"></div>
    <div class="field"><label>Время</label>
      <div class="row"><input class="inp" id="f-start" type="time" value="${hhmm(e.start_time)}" title="с">–<input class="inp" id="f-end" type="time" value="${hhmm(e.end_time)}" title="до"></div></div>
    </div>
    <div class="field"><label>Раздел</label>
      <select class="inp" id="f-section"><option value="">Без раздела</option>
        ${mySecs().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    </div><div class="notes-col">
    <div class="field" id="f-subs-box"><div id="f-subs"></div>
      <button class="link" data-act="sub-add">+ Подпункт</button></div>
    ${occ ? kidsBox : ''}
    <div class="field"><textarea class="inp" id="f-notes" placeholder="Заметка">${esc(e.notes || '')}</textarea></div>
    </div></div>
    </div>
    <div class="e-pane" data-pane="repeat">
    <div class="cols"><div>
    <div class="field"><label>Повтор</label>
      <div class="row">
        <select class="inp" id="f-unit">
          <option value="">Не повторять</option>
          <option value="day">Дни</option><option value="week">Недели</option>
          <option value="month">Месяцы</option><option value="year">Годы</option>
          <option value="cycle">Цикл: дни да / нет</option>
        </select>
        <span id="f-every-box" class="row">каждые <input class="inp" id="f-every" type="number" min="1" value="${e.repeat_every || 1}" style="max-width:64px"></span>
      </div></div>
    <div class="field" id="f-cycle-box"><label>Цикл</label>
      <div class="row">делать <input class="inp" id="f-on" type="number" min="1" value="${e.repeat_unit === 'cycle' ? e.repeat_every || 1 : 2}" style="max-width:64px"> дн., пропускать <input class="inp" id="f-off" type="number" min="1" value="${e.repeat_off || 1}" style="max-width:64px"> дн.</div>
      <div class="row" style="margin-top:6px">первый день цикла <input class="inp" id="f-anchor" type="date" value="${e.repeat_anchor || ''}" style="max-width:160px"></div>
      <div class="hint" id="f-cycle-next"></div></div>
    </div><div>
    <div class="field" id="f-wd-box"><label>Дни недели</label>
      <div class="wds">${WD.map((w, i) => `<button class="pill" data-act="wd" data-v="${i + 1}">${w}</button>`).join('')}</div></div>
    <div class="field" id="f-from-box"><label>Новый срок считать</label>
      <div class="seg">
        <button class="pill" data-act="from" data-v="due">от старого срока</button>
        <button class="pill" data-act="from" data-v="done">от выполнения</button>
      </div></div>
    </div></div>
    </div>
    <div class="e-pane" data-pane="plan">
    ${projHint(e)}
    <div class="field" id="f-plan-box"><label>План: день, когда делаю</label>
      <div class="row"><input class="inp" id="f-plan" type="date" value="${e.plan_date || ''}">
        займёт <input class="inp num" id="f-est" type="number" min="0" step="0.5" value="${e.estimate || ''}" style="max-width:70px"> ч</div>
      <div id="f-spent"></div></div>
    </div>
    <div class="e-pane" data-pane="more">
    <div class="cols"><div>
    <div class="field" id="f-remind-box"><label>Напомнить на телефон</label>
      <div class="wds remind">
        <button class="pill" data-act="remind" data-v="">Нет</button>
        ${REMIND_TIMES.map(h => `<button class="pill" data-act="remind" data-v="${h}">${h.replace(/^0/, '').slice(0, -3)}</button>`).join('')}
        <input class="inp" id="f-remind" type="time" title="Своё время" value="${hhmm(e.remind_at)}">
        <span class="early" id="f-early-box">и за <input class="inp num" id="f-early" type="number" min="1" max="60" placeholder="—" value="${e.remind_days || ''}" title="Напомнить заранее: за сколько дней до срока" style="max-width:56px"> дн.</span>
      </div></div>
    ${S.space === 'personal' || e.size ? `<div class="field" id="f-size-box"><label>Размер</label>
      <div class="row"><button class="pill" data-act="size" data-v="" id="f-size-def">Нет</button>${Object.entries(SIZES).map(([k, z]) => `<button class="pill" data-act="size" data-v="${k}">${z.icon} ${z.name}</button>`).join('')}</div></div>
    <div class="field" id="f-slot-box"><label>Когда</label>
      <div class="row"><button class="pill" data-act="slot" data-v="">Без окошка</button>${Object.entries(SLOTS).map(([k, s]) => `<button class="pill" data-act="slot" data-v="${k}">${s.name}</button>`).join('')}</div></div>` : ''}
    ${e.project_id && projectTasks(e.project_id).some(x => x.id !== e.id) ? `<div class="field"><label>Делать после</label>
      <div class="wds after">${projectTasks(e.project_id).filter(x => x.id !== e.id).map(x => `<button class="pill" data-act="after" data-v="${x.id}">${x.done_on ? '✓ ' : ''}${esc(x.title)}</button>`).join('')}</div></div>` : ''}
    </div><div>
    ${S.space === 'personal' || e.pet ? `<div class="field" id="f-pet-box"><label>Питомец</label>
      <div class="row">${[['', 'Нет'], ...Object.keys(PETS).filter(petOn).map(p => [p, PETS[p].icon + ' ' + esc(petName(p))])]
        .map(([p, n]) => `<button class="pill" data-act="pet" data-v="${p}">${n}</button>`).join('')}</div></div>` : ''}
    ${S.space === 'personal' || e.decor ? `<div class="field" id="f-decor-box"><label>Картинка</label>
      <div class="row">${[['', 'Нет', ''], ...Object.entries(DECOR).map(([k, d]) => [k, d.icon + ' ' + d.name, d.hint])]
        .map(([k, n, h]) => `<button class="pill" data-act="decor" data-v="${k}" title="${esc(h)}">${n}</button>`).join('')}</div></div>` : ''}
    ${occ ? '' : kidsBox}
    </div></div>
    </div>
    <div class="actions">
      ${isNew ? '<span></span>' : '<button class="btn danger" data-act="delete">Удалить</button>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="save">Сохранить</button></div>
    </div>
  </div></div>`;
  document.getElementById('f-unit').value = e.repeat_unit || '';
  document.getElementById('f-section').value = e.section_id || '';
  document.getElementById('f-unit').onchange = ev => { e.repeat_unit = ev.target.value || null; syncEdit(); };
  document.getElementById('f-remind').onchange = ev => { e.remind_at = ev.target.value || null; syncEdit(); };
  for (const id of ['f-on', 'f-off', 'f-anchor']) document.getElementById(id).oninput = syncCycle;
  renderSubs();
  renderSpent();
  if (!parent) renderKids();
  syncEdit();
  if (isNew) document.getElementById('f-title').focus();
}

// Значения цикла из окна задачи и ближайшие дни для проверки.
function cycleForm() {
  const n = id => Math.max(1, parseInt(document.getElementById(id).value) || 1);
  return { on: n('f-on'), off: n('f-off'), anchor: document.getElementById('f-anchor').value || today() };
}
function syncCycle() {
  const { on, off, anchor } = cycleForm();
  const days = [];
  for (let i = 0, d = addDays(today(), -1); i < 5; i++) days.push(d = nextCycle(d, on, off, anchor));
  document.getElementById('f-cycle-next').textContent = 'Ближайшие дни: ' + days.map(dateLabel).join(' · ');
}

// Показ/скрытие частей окна по выбранным значениям.
function syncEdit() {
  const e = S.edit;
  // у событий цикла нет: уведомления о повторах событий считаются отдельно и его не знают
  if (isEvent(e) && e.repeat_unit === 'cycle') { e.repeat_unit = 'day'; document.getElementById('f-unit').value = 'day'; }
  $modal.querySelector('#f-unit option[value=cycle]').hidden = isEvent(e);
  const cycle = e.repeat_unit === 'cycle';
  const q = s => $modal.querySelectorAll(s);
  q('[data-act=kind]').forEach(b => b.classList.toggle('on', b.dataset.v === e.kind));
  q('[data-act=from]').forEach(b => b.classList.toggle('on', b.dataset.v === e.repeat_from));
  q('[data-act=wd]').forEach(b => b.classList.toggle('on', (e.repeat_weekdays || []).includes(+b.dataset.v)));
  q('[data-act=pet]').forEach(b => b.classList.toggle('on', b.dataset.v ? petsOf(e).includes(b.dataset.v) : !e.pet));
  q('[data-act=decor]').forEach(b => b.classList.toggle('on', b.dataset.v === (e.decor || '')));
  // размер: «Нет» превращается в «как у раздела», если у выбранного раздела он задан
  const defSize = isEvent(e) ? null : secSize(document.getElementById('f-section').value || null);
  const sizeBtn = document.getElementById('f-size-def');
  if (sizeBtn) {
    sizeBtn.textContent = defSize ? `Как у раздела: ${SIZES[defSize].icon}` : 'Нет';
    q('[data-act=size]').forEach(b => b.classList.toggle('on', b.dataset.v === (e.size || '')));
    q('[data-act=slot]').forEach(b => b.classList.toggle('on', b.dataset.v === (e.slot || '')));
    document.getElementById('f-size-box').style.display = isEvent(e) ? 'none' : '';
    const sz = isEvent(e) ? null : e.size || defSize;
    document.getElementById('f-slot-box').style.display = sz === 'mid' || sz === 'idea' ? '' : 'none';
    const anyBtn = document.querySelector('[data-act=slot][data-v=""]');
    if (anyBtn) anyBtn.textContent = sz === 'idea' ? 'Вечером' : 'Без окошка';
  }
  q('[data-act=after]').forEach(b => b.classList.toggle('on', (e.after_ids || []).includes(b.dataset.v)));
  const rem = hhmm(e.remind_at);
  q('[data-act=remind]').forEach(b => b.classList.toggle('on', b.dataset.v.slice(0, 5) === rem));
  document.getElementById('f-remind').value = rem;
  document.getElementById('f-remind').classList.toggle('on', !!rem && !REMIND_TIMES.some(h => h.startsWith(rem)));
  document.getElementById('f-every-box').style.display = e.repeat_unit && !cycle ? '' : 'none';
  document.getElementById('f-cycle-box').style.display = cycle ? '' : 'none';
  if (cycle) {
    const a = document.getElementById('f-anchor');
    if (!a.value) a.value = document.getElementById('f-date').value || today();
    syncCycle();
  }
  document.getElementById('f-wd-box').style.display = e.repeat_unit === 'week' ? '' : 'none';
  // у события нет выполнения: «от дня выполнения» не нужно, зато есть «по какое число»
  document.getElementById('f-from-box').style.display = e.repeat_unit && !isEvent(e) && !cycle ? '' : 'none';
  document.getElementById('f-end-box').style.display = isEvent(e) ? '' : 'none';
  document.getElementById('f-startdate-box').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-nodate').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-date-label').textContent = isEvent(e) ? 'Дата' : 'Срок';
  document.getElementById('f-subs-box').style.display = isEvent(e) ? 'none' : '';
  document.getElementById('f-plan-box').style.display = planFields(e) ? '' : 'none';
  // случай: только название, «Следом» и заметка
  const occ = e.kind === 'occasion';
  if (occ) for (const sel of ['#f-kind', '#f-when', '#f-subs-box', '#f-tabs']) $modal.querySelector(sel).hidden = true;
  const kb = document.getElementById('f-kids-box');
  if (kb) kb.style.display = isEvent(e) ? 'none' : '';
  // вкладки: «План и время» — только у рабочих задач; точка — на вкладке что-то задано
  const tabOk = { main: true, repeat: !occ, plan: !occ && planFields(e), more: !occ };
  if (!tabOk[e.tab]) e.tab = 'main';
  const sizeSet = !isEvent(e) && (e.size || e.slot);
  const dots = {
    repeat: !!e.repeat_unit,
    plan: !!(e.plan_date || e.estimate || (e.id && spentOf(e.id))),
    more: !!(e.remind_at || e.remind_days || e.pet || e.decor || sizeSet || (e.after_ids || []).length || (!isEvent(e) && (e.kids || []).some(k => k.t.trim()))),
  };
  q('[data-act=e-tab]').forEach(b => {
    const k = b.dataset.v;
    b.classList.toggle('on', k === e.tab);
    b.style.display = tabOk[k] ? '' : 'none';
    const dot = b.querySelector('.tdot');
    if (dot) dot.hidden = !dots[k];
  });
  q('.e-pane').forEach(p => { p.hidden = p.dataset.pane !== e.tab; });
}

// Задачи «Следом» в окне задачи: ☾ спит / ● уже на сегодня, текст, ✕.
function renderKids() {
  document.getElementById('f-kids').innerHTML = S.edit.kids.map((k, i) => `<div class="subrow">
      <span class="kid-mark ${k.on ? 'on' : ''}" title="${k.on ? 'Уже на сегодня' : 'Спит'}">${k.on ? '●' : '☾'}</span>
      <input class="inp" data-kid="${i}" placeholder="Что сделать потом" value="${esc(k.t)}">
      <button class="icon small kid-book ${k.decor === 'books' ? 'on' : ''}" data-act="kid-book" data-v="${i}" aria-label="Книгами на подоконнике">📚</button>
      <button class="icon small" data-act="kid-del" data-v="${i}" aria-label="Убрать">✕</button>
    </div>`).join('');
}

// Сохранить «Следом»: новые — добавить, изменённые — переименовать, убранные — удалить.
async function saveKids(pid, row) {
  const kids = S.edit.kids || [];
  const keep = new Set(kids.filter(k => k.id && k.t.trim()).map(k => k.id));
  const gone = S.tasks.filter(x => x.wake_after === pid && !keep.has(x.id)).map(x => x.id);
  if (gone.length) await call(sb.from('tasks').delete().in('id', gone));
  for (const k of kids) {
    const title = k.t.trim();
    if (!title) continue;
    if (!k.id) await call(sb.from('tasks').insert({ title, kind: 'task', wake_after: pid, repeat_from: 'due',
      section_id: row.kind === 'occasion' ? null : row.section_id, space: row.space, ...(k.decor ? { decor: k.decor } : {}) }));
    else {
      const was = byId(k.id) || {};
      if (was.title !== title || (was.decor || null) !== (k.decor || null)) await call(sb.from('tasks').update({ title, decor: k.decor || null }).eq('id', k.id));
    }
  }
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
  const k = ev.target.dataset.kid;
  if (k !== undefined && S.edit) S.edit.kids[k].t = ev.target.value;
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

// Высота окна — по содержимому, а не «на весь экран»: при открытии меряем самую высокую вкладку
// так, будто все поля, которые появляются от кнопок, уже показаны. Потом окно уже не меняет размер
// от нажатий; что не поместилось (много подпунктов) — прокручивается внутри.
function fitSheet() {
  const sh = $modal.querySelector('.sheet.fixed, .sheet.review');
  if (!sh) return;
  const panes = [...sh.querySelectorAll(':scope > .e-pane, :scope > .tpl-pane')];
  const was = panes.map(p => p.hidden);
  const tabOff = p => { const b = sh.querySelector(`[data-act$="-tab"][data-v="${p.dataset.pane}"]`); return b && b.style.display === 'none'; };
  sh.style.height = 'auto';
  sh.classList.add('measure');
  let h = 0;
  const live = panes.filter(p => !tabOff(p));
  if (live.length) live.forEach(p => { panes.forEach(x => { x.hidden = x !== p; }); h = Math.max(h, sh.scrollHeight); });
  else h = sh.scrollHeight;
  panes.forEach((p, i) => { p.hidden = was[i]; });
  sh.classList.remove('measure');
  sh.style.height = Math.min(h + 2, innerHeight * 0.92) + 'px';
}
// новое окно (или окно целиком перерисовано) — подогнать высоту
new MutationObserver(() => fitSheet()).observe($modal, { childList: true });
addEventListener('resize', () => fitSheet());

function closeModal() {
  S.edit = null;
  S.tpl = null;
  $modal.innerHTML = '';
  $modal.dataset.kind = '';
  renderReview();
  // открыли задачу из окна предложений — после неё вернуться в окно
  if (S.offer && !S.offer.hidden && !$modal.dataset.kind) renderOffer();
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
  // напомнить заранее (016_early.sql); пока база не обновлена, у задач без него поле не отправляем
  const early = Math.min(60, Math.max(0, Math.round(+document.getElementById('f-early').value || 0))) || null;
  if (early || e.remind_days) { row.remind_days = early; if (early !== e.remind_days) row.early_on = null; }
  if (planFields(e)) {
    row.plan_date = document.getElementById('f-plan').value || null;
    row.estimate = parseFloat(document.getElementById('f-est').value.replace(',', '.')) || null;
  } else if (e.plan_date || e.estimate) { row.plan_date = null; row.estimate = null; }
  if (e.pet || (byId(e.id) || {}).pet) row.pet = e.pet || null;
  if (e.decor || (byId(e.id) || {}).decor) row.decor = e.decor || null; // пока 010 не запущен, у задач без картинки поле не отправляем
  // размер и «когда» (пока 014 не запущен, у задач без размера поля не отправляем)
  const was = byId(e.id) || {};
  const midNow = !isEvent(e) && ['mid', 'idea'].includes(e.size || secSize(row.section_id));
  if (e.size || was.size) row.size = isEvent(e) ? null : e.size || null;
  if (e.slot || was.slot) row.slot = midNow ? e.slot || null : null;
  if (row.due_date && was.offer_after) row.offer_after = null;
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
  if (row.repeat_unit === 'cycle') {
    const { on, off, anchor } = cycleForm();
    Object.assign(row, { repeat_every: on, repeat_off: off, repeat_anchor: anchor, repeat_from: 'due', repeat_weekdays: null });
    if (!cycleOn(row.due_date, on, off, anchor)) row.due_date = nextCycle(row.due_date, on, off, anchor); // срок — только на день цикла
  }
  if (isEvent(row)) {
    row.repeat_from = 'due';
    const end = document.getElementById('f-enddate').value;
    if (end && end > row.due_date) row.end_date = end;
  }
  if (row.kind === 'occasion') Object.assign(row, { due_date: null, repeat_unit: null, repeat_every: null, repeat_weekdays: null,
    section_id: null, start_time: null, end_time: null, start_date: null });
  let id = e.id;
  if (id) await call(sb.from('tasks').update(row).eq('id', id));
  else id = (await call(sb.from('tasks').insert(row).select('id').single())).id;
  if (!e.wake_after && !isEvent(row)) await saveKids(id, row);
  const backToOcc = row.kind === 'occasion';
  closeModal();
  await load();
  if (backToOcc) openOcc();
}

async function deleteEdit() {
  const kids = S.tasks.some(x => x.wake_after === S.edit.id);
  if (!confirm('Удалить совсем? История тоже удалится.' + (kids ? ' И задачи «Следом» — тоже.' : ''))) return;
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
    ${sec ? `<div class="field"><label>Режим</label>
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
      for (let i = 0; i < 2000 && d < t0; i++) d = nextOf(t, d);
      return call(sb.from('tasks').update({ due_date: d }).eq('id', t.id));
    }));
  }
  closeModal();
  await load();
  toast(paused ? `Раздел «${sec.name}» выключен` : `Раздел «${sec.name}» включён`);
}

// ---------- режимы «Личное / Работа» ----------
const SPACES = { personal: '🏠 Личное', work: '💼 Работа' };
// только значок: 🏠 — личное, 💼 — работа (что это — в справке)
const MODE = () => `<button class="icon mode" data-act="space" aria-label="${SPACES[S.space]}">${SPACES[S.space].split(' ')[0]}</button>`;

function setSpace(space) {
  S.space = space;
  localSet('space', space);
  S.section = null;
  S.pick = null;
  render();
  renderReview();
  maybeOffer();
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
  // оценка часов: среднее по факту прошлых периодов, если записано; иначе — часы из шаблона
  const est = steps.map((s, i) => { const a = factAvg(tpl.id, s.title, i); return a ? round4(a.avg) : s.hours; });
  const rows = steps.map((s, i) => ({
    title: s.title,
    project_id: data[0].id,
    section_id: tpl.section_id,
    space: sec ? sec.space || 'work' : 'work',
    position: i,
    start_date: s.start_day ? dayAfter(p.end, s.month || 1, s.start_day) : null,
    due_date: s.due_day ? dayAfter(p.end, s.month || 1, s.due_day) : null,
    ...(s.subs && s.subs.length ? { checklist: s.subs.map(x => ({ t: x, d: false })) } : {}),
    ...(est[i] ? { estimate: est[i] } : {}),
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
      <b>${esc(p.title)}</b>${S.templates.some(x => x.id === p.template_id) ? `<button class="icon small" data-act="guide" data-id="${p.id}" aria-label="Инструкция">📖</button>` : ''}
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
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet fixed">
    <h3>Шаблоны</h3>
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
  const stats = tplStatsHTML(t);
  t.someMonths = t.months.length > 0;
  t.tab = 'main';
  // окно на вкладках: «Основное» / «Шаги» / «Время» — чтобы настройки не громоздились
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet wide fixed">
    <h3>${t.id ? 'Шаблон' : 'Новый шаблон'}</h3>
    <div class="field"><input class="inp" id="t-title" placeholder="Название, например «Квартальная отчётность»" value="${esc(t.title || '')}"></div>
    <div class="seg tpl-tabs">
      <button class="pill" data-act="t-tab" data-v="main">Основное</button>
      <button class="pill" data-act="t-tab" data-v="steps">Шаги</button>
      <button class="pill" data-act="t-tab" data-v="memo">Памятка</button>
      ${stats ? '<button class="pill" data-act="t-tab" data-v="time">Время</button>' : ''}
    </div>
    <div class="tpl-pane" data-pane="main"><div class="cols"><div>
      ${t.from ? `<div class="field"><label>Эта задача — за период</label>
        <select class="inp" id="t-from-p"></select>
</div>` : ''}
      <div class="field"><label>Как часто</label>
        <div class="seg">${Object.entries(PERIODS).map(([k, n]) => `<button class="pill" data-act="t-period" data-v="${k}">${n}</button>`).join('')}</div></div>
      <div class="field" id="t-months-box"><label>Какие месяцы</label>
        <div class="seg"><button class="pill" data-act="t-some" data-v="">Все месяцы</button><button class="pill" data-act="t-some" data-v="1">Только некоторые</button></div>
        <div id="t-months-list">
          <div class="wds months">${MONTHS.map((m, i) => `<button class="pill" data-act="t-month" data-v="${i + 1}">${m.slice(0, 3)}</button>`).join('')}</div></div></div>
      </div><div>
      <div class="field"><label>Создавать заранее</label>
        <div class="row">за <input class="inp num" id="t-lead" type="number" min="0" max="20" value="${t.lead_days}" style="max-width:70px"> рабочих дн. до конца периода</div></div>
      <div class="field"><label>Раздел для задач</label>
        <select class="inp" id="t-section"><option value="">Без раздела</option>${work.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      ${t.id ? `<div class="field"><label>Создать задачи сейчас</label>
        <div class="row"><select class="inp" id="t-run" style="flex:1">${periodChoices(t.period).map(p => `<option value="${p.key}">${p.label}</option>`).join('')}</select>
        <button class="btn" data-act="t-run">Создать задачи</button></div></div>
        <div class="field"><button class="link" data-act="t-copy">Сделать копию шаблона</button></div>` : ''}
    </div></div></div>
    <div class="tpl-pane" data-pane="steps">
      ${t.from && t.from.subs.length ? `<div class="field"><label>Какие подпункты задачи взять в шаблон</label>
        <div class="fsubs" id="t-fsubs"></div></div>` : ''}
      <div class="field"><label>Шаги</label>
        <div id="t-steps"></div>
        <button class="link" data-act="t-add">+ Шаг</button></div>
    </div>
    <div class="tpl-pane" data-pane="memo"><textarea class="inp hw-text" id="t-memo" rows="14" placeholder="Памятка шаблона">${esc(t.memo || '')}</textarea></div>
    ${stats ? `<div class="tpl-pane" data-pane="time">${stats}</div>` : ''}
    <div class="actions">
      ${t.id ? '<button class="btn danger" data-act="t-delete">Удалить</button>' : '<span></span>'}
      <div class="row"><button class="btn" data-act="close">Отмена</button><button class="btn main" data-act="t-save">Сохранить</button></div>
    </div>
  </div></div>`;
  document.getElementById('t-section').value = t.section_id || (work[0] && !t.id ? work[0].id : '');
  if (t.from) document.getElementById('t-from-p').onchange = ev => { S.tpl.from.pkey = ev.target.value; fromDays(S.tpl); renderSteps(); };
  renderSteps();
  syncTemplate();
}

function renderSteps() {
  const num = (i, k, ph) => `<input class="inp num" type="number" min="1" max="31" data-step="${i}" data-k="${k}" placeholder="${ph}" value="${S.tpl.steps[i][k] || ''}">`;
  document.getElementById('t-steps').innerHTML = '<div class="step head"><span>№</span><span>Шаг</span><span>с</span><span>до</span><span>мес.</span><span>часов</span><span></span><span></span></div>'
    + S.tpl.steps.map((s, i) => `<div class="step">
      <span class="step-n">${i + 1}</span>
      <input class="inp" data-step="${i}" data-k="title" placeholder="Что сделать" value="${esc(s.title || '')}">
      ${num(i, 'start_day', 'с')}${num(i, 'due_day', 'до')}
      <input class="inp num" type="number" min="1" max="12" data-step="${i}" data-k="month" title="Месяц после конца периода" value="${s.month || 1}">
      <input class="inp num" type="number" min="0" step="0.5" data-step="${i}" data-k="hours" title="Сколько примерно часов займёт" placeholder="ч" value="${s.hours || ''}">
      <button class="icon small step-how ${s.howto ? 'on' : ''}" data-act="t-how" data-v="${i}" aria-label="Как делать">📖</button>
      <button class="icon small" data-act="t-del-step" data-v="${i}" title="Убрать шаг">✕</button>
    </div>
    <div class="t-subs">${(S.tpl.howOpen || []).includes(i) ? `<textarea class="inp t-howto" data-step="${i}" data-k="howto" placeholder="Как делать">${esc(s.howto || '')}</textarea>` : ''}${(s.subs || []).map((x, j) => `<div class="subrow">
        <span class="sub-dash">└</span>
        <input class="inp" data-tstep="${i}" data-tsub="${j}" placeholder="Подзадача" value="${esc(x)}">
        <button class="icon small" data-act="t-sub-up" data-v="${i}:${j}" aria-label="Сделать отдельным шагом">⤴</button>
        <button class="icon small" data-act="t-del-sub" data-v="${i}:${j}" aria-label="Убрать">✕</button>
      </div>`).join('')}
      ${S.tpl.moveFrom === i ? `<div class="row t-move"><label>Подзадачей к шагу <select class="inp" id="t-move-to">${S.tpl.steps.map((x, k) => k === i ? '' : `<option value="${k}">${k + 1}. ${esc(x.title || '')}</option>`).join('')}</select></label>
        <button class="icon small" data-act="t-move-go" data-v="${i}" aria-label="Перенести">✓</button><button class="icon small" data-act="t-move-off" aria-label="Не переносить">✕</button></div>` : ''}
      <div class="row t-after"><span class="row"><button class="link small" data-act="t-add-sub" data-v="${i}">+ подзадача</button>${S.tpl.steps.length > 1 ? `<button class="link small" data-act="t-move" data-v="${i}">⤵ в подзадачи</button>` : ''}</span>
        <label>после шагов <input class="inp" data-step="${i}" data-k="after" placeholder="напр. 1, 2" value="${(s.after || []).join(', ')}"></label></div></div>`).join('');
}

// Подзадача → отдельный шаг сразу после своего (сроки и месяц — как у шага); номера в «после шагов» сдвигаются.
function stepFromSub(i, j) {
  const st = S.tpl.steps, s = st[i], title = (s.subs || [])[j];
  if (title === undefined) return;
  s.subs.splice(j, 1);
  const at = i + 1; // новый шаг встаёт на место at (номер at + 1)
  st.forEach(x => { if (x.after) x.after = x.after.map(n => (n > at ? n + 1 : n)); });
  st.splice(at, 0, { title, start_day: s.start_day || null, due_day: s.due_day || null, month: s.month || 1, subs: [] });
  S.tpl.howOpen = [];
  renderSteps();
}
// Шаг → подзадача другого шага: его подзадачи тоже переходят туда; инструкция шага дописывается к инструкции того шага.
function stepToSub(i, k) {
  const st = S.tpl.steps, s = st[i], to = st[k];
  if (!s || !to || i === k) return;
  to.subs = [...(to.subs || []), ...(s.title ? [s.title] : []), ...(s.subs || [])];
  if (s.howto) to.howto = [to.howto, `${s.title}:\n${s.howto}`].filter(Boolean).join('\n\n');
  const n = i + 1, toN = (k > i ? k - 1 : k) + 1; // «после шагов»: ссылки на перенесённый шаг — теперь на тот, куда перенесли
  st.splice(i, 1);
  st.forEach((x, idx) => { if (x.after) x.after = [...new Set(x.after.map(y => (y === n ? toN : y > n ? y - 1 : y)))].filter(y => y !== idx + 1); });
  S.tpl.moveFrom = null;
  S.tpl.howOpen = [];
  renderSteps();
}

function syncTemplate() {
  const t = S.tpl;
  $modal.querySelectorAll('[data-act=t-period]').forEach(b => b.classList.toggle('on', b.dataset.v === t.period));
  $modal.querySelectorAll('[data-act=t-month]').forEach(b => b.classList.toggle('on', t.months.includes(+b.dataset.v)));
  document.getElementById('t-months-box').style.display = t.period === 'month' ? '' : 'none';
  $modal.querySelectorAll('[data-act=t-some]').forEach(b => b.classList.toggle('on', !!b.dataset.v === t.someMonths));
  document.getElementById('t-months-list').style.display = t.someMonths ? '' : 'none';
  $modal.querySelectorAll('[data-act=t-tab]').forEach(b => b.classList.toggle('on', b.dataset.v === t.tab));
  $modal.querySelectorAll('.tpl-pane').forEach(p => { p.hidden = p.dataset.pane !== t.tab; });
  if (t.from) {
    // сменили «каждый месяц / квартал / год» — заново список периодов и числа шага
    const sel = document.getElementById('t-from-p');
    if (sel.dataset.period !== t.period) {
      const ch = periodChoices(t.period);
      if (!ch.some(x => x.key === t.from.pkey)) t.from.pkey = lastPeriod(t.period).key;
      sel.innerHTML = ch.map(p => `<option value="${p.key}">${p.label}</option>`).join('');
      sel.value = t.from.pkey;
      sel.dataset.period = t.period;
      fromDays(t);
      renderSteps();
    }
    const fs = document.getElementById('t-fsubs');
    if (fs) fs.innerHTML = t.from.subs.map((x, i) => `<button class="fsub" data-act="t-fsub" data-v="${i}"><span class="sub-box ${x.on ? 'on' : ''}">${x.on ? '✓' : ''}</span>${esc(x.t)}</button>`).join('')
      + `<div class="hint">Взято ${t.from.subs.filter(x => x.on).length} из ${t.from.subs.length}</div>`;
  }
}

// Шаблон из рабочей задачи: один шаг с её названием, сроком, часами (по факту, иначе оценка); подпункты — на выбор.
function tplFromTask() {
  const e = S.edit;
  const t = byId(e.id);
  const title = document.getElementById('f-title').value.trim() || t.title;
  const spent = spentOf(t.id);
  const est = parseFloat((document.getElementById('f-est').value || '').replace(',', '.')) || +t.estimate || 0;
  const sec = S.sections.find(s => s.id === t.section_id && spaceOfSec(s) === 'work');
  const tpl = { title, period: 'month', months: [], lead_days: 3, section_id: sec ? sec.id : null,
    steps: [{ title, month: 1, hours: round4(spent) || est || null, subs: [] }],
    from: { id: t.id, subs: cleanSubs(e.checklist).map(s => ({ t: s.t, on: true })), due: t.due_date, start: t.start_date,
      repeat: !!t.repeat_unit, pkey: lastPeriod('month').key } };
  fromDays(tpl);
  openTemplate(tpl);
}

// Числа шага из сроков задачи: день месяца и какой это месяц после конца выбранного периода.
function fromDays(tpl) {
  const f = tpl.from;
  const p = periodChoices(tpl.period).find(x => x.key === f.pkey) || lastPeriod(tpl.period);
  const end = parse(p.end);
  const off = d => { const x = parse(d); return Math.max(1, x.getFullYear() * 12 + x.getMonth() - end.getFullYear() * 12 - end.getMonth()); };
  const s = tpl.steps[0];
  if (!s) return;
  s.month = f.due || f.start ? off(f.due || f.start) : 1;
  s.due_day = f.due ? parse(f.due).getDate() : null;
  s.start_day = f.start ? parse(f.start).getDate() : null;
}

// ---------- инструкции (работа): «как делать» у шага шаблона + памятка шаблона ----------
// Живут в шаблоне (steps[].howto, templates.memo), а не копируются в задачи: поправила — в следующем периоде уже новая версия.
// Шаг задачи ищется по названию, иначе по месту в проекте.
function stepOf(t) {
  const p = t && t.project_id && (S.allProjects || []).find(x => x.id === t.project_id);
  const tpl = p && S.templates.find(x => x.id === p.template_id);
  if (!tpl) return null;
  const steps = tpl.steps || [];
  let i = steps.findIndex(s => s.title === t.title);
  if (i < 0 && steps[t.position]) i = t.position;
  return { tpl, p, i, step: steps[i] || null };
}
// Текст инструкции: строки «- …» / «1. …» — списки, ссылки нажимаются, пустая строка — абзац.
function richText(s) {
  const link = x => x.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  for (const raw of String(s || '').split('\n')) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
    if (m) {
      const tag = m[1] ? 'ol' : 'ul';
      if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${link(esc(m[2]))}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (line) out.push(`<p>${link(esc(line))}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join('');
}
// Окно поверх всего (и поверх окна задачи): step — один шаг (i), иначе вся инструкция проекта.
function openHowto(taskId) {
  const h = stepOf(byId(taskId));
  if (!h) return toast('Шаблон этой задачи не найден');
  S.howto = { tplId: h.tpl.id, i: h.i >= 0 ? h.i : null, title: byId(taskId).title, edit: null, guide: false };
  renderHowto();
}
function openGuide(projectId) {
  const p = (S.allProjects || []).find(x => x.id === projectId);
  const tpl = p && S.templates.find(x => x.id === p.template_id);
  if (!tpl) return;
  S.howto = { tplId: tpl.id, i: null, title: tpl.title, edit: null, guide: true };
  renderHowto();
}
function closeHowto() { S.howto = null; document.getElementById('howto')?.remove(); }
function renderHowto() {
  const h = S.howto, tpl = h && S.templates.find(x => x.id === h.tplId);
  if (!tpl) return closeHowto();
  let el = document.getElementById('howto');
  if (!el) { el = document.createElement('div'); el.id = 'howto'; document.body.appendChild(el); }
  const steps = tpl.steps || [];
  // блок текста: просмотр или правка (key — 'memo' или номер шага)
  const block = (key, text, empty) => h.edit === key
    ? `<textarea class="inp hw-text" id="hw-text" rows="10" placeholder="Как делать">${esc(text || '')}</textarea>
       <div class="row hw-btns"><button class="btn" data-act="hw-cancel">Отмена</button><button class="btn main" data-act="hw-save">Сохранить</button></div>`
    : `<div class="hw-body">${text ? richText(text) : `<div class="empty small">${empty}</div>`}</div>
       <button class="link" data-act="hw-edit" data-v="${key}">✎ ${text ? 'Изменить' : 'Написать'}</button>`;
  const memo = `<details class="hw-memo" ${h.guide || h.edit === 'memo' || !(steps[h.i] || {}).howto ? 'open' : ''}><summary>Памятка шаблона</summary>${block('memo', tpl.memo, 'Памятки нет')}</details>`;
  let body;
  if (h.guide) {
    body = memo + steps.map((s, i) => `<details class="hw-step" ${h.edit === i ? 'open' : ''}><summary>${i + 1}. ${esc(s.title)}${s.howto ? ' 📖' : ''}</summary>${block(i, s.howto, 'Инструкции нет')}</details>`).join('');
  } else if (h.i === null) {
    body = `<div class="empty small">Такого шага в шаблоне нет</div>` + memo;
  } else {
    body = `<h2>Как делать</h2>${block(h.i, steps[h.i].howto, 'Инструкции пока нет')}` + memo;
  }
  el.innerHTML = `<div class="overlay" data-act="hw-close-bg"><div class="sheet fixed hw">
    <h3>📖 ${esc(h.title)}</h3>${h.guide ? '' : `<div class="hint">${esc(tpl.title)}</div>`}
    <div class="hw-scroll">${body}</div>
    <div class="actions"><span></span><button class="btn" data-act="hw-close">Закрыть</button></div>
  </div></div>`;
  if (h.edit !== null) document.getElementById('hw-text')?.focus();
}
async function saveHowto() {
  const h = S.howto, tpl = S.templates.find(x => x.id === h.tplId);
  const text = document.getElementById('hw-text').value.trim() || null;
  if (h.edit === 'memo') {
    if (!('memo' in tpl)) return toast('Сначала запусти в Supabase файл 020_payments_howto.sql');
    await call(sb.from('templates').update({ memo: text }).eq('id', tpl.id));
    tpl.memo = text;
  } else {
    const steps = (tpl.steps || []).map((s, i) => (i === +h.edit ? { ...s, howto: text } : s));
    await call(sb.from('templates').update({ steps }).eq('id', tpl.id));
    tpl.steps = steps;
  }
  h.edit = null;
  renderHowto();
  toast('Сохранено в шаблоне');
}

// В окне рабочей задачи: из какого она проекта (шаблона) — или кнопка «сделать шаблон».
function projHint(e) {
  if (!e.id || isEvent(e) || e.kind === 'habit' || e.kind === 'occasion' || spaceOf(e) !== 'work') return '';
  const p = e.project_id && (S.allProjects || []).find(x => x.id === e.project_id);
  if (p) return `<div class="hint proj-of">📁 ${esc(p.title)}${stepOf(e) ? ` <button class="link" data-act="howto" data-id="${e.id}">📖 Как делать</button>` : ''}</div>`;
  return `<div class="hint proj-of"><button class="link" data-act="tpl-from">⟳ Сделать шаблон из этой задачи</button></div>`;
}

// Поля шагов сохраняются в S.tpl при вводе.
document.addEventListener('input', ev => {
  if (ev.target.id === 't-memo' && S.tpl) { S.tpl.memo = ev.target.value; return; }
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
  S.tpl.steps[i][k] = k === 'title' || k === 'howto' ? ev.target.value : k === 'hours' ? parseFloat(ev.target.value) || null : parseInt(ev.target.value) || null;
});

// silent — только сохранить и вернуть шаблон (для «Создать задачи»), без вопросов и закрытия окна
async function saveTemplate(silent = false) {
  const t = S.tpl;
  const title = document.getElementById('t-title').value.trim();
  if (!title) return toast('Напиши название шаблона');
  const row = {
    title,
    period: t.period,
    months: t.period === 'month' && t.someMonths && t.months.length ? [...t.months].sort((a, b) => a - b) : null,
    section_id: document.getElementById('t-section').value || null,
    // подпункты, выбранные из задачи, — в первый шаг
    steps: t.steps.map((s, i) => (i === 0 && t.from ? { ...s, subs: [...t.from.subs.filter(x => x.on).map(x => x.t), ...(s.subs || [])] } : s))
      .filter(s => s.title && s.title.trim()).map((s, _, all) => ({
      title: s.title.trim(), start_day: s.start_day || null, due_day: s.due_day || null, month: s.month || 1,
      subs: (s.subs || []).map(x => x.trim()).filter(Boolean),
      hours: s.hours || null,
      after: (s.after || []).filter(n => n <= all.length),
      ...(s.howto && s.howto.trim() ? { howto: s.howto.trim() } : {}),
    })),
    lead_days: Math.max(0, parseInt(document.getElementById('t-lead').value) || 0),
  };
  // памятка — только если в базе есть колонка (020); иначе сохраняем без неё
  const memo = (document.getElementById('t-memo').value || '').trim() || null;
  if ('memo' in t || S.templates.some(x => 'memo' in x)) row.memo = memo;
  else if (memo) toast('Памятка не сохранится: запусти в Supabase файл 020_payments_howto.sql');
  let tpl;
  if (t.id) [tpl] = await call(sb.from('templates').update(row).eq('id', t.id).select());
  else [tpl] = await call(sb.from('templates').insert(row).select());
  if (silent) return tpl;
  if (!t.id && t.from) {
    // шаблон из задачи: сама задача становится проектом за выбранный период, следующие шаблон создаст сам
    const p = periodChoices(tpl.period).find(x => x.key === t.from.pkey) || lastPeriod(tpl.period);
    const [pr] = await call(sb.from('projects').insert({ template_id: tpl.id, period: p.key, title: `${tpl.title} — ${p.label}`, section_id: tpl.section_id }).select());
    const upd = { project_id: pr.id, position: 0, section_id: tpl.section_id };
    if (t.from.repeat && confirm('У задачи есть повтор. Убрать его? Дальше такие задачи будет создавать шаблон — иначе они задвоятся.'))
      Object.assign(upd, { repeat_unit: null, repeat_every: null, repeat_weekdays: null });
    await call(sb.from('tasks').update(upd).eq('id', t.from.id));
    await call(sb.from('templates').update({ last_period: p.key }).eq('id', tpl.id));
    toast(`Шаблон готов. Эта задача — за ${p.label}`);
  } else if (!t.id) {
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
const BUSY = new Set(['t-save', 't-run', 't-delete', 'p-archive', 's-pause', 'login', 'signup', 'done', 'undo', 'save', 'delete', 's-save', 's-delete', 'r-yes', 'r-no', 'bulk-save', 'bulk-delete', 'limits-save', 'flower-sec', 'occ-go']);

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
    + ctxSlots(t, item)
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

// «В окошко» в быстром меню: личный режим, будний день, задача на сегодня.
function ctxSlots(t, item) {
  const d = today();
  if (S.space !== 'personal' || isodow(d) >= 6 || isEvent(t) || reviewDay(t) !== d) return '';
  const fit = dayFit(d), cur = fit.inSlot[t.id];
  return '<div class="ctx-sep">В окошко — на сегодня</div>'
    + Object.keys(SLOTS).map(k => item('w:' + k, `${SLOT_ICON[k]} ${SLOTS[k].name}`, cur === k)).join('')
    + (cur ? item('w:none', 'Убрать из окошка', false) : '');
}

// Поменять срок (d:ГГГГ-ММ-ДД, d: — без срока) или раздел (s:id, s: — без раздела); с «Отменить».
async function quick(t, v) {
  const [k, val] = [v.slice(0, 2), v.slice(2) || null];
  if (k === 'w:') return setDaySlot(t, val);
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
  if ((act === 'close-bg' || act === 'of-hide-bg' || act === 'hw-close-bg') && (ev.target !== el || downAt !== el)) return;
  if (BUSY.has(act)) el.disabled = true; // от двойного нажатия, пока ждём базу
  try {
    switch (act) {
      case 'login': case 'signup': await auth(act); break;
      case 'logout': closeModal(); await sb.auth.signOut(); break;
      case 'set-name': await setName(); break;
      case 'settings': openSettings(); break;
      case 'help': openHelp(); break;
      case 'occ': openOcc(); break;
      case 'pay': await openPay(); break;
      case 'howto': ev.stopPropagation(); openHowto(id); break;
      case 'guide': openGuide(id); break;
      case 'hw-close': case 'hw-close-bg': closeHowto(); break;
      case 'hw-edit': S.howto.edit = v === 'memo' ? 'memo' : +v; renderHowto(); break;
      case 'hw-cancel': S.howto.edit = null; renderHowto(); break;
      case 'hw-save': await saveHowto(); break;
      case 'pay-save': await savePay(); break;
      case 'pay-done': ev.stopPropagation(); await payMark(id, true); break;
      case 'pay-back': ev.stopPropagation(); await payMark(id, false); break;
      case 'pay-edit': S.pay.edit = S.pay.edit === id ? null : id; renderPay(true); break;
      case 'pay-cancel': S.pay.edit = null; renderPay(true); break;
      case 'pay-del': await payDelete(); break;
      case 'pay-arch': S.pay.arch = !!v; renderPay(); break;
      case 'occ-new': openEdit({ kind: 'occasion', repeat_from: 'due' }); break;
      case 'occ-go': closeModal(); await complete(byId(id)); break;
      case 'kid-add':
        S.edit.kids.push({ t: '' });
        renderKids();
        $modal.querySelector(`[data-kid="${S.edit.kids.length - 1}"]`).focus();
        break;
      case 'kid-del': S.edit.kids.splice(+v, 1); renderKids(); break;
      case 'kid-book': { const k = S.edit.kids[+v]; k.decor = k.decor === 'books' ? null : 'books'; renderKids(); break; }
      case 'book': bookDone(byId(id), el); break;
      case 'book-ok': $bubble.hidden = true; await complete(byId(id)); break;
      case 'show-done': S.showDone = !S.showDone; localSet('done', S.showDone ? '1' : ''); openSettings(); render(); break;
      case 'flower-sec': await flowerSec(el); break;
      case 'bg-toggle': S.bg = !S.bg; localSet('bg', S.bg ? '1' : '0'); openSettings(); render(); break;
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
      case 't-tab': S.tpl.tab = v; syncTemplate(); break;
      case 'e-tab': S.edit.tab = v; syncEdit(); break;
      case 't-some': S.tpl.someMonths = !!v; syncTemplate(); break;
      case 't-month': S.tpl.months = S.tpl.months.includes(+v) ? S.tpl.months.filter(m => m !== +v) : S.tpl.months.concat(+v); syncTemplate(); break;
      case 't-add': S.tpl.steps.push({ title: '', month: 1 }); renderSteps(); break;
      case 't-del-step': {
        S.tpl.howOpen = []; S.tpl.moveFrom = null;
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
      case 'limits-save': await saveLimits(); break;
      case 'nodate': S.noDate = !S.noDate; localSet('nodate', S.noDate ? '1' : ''); render(); break;
      case 'size-filter':
        S.sizes = S.sizes.includes(v) ? S.sizes.filter(x => x !== v) : S.sizes.concat(v);
        localSet('sizes', S.sizes.join(',')); render(); break;
      case 'h-range': S.hRange = +v; localSet('hrange', v); render(); break;
      case 't-range': S.tRange = +v; localSet('trange', v); render(); break;
      case 'sp-add': await addSpent(); break;
      case 'sp-del': await delSpent(v); break;
      case 'tpl-from': tplFromTask(); break;
      case 't-fsub': S.tpl.from.subs[+v].on = !S.tpl.from.subs[+v].on; syncTemplate(); break;
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
      case 't-how': { const o = (S.tpl.howOpen ||= []), n = +v; o.includes(n) ? o.splice(o.indexOf(n), 1) : o.push(n); renderSteps(); break; }
      case 't-add-sub': (S.tpl.steps[+v].subs ||= []).push(''); renderSteps(); break;
      case 't-sub-up': stepFromSub(...v.split(':').map(Number)); break;
      case 't-move': S.tpl.moveFrom = +v; renderSteps(); break;
      case 't-move-off': S.tpl.moveFrom = null; renderSteps(); break;
      case 't-move-go': stepToSub(+v, +document.getElementById('t-move-to').value); break;
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
      case 'pet': { // кот и попугай включаются по отдельности, оба сразу — 'both'
        const on = v ? (petsOf(S.edit).includes(v) ? petsOf(S.edit).filter(p => p !== v) : petsOf(S.edit).concat(v)) : [];
        S.edit.pet = on.length === 2 ? 'both' : on[0] || null;
        syncEdit();
        break;
      }
      case 'pet-name': await renamePet(v); break;
      case 'pet-toggle': await petToggle(el); break;
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
      case 'sort-az': await sortAZ(id === 'none' ? null : id); toast('Расставлено по алфавиту'); break;
      case 'size': S.edit.size = v || null; syncEdit(); break;
      case 'slot': S.edit.slot = v || null; syncEdit(); break;
      case 'sec-size': await setSecSize(id, v); break;
      case 'of-today': case 'of-lunch': case 'of-tomorrow': case 'of-later': offerAct(id, act); break;
      case 'of-close': await closeOffer(); break;
      case 'of-hide': case 'of-hide-bg': offerHide(true); break;
      case 'of-show': offerHide(false); break;
      case 'slots-save': await saveSlots(); break;
      case 'new-section': openSection(null); break;
      case 'edit-section': openSection(S.sections.find(s => s.id === id)); break;
      case 's-color': $modal.querySelectorAll('[data-act=s-color]').forEach(b => b.classList.toggle('on', b === el)); break;
      case 's-save': await saveSection(id); break;
      case 's-delete': await deleteSection(id); break;
      case 's-pause': await togglePause(id); break;
      case 'import': closeModal(); document.getElementById('import-file').click(); break;
      case 'r-yes': rvMark(el, id, 'yes'); break;
      case 'r-no': rvMark(el, id, 'no'); break;
      case 'r-sy': rvSubMark(el, id, +v, 'yes'); break;
      case 'r-sn': rvSubMark(el, id, +v, 'no'); break;
      case 'r-save': el.disabled = true; el.textContent = 'Сохраняю…'; await rvSave(); break;
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
  if (ev.key === 'Enter' && (ev.target.id === 'pay-w' || ev.target.id === 'pay-a')) savePay();
  if (ev.key === 'Enter' && ev.target.id === 's-name') saveSection($modal.querySelector('[data-act=s-save]').dataset.id);
  if (ev.key === 'Escape') hideCtx();
  if (ev.key === 'Escape' && S.howto) return closeHowto();
  if (ev.key === 'Escape' && $modal.dataset.kind === 'offer') offerHide(true);
  else if (ev.key === 'Escape' && $modal.dataset.kind && $modal.dataset.kind !== 'review') closeModal();
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
