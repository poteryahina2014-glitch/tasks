-- Обновление 19: картинка «Книги» (тихая задача — стопка книг на подоконнике).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.
alter table tasks drop constraint if exists tasks_decor_check;
alter table tasks add constraint tasks_decor_check check (decor in ('dust', 'meter', 'books'));
