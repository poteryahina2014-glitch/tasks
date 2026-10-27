-- Обновление 5: уведомления на телефон.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.
-- Перед этим должна быть создана функция notify (Edge Functions), см. инструкцию.

-- Во сколько напомнить о задаче (в день срока) и когда уже напомнили.
alter table tasks add column if not exists remind_at time;
alter table tasks add column if not exists reminded_on date;

-- Подписки устройств на уведомления (одно устройство — одна строка).
create table if not exists push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Настройки: часовой пояс и вечернее напоминание о несделанном.
create table if not exists prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  tz text not null default 'Europe/Kyiv',
  daily_on boolean not null default true,
  daily_time time not null default '20:00',
  last_daily date
);

alter table push_subs enable row level security;
alter table prefs enable row level security;
drop policy if exists own on push_subs;
drop policy if exists own on prefs;
create policy own on push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on push_subs, prefs to authenticated;

-- Каждые 5 минут база вызывает функцию notify, а та решает, кому что отправить.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule('notify') where exists (select 1 from cron.job where jobname = 'notify');
select cron.schedule('notify', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://iagqsddhahpzwojxcagq.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
