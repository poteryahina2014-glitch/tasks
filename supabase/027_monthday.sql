-- Ежемесячный (и ежегодный) повтор на 29–31 число не «сползает».
-- Было: 31 янв + 1 мес = 28 фев, дальше 28 мар, 28 апр… (считалось от прошлого срока).
-- Стало: у задачи хранится исходный день месяца repeat_monthday; следующий срок = этот день,
--   а если в месяце столько дней нет — последний день месяца (31 янв → 28 фев → 31 мар → 30 апр).
--   То же для 29 февраля у ежегодных: в невисокосный год — 28-е, в високосный — снова 29-е.
-- repeat_monthday ставит сама база (триггер), приложению писать его не нужно:
--   срок поменяли руками на другое число — день месяца берётся из нового срока;
--   срок сдвинули на «укороченный» конец месяца (28 фев при дне 31) — день месяца остаётся.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks add column if not exists repeat_monthday int check (repeat_monthday between 1 and 31);

-- день m в месяце даты d, но не дальше последнего дня этого месяца
create or replace function month_day(d date, m int)
returns date language sql immutable as $$
  select make_date(extract(year from d)::int, extract(month from d)::int,
    least(m, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int))
$$;

-- Следующий срок задачи после p_from, с любым видом повтора (было в 012_cycle.sql).
create or replace function next_of(t tasks, p_from date)
returns date language sql immutable as $$
  select case
    when t.repeat_unit = 'cycle'
      then next_cycle(p_from, t.repeat_every, t.repeat_off, t.repeat_anchor)
    when t.repeat_unit in ('month', 'year') and t.repeat_monthday is not null
      then month_day(next_due(p_from, t.repeat_every, t.repeat_unit, t.repeat_weekdays), t.repeat_monthday)
    else next_due(p_from, t.repeat_every, t.repeat_unit, t.repeat_weekdays) end
$$;

-- уже существующим задачам — день из нынешнего срока
-- (если какая-то уже сползла, например стоит на 28-е вместо 29-го, — поправить ей срок руками, день запомнится сам)
update tasks set repeat_monthday = extract(day from due_date)::int
where repeat_unit in ('month', 'year') and due_date is not null and repeat_monthday is null;

create or replace function task_monthday() returns trigger language plpgsql as $$
begin
  if new.repeat_unit in ('month', 'year') and new.due_date is not null then
    if new.repeat_monthday is null
       or new.due_date <> month_day(new.due_date, new.repeat_monthday) then
      new.repeat_monthday := extract(day from new.due_date)::int;
    end if;
  else
    new.repeat_monthday := null;
  end if;
  return new;
end $$;

drop trigger if exists task_monthday on tasks;
create trigger task_monthday before insert or update on tasks for each row execute function task_monthday();

grant execute on function month_day(date, int) to authenticated;
grant execute on function next_of(tasks, date) to authenticated;
