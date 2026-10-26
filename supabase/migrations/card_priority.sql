/* =========================================================
   Приоритет карточек: колонка priority (1..3) и сортировка.
   Запуск: Supabase Studio → SQL Editor → вставить → Run.
   Скрипт можно запускать сколько угодно раз: повторный прогон
   ничего не ломает и не трогает уже расставленные приоритеты.

   Что делает:
   • добавляет public.cards.priority (1 — низкий, 2 — обычный, 3 — высокий);
   • пересобирает admin_upsert_card, чтобы админ мог писать приоритет;
   • оставляет участникам только те колонки, что были и раньше,
     поэтому приоритет в интерфейсе меняет только админ.
   ========================================================= */

/* ---------- 1. Колонка приоритета ---------- */
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'cards'
          and column_name  = 'priority'
    ) then
        alter table public.cards
            add column priority int not null default 2;
    end if;
end $$;

/* ---------- 2. Граница значений: только 1, 2 или 3 ---------- */
alter table public.cards drop constraint if exists cards_priority_check;
alter table public.cards add constraint cards_priority_check
    check (priority between 1 and 3);

/* ---------- 3. Функция админа с приоритетом ----------
   Старую версию сносим первой: с новым параметром postgres завёл бы
   вторую функцию с теми же именами аргументов, и вызов стал бы
   неоднозначным («function call is ambiguous»). */
drop function if exists public.admin_upsert_card(text, int, text, text, text, date, timestamptz, timestamptz);
drop function if exists public.admin_upsert_card(text, int, text, text, text, date, timestamptz, timestamptz, int);

create or replace function public.admin_upsert_card(
    p_id          text,
    p_stage       int,
    p_title       text,
    p_note        text        default '',
    p_who         text        default '',
    p_ddl         date        default null,
    p_done_at     timestamptz default null,
    p_archived_at timestamptz default null,
    p_priority    int         default 2
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

    insert into public.cards (id, stage, title, note, who, ddl, done_at, archived_at, priority)
    values (p_id, p_stage, coalesce(nullif(p_title, ''), 'без названия'),
            coalesce(p_note, ''), coalesce(p_who, ''), p_ddl, p_done_at, p_archived_at,
            least(greatest(coalesce(p_priority, 2), 1), 3))
    on conflict (id) do update
        set stage       = excluded.stage,
            title       = excluded.title,
            note        = excluded.note,
            who         = excluded.who,
            ddl         = excluded.ddl,
            done_at     = excluded.done_at,
            archived_at = excluded.archived_at,
            priority    = excluded.priority;
end;
$$;

grant execute on function public.admin_upsert_card(text, int, text, text, text, date, timestamptz, timestamptz, int) to authenticated;

/* ---------- 4. Участникам приоритет менять нельзя ----------
   На всякий случай убираем общий UPDATE на таблицу (если он где-то
   остался) и оставляем ровно те колонки, что были: этап, ответственный,
   даты закрытия и архива. Приоритет — только через функцию админа. */
revoke update on public.cards from anon, authenticated;
grant update (stage, who, done_at, archived_at) on public.cards to anon, authenticated;

/* =========================================================
   Готово. Проверить можно так:
   select id, title, stage, priority from public.cards order by stage, priority desc;
   ========================================================= */
