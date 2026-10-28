-- Обновление 6: подпункты задач и создание задач по шаблону заранее.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

-- Подпункты задачи (без своих сроков): [{"t": "Письмо …", "d": false}]
alter table tasks add column if not exists checklist jsonb;

-- За сколько рабочих дней до конца периода шаблон создаёт задачи (0 — на следующий день после конца).
-- Подзадачи шагов хранятся в самих шагах: steps[].subs = ["…", "…"].
alter table templates add column if not exists lead_days int not null default 0;
