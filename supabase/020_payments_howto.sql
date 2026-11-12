-- 1) Платежи 💳: «дата, сумма, за что» — чтобы потом разнести в Excel-таблицу расходов.
--    done_on — когда отметила «внесла» (запись уходит в архив). Пусто — ещё не внесено.
create table if not exists payments (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  paid_on date not null default current_date,
  amount numeric(12, 2),
  what text not null default '',
  done_on date,
  created_at timestamptz not null default now()
);
create index if not exists payments_user on payments (user_id, done_on, paid_on);

alter table payments enable row level security;
drop policy if exists own on payments;
create policy own on payments for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on payments to authenticated;

-- 2) Памятка рабочего шаблона (общий текст «как делать»). Инструкции к шагам лежат в steps[].howto — колонка не нужна.
alter table templates add column if not exists memo text;
