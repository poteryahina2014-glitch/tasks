-- 026: «Поздравить» в день рождения — без уведомления в 9:00 (её решение 18.11.2026: уведомления она не смотрит,
-- напоминает торт на полке). Запустить один раз в Supabase → SQL Editor. Можно запускать повторно.
create or replace function bday_gen() returns void language plpgsql security definer set search_path = public as $$
declare r record; loc date; d date; y int; n int;
begin
  for r in select t.*, coalesce(p.tz, 'Europe/Kyiv') as tzz from tasks t left join prefs p on p.user_id = t.user_id
           where t.bday and t.due_date is not null loop
    loc := (now() at time zone r.tzz)::date;
    d := bday_next(r.due_date, loc);
    y := extract(year from d)::int;
    -- поздравить — в сам день
    if d = loc then
      insert into bday_done (user_id, bday_id, year, kind) values (r.user_id, r.id, y, 'hi') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into tasks (user_id, title, kind, due_date, remind_at, size, decor, section_id, space, bday_of, bday_year, bday_kind)
        values (r.user_id, 'Поздравить: ' || r.title, 'task', loc, null, 'quick', 'cake', r.section_id, r.space, r.id, y, 'hi')
        on conflict do nothing;
      end if;
    end if;
    -- подарок — за gift_days дней (если день рождения добавили позже — сразу)
    if r.gift_days is not null and loc >= d - r.gift_days then
      insert into bday_done (user_id, bday_id, year, kind) values (r.user_id, r.id, y, 'gift') on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        insert into tasks (user_id, title, kind, due_date, remind_at, size, section_id, space, bday_of, bday_year, bday_kind)
        values (r.user_id, 'Подарок: ' || r.title, 'task', loc, '10:00', 'mid', r.section_id, r.space, r.id, y, 'gift')
        on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

-- у уже созданных — тоже убрать
update tasks set remind_at = null where bday_kind = 'hi' and done_on is null;
