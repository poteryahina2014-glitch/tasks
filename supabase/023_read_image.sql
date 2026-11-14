-- «Чтение»: картинка статьи (для вида плиткой). null — ещё не искали, '' — у статьи картинки нет.
alter table reads add column if not exists image text;
