// Лимит Claude на «Сегодня» (24.11.2026): сколько осталось от недельного и когда обнулится.
// Таблица claude_limit (031_claude_limit.sql), пишет хук на ПК (C:\Users\123\.claude\hooks\claude-limit.ps1); нет таблицы или строки — плашки нет.
// Потрачено ≥ 80% — красная плашка, 60–79% — жёлтая строка, меньше — серая строка.
const LIMIT = { row: null };
const LIMIT_WARN = 60, LIMIT_BAD = 80;
const LIMIT_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// База не ответила (null) — оставить прежнее, чтобы строка не мигала.
function limitLoaded(rows) {
  if (rows) LIMIT.row = rows[0] || null;
}

const limitWhen = s => {
  const d = new Date(s), p = n => String(n).padStart(2, '0');
  return `${LIMIT_DAYS[d.getDay()]} ${p(d.getDate())}.${p(d.getMonth() + 1)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Что показать сейчас. Срок обнуления прошёл, а нового замера ещё нет — неделя заново, следующий срок неизвестен.
function limitState(row, now = Date.now()) {
  if (!row || !Number.isFinite(row.week)) return null;
  const fresh = row.week_reset && Date.parse(row.week_reset) <= now;
  const used = fresh ? 0 : Math.min(100, Math.max(0, row.week));
  return { left: 100 - used, level: used >= LIMIT_BAD ? 'bad' : used >= LIMIT_WARN ? 'warn' : '', until: fresh || !row.week_reset ? '' : limitWhen(row.week_reset) };
}

function limitHTML() {
  const l = limitState(LIMIT.row);
  if (!l) return '';
  return `<div class="limit ${l.level}" title="Недельный лимит Claude, замер ${limitWhen(LIMIT.row.at)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg>
    <b>Осталось ${l.left}%</b>${l.until ? `<span>до ${l.until}</span>` : ''}</div>`;
}
