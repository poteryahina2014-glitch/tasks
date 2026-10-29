-- Обновление 10: картинки у задач — пыль и паутина (уборка), счётчики (передать показания).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks add column if not exists decor text check (decor in ('dust', 'meter'));
