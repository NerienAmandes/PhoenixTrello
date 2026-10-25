/* =========================================================
   Телеграм-бот дедлайнов: подписки и «новые» карточки.
   Запуск: Supabase Studio → SQL Editor → вставить → Run.
   ========================================================= */

/* ---------- 1. Когда карточку создали ----------
   Раньше у карточек не было времени появления, поэтому «новые
   карточки» отличить было не от чего. Старые карточки придут
   сюда с минус-месяцем, чтобы не выглядеть свежими. */
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = 'cards'
          and column_name  = 'created_at'
    ) then
        alter table public.cards
            add column created_at timestamptz not null default now();
        update public.cards set created_at = now() - interval '30 days';
    end if;
end $$;

/* ---------- 1б. Состояние напоминаний по каждой карточке ----------
   bot_tier   — последний «уровень» (far/soon/late/noddl)
   bot_sent_at — когда по этой карточке последний раз писали
   Нужны, чтобы у каждой карточки был свой таймер:
   дальше 7 дней — раз в неделю, ≤ 7 дней — раз в 2 дня,
   просрочено — раз в 4 дня. */
alter table public.cards
    add column if not exists bot_tier text,
    add column if not exists bot_sent_at timestamptz;

/* Отметка «мы только что напомнили» — вызывается ботом после отправки. */
create or replace function public.bot_mark_reminded(
    p_cards jsonb
)
    returns void
    language plpgsql
    security definer
set search_path = public
as $$
begin
    update public.cards c
       set bot_tier   = x.tier,
           bot_sent_at = now()
      from jsonb_to_recordset(p_cards) as x(id text, tier text)
     where c.id = x.id;
end;
$$;

grant execute on function public.bot_mark_reminded(jsonb) to service_role;

/* ---------- 2. Кто подписан на уведомления ----------
   chat_id — идентификатор чата в Телеграме, email — почта админа
   с сайта (по ней идёт проверка прав). last_digest — хэш последней
   отправки: если за прошлый раз ничего не поменялось, бот молчит. */
create table if not exists public.telegram_chats (
    chat_id     bigint primary key,
    email       text        not null unique,
    username    text        not null default '',
    active      boolean     not null default true,
    last_digest text        not null default '',
    last_sent_at timestamptz,
    created_at  timestamptz not null default now()
);

alter table public.telegram_chats enable row level security;

/* Снаружи таблицу не видно: ни гостям, ни участникам сайта.
   Читает и пишет только бот — через service_role. */
revoke all on public.telegram_chats from anon, authenticated;
grant select, insert, update, delete on public.telegram_chats to service_role;

grant select on public.cards to service_role;

/* ---------- 3. Привязка чата к админу ----------
   Вызывается ботом после /start. Право на подписку есть только
   у того, чья почта лежит в admins. */
create or replace function public.bot_bind(
    p_email    text,
    p_chat_id  bigint,
    p_username text default ''
)
    returns text
    language plpgsql
    security definer
set search_path = public
as $$
declare
    v_email text;
begin
    v_email := lower(btrim(coalesce(p_email, '')));
    if v_email = '' or v_email not like '%_@_%._%' then
        return 'email';
    end if;

    if not exists (select 1 from public.admins a where lower(a.email) = v_email) then
        return 'not_admin';
    end if;

    /* почта могла быть привязана к другому чату — освобождаем её */
    delete from public.telegram_chats
     where email = v_email and chat_id <> p_chat_id;

    insert into public.telegram_chats (chat_id, email, username, active)
    values (p_chat_id, v_email, coalesce(p_username, ''), true)
    on conflict (chat_id) do update
        set email    = excluded.email,
            username = excluded.username,
            active   = true;

    return 'ok';
end;
$$;

create or replace function public.bot_unbind(p_chat_id bigint)
    returns boolean
    language sql
    security definer
set search_path = public
as $$
    update public.telegram_chats
       set active = false
     where chat_id = p_chat_id
    returning true;
$$;

grant execute on function public.bot_bind(text, bigint, text) to service_role;
grant execute on function public.bot_unbind(bigint) to service_role;

/* =========================================================
   Дальше — три шага с ботом:
   1. deploy функции telegram-bot (файл supabase/functions/telegram-bot/index.ts);
   2. секреты функции: TELEGRAM_BOT_TOKEN и BOT_SECRET;
   3. GET .../functions/v1/telegram-bot/setup с x-bot-secret —
      это включает вебхук Телеграма.
   ========================================================= */
