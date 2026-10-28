-- Обновление 9: питомцы — задача может относиться к коту или попугаю.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

alter table tasks add column if not exists pet text check (pet in ('cat', 'bird'));
