-- 028: правки по Security Advisor (ревизия 22.11.2026). Запускать один раз.

-- 1. Всем нашим функциям в public — постоянный search_path (предупреждение function_search_path_mutable).
--    Функции расширений не трогаем.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

-- 2. bday_gen вызывает только расписание (pg_cron от владельца) — снаружи её звать незачем.
revoke execute on function public.bday_gen() from public, anon, authenticated;
