-- Обновление 11: задача может относиться сразу к обоим питомцам (pet = 'both').
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks drop constraint if exists tasks_pet_check;
alter table tasks add constraint tasks_pet_check check (pet in ('cat', 'bird', 'both'));
