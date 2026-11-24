-- Обновление 31: лимит Claude для плашки на «Сегодня».
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

-- одна строка на человека; пишет хук на ПК (секретный ключ), приложение только читает свою
create table if not exists claude_limit (
  user_id uuid primary key references auth.users on delete cascade,
  week int not null check (week between 0 and 1000),
  week_reset timestamptz,
  five int,
  five_reset timestamptz,
  at timestamptz not null default now()
);
alter table claude_limit enable row level security;
drop policy if exists own on claude_limit;
create policy own on claude_limit for select to authenticated using (user_id = auth.uid());
revoke all on claude_limit from public, anon, authenticated;
grant select on claude_limit to authenticated;
grant select, insert, update on claude_limit to service_role; -- имя роли, не ключ; проверка: можно
