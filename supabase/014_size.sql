-- Размер задачи и предложения на день.
-- size: quick — пятиминутка, mid — средняя, big — на весь день (выходные), idea — по вдохновению (вечер).
-- slot: у средней задачи — когда она делается (lunch — обед, after — после работы).
-- offer_after: «Не сегодня» / «Потом» в окне предложений — до этого дня задачу не предлагать.
-- sections.default_size: размер всех задач раздела по умолчанию (если у задачи свой не выбран).
alter table tasks add column if not exists size text
  check (size is null or size in ('quick', 'mid', 'big', 'idea'));
alter table tasks add column if not exists slot text
  check (slot is null or slot in ('lunch', 'after'));
alter table tasks add column if not exists offer_after date;
alter table sections add column if not exists default_size text
  check (default_size is null or default_size in ('quick', 'mid', 'big', 'idea'));
