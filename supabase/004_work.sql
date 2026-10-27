-- Обновление 4: режимы «Личное / Работа», дата «начать с», шаблоны и проекты.
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.

-- Режим: раздел и задача без раздела относятся к личному или рабочему.
alter table sections add column if not exists space text not null default 'personal'
  check (space in ('personal', 'work'));
alter table tasks add column if not exists space text not null default 'personal'
  check (space in ('personal', 'work'));

-- Когда начинать (срок due_date — это дедлайн).
alter table tasks add column if not exists start_date date;

-- Шаблоны: повторяющиеся наборы шагов (квартальная отчётность, оценка урожая …).
-- period: month / quarter / year; months — в какие месяцы (для month, пусто — все);
-- steps: [{title, start_day, due_day, month}] — числа месяца, month = какой по счёту месяц после конца периода.
-- last_period — за какой период задачи уже созданы ('2026-09', '2026-Q3', '2026').
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  period text not null check (period in ('month', 'quarter', 'year')),
  months int[],
  section_id uuid references sections on delete set null,
  steps jsonb not null default '[]',
  last_period text,
  created_at timestamptz not null default now()
);

-- Проекты: набор задач за конкретный период («Отчётность — III кв. 2026»).
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  template_id uuid references templates on delete set null,
  period text,
  title text not null,
  section_id uuid references sections on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_id, period)   -- два устройства не создадут один период дважды
);

alter table tasks add column if not exists project_id uuid references projects on delete cascade;

alter table templates enable row level security;
alter table projects enable row level security;
drop policy if exists own on templates;
drop policy if exists own on projects;
create policy own on templates for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on projects for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on templates, projects to authenticated;
