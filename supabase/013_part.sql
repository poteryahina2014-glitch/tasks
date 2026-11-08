-- Частично выполненная привычка: доля сделанных подпунктов (0..1) у отметки «missed».
-- Пусто — полный пропуск. Пишет приложение после утренней проверки.
alter table task_log add column if not exists part numeric
  check (part is null or (part >= 0 and part <= 1));
