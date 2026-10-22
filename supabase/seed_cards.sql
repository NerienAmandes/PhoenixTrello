/* Бумажный список релизов → в базу.
   Запуск: Supabase Studio → SQL Editor → вставить → Run.
   В SQL Editor ты заходишь как postgres, поэтому обычный insert здесь
   работает без всяких проверок прав. Скрипт можно запускать сколько угодно
   раз: повторный запуск ничего не дублирует и не портит уже сдвинутые карточки. */

insert into public.cards (id, stage, title, note) values
    /* 1 · запись вокала */
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
    /* 2 · отслушка */
    ('seed16', 2, 'RPG',                   'тайм'),
    ('seed17', 2, 'Kawaii to басен',       'так меняется же?'),
    ('seed18', 2, 'Land of the dead',      'придётся переписывать'),
    /* 3 · правки */
    ('seed19', 3, 'All save Challenge',    ''),
    ('seed20', 3, 'Xy',                    ''),
    ('seed21', 3, 'Run Rabbit',            ''),
    ('seed22', 3, 'Сердце байта',          ''),
    ('seed23', 3, 'Azari — Seapegoat',     ''),
    /* 4 · сведение, тюн и тайм */
    ('seed24', 4, 'Saija Boys',            'наверное надо'),
    /* 5 · арт */
    ('seed25', 5, 'Halsey — Control',      ''),
    ('seed26', 5, 'Любовь в Канзедрио',    ''),
    ('seed27', 5, 'Иззеща',                ''),
    ('seed28', 5, 'Фон на Dollhouse',      ''),
    ('seed29', 5, 'Shadow — Shadow',       ''),
    ('seed30', 5, 'Who',                   'после сдачи?')
on conflict (id) do nothing;

/* Проверка: по этапам должно быть 15 + 3 + 5 + 1 + 6 = 30. */
select stage, count(*) from public.cards group by stage order by stage;

/* =========================================================
   СЮДА ВПИСЫВАЕШЬ СВОИХ АДМИНОВ — по одному на строку.
   Почта должна совпадать с почтой в Authentication → Users.
   =========================================================
   insert into public.admins (email) values ('твой@email');
   insert into public.admins (email) values ('второй@email');
*/