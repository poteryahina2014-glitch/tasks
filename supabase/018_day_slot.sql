-- Окошко задачи только на один день: перетащила задачу в другое окошко (или убрала из окошка) на «Сегодня».
-- Постоянное «Когда» (tasks.slot) не меняется. slot_now: 'lunch' / 'after' / 'eve' / 'none' (не ставить в окошко).
alter table tasks add column if not exists slot_day date;
alter table tasks add column if not exists slot_now text;
