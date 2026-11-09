-- Спящие задачи «Следом» и «случаи» (пришла зарплата и т. п.).
-- wake_after: задача спит (без срока, нигде не видна), пока не отметят главную задачу (или случай).
--   Тогда приложение ставит ей срок на сегодня. Сделали её — она снова засыпает до следующего раза.
-- kind = 'occasion': случай — то, что нельзя запланировать заранее. Срока нет, живёт в меню ☀.
--   Отметили — в истории (task_log) остаётся день, а случай снова ждёт.
alter table tasks add column if not exists wake_after uuid references tasks(id) on delete cascade;
create index if not exists tasks_wake_after on tasks (wake_after);

alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks add constraint tasks_kind_check check (kind in ('task', 'habit', 'event', 'occasion'));

create or replace function complete_task(p_task uuid, p_done_on date)
returns void language plpgsql as $$
declare t tasks;
begin
  select * into t from tasks where id = p_task for update;
  if not found then raise exception 'task not found'; end if;

  insert into task_log (task_id, day, status, done_on, prev_due)
  values (t.id, coalesce(t.due_date, p_done_on), 'done', p_done_on, t.due_date);

  if t.kind = 'occasion' or t.wake_after is not null then
    -- случай и задача «Следом» не заканчиваются: засыпают до следующего раза
    update tasks set due_date = null, plan_date = null where id = t.id;
  elsif t.repeat_unit is null then
    update tasks set done_on = p_done_on where id = t.id;
  else
    update tasks set due_date = next_of(t,
      case when t.repeat_from = 'done' then p_done_on else coalesce(t.due_date, p_done_on) end)
    where id = t.id;
  end if;
end $$;

grant execute on function complete_task(uuid, date) to authenticated;
