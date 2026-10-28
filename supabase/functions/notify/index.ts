// Функция notify: каждые 5 минут её вызывает база (pg_cron, см. 005_push.sql).
// Шлёт на телефон:
//  — напоминания о задачах, у которых задано «Напомнить в …» и срок сегодня;
//  — вечером (по умолчанию в 20:00) — список того, что сегодня ещё не сделано.
// Отправляет каждое напоминание один раз и только в течение часа после назначенного времени,
// поэтому лишний вызов ничего не испортит.
// Секреты (Edge Functions → Secrets): VAPID_PUBLIC, VAPID_PRIVATE. SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase даёт сам.
import { createClient } from 'npm:@supabase/supabase-js@2.76.1';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails('https://poteryahina2014-glitch.github.io/tasks/', Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);

const WINDOW = 60; // минут после назначенного времени, в которые ещё можно прислать

// ---------- даты (строки 'YYYY-MM-DD', как в приложении) ----------
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const isodow = (s: string) => (parse(s).getUTCDay() + 6) % 7 + 1;
const weekStart = (s: string) => addDays(s, 1 - isodow(s));
const daysBetween = (a: string, b: string) => Math.round((+parse(b) - +parse(a)) / 864e5);
function addMonths(s: string, n: number) {
  const d = parse(s);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d.getUTCDate(), last));
  return iso(t);
}
// то же, что next_due в базе и nextDue в приложении
function nextDue(from: string, every: number, unit: string, weekdays: number[] | null) {
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

// Есть ли задача на день d. У событий срок не сдвигается — повторы считаем от первой даты.
function onDay(t: any, d: string) {
  if (!t.due_date) return false;
  if (t.due_date === d) return true;
  if (t.kind !== 'event' || !t.repeat_unit || t.due_date > d) return false;
  let x = t.due_date;
  for (let i = 0; i < 5000 && x < d; i++) x = nextDue(x, t.repeat_every, t.repeat_unit, t.repeat_weekdays);
  return x === d;
}

// Местные дата и время пользователя.
function localNow(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const due = (at: string, now: number) => now >= minutes(at) && now < minutes(at) + WINDOW;

async function send(subs: any[], msg: object) {
  for (const s of subs) {
    try {
      // urgency high — Android будит телефон сразу (с обычной срочностью копит до открытия приложения);
      // TTL час — если телефон был выключен, старые напоминания потом не сыплются пачкой
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg),
        { urgency: 'high', TTL: 3600 });
    } catch (e: any) {
      // устройство отписалось или приложение удалено — подписка больше не нужна
      if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subs').delete().eq('id', s.id);
      else console.error('push', e.statusCode, e.body || e.message);
    }
  }
}

// приложение зовёт функцию с другого адреса (кнопка «Прислать проверочное уведомление»)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey' };
const reply = (body: object) => new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const input = await req.json().catch(() => ({}));
  if (input.test) {
    // проверка: только на уже подписанное устройство
    const { data } = await db.from('push_subs').select('*').eq('endpoint', input.test);
    await send(data || [], { title: 'Проверка', body: 'Уведомления работают 🎉', tag: 'test' });
    return reply({ test: (data || []).length });
  }
  const { data: subs } = await db.from('push_subs').select('*');
  const users = [...new Set((subs || []).map(s => s.user_id))];
  let sent = 0;
  for (const uid of users) {
    const mySubs = subs!.filter(s => s.user_id === uid);
    const { data: pref } = await db.from('prefs').select('*').eq('user_id', uid).maybeSingle();
    const p = pref || { tz: 'Europe/Kyiv', daily_on: true, daily_time: '20:00:00', last_daily: null };
    const now = localNow(p.tz);
    const [{ data: tasks }, { data: secs }] = await Promise.all([
      db.from('tasks').select('*').eq('user_id', uid).is('done_on', null),
      db.from('sections').select('id,paused').eq('user_id', uid),
    ]);
    const paused = new Set((secs || []).filter(s => s.paused).map(s => s.id));
    const live = (tasks || []).filter(t => !paused.has(t.section_id));

    // напоминания о конкретных задачах
    for (const t of live) {
      if (!t.remind_at || t.reminded_on === now.day || !onDay(t, now.day) || !due(t.remind_at, now.min)) continue;
      await db.from('tasks').update({ reminded_on: now.day }).eq('id', t.id);
      const time = t.start_time ? ` в ${t.start_time.slice(0, 5)}` : '';
      await send(mySubs, { title: t.title, body: t.kind === 'event' ? `Сегодня${time}` : 'Напоминание', tag: 'task-' + t.id });
      sent++;
    }

    // вечером — что сегодня ещё не сделано
    if (p.daily_on && p.last_daily !== now.day && due(p.daily_time, now.min)) {
      await db.from('prefs').upsert({ user_id: uid, last_daily: now.day });
      const left = live.filter(t => t.kind !== 'event' && t.due_date && t.due_date <= now.day);
      if (left.length) {
        const names = left.slice(0, 6).map(t => '• ' + t.title).join('\n') + (left.length > 6 ? `\nи ещё ${left.length - 6}` : '');
        await send(mySubs, { title: `Не сделано сегодня: ${left.length}`, body: names, tag: 'daily' });
        sent++;
      }
    }
  }
  return reply({ users: users.length, sent });
});
