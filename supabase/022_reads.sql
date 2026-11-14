-- Очередь чтения 📰: ссылки на статьи «прочитать потом». Приложение выдаёт одну статью в день.
--   queued_at — место в очереди (раньше = раньше выдаст; «Потом» ставит в конец);
--   shown_on  — день, когда статья стала «статьёй дня» (на этот день она закреплена);
--   done_on   — когда прочитала (уходит в «Прочитанные»).
create table if not exists reads (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  url text not null,
  title text not null default '',
  queued_at timestamptz not null default now(),
  shown_on date,
  done_on date,
  created_at timestamptz not null default now()
);
create index if not exists reads_user on reads (user_id, done_on, queued_at);

alter table reads enable row level security;
drop policy if exists own on reads;
create policy own on reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on reads to authenticated;
