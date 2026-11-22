-- Проверка защиты строк (RLS). Ничего не меняет. Запускать в Supabase → SQL Editor:
-- после новой таблицы в любом приложении и на ревизии.
-- Притворяется чужим вошедшим пользователем и считает, сколько строк он видит в каждой таблице.
-- Норма: «защита» = true, «правил» ≥ 1, «видит чужой» = 0 во всех строках.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select c.relname as "таблица",
       c.relrowsecurity as "защита",
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as "правил",
       case when has_table_privilege(c.oid, 'select')
            then (xpath('/row/c/text()',
                    query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int
       end as "видит чужой"
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by 4 desc nulls last, 2, 1;
