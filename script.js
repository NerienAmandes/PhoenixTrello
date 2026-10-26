/* ========= НАСТРОЙКИ SUPABASE =========
   Project Settings → API: вставь Project URL и anon public key.
   anon key публичный по своей природе — его можно коммитить в репозиторий.
   Пароля админа в коде нет: вход через Supabase Auth, а права на запись
   проверяет сама база (RLS + колоночные гранты). Обойти это из консоли
   браузера нельзя. */
const SUPABASE_URL = "https://fbsjfcnqnuvsoqslkxqn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZic2pmY25xbnV2c29xc2xreHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1OTE0NjIsImV4cCI6MjEwODE2NzQ2Mn0.wNmqUqbxd32qqda0rF7kCZUU1pGcgYFpqqDTAvLcJi8";
/* ====================================== */
const KEY = 'kaver-tracker-v1', THEME_KEY = 'kaver-theme';
const STAGES = [
    { id: 1, name: 'Запись вокала' },
    { id: 2, name: 'Отслушка' },
    { id: 3, name: 'Правки' },
    { id: 4, name: 'Сведение, тюн и тайм' },
    { id: 5, name: 'Арт' },
    { id: 6, name: 'Видео' }];
const FINAL = STAGES.length;
/* приоритет карточки: 1 — низкий, 2 — обычный, 3 — высокий.
   Ставит только админ, участникам база не даёт эту колонку менять. */
const PRIO_NAMES = { 1: 'низкий', 2: 'обычный', 3: 'высокий' };
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDdl = s => { const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const dayEnd = s => new Date(s + 'T23:59:59');
const isEarly = c => c.stage === FINAL && !!c.doneAt && !!c.ddl && new Date(c.doneAt) <= dayEnd(c.ddl);
const isLate = c => !!c.ddl && c.stage !== FINAL && new Date() > dayEnd(c.ddl);
function seedCards() {
    const s = []; let i = 0; const add = (stage, t, n) => s.push({ id: 'seed' + (++i), stage, title: t, note: n || '', who: '', ddl: '', doneAt: '', archivedAt: '', priority: 2 });
    [['Ирис Ado'], ['Разбеги'], ['Brain Rot'], ['Bad Apple'], ['Киберпанк'], ['Песня про самовыпил'], ['Клемобис'], ['Парад самонадеянности'], ['Тела'], ['Fuck you'], ['Dance forever'], ['Феникс'], ["Don't come crying"], ['Magic Ado'], ['AiAiAi (Ado)']].forEach(x => add(1, x[0]));
    add(2, 'RPG', 'тайм'); add(2, 'Kawaii to басен', 'так меняется же?'); add(2, 'Land of the dead', 'придётся переписывать');
    [['All save Challenge'], ['Xy'], ['Run Rabbit'], ['Сердце байта'], ['Azari — Seapegoat']].forEach(x => add(3, x[0]));
    add(4, 'Saija Boys', 'наверное надо');
    [['Halsey — Control'], ['Любовь в Канзедрио'], ['Иззеща'], ['Фон на Dollhouse'], ['Shadow — Shadow'], ['Who', 'после сдачи?']].forEach(x => add(5, x[0], x[1]));
    return s;
}
let state = { cards: [] }, sb = null, filterDdl = '', archiveOpen = false, me = null, admin = false;
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const byId = id => state.cards.find(c => c.id === id);
const board = document.getElementById('board');

/* ---- запись: участнику и админу доступно разное ----
   Участник двигает карточку между этапами, меняет ответственного и архивирует —
   это ровно те колонки, что разрешены грантом в базе. Название, заметку и дедлайн
   он изменить не может даже из консоли браузера.
   Всё остальное идёт через SECURITY DEFINER функции, которые сами проверяют
   is_admin(). Ошибка приливает сюда и молча откатывает локальную карточку. */
async function saveFlow(c) {
    if (!sb) { save(); return; }
    /* await обязателен: билдер supabase-js ленивый, без него запрос просто не уходит */
    const { error } = await sb.from('cards').update({ stage: c.stage, who: c.who || '', done_at: c.doneAt || null, archived_at: c.archivedAt || null }).eq('id', c.id);
    if (error) { console.warn('не сохранилось', error); await loadCards(); }
}
async function saveCard(c) {
    if (!sb) { save(); return; }
    const { error } = await sb.rpc('admin_upsert_card', {
        p_id: c.id, p_stage: c.stage, p_title: c.title, p_note: c.note || '',
        p_who: c.who || '', p_ddl: c.ddl || null,
        p_done_at: c.doneAt || null, p_archived_at: c.archivedAt || null,
        p_priority: c.priority || 2
    });
    if (error) { await loadCards(); return; }
}
async function removeCard(id) {
    state.cards = state.cards.filter(c => c.id !== id);
    render();
    if (!sb) { save(); return; }
    const { error } = await sb.rpc('admin_delete_card', { p_id: id });
    if (error) { console.warn('не сожглось', error); await loadCards(); }
}
function archiveCard(c) { c.archivedAt = new Date().toISOString(); saveFlow(c); render(); }
function unarchiveCard(c) { c.archivedAt = ''; saveFlow(c); render(); }

/* ---- вход и права ---- */
async function refreshAuth() {
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    me = data.session?.user ?? null;
    admin = me ? !!(await sb.rpc('is_admin')).data : false;
    authBtn.textContent = admin ? `админ: ${me.email}` : me ? `вошел: ${me.email}` : 'войти';
    render();
}
/* Спрашивает права перед действием. false — значит действие отменено. */
function requireAdmin(act) {
    if (admin) return true;
    if (me) { alert(`${act} может только админ`); return false; }
    if (sb) {
        loginNote.textContent = `${act} может только админ. Войди — и кнопки появятся.`;
        openLogin(); return false;
    }
    alert('сначала впиши Project URL и anon key в настройках Supabase');
    return false;
}
async function signIn() {
    const email = lEmail.value.trim(), password = lPass.value;
    if (!email || !password) return;
    const btn = lIn; btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { alert('не пустил: ' + error.message); return; }
    loginModal.classList.remove('show'); lPass.value = '';
}
function openLogin() { loginModal.classList.add('show'); lEmail.focus(); }
/* Один запрос вместо тридцати: доска не дёргается на каждый карточный апдейт. */
async function seedFromPaper() {
    const { error } = await sb.rpc('admin_seed_cards');
    if (error) { console.warn('посев не удался', error); return; }
    await loadCards();
}

async function initStore() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        try {
            const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
            sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            sb.auth.onAuthStateChange(() => refreshAuth());
            await refreshAuth();
            await loadCards();
            /* бумажный список заливаем ровно один раз — когда база ещё пуста.
               Проверка после loadCards, иначе посев сбрасывал бы этапы при каждой перезагрузке. */
            if (admin && !state.cards.length) await seedFromPaper();
            sb.channel('cards-changes')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => loadCards())
                .subscribe();
            return;
        } catch (e) { console.warn('supabase unavailable → local mode', e); }
    }
    fallbackLocal();
}
async function loadCards() {
    /* сортировка обязательна: без неё postgres отдаёт строки в произвольном
       порядке и после перезагрузки карточки выглядят перетасованными */
    const { data, error } = await sb.from('cards').select('*').order('title');
    if (error) { console.warn('supabase select error', error); return; }
    state.cards = data.map(r => ({ id: r.id, stage: r.stage, title: r.title, note: r.note || '', who: r.who || '', ddl: r.ddl || '', doneAt: r.done_at || '', archivedAt: r.archived_at || '', priority: r.priority ?? 2 }));
    render();
}
function fallbackLocal() {
    sb = null;
    try { state = JSON.parse(localStorage.getItem(KEY)) || { cards: seedCards() } } catch (e) { state = { cards: seedCards() } }
    save(); render();
}

/* освещение */
const themeBtn = document.getElementById('themeBtn');
function applyTheme(t) {
    document.body.classList.toggle('light', t === 'light');
    themeBtn.textContent = t === 'light' ? 'сделать потемнее' : 'сделать посветлее';
    localStorage.setItem(THEME_KEY, t);
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
themeBtn.onclick = () => applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');

/* фильтр по дедлайну */
const fDdlSel = document.getElementById('fDdl');
function matches(c) {
    if (filterDdl === 'over' && !isLate(c)) return false;
    if (filterDdl === 'week' && !(c.ddl && !isLate(c) && (dayEnd(c.ddl) - Date.now()) <= 7 * 864e5)) return false;
    if (filterDdl === 'none' && c.ddl) return false;
    return true;
}
fDdlSel.onchange = () => { filterDdl = fDdlSel.value; render(); };

/* архив */
const archiveBtn = document.getElementById('archiveBtn'), archiveSec = document.getElementById('archive'),
    archiveList = document.getElementById('archiveList'), archiveNote = document.getElementById('archiveNote');
archiveBtn.onclick = () => { archiveOpen = !archiveOpen; render(); };
archiveList.addEventListener('click', e => {
    const b = e.target.closest('.back'); if (!b) return;
    const c = byId(b.dataset.id); if (c) unarchiveCard(c);
});
function acardEl(c) {
    const d = document.createElement('div'); d.className = 'acard';
    if (isEarly(c)) d.classList.add('early');
    const closed = (c.doneAt || c.archivedAt || '').slice(0, 10);
    d.innerHTML = `<div class="t"></div>${c.who ? '<div class="w"></div>' : ''}${closed ? '<div class="c"></div>' : ''}<br><button class="back" data-id="${c.id}">вернуть на доску</button>`;
    d.querySelector('.t').textContent = c.title;
    if (c.who) d.querySelector('.w').textContent = c.who;
    if (closed) d.querySelector('.c').textContent = fmtDdl(closed);
    return d;
}

/* Порядок внутри отдела: сначала приоритет (выше — выше),
   при равном — ближайший дедлайн, потом название, чтобы порядок не прыгал. */
function byPriority(a, b) {
    const p = (b.priority || 2) - (a.priority || 2);
    if (p) return p;
    const ad = a.ddl || '9999-12-31', bd = b.ddl || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.title.localeCompare(b.title, 'ru');
}
function cardEl(c) {
    const d = document.createElement('div'); d.className = 'card'; d.draggable = true; d.dataset.id = c.id;
    const pr = [1, 2, 3].includes(c.priority) ? c.priority : 2; d.dataset.p = pr;
    if (!matches(c)) d.classList.add('dim');
    if (isEarly(c)) d.classList.add('early');
    if (isLate(c)) d.classList.add('late');
    d.innerHTML = `<div class="head"><div class="t"></div><div class="prio" title="приоритет: ${PRIO_NAMES[pr]}"><i></i><i></i><i></i></div></div>${c.who ? '<div class="w"></div>' : ''}${c.ddl ? '<div class="d"></div>' : ''}${c.note ? '<div class="n"></div>' : ''}<div class="ctl"><button data-act="left" title="на этап назад">←</button>${c.stage === FINAL ? '<button data-act="archive" title="в архив (завершено)">✓</button>' : ''}${admin ? '<button data-act="edit" title="переписать">✎</button>' : ''}<button data-act="right" title="на этап дальше">→</button></div>`;
    d.querySelector('.t').textContent = c.title;
    if (c.who) d.querySelector('.w').textContent = c.who;
    if (c.ddl) d.querySelector('.d').textContent = fmtDdl(c.ddl);
    if (c.note) d.querySelector('.n').textContent = c.note; return d;
}
function render() {
    const active = state.cards.filter(c => !c.archivedAt);
    const arch = state.cards.filter(c => c.archivedAt).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
    board.innerHTML = ''; STAGES.forEach(st => {
        const cards = active.filter(c => c.stage === st.id).sort(byPriority);
        /* кнопка «+» видна всем: у кого нет прав — приглушена и с замочком */
        const addBtn = `<button class="add${admin ? '' : ' locked'}" data-add="${st.id}" title="${admin ? 'добавить песню на этап' : 'добавлять песни может только админ'}">+</button>`;
        const col = document.createElement('section'); col.className = 'col'; col.dataset.stage = st.id; col.dataset.num = '0' + st.id;
        col.innerHTML = `<div class="colHead"><span class="stamp">${st.id} · ${st.name}</span><span class="count">${cards.length}</span>${addBtn}</div><div class="cards" data-stage="${st.id}"></div>`;
        const list = col.querySelector('.cards'); cards.forEach(c => list.appendChild(cardEl(c))); board.appendChild(col);
    });
    /* прогресс считается только по архивным */
    const total = state.cards.length, done = arch.length,
        pct = total ? Math.round(done / total * 100) : 0;
    document.getElementById('barFill').style.width = pct + '%';
    document.getElementById('barText').textContent = `закрыто ${done} из ${total} · ${pct}% готово` + (filterDdl ? ` · дд: ${fDdlSel.selectedOptions[0].text}` : '');
    const names = [...new Set(state.cards.flatMap(c => (c.who || '').split(',')).map(s => s.trim()).filter(Boolean))];
    whoList.innerHTML = ''; names.forEach(n => { const o = document.createElement('option'); o.value = n; whoList.appendChild(o); });
    archiveSec.hidden = !archiveOpen;
    archiveBtn.textContent = archiveOpen ? `спрятать архив (${arch.length})` : `архив (${arch.length})`;
    archiveNote.textContent = arch.length ? `закрытых релизов: ${arch.length}` : 'пока пусто — всё ещё в работе';
    archiveList.innerHTML = ''; arch.forEach(c => archiveList.appendChild(acardEl(c)));
}
function move(c, stage) {
    stage = Math.max(1, Math.min(FINAL, stage)); if (stage === c.stage) return; const was = c.stage;
    c.stage = stage;
    c.doneAt = (stage === FINAL) ? new Date().toISOString() : '';
    saveFlow(c); render();
    if (stage === FINAL && was !== FINAL) {
        sparks(); const el = board.querySelector(`.card[data-id="${c.id}"]`);
        if (el) { el.classList.add('stamped'); setTimeout(() => el.classList.remove('stamped'), 2200); }
    }
    openHand(c, stage);
}
function openHand(c, stage) {
    handText.textContent = `«${c.title}» теперь на этапе «${STAGES[stage - 1].name}». кто теперь ответственный?`;
    hWho.value = c.who || ''; handCardId = c.id; hand.classList.add('show'); hWho.focus();
}
function sparks() {
    const cols = ['#ffd97a', '#f5a623', '#e0502e']; for (let i = 0; i < 42; i++) {
        const p = document.createElement('i');
        p.className = 'spark'; p.style.color = cols[i % 3]; p.style.left = (20 + Math.random() * 60) + 'vw';
        p.style.bottom = (8 + Math.random() * 22) + 'vh'; p.style.animationDelay = Math.random() * .3 + 's';
        p.style.setProperty('--dx', (Math.random() * 140 - 70) + 'px'); document.body.appendChild(p); setTimeout(() => p.remove(), 1800);
    }
}
board.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'); if (add) {
        /* добавление песни — только админ, остальным покажем окно входа */
        if (!requireAdmin('добавлять песни')) return;
        openEditor(null, +add.dataset.add); return;
    }
    const btn = e.target.closest('.ctl button'); if (btn) {
        const id = btn.closest('.card').dataset.id, c = byId(id);
        if (btn.dataset.act === 'edit') openEditor(id);
        else if (btn.dataset.act === 'archive') archiveCard(c);
        else move(c, c.stage + (btn.dataset.act === 'right' ? 1 : -1)); return;
    }
    /* клик по бумажке больше не открывает редактор — на телефоне один
       промах мимо кнопок и админ оказывается в форме без желания туда лезть.
       Редактор открывается только явной кнопкой «✎». */
});
board.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
board.addEventListener('dragend', () => { document.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
board.addEventListener('dragover', e => { const col = e.target.closest('.col'); document.querySelectorAll('.col.over').forEach(c => { if (c !== col) c.classList.remove('over') }); if (col) { e.preventDefault(); col.classList.add('over'); } });
board.addEventListener('drop', e => {
    const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); col.classList.remove('over');
    const c = byId(e.dataTransfer.getData('text/plain')); if (c) move(c, +col.querySelector('.cards').dataset.stage);
});
const modal = document.getElementById('modal'), fTitle = document.getElementById('fTitle'), fNote = document.getElementById('fNote'), fWho = document.getElementById('fWho'), fDdlInput = document.getElementById('fDdlInput'), fPri = document.getElementById('fPri'), whoList = document.getElementById('whoList'), delBtn = document.getElementById('delBtn');
const hand = document.getElementById('hand'), handText = document.getElementById('handText'), hWho = document.getElementById('hWho');
const loginModal = document.getElementById('login'), lEmail = document.getElementById('lEmail'), lPass = document.getElementById('lPass'), lIn = document.getElementById('lIn'), loginNote = document.getElementById('loginNote');
const authBtn = document.getElementById('authBtn');
let editingId = null, newStage = 1, handCardId = null;
function openEditor(id, stage) {
    editingId = id;
    if (id) { const c = byId(id); fTitle.value = c.title; fNote.value = c.note; fWho.value = c.who || ''; fDdlInput.value = c.ddl || ''; fPri.value = String(c.priority || 2); delBtn.style.display = ''; }
    else { newStage = stage; fTitle.value = ''; fNote.value = ''; fWho.value = ''; fDdlInput.value = ''; fPri.value = '2'; delBtn.style.display = 'none'; }
    modal.classList.add('show'); fTitle.focus();
}
document.getElementById('saveBtn').onclick = async () => {
    const t = fTitle.value.trim() || 'без названия', n = fNote.value.trim(), w = fWho.value.trim(), dl = fDdlInput.value, pr = Number(fPri.value) || 2;
    if (editingId) {
        const c = byId(editingId); c.title = t; c.note = n; c.who = w; c.ddl = dl; c.priority = pr;
        if (c.stage === FINAL && !c.doneAt) c.doneAt = new Date().toISOString();
        await saveCard(c);
    }
    else {
        const c = { id: uid(), stage: newStage, title: t, note: n, who: w, ddl: dl, priority: pr, doneAt: newStage === FINAL ? new Date().toISOString() : '', archivedAt: '' };
        state.cards.push(c); await saveCard(c);
    }
    render(); modal.classList.remove('show');
};
delBtn.onclick = async () => { if (!requireAdmin('сжигать карточки')) return; if (!confirm('сжечь карточку?')) return; await removeCard(editingId); modal.classList.remove('show'); };
document.getElementById('cancelBtn').onclick = () => modal.classList.remove('show');
document.getElementById('handSave').onclick = async () => { const c = byId(handCardId); if (c) { c.who = hWho.value.trim(); await saveFlow(c); render(); } hand.classList.remove('show'); };
document.getElementById('handSkip').onclick = () => hand.classList.remove('show');
modal.addEventListener('click', e => { /* подложка больше не закрывает модалку — на телефоне
   один промах пальцем и всё исчезает. Закрываем только отменой или Esc */ });
hand.addEventListener('click', e => { /* см. выше — подложка не закрывает */ });
loginModal.addEventListener('click', e => { /* см. выше — подложка не закрывает */ });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { modal.classList.remove('show'); hand.classList.remove('show'); loginModal.classList.remove('show'); } });

/* ---- вход ---- */
lIn.onclick = signIn;
lPass.addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
document.getElementById('lCancel').onclick = () => loginModal.classList.remove('show');
authBtn.onclick = async () => {
    if (!sb) { alert('сначала впиши Project URL и anon key в настройках Supabase'); return; }
    if (me) { await sb.auth.signOut(); return; }
    openLogin();
};

initStore();