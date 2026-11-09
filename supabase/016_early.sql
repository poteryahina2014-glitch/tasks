-- Обновление 16: напоминание заранее и конец повтора.
-- remind_days — за сколько дней до срока прислать пуш (в remind_at или в 10:00). early_on — когда уже прислали.
-- repeat_until — по какое число повторять: следующий срок после этой даты → задача закончена (done_on).
--   Нужно для курсов лекарств из «Питомцев».
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks add column if not exists remind_days int check (remind_days is null or remind_days between 1 and 60);
alter table tasks add column if not exists early_on date;
alter table tasks add column if not exists repeat_until date;

create or replace function task_until() returns trigger language plpgsql as $$
begin
  if new.repeat_unit is not null and new.repeat_until is not null and new.done_on is null
     and new.due_date is not null and new.due_date > new.repeat_until then
    -- последний раз уже был: задача закончена в день последнего срока
    new.done_on := least(coalesce(old.due_date, new.repeat_until), new.repeat_until);
    new.due_date := coalesce(old.due_date, new.repeat_until);
  end if;
  if new.due_date is distinct from old.due_date then new.early_on := null; end if;
  return new;
end $$;

drop trigger if exists task_until on tasks;
create trigger task_until before update on tasks for each row execute function task_until();
