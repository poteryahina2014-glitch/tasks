-- Обновление 30: сроки вещей из «Где что лежит» — памятками, а не задачами (план «Памятки и По мере», этап 4).
-- Вставить целиком в Supabase → SQL Editor → Run. Можно запускать повторно.
-- Нужны 029_memos.sql (памятки) и таблицы «Где что лежит» (001_gde.sql). Запустила 029 ещё раз — запустить и этот файл.

-- памятка вещи: день = дата у вещи (unit 'week' — чтобы был день, а не месяц); вещь удалили — памятка ушла
alter table memos add column if not exists item_id uuid references w_items on delete cascade;
create unique index if not exists memos_item on memos (item_id);

drop policy if exists own on memos;
create policy own on memos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and (booked_task is null or exists (select 1 from tasks t where t.id = booked_task and t.user_id = auth.uid()))
    and (item_id is null or exists (select 1 from w_items i where i.id = item_id and i.user_id = auth.uid())));

create or replace function w_memo_title(p_name text, p_place uuid) returns text
language sql stable set search_path = public as $$
  select 'Заменить: ' || p_name || coalesce(' — ' || w_place_path(p_place), '')
$$;
revoke all on function w_memo_title(text, uuid) from public, anon;
grant execute on function w_memo_title(text, uuid) to authenticated;

-- старый порядок: задача «Проверить срок: …»
drop trigger if exists w_item_task on w_items;
drop function if exists w_item_task();

create or replace function w_item_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists w_item_touch on w_items;
create trigger w_item_touch before update on w_items for each row execute function w_item_touch();

-- Дата у вещи → памятка. Поменялась дата — поменялся день; поменялось название или место — только название памятки
-- (день, отложенный в «Задачах», не возвращается). Дату убрали — памятка удалена.
create or replace function w_item_memo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.check_on is null then
    delete from memos where item_id = new.id;
  elsif tg_op = 'INSERT' or new.check_on is distinct from old.check_on then
    insert into memos (user_id, title, grp, unit, plan, item_id)
    values (new.user_id, w_memo_title(new.name, new.place_id), 'spoiled', 'week', new.check_on, new.id)
    on conflict (item_id) do update set title = excluded.title, plan = excluded.plan;
  elsif new.name is distinct from old.name or new.place_id is distinct from old.place_id then
    update memos set title = w_memo_title(new.name, new.place_id) where item_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists w_item_memo on w_items;
create trigger w_item_memo after insert or update on w_items for each row execute function w_item_memo();

-- Место переименовали или перенесли — путь в названиях памяток (и у вещей во вложенных местах)
create or replace function w_place_memo() returns trigger
language plpgsql set search_path = public as $$
begin
  update memos m set title = w_memo_title(i.name, i.place_id)
  from w_items i
  where m.item_id = i.id and i.place_id in (
    with recursive sub as (
      select new.id as id, 0 as lvl
      union all
      select p.id, sub.lvl + 1 from w_places p join sub on p.parent_id = sub.id where sub.lvl < 20
    ) select id from sub);
  return null;
end $$;
drop trigger if exists w_place_memo on w_places;
create trigger w_place_memo after update of name, parent_id on w_places
  for each row when (new.name is distinct from old.name or new.parent_id is distinct from old.parent_id)
  execute function w_place_memo();

-- Памятку удалили — у вещи снята дата, вещь остаётся
create or replace function memo_item_free() returns trigger
language plpgsql set search_path = public as $$
begin
  update w_items set check_on = null where id = old.item_id and check_on is not null;
  return null;
end $$;
drop trigger if exists memo_item_free on memos;
create trigger memo_item_free after delete on memos
  for each row when (old.item_id is not null) execute function memo_item_free();

-- «Сделано»: у памятки вещи новый срок пишется и в вещь; пусто — дата у вещи снята, памятка уходит
create or replace function memo_done(p_id uuid, p_on date, p_said text, p_next date)
returns void language plpgsql security invoker set search_path = public as $$
declare it uuid;
begin
  update memos set plan = p_next, booked_task = null where id = p_id returning item_id into it;
  if not found then raise exception 'памятки нет'; end if;
  insert into memo_log (memo_id, done_on, said) values (p_id, p_on, nullif(trim(p_said), ''));
  if it is not null then
    update w_items set check_on = p_next where id = it;
  end if;
end $$;
revoke all on function memo_done(uuid, date, text, date) from public, anon;
grant execute on function memo_done(uuid, date, text, date) to authenticated;

-- Перенос: вещи с датой → памятки; задача, отложенная на будущее, — на тот же день. Невыполненные задачи уходят.
insert into memos (user_id, title, grp, unit, plan, item_id)
select i.user_id, w_memo_title(i.name, i.place_id), 'spoiled', 'week',
  case when t.done_on is null and t.due_date > current_date and t.due_date > i.check_on then t.due_date else i.check_on end, i.id
from w_items i left join tasks t on t.id = i.task_id
where i.check_on is not null
on conflict (item_id) do nothing;
delete from tasks t using w_items i where i.task_id = t.id and t.user_id = i.user_id and t.done_on is null;
