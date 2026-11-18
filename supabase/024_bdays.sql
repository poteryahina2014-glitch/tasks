-- Дни рождения (18.11.2026).
-- bday      — это событие — день рождения (ежегодное);
-- gift_days — за сколько дней создать задачу «Подарок: …» (null — подарок не нужен);
-- bday_of / bday_year / bday_kind — у созданных задач: чей день рождения, какого года, 'hi' (поздравить) или 'gift'.
alter table tasks add column if not exists bday boolean not null default false;
alter table tasks add column if not exists gift_days int;
alter table tasks add column if not exists bday_of uuid references tasks(id) on delete cascade;
alter table tasks add column if not exists bday_year int;
alter table tasks add column if not exists bday_kind text check (bday_kind in ('hi', 'gift'));
-- одна задача каждого вида на год (у обычных задач эти поля пустые — им не мешает)
create unique index if not exists tasks_bday_once on tasks (bday_of, bday_year, bday_kind);
