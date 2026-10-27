-- Обновление 2: время у задач и события (встречи, отпуск с … по …).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks add column if not exists start_time time;   -- с какого времени
alter table tasks add column if not exists end_time time;     -- до какого времени
alter table tasks add column if not exists end_date date;     -- последний день события на несколько дней

alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks add constraint tasks_kind_check check (kind in ('task', 'habit', 'event'));
