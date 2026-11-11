-- Фактически потраченное время на задачу: записи по дням («сегодня 1,5 ч», «завтра ещё 0,5 ч»).
-- Итог задачи — сумма записей. По ним считаются статистика (вкладка «Время», окно шаблона)
-- и оценка новых задач шаблона (среднее по факту прошлых периодов).
create table if not exists time_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null references tasks on delete cascade,
  day date not null,
  hours numeric(5, 2) not null check (hours > 0),
  created_at timestamptz not null default now()
);
create index if not exists time_log_task on time_log (task_id);
create index if not exists time_log_user_day on time_log (user_id, day);

alter table time_log enable row level security;
drop policy if exists own on time_log;
create policy own on time_log for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on time_log to authenticated;
