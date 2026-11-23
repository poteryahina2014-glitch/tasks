-- Обновление 29: памятки (план «Памятки и По мере», этап 3).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно (после — снова 030_memo_items.sql: там новее правило доступа и memo_done).

-- памятка: врач, фильтр, поверка… Срока и просрочки нет: есть месяц (или день, если частота в неделях), когда пора.
--   every + unit — раз в сколько месяцев/недель; пусто — частота не решена;
--   plan         — когда пора: у месяцев 1-е число, у недель день; пусто — «когда?»;
--   booked_task  — событие в календаре, если уже записалась.
create table if not exists memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  grp text not null default 'health' check (grp in ('health', 'home', 'cat', 'spoiled', 'stock')),
  every int check (every > 0),
  unit text not null default 'month' check (unit in ('month', 'week')),
  plan date,
  prep text,
  note text,
  booked_task uuid references tasks on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists memos_user on memos (user_id);
create index if not exists memos_booked on memos (booked_task);

-- история: когда сделано и что сказали
create table if not exists memo_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  memo_id uuid not null references memos on delete cascade,
  done_on date not null,
  said text,
  created_at timestamptz not null default now()
);
create index if not exists memo_log_memo on memo_log (memo_id, done_on);

alter table memos enable row level security;
drop policy if exists own on memos;
create policy own on memos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (booked_task is null or exists (select 1 from tasks t where t.id = booked_task and t.user_id = auth.uid())));
alter table memo_log enable row level security;
drop policy if exists own on memo_log;
create policy own on memo_log for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from memos m where m.id = memo_id and m.user_id = auth.uid()));
grant select, insert, update, delete on memos, memo_log to authenticated;
revoke all on memos, memo_log from anon;

-- «Сделано»: строка истории и следующий раз — вместе или никак
create or replace function memo_done(p_id uuid, p_on date, p_said text, p_next date)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update memos set plan = p_next, booked_task = null where id = p_id;
  if not found then raise exception 'памятки нет'; end if;
  insert into memo_log (memo_id, done_on, said) values (p_id, p_on, nullif(trim(p_said), ''));
end $$;
revoke all on function memo_done(uuid, date, text, date) from public, anon;
grant execute on function memo_done(uuid, date, text, date) to authenticated;
