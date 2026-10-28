-- Обновление 7: план (в какой день делаю — отдельно от дедлайна) и оценка времени.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

-- День, на который задача запланирована (due_date — дедлайн, его план не трогает).
alter table tasks add column if not exists plan_date date;

-- Сколько примерно часов займёт задача.
alter table tasks add column if not exists estimate numeric(5, 2);

-- У шага шаблона оценка хранится в самом шаге: steps[].hours.
