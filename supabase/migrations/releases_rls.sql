/* =========================================================
   Трекер релизов «Fire Phoenix» — таблицы, права, RLS.
   Запуск: Supabase Studio → SQL Editor → вставить → Run.
   Пароля в коде сайта нет вообще: вход через Auth,
   права на запись проверяет сама база.
   ========================================================= */

/* ---------- 1. Таблица релизов ---------- */
create table if not exists public.cards (
    id          text primary key,
    title       text not null,
    note        text not null default '',
    who         text not null default '',
    ddl         date,
    stage       int         not null default 1 check (stage between 1 and 6),
    done_at     timestamptz,
    archived_at timestamptz
);

/* ---------- 2. Админы: кому можно переписывать и сжигать карточки ---------- */
create table if not exists public.admins (
    email      text primary key,
    created_at timestamptz not null default now()
);

/* ---------- 3. Проверка прав ---------- */
create or replace function public.is_admin()
    returns boolean
    language sql
    stable
    security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admins a
        where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

grant execute on function public.is_admin() to anon, authenticated;

/* ---------- 4. RLS ---------- */
alter table public.cards  enable row level security;
alter table public.admins enable row level security;

/* Доска видна всем, включая гостей — читать можно. */
drop policy if exists "cards читает всем" on public.cards;
create policy "cards читает всем"
    on public.cards for select
    to anon, authenticated
    using (true);

/* Участники двигают карточки между этапами и назначают ответственного.
   Какие именно колонки им доступны — задано грантами в шаге 5. */
drop policy if exists "cards двигают участники" on public.cards;
create policy "cards двигают участники"
    on public.cards for update
    to anon, authenticated
    using (true)
    with check (true);

/* Список админов наружу не отдаём: читается только через is_admin(). */
drop policy if exists "admins только свои" on public.admins;
create policy "admins только свои"
    on public.admins for select
    to authenticated
    using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

/* ---------- 5. Колоночные права: чем может оперировать участник ---------- */
revoke all on public.cards from anon, authenticated;
grant select on public.cards to anon, authenticated;
grant update (stage, who, done_at, archived_at) on public.cards to anon, authenticated;

revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

/* ---------- 6. Полные права админа: создать, переписать, сжечь ---------- */
create or replace function public.admin_upsert_card(
    p_id          text,
    p_stage       int,
    p_title       text,
    p_note        text        default '',
    p_who         text        default '',
    p_ddl         date        default null,
    p_done_at     timestamptz default null,
    p_archived_at timestamptz default null
)
    returns void
    language plpgsql
    security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'прав на запись нет' using errcode = '42501';
    end if;

    insert into public.cards (id, stage, title, note, who, ddl, done_at, archived_at)
    values (p_id, p_stage, coalesce(nullif(p_title, ''), 'без названия'),
            coalesce(p_note, ''), coalesce(p_who, ''), p_ddl, p_done_at, p_archived_at)
    on conflict (id) do update
        set stage       = excluded.stage,
            title       = excluded.title,
            note        = excluded.note,
            who         = excluded.who,
            ddl         = excluded.ddl,
            done_at     = excluded.done_at,
            archived_at = excluded.archived_at;
end;
$$;

create or replace function public.admin_delete_card(p_id text)
    returns void
    language plpgsql
    security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'прав на запись нет' using errcode = '42501';
    end if;

    delete from public.cards where id = p_id;
end;
$$;

/* Полный сброс доски перед тем, как залить бумажный список заново. */
create or replace function public.admin_clear_cards()
    returns void
    language plpgsql
    security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'прав на запись нет' using errcode = '42501';
    end if;

    delete from public.cards;
end;
$$;

grant execute on function public.admin_upsert_card(text, int, text, text, text, date, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_delete_card(text)  to authenticated;
grant execute on function public.admin_clear_cards()      to authenticated;

/* ---------- 6a. Посев бумажного списка ---------- */
create or replace function public.admin_seed_cards()
    returns void
    language plpgsql
    security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'прав на запись нет' using errcode = '42501';
    end if;

    /* если доска не пуста — молча выходим: перезагрузка страницы не должна
       откатывать карточки на исходные этапы */
    if exists (select 1 from public.cards) then
        return;
    end if;

    insert into public.cards (id, stage, title, note) values
        ('seed1',  1, 'Ирис Ado',              ''),
        ('seed2',  1, 'Разбеги',               ''),
        ('seed3',  1, 'Brain Rot',             ''),
        ('seed4',  1, 'Bad Apple',             ''),
        ('seed5',  1, 'Киберпанк',             ''),
        ('seed6',  1, 'Песня про самовыпил',   ''),
        ('seed7',  1, 'Клемобис',              ''),
        ('seed8',  1, 'Парад самонадеянности', ''),
        ('seed9',  1, 'Тела',                  ''),
        ('seed10', 1, 'Fuck you',              ''),
        ('seed11', 1, 'Dance forever',         ''),
        ('seed12', 1, 'Феникс',                ''),
        ('seed13', 1, 'Don''t come crying',    ''),
        ('seed14', 1, 'Magic Ado',             ''),
        ('seed15', 1, 'AiAiAi (Ado)',          ''),
        ('seed16', 2, 'RPG',                   'тайм'),
        ('seed17', 2, 'Kawaii to басен',       'так меняется же?'),
        ('seed18', 2, 'Land of the dead',      'придётся переписывать'),
        ('seed19', 3, 'All save Challenge',    ''),
        ('seed20', 3, 'Xy',                    ''),
        ('seed21', 3, 'Run Rabbit',            ''),
        ('seed22', 3, 'Сердце байта',          ''),
        ('seed23', 3, 'Azari — Seapegoat',     ''),
        ('seed24', 4, 'Saija Boys',            'наверное надо'),
        ('seed25', 5, 'Halsey — Control',      ''),
        ('seed26', 5, 'Любовь в Канзедрио',    ''),
        ('seed27', 5, 'Иззеща',                ''),
        ('seed28', 5, 'Фон на Dollhouse',      ''),
        ('seed29', 5, 'Shadow — Shadow',       ''),
        ('seed30', 5, 'Who',                   'после сдачи?')
    on conflict (id) do nothing;
end;
$$;

grant execute on function public.admin_seed_cards() to authenticated;

/* ---------- 7. Realtime, чтобы доска обновлялась у всех сразу ---------- */
do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'cards'
    ) then
        alter publication supabase_realtime add table public.cards;
    end if;
end $$;

/* =========================================================
   ШАГ 8 — выполни отдельно, подставив свой email.
   Это единственный, кто сможет переписывать и сжигать карточки.
   =========================================================
   insert into public.admins (email) values ('твой@email');
*/