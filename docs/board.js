// «По мере», доска с листочками и книга рецептов (план «Памятки и По мере», этап 1, 23.11.2026).
// «По мере» — обычная задача без срока: увидела список — сделала тут же. Просрочки у неё нет.
// Использует из app.js: S, $modal, esc, active, sectionOf, render, call, sb, complete, toast, addDays, today, localGet/localSet.

// Раздел-книга рецептов — тот, у которого размер по умолчанию «рецепты» (в базе по-прежнему 'idea': бывшее вдохновение).
const RECIPE = 'idea';
const isRecipeSec = id => (S.sections.find(s => s.id === id) || {}).default_size === RECIPE;
const isRecipe = t => !isEvent(t) && t.kind !== 'habit' && t.kind !== 'occasion' && isRecipeSec(t.section_id);

// Задачи «По мере»: без срока, плана и начала; не привычки, не события, не рецепты; раздел не на паузе (active).
// Начатые (есть «начало») не берём: они и так видны в «Сегодня» → «В работе». Ждущие другую задачу — тоже.
const loose = () => (S.space !== 'personal' ? [] : active()
  .filter(t => !isEvent(t) && t.kind !== 'habit' && !t.due_date && !t.plan_date && !t.start_date && !t.repeat_unit
    && t.decor !== 'meter' && !isRecipe(t) && !waitsFor(t).length)
  .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')));
const recipes = () => (S.space !== 'personal' ? [] : active()
  .filter(t => isRecipe(t) && !t.due_date && !t.plan_date).sort((a, b) => a.title.localeCompare(b.title, 'ru')));

// Залежалась: лежит дольше месяца. «Ещё месяц» пишет offer_after (до этого дня не подсвечивать) — поле прежних предложений.
const STALE_DAYS = 30;
const looseStale = t => (t.created_at || '').slice(0, 10) <= addDays(today(), -STALE_DAYS) && !(t.offer_after && t.offer_after > today());

// ---------- доска на стене ----------
// Листочков столько, сколько задач (до 20, дальше последний — стопкой). Первыми — памятки, которым пора (голубые на скрепке), за ними залежавшиеся (оранжевые).
const BOARD_MAX = 20;
const boardSig = () => [memoNow().map(m => [m.id, m.title]), loose().map(t => [t.id, looseStale(t), t.title])];
function boardSVG() {
  const all = loose();
  const memo = new Set(memoNow());
  const notes = [...memo, ...all.filter(looseStale), ...all.filter(t => !looseStale(t))];
  const over = notes.length > BOARD_MAX;
  const turn = [-5, 6, 4, -4, 0, -2, 4, -3, 5, 2];
  const note = (t, i) => {
    const x = 18 + i % 5 * 20, y = 33 + Math.floor(i / 5) * 22, pile = over && i === BOARD_MAX - 1;
    const isMemo = memo.has(t), c = isMemo ? '#9ec7f2' : looseStale(t) ? '#EF9F27' : '#FAEEDA';
    return `<g${isMemo ? ' data-act="board-memo"' : ''} transform="rotate(${turn[i % turn.length]} ${x + 8} ${y + 8})">
      ${pile ? `<rect x="${x + 4}" y="${y + 4}" width="16" height="17" fill="#c9b48f"/><rect x="${x + 2}" y="${y + 2}" width="16" height="17" fill="#e2d0ab"/>` : ''}
      <rect x="${x}" y="${y}" width="16" height="17" fill="${c}"/>${isMemo ? `<path d="M${x + 6} ${y + 5}v-6a2 2 0 0 1 4 0v5" fill="none" stroke="#4a5570" stroke-width="1.4"/>` : ''}<title>${pile ? `ещё ${notes.length - BOARD_MAX + 1}` : esc(t.title)}</title></g>`;
  };
  return `<svg viewBox="8 22 116 160" aria-hidden="true">
    <rect x="8" y="22" width="116" height="160" rx="4" fill="#7a5a3c"/><rect x="14" y="28" width="104" height="148" fill="#b98d5e"/>
    ${notes.slice(0, BOARD_MAX).map(note).join('')}</svg>`;
}
const boardLabel = () => `По мере: ${loose().length}${memoNow().length ? `, памятки — пора: ${memoNow().length}` : ''}`;
const boardHTML = () => (S.space === 'personal' ? `<div class="board" data-act="board" role="button" aria-label="${boardLabel()}">${boardSVG()}</div>` : '');
// Вход без доски (телефон, узкое окно, вид за окном выключен): значок в заголовке; когда стена есть, его прячет CSS.
// Число на значке — сколько памяток пора.
const looseIcon = () => (S.space === 'personal' ? `<button class="icon loose-ico" data-act="board" aria-label="${boardLabel()}">📌${memoNow().length ? `<i class="ico-n">${memoNow().length}</i>` : ''}</button>` : '');

// Лежанка под доской и книга рецептов на полке — простой плоский стиль (Эскиз комнаты 23.11.svg)
const bedSVG = () => `<svg viewBox="0 0 112 34" aria-hidden="true"><ellipse cx="56" cy="18" rx="56" ry="16" fill="#5d4a6b"/><ellipse cx="56" cy="12" rx="46" ry="11" fill="#7d6690"/></svg>`;
const recipeSVG = () => `<svg viewBox="0 0 130 110" aria-hidden="true">
  <rect x="34" y="10" width="62" height="100" rx="4" fill="#993556"/><rect x="34" y="10" width="13" height="100" rx="4" fill="#6f2440"/>
  <rect x="92" y="15" width="4" height="90" fill="#FAEEDA"/><circle cx="70" cy="52" r="17" fill="#FAEEDA"/><circle cx="70" cy="52" r="11" fill="#e6d3b3"/>
  <rect x="56" y="82" width="28" height="4" rx="2" fill="#FAEEDA"/><rect x="61" y="90" width="18" height="4" rx="2" fill="#FAEEDA"/></svg>`;
const recipeHTML = () => (recipes().length ? `<div class="recipe" data-act="recipes" role="button" aria-label="Рецепты">${recipeSVG()}</div>` : '');

// ---------- окно доски («По мере» и «Памятки») и окно рецептов ----------
// S.board: 'loose' | 'memo' | 'recipes' — какое открыто. Открыли из него задачу — после неё вернуться сюда же (boardBack в closeModal).
function openBoard(tab = 'loose', back = false) {
  const tabs = tab !== 'recipes' && MEMO.on;
  if (tab === 'memo' && !tabs) tab = 'loose';
  S.board = tab;
  $modal.dataset.kind = 'board';
  $modal.innerHTML = `<div class="overlay" data-act="close-bg"><div class="sheet board-win">
    ${tabs ? `<div class="board-tabs"><button class="pill" data-act="board-tab" data-v="loose"></button><button class="pill" data-act="board-tab" data-v="memo"></button><button class="memo-plus" data-act="memo-new" aria-label="Новая памятка">+</button></div>` : '<h3></h3>'}<div class="board-list"></div>
    <div class="actions"><span></span><button class="btn" data-act="board-close">Закрыть</button></div></div></div>`;
  renderBoard();
  // высота — по самой высокой вкладке при открытии (без пустого места), дальше не меняется; вернулись из задачи — та же
  const sh = $modal.querySelector('.board-win');
  if (!back) {
    sh.style.height = 'auto';
    let h = 0;
    for (const x of tabs ? ['memo', 'loose'] : [tab]) { S.board = x; renderBoard(); h = Math.max(h, sh.scrollHeight); }
    S.board = tab;
    renderBoard();
    S.boardH = Math.max(260, Math.min(h + 2, innerHeight * .88));
  }
  sh.style.height = S.boardH + 'px';
}
function renderBoard() {
  if ($modal.dataset.kind !== 'board') return;
  const rec = S.board === 'recipes', list = rec ? recipes() : loose();
  const n = x => (x ? ` · ${x}` : ''), h3 = $modal.querySelector('h3');
  if (h3) h3.textContent = (rec ? 'Рецепты' : 'По мере') + n(list.length);
  $modal.querySelectorAll('.board-tabs .pill').forEach(b => {
    b.textContent = b.dataset.v === 'memo' ? 'Памятки' + n(memoNow().length) : 'По мере' + n(list.length);
    b.classList.toggle('on', b.dataset.v === S.board);
  });
  const plus = $modal.querySelector('.memo-plus');
  if (plus) plus.style.visibility = S.board === 'memo' ? '' : 'hidden';
  if (S.board === 'memo') { $modal.querySelector('.board-list').innerHTML = memoListHTML(); return; }
  $modal.querySelector('.board-list').innerHTML = list.map(t => {
    const sec = rec ? null : sectionOf(t), old = !rec && looseStale(t);
    return `<div class="task${sec ? ' tinted' : ''}${old ? ' stale' : ''}"${sec ? ` style="--sec:${esc(sec.color)}"` : ''}>
      <button class="check" data-act="board-done" data-id="${t.id}" aria-label="Сделано">✓</button>
      <div class="body" data-act="edit" data-id="${t.id}"><div class="title">${esc(t.title)}</div>${sec ? `<div class="meta"><span>${esc(sec.name)}</span></div>` : ''}</div>
      ${rec ? '' : `<button class="btn board-more" data-act="board-more" data-id="${t.id}"${old ? '' : ' style="visibility:hidden" tabindex="-1"'}>ещё месяц</button>`}</div>`;
  }).join('') || `<div class="empty small">${rec ? 'Рецептов нет' : 'Пусто'}</div>`;
}
function boardTab(v) {
  S.board = v;
  renderBoard();
  $modal.querySelector('.board-list').scrollTop = 0;
}
// Закрыли задачу, открытую из списка, — снова список. true — вернулись.
function boardBack(was) {
  if (!S.board) return false;
  if (was !== 'edit' && was !== 'memo') { S.board = null; return false; } // закрыли сам список (или из задачи ушли в другое окно)
  openBoard(S.board, true);
  return true;
}
async function boardDone(id) {
  const t = byId(id);
  if (t) await complete(t);
}
async function boardMore(id) {
  const t = byId(id), old = t.offer_after ?? null;
  if (!t) return;
  const show = v => { t.offer_after = v; render(); renderBoard(); };
  const set = async v => {
    const was = t.offer_after ?? null;
    show(v);
    try { await call(sb.from('tasks').update({ offer_after: v }).eq('id', id)); } catch (e) { show(was); throw e; } // не записалось — подсветка как была
  };
  await set(addDays(today(), STALE_DAYS));
  toast('Ещё месяц', () => set(old));
}

// У рецепта нет просрочки: взяла на день и не сделала — снова без срока, в книге.
async function recipeExpire() {
  const t0 = today();
  const gone = S.tasks.filter(t => !t.done_on && !t.repeat_unit && isRecipe(t) && t.due_date && t.due_date < t0);
  if (!gone.length) return;
  await call(sb.from('tasks').update({ due_date: null, plan_date: null, slot: null }).in('id', gone.map(t => t.id)));
  gone.forEach(t => { t.due_date = null; t.plan_date = null; t.slot = null; });
}
