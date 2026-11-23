// Памятки (план «Памятки и По мере», этап 3, 23.11.2026): врачи, фильтры, поверки. Просрочки нет — есть месяц, когда пора.
// Таблицы memos и memo_log (029_memos.sql); пока их нет — S.memoOn = false, вкладки «Памятки» нет.
// Использует из app.js: S, $modal, esc, call, sb, once, toast, today, addDays, iso, parse, pad, cap, hhmm, byId, isEvent, MONTHS, UNDO_MS, render, load, closeModal.

const MEMO_GROUPS = [['health', 'Здоровье'], ['home', 'Дом'], ['cat', 'Кот'], ['spoiled', 'Испортилось'], ['stock', 'Запасы']];
const MEMO = { list: [], log: [], on: false, gone: new Set(), ed: null, was: '' };
// memo.js грузится раньше app.js, а once — оттуда: берём её при первом вызове
const memoOnce = fn => { let f; return (...a) => (f = f || once(fn))(...a); };

// ---------- даты ----------
const monthStart = s => s.slice(0, 8) + '01';
const memoMonths = (s, n) => { const d = parse(monthStart(s)); d.setMonth(d.getMonth() + n); return iso(d); }; // 1-е число через n месяцев
const dmy = s => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
// Когда в следующий раз, если сделано on: месяцы — 1-е число месяца, недели — день; частоты нет — «когда?»
const memoNext = (m, on) => (!m.every ? null : m.unit === 'week' ? addDays(on, 7 * m.every) : memoMonths(on, m.every));
// → «на месяц позже» (у недель — на неделю), не раньше следующего месяца/недели от сегодня
const memoShift = m => {
  const t0 = today(), from = m.plan && m.plan > t0 ? m.plan : t0;
  return m.unit === 'week' ? addDays(from, 7) : memoMonths(from, 1);
};
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);
function memoEvery(m) {
  const n = m.every;
  if (!n) return '';
  if (m.unit === 'week') return n === 1 ? 'раз в неделю' : `раз в ${n} ${plural(n, 'неделю', 'недели', 'недель')}`;
  if (n === 12) return 'раз в год';
  if (n % 12 === 0) return `раз в ${n / 12} ${plural(n / 12, 'год', 'года', 'лет')}`;
  return n === 1 ? 'раз в месяц' : `раз в ${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`;
}
function memoWhen(m) {
  if (!m.plan) return 'когда?';
  const y = m.plan.slice(0, 4) !== today().slice(0, 4);
  if (m.unit === 'week') return m.plan.slice(8) + '.' + m.plan.slice(5, 7) + (y ? '.' + m.plan.slice(0, 4) : '');
  const name = MONTHS[+m.plan.slice(5, 7) - 1];
  return y ? `${name.slice(0, 3)} ${m.plan.slice(0, 4)}` : name;
}

// ---------- состояние ----------
// booked — записалась (событие сегодня или впереди); now — пора (месяц наступил или запись прошла, а ✓ нет); rest — остальные.
const memos = () => (S.space === 'personal' && MEMO.on ? MEMO.list.filter(m => !MEMO.gone.has(m.id)) : []);
const memoEvent = m => (m.booked_task && byId(m.booked_task)) || null;
function memoState(m) {
  const e = memoEvent(m);
  if (e && e.due_date) return e.due_date >= today() ? 'booked' : 'now';
  return m.plan && m.plan <= today() ? 'now' : 'rest';
}
const memoSort = (a, b) => (a.plan || '9').localeCompare(b.plan || '9') || a.title.localeCompare(b.title, 'ru');
const memoNow = () => memos().filter(m => memoState(m) === 'now').sort(memoSort);
const memoById = id => MEMO.list.find(m => m.id === id);
const memoLogs = id => MEMO.log.filter(l => l.memo_id === id).sort((a, b) => b.done_on.localeCompare(a.done_on) || b.id - a.id);
// из load() app.js; null — таблиц ещё нет (или не ответила база: тогда остаётся то, что уже загружено)
function memoLoaded(list, log) {
  if ((!list || !log) && MEMO.on) return;
  MEMO.on = !!list && !!log;
  MEMO.list = list || [];
  MEMO.log = log || [];
}

// ---------- вкладка «Памятки» в окне доски ----------
function memoRow(m) {
  const st = memoState(m), e = memoEvent(m), last = memoLogs(m.id)[0];
  const when = e && st !== 'rest' ? `${e.due_date.slice(8)}.${e.due_date.slice(5, 7)}${e.start_time ? ', ' + hhmm(e.start_time) : ''}` : memoWhen(m);
  const meta = [last && dmy(last.done_on), memoEvery(m), m.prep && `<b>${esc(m.prep)}</b>`].filter(Boolean).join(' · ');
  return `<div class="task memo ${st}">
    <button class="check" data-act="memo-done" data-id="${m.id}" aria-label="Сделано">✓</button>
    <div class="body" data-act="memo-edit" data-id="${m.id}"><div class="title">${esc(m.title)}</div><div class="meta"><span class="memo-when2">${when}</span><span>${meta}</span></div></div>
    <span class="memo-when">${when}</span>
    <button class="memo-ic" data-act="memo-book" data-id="${m.id}" aria-label="${e ? 'Запись' : 'Записалась'}">📅</button>
    <button class="memo-ic" data-act="memo-shift" data-id="${m.id}" aria-label="${m.unit === 'week' ? 'На неделю позже' : 'На месяц позже'}"${m.plan && st !== 'booked' ? '' : ' style="visibility:hidden" tabindex="-1"'}>→</button></div>`;
}
function memoListHTML() {
  const all = memos(), by = st => all.filter(m => memoState(m) === st);
  const block = (name, list, cls = '') => (list.length ? `<div class="memo-g ${cls}">${name}</div>${list.map(memoRow).join('')}` : '');
  const evKey = m => { const e = memoEvent(m); return e.due_date + (e.start_time || ''); };
  return (block('Пора', memoNow(), 'now')
    + block('Записана', by('booked').sort((a, b) => evKey(a).localeCompare(evKey(b))))
    + MEMO_GROUPS.map(([g, name]) => block(name, by('rest').filter(m => m.grp === g).sort(memoSort))).join('')) || '<div class="empty small">Пусто</div>';
}

// ---------- запись в базу ----------
async function memoPatch(id, row) {
  const m = memoById(id), was = {};
  for (const k in row) was[k] = m[k] ?? null;
  await call(sb.from('memos').update(row).eq('id', id));
  Object.assign(m, row);
  return was;
}
async function memoShiftBy(id) {
  const m = memoById(id);
  if (!m) return;
  const was = await memoPatch(id, { plan: memoShift(m), booked_task: null }); // запись, что уже прошла, больше не держит
  render(); renderBoard();
  toast(`Теперь: ${memoWhen(m)}`, async () => { await memoPatch(id, was); render(); renderBoard(); });
}

// Закрыли окно памятки — обратно в список
const memoSheet = (cls, title, body, left, save) => {
  $modal.dataset.kind = 'memo';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet ${cls}"><h3>${esc(title)}</h3>${body}
    <div class="actions memo-actions">${left || '<span></span>'}<span class="grow"></span><button class="btn" data-act="memo-cancel">Отмена</button><button class="btn main" data-act="${save}">Сохранить</button></div></div></div>`;
  MEMO.was = memoFields();
};
const memoFields = () => JSON.stringify([...$modal.querySelectorAll('input, textarea, select')].map(x => x.value)) + (MEMO.ed ? MEMO.ed.grp + MEMO.ed.unit : '');
const memoChanged = () => $modal.dataset.kind === 'memo' && memoFields() !== MEMO.was;
const val = id => document.getElementById(id).value.trim();

// ---------- окно памятки ----------
const planInput = (unit, plan) => (unit === 'week'
  ? `<input class="inp" type="date" id="m-plan" value="${plan || ''}">`
  : `<input class="inp" type="month" id="m-plan" value="${plan ? plan.slice(0, 7) : ''}">`);
const planValue = () => { const v = val('m-plan'); return !v ? null : v.length === 7 ? v + '-01' : v; };
function openMemo(id) {
  const m = id ? memoById(id) : { title: '', grp: 'health', every: null, unit: 'month', plan: null };
  if (!m) return;
  MEMO.ed = { id: m.id || null, grp: m.grp, unit: m.unit, logs: id ? memoLogs(id).map(l => ({ ...l })) : [], del: [] };
  memoSheet('edit memo-win', id ? 'Памятка' : 'Новая памятка', `<div class="memo-cols"><div>
      <div class="field"><label>Название</label><input class="inp" id="m-title" value="${esc(m.title)}"></div>
      <div class="field"><label>Группа</label><div class="seg memo-grp">${MEMO_GROUPS.map(([g, n]) => `<button class="pill${g === m.grp ? ' on' : ''}" data-act="memo-grp" data-v="${g}">${n}</button>`).join('')}</div></div>
      <div class="memo-two"><div class="field"><label>Раз в</label><div class="row"><input class="inp" type="number" min="1" max="600" id="m-every" value="${m.every || ''}"><select class="inp" id="m-unit"><option value="month"${m.unit === 'month' ? ' selected' : ''}>мес.</option><option value="week"${m.unit === 'week' ? ' selected' : ''}>нед.</option></select></div></div>
      <div class="field"><label>Когда</label><div id="m-plan-box">${planInput(m.unit, m.plan)}</div></div></div>
      <div class="field"><label>Перед этим / что взять</label><input class="inp" id="m-prep" value="${esc(m.prep || '')}"></div>
      <div class="field"><label>Заметка</label><textarea class="inp" id="m-note">${esc(m.note || '')}</textarea></div></div>
    <div class="memo-hist"><div class="field"><label>История</label></div><div id="m-logs"></div><button class="btn memo-add" data-act="memo-log-add">+</button></div></div>`,
    id ? `<button class="btn danger" data-act="memo-del" data-id="${id}" aria-label="Удалить">🗑</button>` : '', 'memo-save');
  renderMemoLogs();
  MEMO.was = memoFields();
  if (!id) document.getElementById('m-title').focus();
}
function syncMemoLogs() {
  $modal.querySelectorAll('.memo-log').forEach((r, i) => { const l = MEMO.ed.logs[i]; l.done_on = r.querySelector('input').value; l.said = r.querySelector('textarea').value; });
}
function renderMemoLogs() {
  document.getElementById('m-logs').innerHTML = MEMO.ed.logs.map((l, i) => `<div class="memo-log"><div class="row"><input class="inp" type="date" aria-label="Когда" value="${l.done_on || ''}"><button class="icon" data-act="memo-log-del" data-v="${i}" aria-label="Убрать строку">✕</button></div>
    <textarea class="inp" rows="2" aria-label="Что сказали">${esc(l.said || '')}</textarea></div>`).join('') || '<div class="empty small">Пусто</div>';
}
function memoLogAdd() { syncMemoLogs(); MEMO.ed.logs.unshift({ done_on: today(), said: '' }); renderMemoLogs(); }
function memoLogDel(i) {
  syncMemoLogs();
  const [l] = MEMO.ed.logs.splice(i, 1);
  if (l.id) MEMO.ed.del.push(l.id);
  renderMemoLogs();
}
function memoGrp(g) {
  MEMO.ed.grp = g;
  $modal.querySelectorAll('.memo-grp .pill').forEach(b => b.classList.toggle('on', b.dataset.v === g));
}
function memoUnit(unit) {
  const plan = planValue();
  MEMO.ed.unit = unit;
  document.getElementById('m-plan-box').innerHTML = planInput(unit, plan);
}
const saveMemo = memoOnce(async function saveMemo() {
  const ed = MEMO.ed, title = val('m-title');
  if (!title) return toast('Напиши название');
  syncMemoLogs();
  if (ed.logs.some(l => !l.done_on)) return toast('В истории есть строка без даты');
  const row = { title, grp: ed.grp, every: parseInt(val('m-every')) || null, unit: ed.unit, plan: planValue(), prep: val('m-prep') || null, note: val('m-note') || null };
  if (row.every < 0) row.every = null;
  if (ed.id) await call(sb.from('memos').update(row).eq('id', ed.id));
  else ed.id = (await call(sb.from('memos').insert(row).select()))[0].id; // не записалась история — повтор «Сохранить» не создаст вторую памятку
  if (ed.del.length) await call(sb.from('memo_log').delete().in('id', ed.del));
  ed.del = [];
  for (const l of ed.logs) {
    const x = { done_on: l.done_on, said: (l.said || '').trim() || null };
    if (!l.id) l.id = (await call(sb.from('memo_log').insert({ ...x, memo_id: ed.id }).select()))[0].id;
    else {
      const old = MEMO.log.find(o => o.id === l.id) || {};
      if (old.done_on !== x.done_on || (old.said || null) !== x.said) await call(sb.from('memo_log').update(x).eq('id', l.id));
    }
  }
  await load();
  closeModal();
});
function memoDel(id) {
  MEMO.gone.add(id);
  closeModal();
  render(); renderBoard();
  const timer = setTimeout(async () => {
    try { await call(sb.from('memos').delete().eq('id', id)); MEMO.list = MEMO.list.filter(m => m.id !== id); } finally { MEMO.gone.delete(id); render(); renderBoard(); }
  }, UNDO_MS);
  toast('Памятка удалена', async () => { clearTimeout(timer); MEMO.gone.delete(id); render(); renderBoard(); });
}

// ---------- ✓ сделано ----------
function openMemoDone(id) {
  const m = memoById(id);
  if (!m) return;
  const e = memoEvent(m), t0 = today(), on = e && e.due_date && e.due_date < t0 ? e.due_date : t0; // была запись и прошла — её дата
  MEMO.ed = { id, grp: '', unit: m.unit, touched: false };
  memoSheet('memo-small', m.title, `<div class="memo-two"><div class="field"><label>Когда</label><input class="inp" type="date" id="m-on" max="${t0}" value="${on}"></div>
    <div class="field"><label>Следующий раз</label>${planInput(m.unit, memoNext(m, on))}</div></div>
    <div class="field"><label>Что сказали</label><textarea class="inp" id="m-said"></textarea></div>`, '', 'memo-done-save');
}
// поменяла дату — следующий раз пересчитался, если его не правила сама
function memoOnChange() {
  const m = memoById(MEMO.ed.id), on = val('m-on');
  if (!on || MEMO.ed.touched) return;
  const next = memoNext(m, on);
  document.getElementById('m-plan').value = next ? (m.unit === 'week' ? next : next.slice(0, 7)) : '';
}
const saveMemoDone = memoOnce(async function saveMemoDone() {
  const on = val('m-on');
  if (!on) return toast('Укажи дату');
  if (on > today()) return toast('Дата ещё не наступила');
  await call(sb.rpc('memo_done', { p_id: MEMO.ed.id, p_on: on, p_said: val('m-said') || null, p_next: planValue() }));
  await load();
  closeModal();
});

// ---------- 📅 записалась: событие в календаре ----------
function openMemoBook(id) {
  const m = memoById(id);
  if (!m) return;
  const st = memoState(m), e = st === 'booked' ? memoEvent(m) : null; // прошедшая запись — новая запись с чистого листа
  MEMO.ed = { id, grp: '', unit: m.unit, ev: e ? e.id : null };
  memoSheet('memo-small', m.title, `<div class="memo-two"><div class="field"><label>Дата</label><input class="inp" type="date" id="m-bd" min="${today()}" value="${e ? e.due_date : ''}"></div>
    <div class="field"><label>Время</label><input class="inp" type="time" id="m-bt" value="${e ? hhmm(e.start_time) : ''}"></div></div>
    <div class="field"><label>Где, что взять</label><textarea class="inp" id="m-bn">${esc(e ? e.notes || '' : m.prep || '')}</textarea></div>`,
    e ? `<button class="btn danger" data-act="memo-unbook">Отменить запись</button>` : '', 'memo-book-save');
}
const saveMemoBook = memoOnce(async function saveMemoBook() {
  const ed = MEMO.ed, m = memoById(ed.id), d = val('m-bd');
  if (!d) return toast('Укажи дату');
  if (d < today()) return toast('Эта дата уже прошла');
  const row = { due_date: d, start_time: val('m-bt') || null, notes: val('m-bn') || null };
  if (ed.ev) await call(sb.from('tasks').update(row).eq('id', ed.ev));
  else {
    const [t] = await call(sb.from('tasks').insert({ ...row, title: m.title, kind: 'event' }).select());
    try { await memoPatch(m.id, { booked_task: t.id }); } catch (err) { await sb.from('tasks').delete().eq('id', t.id); throw err; } // не связалось — событие без памятки не оставлять
  }
  await load();
  closeModal();
});
const memoUnbook = memoOnce(async function memoUnbook() {
  const ed = MEMO.ed;
  if (!ed.ev || !confirm('Отменить запись? Событие уйдёт из календаря.')) return;
  await call(sb.from('tasks').delete().eq('id', ed.ev)); // booked_task база очистит сама
  memoById(ed.id).booked_task = null;
  await load();
  closeModal();
});

document.addEventListener('change', ev => {
  if ($modal.dataset.kind !== 'memo') return;
  if (ev.target.id === 'm-unit') memoUnit(ev.target.value);
  if (ev.target.id === 'm-on') memoOnChange();
  if (ev.target.id === 'm-plan') MEMO.ed.touched = true;
});
// Кнопки памяток (из общего обработчика щелчков app.js); true — обработано
async function memoAct(act, id, v) {
  switch (act) {
    case 'memo-edit': openMemo(id); break;
    case 'memo-new': openMemo(); break;
    case 'memo-done': openMemoDone(id); break;
    case 'memo-book': openMemoBook(id); break;
    case 'memo-shift': await memoShiftBy(id); break;
    case 'memo-save': await saveMemo(); break;
    case 'memo-done-save': await saveMemoDone(); break;
    case 'memo-book-save': await saveMemoBook(); break;
    case 'memo-unbook': await memoUnbook(); break;
    case 'memo-del': memoDel(id); break;
    case 'memo-grp': memoGrp(v); break;
    case 'memo-log-add': memoLogAdd(); break;
    case 'memo-log-del': memoLogDel(+v); break;
    case 'memo-cancel': closeModal(); break;
    default: return false;
  }
  return true;
}
