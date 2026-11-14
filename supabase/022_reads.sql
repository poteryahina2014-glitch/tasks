-- «Чтение» 📰: статьи «прочитать потом», папки по темам, каждый день — несколько статей на подоконнике.
-- Можно запускать повторно.

-- папки (темы)
create table if not exists read_folders (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null default '',
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table read_folders enable row level security;
drop policy if exists own on read_folders;
create policy own on read_folders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on read_folders to authenticated;

-- статьи
--   created_at   — когда добавлена в список;
--   published_on — дата самой статьи (если удалось вытащить со страницы);
--   shown_on     — день, на который статья выбрана «почитать сегодня»;
--   done_on      — когда прочитана (уходит в «Прочитанные»).
create table if not exists reads (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  url text not null,
  title text not null default '',
  site text not null default '',
  published_on date,
  folder_id bigint references read_folders on delete set null,
  shown_on date,
  done_on date,
  created_at timestamptz not null default now()
);
-- если таблица уже была создана первой версией этого файла
alter table reads add column if not exists site text not null default '';
alter table reads add column if not exists published_on date;
alter table reads add column if not exists folder_id bigint references read_folders on delete set null;
create index if not exists reads_user on reads (user_id, done_on, created_at);

alter table reads enable row level security;
drop policy if exists own on reads;
create policy own on reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on reads to authenticated;
