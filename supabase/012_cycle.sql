-- Повтор по циклу: N дней делать, M дней пропускать (например, 2 через 1 — выходные при графике «сутки через двое»).
-- repeat_unit = 'cycle', repeat_every = дней делать, repeat_off = дней пропускать, repeat_anchor = первый день цикла.
alter table tasks add column if not exists repeat_off int check (repeat_off > 0);
alter table tasks add column if not exists repeat_anchor date;
alter table tasks drop constraint if exists tasks_repeat_unit_check;
alter table tasks add constraint tasks_repeat_unit_check check (repeat_unit in ('day', 'week', 'month', 'year', 'cycle'));

-- Следующий день цикла после p_from.
create or replace function next_cycle(p_from date, p_on int, p_off int, p_anchor date)
returns date language plpgsql immutable as $$
declare
  n int := coalesce(p_on, 1);
  len int := n + coalesce(p_off, 1);
  a date := coalesce(p_anchor, p_from);
  d date := p_from + 1;
begin
  for i in 1..len loop
    if (((d - a) % len) + len) % len < n then return d; end if;
    d := d + 1;
  end loop;
  return d;
end $$;

-- Следующий срок задачи после p_from, с любым видом повтора.
create or replace function next_of(t tasks, p_from date)
returns date language sql immutable as $$
  select case when t.repeat_unit = 'cycle'
    then next_cycle(p_from, t.repeat_every, t.repeat_off, t.repeat_anchor)
    else next_due(p_from, t.repeat_every, t.repeat_unit, t.repeat_weekdays) end
$$;

create or replace function complete_task(p_task uuid, p_done_on date)
returns void language plpgsql as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;

  insert into task_log (task_id, day, status, done_on, prev_due)
  values (t.id, coalesce(t.due_date, p_done_on), 'done', p_done_on, t.due_date);

  if t.repeat_unit is null then
    update tasks set done_on = p_done_on where id = t.id;
  else
    update tasks set due_date = next_of(t,
      case when t.repeat_from = 'done' then p_done_on else coalesce(t.due_date, p_done_on) end)
    where id = t.id;
  end if;
end $$;

create or replace function miss_task(p_task uuid, p_today date)
returns void language plpgsql as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;

  if t.kind = 'habit' and t.repeat_unit is not null then
    insert into task_log (task_id, day, status, prev_due)
    values (t.id, t.due_date, 'missed', t.due_date);
    update tasks set due_date = next_of(t, t.due_date) where id = t.id;
  else
    insert into task_log (task_id, day, status, prev_due)
    values (t.id, coalesce(t.due_date, p_today), 'moved', t.due_date);
    update tasks set due_date = p_today where id = t.id;
  end if;
end $$;

grant execute on function next_cycle(date, int, int, date) to authenticated;
grant execute on function next_of(tasks, date) to authenticated;
