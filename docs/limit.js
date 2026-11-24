// Лимит Claude в шапке «Сегодня» (24.11.2026): шкала потраченного за неделю, как в Органайзере (limit.py); подробности — подсказкой при наведении или по нажатию.
// Таблица claude_limit (031_claude_limit.sql), пишет хук на ПК (C:\Users\123\.claude\hooks\claude-limit.ps1); нет таблицы или строки — шкалы нет.
// Потрачено ≥ 80% — красная, 60–79% — жёлтая, меньше — спокойная.
const LIMIT = { row: null, open: false };
const LIMIT_WARN = 60, LIMIT_BAD = 80;
const LIMIT_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// База не ответила (null) — оставить прежнее, чтобы шкала не мигала.
function limitLoaded(rows) {
  if (rows) LIMIT.row = rows[0] || null;
}

const limitWhen = (s, now = Date.now()) => {
  const d = new Date(s), p = n => String(n).padStart(2, '0'), day = x => new Date(x).setHours(0, 0, 0, 0);
  const far = Math.round((day(d) - day(now)) / 864e5);
  return `${{ 0: 'сегодня', 1: 'завтра', '-1': 'вчера' }[far] || `${LIMIT_DAYS[d.getDay()]} ${p(d.getDate())}.${p(d.getMonth() + 1)}`} в ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Потрачено, %: срок обнуления прошёл, а нового замера ещё нет — снова 0; нет числа — null.
function limitUsed(row, key, now) {
  if (!row || !Number.isFinite(row[key])) return null;
  const reset = row[key + '_reset'];
  return reset && Date.parse(reset) <= now ? 0 : Math.round(Math.min(100, Math.max(0, row[key])));
}

// Что показать сейчас: потрачено за неделю, цвет, строки подсказки.
function limitState(row, now = Date.now()) {
  const used = limitUsed(row, 'week', now);
  if (used === null) return null;
  const tip = [];
  for (const [name, key] of [['Неделя', 'week'], ['5 часов', 'five']]) {
    const n = limitUsed(row, key, now), reset = row[key + '_reset'];
    if (n !== null) tip.push(`${name}: ${n}%` + (reset && Date.parse(reset) > now ? `, обнулится ${limitWhen(reset, now)}` : ''));
  }
  if (row.at) tip.push(`Замер: ${limitWhen(row.at, now)}`);
  return { used, level: used >= LIMIT_BAD ? 'bad' : used >= LIMIT_WARN ? 'warn' : '', tip };
}

function limitHTML() {
  const l = limitState(LIMIT.row);
  if (!l) return '';
  return `<button class="limit ${l.level} ${LIMIT.open ? 'open' : ''}" type="button">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>
    <span class="limit-bar"><i style="width:${l.used}%"></i></span><b>${l.used}%</b><span class="limit-tip">${l.tip.join('<br>')}</span></button>`;
}

// Подсказка по нажатию (на телефоне наведения нет); нажатие мимо или Esc — закрыть.
function limitTip(open) {
  LIMIT.open = open;
  const b = document.querySelector('.limit');
  if (b) b.classList.toggle('open', open);
}
document.addEventListener('click', e => {
  const on = e.target.closest && e.target.closest('.limit');
  if (on || LIMIT.open) limitTip(on ? !LIMIT.open : false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && LIMIT.open) limitTip(false); });
