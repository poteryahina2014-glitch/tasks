-- Окно: задачу можно сделать за N дней от срока, всё это время она не просрочена.
-- tasks.window_days — своё у задачи (0 — без окна, пусто — как у раздела); sections.default_window — у раздела.
alter table tasks add column if not exists window_days int check (window_days between 0 and 30);
alter table sections add column if not exists default_window int check (default_window between 0 and 30);
