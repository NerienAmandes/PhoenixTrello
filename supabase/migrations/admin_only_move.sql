/* =========================================================
   Двигать карточки — только админам.
   Запуск: Supabase Studio → SQL Editor → вставить → Run.
   Идемпотентный: повторный прогон ничего не ломает.

   Что делает:
   1. Забираем у участников право менять stage, done_at, archived_at
      — это колонки, отвечающие за движение и закрытие карточек.
   2. Оставляем участникам только who (взять/передать ответственного)
      и ddl (кнопка «продлить дедлайн»).
   3. Полные права на всё — у админа через admin_upsert_card.
   ========================================================= */

/* ---------- 1. Ограничиваем обновляемые колонки ---------- */
revoke update on public.cards from anon, authenticated;
grant select on public.cards to anon, authenticated;
grant update (who, ddl) on public.cards to anon, authenticated;

/* =========================================================
   Проверка:
   select * from information_schema.role_column_grants
    where table_name = 'cards' and grantee in ('anon', 'authenticated');
   ========================================================= */
