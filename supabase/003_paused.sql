-- Обновление 3: раздел можно временно выключить (задачи скрыты, но не удалены).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table sections add column if not exists paused boolean not null default false;
