-- Список «Сообщения» скрывает диалоги, в которых ещё нет ни одного сообщения.
--
-- При подключении WhatsApp Zernio присылает `conversation.started` на каждый
-- существующий тред синхронизированной истории, но сами исторические сообщения
-- не шлёт. Пайплайн входящего честно создаёт диалог — событие существует ради
-- личного ответа автору комментария, где тред тоже открывается до первого
-- сообщения, — и инбокс заполняется пустыми строками без превью.
--
-- Диалоги при этом не удаляются: как только в тред придёт первое сообщение, он
-- появится в списке вместе со всей своей историей. Прячется только пустая
-- строка, и прячется на уровне БД, а не в JS: фильтровать страницу после
-- выборки означало бы врать в пагинации и в счётчике `count`.
--
-- PostgREST не умеет `exists (…)`, поэтому предикат живёт во вью — тем же
-- приёмом, что и превью списков (20260828130000_add_thread_preview_views).
--
-- `security_invoker = on` — вью исполняется правами вызывающего, а не своими:
-- политика `conversations_member_access` продолжает действовать ровно так же,
-- как при прямом запросе к таблице. Без этого вью стало бы дырой в изоляции
-- тенантов (правило 3).
--
-- Колонки перечислены явно, а не `c.*`: `*` в определении вью разворачивается
-- один раз при создании, и колонка, добавленная в `conversations` позже, молча
-- не появилась бы здесь.
--
-- Индекс не нужен: `messages_conversation_created_at_idx` уже покрывает поиск
-- по `conversation_id`, а `conversations_inbox_idx` — сортировку списка.
--
-- Docs: docs/architecture/06-data-model.md, docs/architecture/10-ui.md

create view public.conversation_list_entries
with (security_invoker = on) as
select
  c.id,
  c.workspace_id,
  c.channel_connection_id,
  c.contact_id,
  c.external_id,
  c.status,
  c.snoozed_until,
  c.last_incoming_at,
  c.unread_count,
  c.matched_kb_file_ids,
  c.created_at,
  c.updated_at
from public.conversations c
where exists (
  select 1
  from public.messages m
  where m.conversation_id = c.id
);

comment on view public.conversation_list_entries is
  'Диалоги для списка «Сообщения»: те же строки, что в conversations, но без тредов, в которых ещё нет ни одного сообщения.';
