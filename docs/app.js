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
};

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
  $app.innerHTML = views[S.view]() + `
    <button class="fab" data-act="new" title="Новая задача">+</button>
    <nav class="bottom">
      ${[['today', 'Сегодня'], ['calendar', 'Календарь'], ['sections', 'Разделы']]
        .map(([k, n]) => `<button class="pill ${S.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${n}</button>`).join('')}
    </nav>`;
}

function taskRow(t, opts = {}) {
  const sec = sectionOf(t);
  const meta = [];
  if (opts.date && t.due_date) meta.push(`<span class="${t.due_date < today() ? 'late' : ''}">${dateLabel(t.due_date)}</span>`);
  if (sec && !opts.noSection) meta.push(`<span><i class="dot" style="background:${esc(sec.color)}"></i>${esc(sec.name)}</span>`);
  const rep = repeatLabel(t);
  if (rep) meta.push(`<span>↻ ${esc(rep)}</span>`);
  if (t.kind === 'habit') {
    const st = habitStats(t);
    if (st.total) meta.push(`<span class="stat">${st.done} из ${st.total} за 30 дн.</span>`);
  }
  if (opts.note) meta.unshift(`<span class="${opts.noteCls || ''}">${opts.note}</span>`);
  const cls = `task ${t.kind === 'habit' ? 'habit' : ''} ${opts.done ? 'done' : ''}`;
  // mark — значок без действия (прошлые отметки и будущие повторы в календаре)
  const check = opts.mark
    ? `<div class="check" style="${opts.markStyle || ''}">${opts.mark}</div>`
    : `<button class="check" data-act="${opts.done ? 'undo' : 'done'}" data-id="${t.id}" title="${opts.done ? 'Отменить' : 'Сделано'}">✓</button>`;
  return `<div class="${cls}">
    ${check}
    <div class="body" data-act="edit" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}

function renderToday() {
  const now = new Date();
  const t0 = today();
  const due = active().filter(t => t.due_date && t.due_date <= t0);
  const habits = due.filter(t => t.kind === 'habit');
  const tasks = due.filter(t => t.kind !== 'habit');
  const noDate = active().filter(t => !t.due_date);
  // сделано сегодня: последние отметки «done» сегодняшним числом
  const doneIds = [...new Set(S.logs.filter(l => l.status === 'done' && l.done_on === t0).map(l => l.task_id))];
  const doneToday = doneIds.map(id => S.tasks.find(t => t.id === id)).filter(Boolean);

  let html = `<header><h1>Сегодня</h1><div class="sub">${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS_OF[now.getMonth()]}</div></header>`;
  if (!due.length && !noDate.length && !doneToday.length) {
    html += '<div class="empty">Задач на сегодня нет.<br>Нажми «+», чтобы добавить.</div>';
  }
  if (habits.length) html += '<h2>Привычки</h2>' + habits.map(t => taskRow(t)).join('');
  if (tasks.length) html += '<h2>Задачи</h2>' + tasks.map(t => taskRow(t)).join('');
  if (noDate.length) html += '<h2>Без срока</h2>' + noDate.map(t => taskRow(t)).join('');
  if (doneToday.length) html += '<h2>Сделано сегодня</h2>' + doneToday.map(t => taskRow(t, { done: true })).join('');
  return html;
}

// Что стоит на день d: настоящие сроки + будущие повторы.
function occurrences(from, to) {
  const map = {};
  const add = (d, item) => (map[d] = map[d] || []).push(item);
  for (const t of active()) {
    if (!t.due_date) continue;
    let d = t.due_date;
    if (d >= from && d <= to) add(d, { t, kind: 'due' });
    if (!t.repeat_unit || d < today()) continue;
    for (let i = 0; i < 400; i++) {
      d = nextDue(d, t.repeat_every, t.repeat_unit, t.repeat_weekdays);
      if (!d || d > to) break;
      if (d >= from) add(d, { t, kind: 'repeat' });
    }
  }
  for (const l of S.logs) {
    if (l.day < from || l.day > to) continue;
    const t = S.tasks.find(x => x.id === l.task_id);
    if (t) add(l.day, { t, kind: l.status });
  }
  return map;
}

function renderCalendar() {
  const t0 = today();
  if (!S.month) S.month = t0.slice(0, 8) + '01';
  if (!S.day) S.day = t0;
  const m = parse(S.month);
  const start = weekStart(S.month);
  const end = addDays(weekStart(addDays(addMonths(S.month, 1), -1)), 6);
  const occ = occurrences(start, end);

  let cells = WD.map(w => `<div class="wd">${w}</div>`).join('');
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const items = (occ[d] || []).filter(o => o.kind !== 'moved');
    const dots = items.slice(0, 6).map(o =>
      `<i class="${o.kind === 'done' ? 'd' : o.t.kind === 'habit' ? 'h' : ''}"></i>`).join('');
    const cls = ['day', d.slice(0, 7) !== S.month.slice(0, 7) ? 'out' : '', d === t0 ? 'today' : '', d === S.day ? 'sel' : ''].join(' ');
    cells += `<button class="${cls}" data-act="day" data-d="${d}">${parse(d).getDate()}<span class="dots">${dots}</span></button>`;
  }

  const items = occ[S.day] || [];
  const seen = new Set();
  let list = '';
  for (const o of items) {
    if (o.kind === 'moved' || seen.has(o.t.id + o.kind)) continue;
    seen.add(o.t.id + o.kind);
    if (o.kind === 'done') list += taskRow(o.t, { done: true, mark: '✓' });
    else if (o.kind === 'missed') list += taskRow(o.t, { mark: '✕', markStyle: 'border-color:var(--bad);color:var(--bad)', note: 'пропущено', noteCls: 'late' });
    else if (o.kind === 'repeat') list += taskRow(o.t, { mark: '↻', markStyle: 'color:var(--muted)', note: 'повтор' });
    else list += taskRow(o.t);
  }
  const d = parse(S.day);
  return `<header><h1>Календарь</h1></header>
    <div class="cal-head">
      <button data-act="month" data-n="-1">‹</button>
      <b>${MONTHS[m.getMonth()][0].toUpperCase() + MONTHS[m.getMonth()].slice(1)} ${m.getFullYear()}</b>
      <button data-act="month" data-n="1">›</button>
    </div>
    <div class="cal">${cells}</div>
    <h2>${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_OF[d.getMonth()]}</h2>
    ${list || '<div class="empty">На этот день ничего нет</div>'}`;
}

function renderSections() {
  const sel = S.section;
  const list = active()
    .filter(t => sel === null || t.section_id === sel)
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : 0);
  const chips = [`<button class="pill ${sel === null ? 'on' : ''}" data-act="section" data-id="">Все</button>`]
    .concat(S.sections.map(s => `<button class="pill ${sel === s.id ? 'on' : ''}" data-act="section" data-id="${s.id}"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</button>`))
    .concat(['<button class="pill" data-act="new-section" title="Новый раздел">+</button>']);
  const cur = S.sections.find(s => s.id === sel);
  return `<header><h1>Разделы</h1></header>
    <div class="chips">${chips.join('')}</div>
    ${cur ? `<button class="link" data-act="edit-section" data-id="${cur.id}">✎ Изменить раздел «${esc(cur.name)}»</button>` : ''}
    ${list.map(t => taskRow(t, { date: true, noSection: sel !== null })).join('') || '<div class="empty">Здесь пока пусто</div>'}
    <div style="text-align:center;margin-top:28px"><button class="link" data-act="logout">Выйти из аккаунта</button></div>`;
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
  return active().filter(t => t.due_date && t.due_date < t0).sort((a, b) => a.due_date < b.due_date ? -1 : 1);
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
    <h3>${isNew ? 'Новая задача' : 'Задача'}</h3>
    <div class="field"><input class="inp" id="f-title" placeholder="Что сделать?" value="${esc(e.title || '')}"></div>
    <div class="field seg" id="f-kind">
      <button class="pill" data-act="kind" data-v="task">Обычная</button>
      <button class="pill" data-act="kind" data-v="habit">Привычка</button>
    </div>
    ${st ? `<div class="stats">За 30 дней: <b>${st.done} из ${st.total}</b>
      <div class="strip">${st.days.map(d => `<i class="${d}"></i>`).join('')}</div></div>` : ''}
    <div class="field"><label>Срок</label>
      <input class="inp" id="f-date" type="date" value="${e.due_date || ''}" style="margin-bottom:8px">
      <div class="row">
        <button class="pill" data-act="date" data-v="0">Сегодня</button>
        <button class="pill" data-act="date" data-v="1">Завтра</button>
        <button class="pill" data-act="date" data-v="">Без срока</button>
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
  document.getElementById('f-from-box').style.display = e.repeat_unit ? '' : 'none';
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
  };
  if (row.repeat_unit && !row.due_date) row.due_date = today();
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

// ---------- нажатия ----------
const byId = id => S.tasks.find(t => t.id === id);
const BUSY = new Set(['login', 'signup', 'done', 'undo', 'save', 'delete', 's-save', 's-delete', 'r-yes', 'r-no']);

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
      case 'logout': await sb.auth.signOut(); break;
      case 'view': S.view = v; localSet('view', v); render(); scrollTo(0, 0); break;
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
      case 'month': S.month = addMonths(S.month, +el.dataset.n); S.day = S.month; render(); if (S.month < addDays(today(), -62)) await load(); break;
      case 'section': S.section = id || null; render(); break;
      case 'new-section': openSection(null); break;
      case 'edit-section': openSection(S.sections.find(s => s.id === id)); break;
      case 's-color': $modal.querySelectorAll('[data-act=s-color]').forEach(b => b.classList.toggle('on', b === el)); break;
      case 's-save': await saveSection(id); break;
      case 's-delete': await deleteSection(id); break;
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
