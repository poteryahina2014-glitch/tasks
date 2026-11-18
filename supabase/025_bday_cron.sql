-- Дни рождения: задачи создаёт сама база по расписанию (18.11.2026), приложение открывать не нужно.
-- «Поздравить: …» — в сам день рождения, без уведомления (её решение: уведомления она смахивает), тихая: не в списках, а тортом на подоконнике (decor 'cake');
-- «Подарок: …»   — за gift_days дней до него (напоминание 10:00).
-- Каждая создаётся один раз на год (таблица bday_done): удалишь — снова не появится.
-- Запустить один раз в Supabase → SQL Editor. Можно запускать повторно.

alter table tasks drop constraint if exists tasks_decor_check;
alter table tasks add constraint tasks_decor_check check (decor in ('dust', 'meter', 'books', 'cake'));

create table if not exists bday_done (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  bday_id uuid not null references tasks(id) on delete cascade,
  year int not null,
  kind text not null check (kind in ('hi', 'gift')),
  primary key (bday_id, year, kind)
);
alter table bday_done enable row level security;
drop policy if exists bday_done_own on bday_done;
create policy bday_done_own on bday_done for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ближайший день рождения (сегодня или позже); 29 февраля в невисокосный год — 28-е
create or replace function bday_next(b date, today date) returns date language sql immutable as $$
  with y as (select g as yr from generate_series(extract(year from today)::int, extract(year from today)::int + 1) g),
  d as (select make_date(yr, extract(month from b)::int,
      least(extract(day from b)::int, extract(day from (make_date(yr, extract(month from b)::int, 1) + interval '1 month - 1 day'))::int)) as dt from y)
  select min(dt) from d where dt >= today
$$;

create or replace function bday_gen() returns void language plpgsql security definer set search_path = public as $$
declare r record; loc date; d date; y int; n int;
begin
  for r in select t.*, coalesce(p.tz, 'Europe/Kyiv') as tzz from tasks t left join prefs p on p.user_id = t.user_id
           where t.bday and t.due_date is not null loop
    loc := (now() at time zone r.tzz)::date;
    d := bday_next(r.due_date, loc);
    y := extract(year from d)::int;
    -- поздравить — в сам день
    if d = loc then
      insert into bday_done (user_id, bday_id, year, kind) values (r.user_id, r.id, y, 'hi') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into tasks (user_id, title, kind, due_date, remind_at, size, decor, section_id, space, bday_of, bday_year, bday_kind)
        values (r.user_id, 'Поздравить: ' || r.title, 'task', loc, null, 'quick', 'cake', r.section_id, r.space, r.id, y, 'hi')
        on conflict do nothing;
      end if;
    end if;
    -- подарок — за gift_days дней (если день рождения добавили позже — сразу)
    if r.gift_days is not null and loc >= d - r.gift_days then
      insert into bday_done (user_id, bday_id, year, kind) values (r.user_id, r.id, y, 'gift') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into tasks (user_id, title, kind, due_date, remind_at, size, section_id, space, bday_of, bday_year, bday_kind)
        values (r.user_id, 'Подарок: ' || r.title, 'task', loc, '10:00', 'mid', r.section_id, r.space, r.id, y, 'gift')
        on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

-- раньше приложение создавало эти задачи за 2 месяца — убрать ещё не наступившие (создадутся в свой день)
delete from tasks where bday_of is not null and done_on is null and due_date > current_date;

-- каждые 30 минут (дёшево: смотрит только дни рождения)
select cron.unschedule('bday_gen') where exists (select 1 from cron.job where jobname = 'bday_gen');
select cron.schedule('bday_gen', '*/30 * * * *', 'select bday_gen()');
select bday_gen();
