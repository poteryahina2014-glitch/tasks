// readmeta — по ссылке на статью достаёт название, сайт и дату публикации (для «Чтения» в Задачах).
// Ставится так же, как notify: Dashboard → Edge Functions → Deploy a new function → Via Editor, имя `readmeta`,
// вставить этот файл → Deploy. Проверку JWT (Verify JWT) НЕ выключать: функцию может вызвать только вошедший пользователь.
// Браузер сам скачать чужую страницу не может (защита сайтов), поэтому это делает функция.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- разбор страницы (тот же код проверялся в Node) ----
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };
function unent(s: string) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();
}
function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (val && val.trim()) return unent(val);
  }
  return '';
}
function toDay(s: string) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function parse(html: string, url: string) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  let title = meta(html, ['og:title', 'twitter:title']) || unent((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const site = meta(html, ['og:site_name', 'application-name']) || host;
  // «Название / Хабр», «Название | Сайт» — хвост с именем сайта убираем
  if (site) title = title.replace(new RegExp('\\s*[/|—–-]\\s*' + site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '');
  const published = toDay(meta(html, ['article:published_time', 'og:published_time', 'datepublished', 'date', 'pubdate', 'publish-date', 'dc.date', 'aiturec:datetime', 'parsely-pub-date', 'sailthru.date']))
    || toDay((html.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || '')
    || toDay((html.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
  return { title: title.slice(0, 300), site: site.slice(0, 100), published };
}
// ---- конец разбора ----

async function readPage(url: string) {
  const r = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml', 'accept-language': 'ru,en;q=0.8',
    },
  });
  if (!r.ok || !r.body) throw new Error('Сайт ответил ' + r.status);
  // берём только начало страницы (заголовки там) — до 800 КБ
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < 800_000) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); size += value.length;
  }
  reader.cancel().catch(() => { });
  const buf = new Uint8Array(size);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  let cs = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
  let text = new TextDecoder(cs || 'utf-8').decode(buf);
  if (!cs) { // кодировка указана в самой странице (старые сайты — windows-1251)
    const m = text.slice(0, 3000).match(/<meta[^>]+charset=["']?([\w-]+)/i);
    if (m && !/utf-?8/i.test(m[1])) { try { text = new TextDecoder(m[1]).decode(buf); } catch { /* оставляем utf-8 */ } }
  }
  return { html: text, url: r.url || url };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { url } = await req.json();
    if (!/^https?:\/\//i.test(url || '')) return json({ error: 'Это не ссылка' });
    const host = new URL(url).hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(host) || !host.includes('.')) return json({ error: 'Такой адрес нельзя' });
    const page = await readPage(url);
    return json(parse(page.html, page.url));
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
