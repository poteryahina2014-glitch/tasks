-- Таск-менеджер: таблицы и функции.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

-- Разделы
create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- Задачи. kind: 'task' — обычная, 'habit' — привычка.
-- Повторение: repeat_unit + repeat_every (каждые N дней/недель/месяцев/лет),
-- repeat_weekdays — дни недели 1=пн … 7=вс (только для 'week'),
-- repeat_from: 'due' — от срока, 'done' — от даты выполнения.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  section_id uuid references sections on delete set null,
  title text not null,
  notes text,
  kind text not null default 'task' check (kind in ('task', 'habit')),
  due_date date,
  repeat_every int check (repeat_every > 0),
  repeat_unit text check (repeat_unit in ('day', 'week', 'month', 'year')),
  repeat_weekdays int[] check (repeat_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]),
  repeat_from text not null default 'due' check (repeat_from in ('due', 'done')),
  done_on date,
  position int not null default 0,
  created_at timestamptz not null default now()
);
-- время, события ('event') и события на несколько дней — см. 002_events.sql

-- История отметок: сделала / пропустила (привычка) / перенесла (обычная).
-- По ней считается статистика привычек и работает «отменить».
create table if not exists task_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null references tasks on delete cascade,
  day date not null,                -- на какой день была задача
  status text not null check (status in ('done', 'missed', 'moved')),
  done_on date,                     -- когда на самом деле сделана
  prev_due date,                    -- срок до отметки
  created_at timestamptz not null default now()
);

create index if not exists tasks_user_due on tasks (user_id, due_date);
create index if not exists task_log_task_day on task_log (task_id, day);

-- Доступ: каждый видит только своё.
alter table sections enable row level security;
alter table tasks enable row level security;
alter table task_log enable row level security;

drop policy if exists own on sections;
drop policy if exists own on tasks;
drop policy if exists own on task_log;
create policy own on sections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on tasks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on task_log for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on sections, tasks, task_log to authenticated;

-- Следующий срок после p_from.
create or replace function next_due(p_from date, p_every int, p_unit text, p_weekdays int[])
returns date language plpgsql immutable as $$
declare
  d date := p_from + 1;
  every int := coalesce(p_every, 1);
begin
  if p_unit = 'week' and coalesce(array_length(p_weekdays, 1), 0) > 0 then
    -- ближайший подходящий день недели в «рабочую» неделю (каждая every-я, считая от p_from)
    for i in 1..400 loop
      if extract(isodow from d)::int = any(p_weekdays)
         and ((date_trunc('week', d)::date - date_trunc('week', p_from)::date) / 7) % every = 0 then
        return d;
      end if;
      d := d + 1;
    end loop;
  end if;
  return case p_unit
    when 'day' then p_from + every
    when 'week' then p_from + 7 * every
    when 'month' then (p_from + make_interval(months => every))::date
    when 'year' then (p_from + make_interval(years => every))::date
  end;
end $$;

-- Отметить выполненной (p_done_on — день, когда сделана).
-- Повторяющаяся задача получает новый срок: от старого срока или от p_done_on.
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
    update tasks set due_date = next_due(
      case when t.repeat_from = 'done' then p_done_on else coalesce(t.due_date, p_done_on) end,
      t.repeat_every, t.repeat_unit, t.repeat_weekdays)
    where id = t.id;
  end if;
end $$;

-- «Не сделала» в утренней проверке.
-- Привычка: пропуск, срок — следующий по расписанию. Обычная: переносится на p_today.
create or replace function miss_task(p_task uuid, p_today date)
returns void language plpgsql as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;

  if t.kind = 'habit' and t.repeat_unit is not null then
    insert into task_log (task_id, day, status, prev_due)
    values (t.id, t.due_date, 'missed', t.due_date);
    update tasks set due_date = next_due(t.due_date, t.repeat_every, t.repeat_unit, t.repeat_weekdays)
    where id = t.id;
  else
    insert into task_log (task_id, day, status, prev_due)
    values (t.id, coalesce(t.due_date, p_today), 'moved', t.due_date);
    update tasks set due_date = p_today where id = t.id;
  end if;
end $$;

-- Отменить последнюю отметку задачи.
create or replace function undo_last(p_task uuid)
returns void language plpgsql as $$
declare l task_log;
begin
  select * into l from task_log where task_id = p_task order by id desc limit 1;
  if not found then return; end if;
  update tasks set due_date = l.prev_due, done_on = null where id = p_task;
  delete from task_log where id = l.id;
end $$;

grant execute on function next_due(date, int, text, int[]) to authenticated;
grant execute on function complete_task(uuid, date) to authenticated;
grant execute on function miss_task(uuid, date) to authenticated;
grant execute on function undo_last(uuid) to authenticated;
