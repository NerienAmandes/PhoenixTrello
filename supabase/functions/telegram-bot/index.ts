/* =========================================================
   PhoenixTrello — бот дедлайнов в Телеграме.

   Что делает:
   • /start — человек сам активирует бота: присылает почту,
     функция проверяет её по таблице admins и привязывает чат.
   • /stop  — отписаться, /status — что подключено.
   • /dispatch — напомнить о карточках, которых подходит срок.
     Этот путь дёргает GitHub Actions по расписанию.

   Как часто напоминать (считается по каждой карточке отдельно):
   • ддл дальше 7 дней   — раз в неделю, по понедельникам
   • ддл ≤ 7 дней        — раз в 2 дня
   • просрочено           — раз в 4 дня, с текстом «просрочено на N дней»
   • без ддл              — раз в неделю, по понедельникам
   Про то, кого и когда доломали, бот помнит в самой карточке
   (колонки bot_tier и bot_sent_at).

   Настройка (один раз):
   1. @BotFather → /newbot → положи токен в секреты функции
      (Edge Functions → telegram-bot → Secrets: TELEGRAM_BOT_TOKEN).
   2. Придумай BOT_SECRET — только латиница, цифры, «_» и «-».
      То же значение положи и в секреты функции, и в GitHub
      (Settings → Secrets → Actions → BOT_SECRET).
   3. Edge Functions → telegram-bot → Settings → Verify JWT: OFF.
      Телеграм шлёт вебхуки без авторизации, проверка идёт по
      secret_token, а доступ к диспетчеру — по заголовку x-bot-secret.
   4. Открой https://<ref>.supabase.co/functions/v1/telegram-bot/setup
      с заголовком x-bot-secret: <BOT_SECRET> — вебхук включится.
   ========================================================= */

const TG_API = 'https://api.telegram.org';

/* ---------- этапы доски — те же, что в script.js ---------- */
const STAGES = [
    { id: 1, name: 'Запись вокала' },
    { id: 2, name: 'Отслушка' },
    { id: 3, name: 'Правки' },
    { id: 4, name: 'Сведение, тюн и тайм' },
    { id: 5, name: 'Арт' },
    { id: 6, name: 'Видео' }];
const FINAL = STAGES.length;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const TZ_OFFSET = 3 * 3600e3;  /* Москва — чтобы «день» совпадал с сайтом */
const DAY = 864e5;
const NEW_DAYS = 7;           /* свежая карточка — такая отметка ещё горит неделю */
const LIMIT = 3600;            /* Телеграм не ест сообщения длиннее 4096 */

/* ---------- когда напоминать по каждому тиру ---------- */
export type Tier = 'late' | 'soon' | 'far' | 'noddl';

const TIER_GAP: Record<Tier, number> = {
    late: 4 * DAY,    /* просрочено — раз в 4 дня */
    soon: 2 * DAY,    /* ддл ≤ 7 дней — раз в 2 дня */
    far: 7 * DAY,     /* ддл дальше 7 дней — раз в неделю */
    noddl: 7 * DAY    /* без ддл — раз в неделю */
};
/* недельные напоминания — только по понедельникам */
const WEEKLY: Tier[] = ['far', 'noddl'];

const DenoRef: any = (globalThis as any).Deno;
const env = (key: string): string => DenoRef?.env?.get(key) ?? '';

const SUPABASE_URL = env('SUPABASE_URL');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const TG_TOKEN = env('TELEGRAM_BOT_TOKEN');
const BOT_SECRET = env('BOT_SECRET');

/* ---------- типы ---------- */
export type Card = {
    id: string;
    title: string;
    note: string;
    who: string;
    ddl: string | null;
    stage: number;
    done_at: string | null;
    archived_at: string | null;
    created_at: string | null;
    bot_tier: string | null;
    bot_sent_at: string | null;
};
type Target = {
    chat_id: number;
    email: string;
    username: string;
    active: boolean;
};
export type Due = { card: Card; tier: Tier; daysLeft: number };

const START_TEXT = [
    'Привет! Это бот доски PhoenixTrello 🦅',
    '',
    'Чтобы включить уведомления — пришли свой email (тот же, что на сайте).',
    'Я проверю, что ты админ и буду напоминать:',
    '➕ карточки без ДДЛ — данные из списка не внесены на сайт (раз в неделю)',
    '📆 дедлайны дальше 7 дней (раз в неделю)',
    '⚡ дедлайны, что скоро подойдут (раз в 2 дня)',
    '⏰ просроченные (раз в 4 дня)',
    '',
    '/start — включить, /stop — отключить, /status — что подключено'
].join('\n');

/* ---------- мелкие помощники ---------- */
export const esc = (s: string): string =>
    (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });

const stageName = (id: number): string =>
    (STAGES.find(s => s.id === id) || { name: '?' }).name;

/* сегодняшняя дата по Москве, в виде YYYY-MM-DD */
export function moscowToday(now: number): string {
    return new Date(now + TZ_OFFSET).toISOString().slice(0, 10);
}

/* сколько целых дней между двумя датами */
export function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
}

export function isMonday(date: string): boolean {
    return new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay() === 1;
}

export function dayLabel(ddl: string): string {
    const d = new Date(Date.parse(`${ddl}T12:00:00+03:00`));
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/* «1 день», «2 дня», «5 дней» */
export function plural(n: number): string {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'дня';
    return 'дней';
}

/* длинное сообщение режем по строкам, чтобы влезало в лимит Телеграма */
export function split(text: string, limit = LIMIT): string[] {
    const out: string[] = [];
    let cur = '';
    for (const raw of text.split('\n')) {
        const line = raw.length > limit ? raw.slice(0, limit) : raw;
        if (cur.length + line.length + 1 > limit) {
            if (cur) out.push(cur);
            cur = line;
        } else {
            cur = cur ? `${cur}\n${line}` : line;
        }
    }
    if (cur) out.push(cur);
    return out;
}

/* ---------- Телеграм ---------- */
async function tg(method: string, payload: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${TG_API}/bot${TG_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
        throw new Error(`telegram ${method}: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.result;
}

async function say(chatId: number, text: string): Promise<void> {
    await tg('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });
}

/* ---------- Supabase ---------- */
async function sbGet<T>(path: string): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (!res.ok) {
        throw new Error(`supabase ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
}

async function sbRpc<T>(fn: string, body: unknown): Promise<T> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        throw new Error(`supabase rpc ${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (null as unknown as T);
}

/* ---------- кому и когда пора напомнить ---------- */
export function tierOf(c: Card, today: string): Tier {
    if (!c.ddl) return 'noddl';
    const left = daysBetween(today, c.ddl);
    if (left < 0) return 'late';
    if (left <= 7) return 'soon';
    return 'far';
}

export function isDue(c: Card, tier: Tier, now: number, monday: boolean): boolean {
    /* недельные напоминания — только по понедельникам */
    if (WEEKLY.includes(tier) && !monday) return false;
    /* уровень сменился (появился ддл, дедлайн прошёл) — напомнить сразу */
    if ((c.bot_tier || '') !== tier) return true;
    if (!c.bot_sent_at) return true;
    return now - Date.parse(c.bot_sent_at) >= TIER_GAP[tier];
}

export function planDue(cards: Card[], now: number, force: boolean): Due[] {
    const today = moscowToday(now);
    const monday = isMonday(today);
    const work = cards.filter(c => !c.archived_at && c.stage !== FINAL);
    const out: Due[] = [];
    for (const c of work) {
        const tier = tierOf(c, today);
        if (!force && !isDue(c, tier, now, monday)) continue;
        out.push({ card: c, tier, daysLeft: c.ddl ? daysBetween(today, c.ddl) : 0 });
    }
    return out;
}

/* ---------- сообщение ---------- */
export function renderDigest(due: Due[], cards: Card[], now: number): string {
    const groups: Record<Tier, Due[]> = { late: [], soon: [], far: [], noddl: [] };
    for (const d of due) groups[d.tier].push(d);

    const line = (d: Due): string => {
        const c = d.card;
        const bits: string[] = [`<b>${esc(c.title)}</b>`];
        if (d.tier === 'late') {
            const over = -d.daysLeft;
            bits.push(`просрочено на ${over} ${plural(over)}`);
        } else if (c.ddl) {
            const left = d.daysLeft;
            const when = left === 0 ? 'сегодня' : left === 1 ? 'завтра' : `через ${left} ${plural(left)}`;
            bits.push(`ддл ${dayLabel(c.ddl)} (${when})`);
        }
        bits.push(`этап: ${esc(stageName(c.stage))}`);
        if (c.who) bits.push(`ответственный: ${esc(c.who)}`);
        if (c.created_at && now - Date.parse(c.created_at) <= NEW_DAYS * DAY) bits.push('новенькая');
        return `• ${bits.join(' · ')}`;
    };

    const parts: string[] = ['<b>🔥 PhoenixTrello — напоминания</b>', ''];

    if (groups.late.length) {
        parts.push('<b>⏰ Просрочено</b> (напоминаем раз в 4 дня)');
        parts.push(...groups.late.map(line));
        parts.push('');
    }
    if (groups.soon.length) {
        parts.push('<b>⚡ Скоро ДДЛ (до 7 дн)</b> (напоминаем раз в 2 дня)');
        parts.push(...groups.soon.map(line));
        parts.push('');
    }
    if (groups.far.length) {
        parts.push('<b>📆 ДДЛ дальше 7 дней</b> (напоминаем раз в неделю)');
        parts.push(...groups.far.map(line));
        parts.push('');
    }
    if (groups.noddl.length) {
        parts.push('<b>➕ Без ДДЛ — надо внести данные на сайт</b>');
        parts.push(...groups.noddl.map(line));
        parts.push('');
    }

    const active = cards.filter(c => !c.archived_at);
    parts.push('<b>📊 По этапам</b>');
    for (const st of STAGES) {
        const n = active.filter(c => c.stage === st.id).length;
        parts.push(`${st.id} · ${esc(st.name)} — ${n}`);
    }

    return parts.join('\n');
}

/* ---------- рассылка ---------- */
async function markReminded(due: Due[]): Promise<void> {
    await sbRpc('bot_mark_reminded', {
        p_cards: due.map(d => ({ id: d.card.id, tier: d.tier }))
    });
}

async function dispatch(force: boolean): Promise<Record<string, unknown>> {
    const now = Date.now();
    const cards = await sbGet<Card[]>(
        'cards?select=id,title,note,who,ddl,stage,done_at,archived_at,created_at,bot_tier,bot_sent_at'
    );

    const due = planDue(cards, now, force);
    if (!due.length) return { sent: 0, reason: 'нечего напоминать' };

    const body = renderDigest(due, cards, now);
    const targets = await sbGet<Target[]>(
        'telegram_chats?select=chat_id,email,username,active&active=eq.true'
    );

    let sent = 0;
    for (const t of targets) {
        try {
            for (const part of split(body)) await say(t.chat_id, part);
            sent++;
        } catch (e) {
            /* один чат сломался — остальные всё равно получают напоминание */
            console.error('не отправили', t.chat_id, e);
        }
    }
    if (sent) await markReminded(due);

    return { sent, subscribers: targets.length, cards: due.length };
}

/* ---------- приём команд от Телеграма ---------- */
async function onMessage(msg: any): Promise<void> {
    const chatId: number = msg.chat.id;
    const text: string = String(msg.text || '').trim();
    const username: string = msg.from?.username || '';
    if (!text) return;

    if (text.startsWith('/start')) {
        await say(chatId, START_TEXT);
        return;
    }
    if (text.startsWith('/stop')) {
        await sbRpc('bot_unbind', { p_chat_id: chatId });
        await say(chatId, 'Отписал. Чтобы снова получать напоминания — /start.');
        return;
    }
    if (text.startsWith('/status')) {
        const me = await sbGet<Target[]>('telegram_chats?select=chat_id,email,username,active&chat_id=eq.' + chatId);
        if (!me.length || !me[0].active) {
            await say(chatId, 'Уведомления выключены. Включить — /start.');
        } else {
            await say(chatId, `Уведомления включены для ${me[0].email}. Отключить — /stop.`);
        }
        return;
    }
    if (text.startsWith('/help')) {
        await say(chatId, START_TEXT);
        return;
    }

    /* иначе считаем, что прислали почту */
    const email = text.split(/\s+/)[0].toLowerCase();
    const result = await sbRpc<string>('bot_bind', {
        p_email: email,
        p_chat_id: chatId,
        p_username: username
    });

    if (result === 'ok') {
        await say(chatId, 'Готово! Буду присылать напоминания. Отписаться — /stop.');
    } else if (result === 'not_admin') {
        await say(chatId, 'Такой почты нет в списке админов. Проверь адрес или попроси админа добавить тебя.');
    } else {
        await say(chatId, 'Пришли, пожалуйста, почту — адрес вида имя@почта.ру');
    }
}

/* ---------- настройка вебхука ---------- */
async function setup(sendTest: boolean): Promise<Record<string, unknown>> {
    const url = `${SUPABASE_URL}/functions/v1/telegram-bot`;
    await tg('setWebhook', {
        url,
        secret_token: BOT_SECRET,
        allowed_updates: ['message'],
        drop_pending_updates: true
    });
    const info = await tg('getWebhookInfo');
    const targets = await sbGet<Target[]>(
        'telegram_chats?select=chat_id,email,username,active&active=eq.true'
    );
    if (sendTest && targets.length) {
        for (const t of targets) {
            await say(t.chat_id, '👋 Бот на связи. Напоминания придут сюда по дедлайнам и по невнесённым данным.');
        }
    }
    return { ok: true, webhook: url, pending: info?.pending_update_count ?? 0, subscribers: targets.length };
}

/* ---------- маршрутизация ---------- */
const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    /* путь может прийти как /telegram-bot/setup (локально)
       и как /functions/v1/telegram-bot/setup (как в Supabase) —
       берём хвост после имени функции в обоих случаях */
    const MARK = 'telegram-bot';
    const at = url.pathname.lastIndexOf(MARK);
    const path = (at >= 0 ? url.pathname.slice(at + MARK.length) : url.pathname)
        .replace(/^\//, '');

    if (path.startsWith('setup')) {
        if (req.headers.get('x-bot-secret') !== BOT_SECRET) return json({ error: 'нет ключа' }, 401);
        return json(await setup(url.searchParams.get('test') === '1'));
    }

    if (path.startsWith('dispatch')) {
        if (req.headers.get('x-bot-secret') !== BOT_SECRET) return json({ error: 'нет ключа' }, 401);
        let force = false;
        try {
            const body = await req.json();
            force = !!body?.force;
        } catch { /* пустое тело — обычная рассылка */ }
        return json(await dispatch(force));
    }

    /* вебхук Телеграма */
    if (req.headers.get('x-telegram-bot-api-secret-token') !== BOT_SECRET) {
        return json({ error: 'нет ключа' }, 401);
    }
    const update = await req.json();
    const msg = update?.message;
    if (msg) {
        try {
            await onMessage(msg);
        } catch (e) {
            console.error('onMessage', e);
            await say(msg.chat.id, 'Что-то сломалось. Попробуй ещё раз или напиши админу.');
        }
    }
    return json({ ok: true });
};

if (DenoRef?.serve) DenoRef.serve(handler);
