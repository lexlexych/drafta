-- Превью списков: последняя запись диалога и последний комментарий публикации.
--
-- Списки слева («Сообщения», «Публикации») показывают под каждой записью строку
-- последнего сообщения/комментария, а список публикаций — ещё и счётчик
-- комментариев. До этой миграции загрузчики (`loadLastMessageByConversation`,
-- `loadListPreviews`) тянули **все** сообщения всех тридцати записей страницы и
-- сводили их в JS: на рабочем workspace это тысячи строк по проводу ради
-- тридцати превью — и главный источник медленной загрузки экрана.
--
-- PostgREST не умеет `distinct on` и `group by`, поэтому агрегат живёт во вью, а
-- запрос из `lib/db` остаётся плоским `select … in (…)`.
--
-- Решения:
--
-- 1. `security_invoker = on` — вью исполняется правами вызывающего, а не своими:
--    политики `messages_member_access` / `comments_member_access` продолжают
--    действовать ровно так же, как при прямом запросе к таблице. Без этого вью
--    стало бы дырой в изоляции тенантов (правило 3).
--
-- 2. `workspace_id` в выборке — тот же defense in depth, что и везде в
--    `lib/db`: запрос всё равно фильтрует по тенанту явно, не полагаясь на одну
--    только RLS.
--
-- 3. `distinct on (…) order by … created_at desc, id desc` — тот же тай-брейк по
--    `id`, что и у пагинации треда (`lib/db/thread-page.ts`): у `created_at` нет
--    уникальности, и без него «последняя» запись при равных отметках времени
--    выбиралась бы произвольно.
--
-- 4. Счётчик входящих комментариев считается оконной функцией до `distinct on`
--    (порядок вычисления в Postgres именно такой), поэтому он относится ко всей
--    публикации, а не к одной выбранной строке.
--
-- Индексы не нужны: `messages_conversation_created_at_idx` и
-- `comments_post_created_at_idx` уже покрывают эти сортировки.
--
-- Docs: docs/architecture/06-data-model.md, docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Последнее сообщение диалога
-- ---------------------------------------------------------------------------

create view public.conversation_message_previews
with (security_invoker = on) as
select distinct on (m.conversation_id)
  m.id,
  m.workspace_id,
  m.conversation_id,
  m.direction,
  m.text,
  m.attachments,
  m.delivery_status,
  m.created_at
from public.messages m
order by m.conversation_id, m.created_at desc, m.id desc;

-- ---------------------------------------------------------------------------
-- 2. Последний комментарий публикации + число входящих
-- ---------------------------------------------------------------------------

create view public.post_comment_previews
with (security_invoker = on) as
select distinct on (c.post_id)
  c.id,
  c.workspace_id,
  c.post_id,
  c.direction,
  c.text,
  c.created_at,
  count(*) filter (where c.direction = 'incoming')
    over (partition by c.post_id) as incoming_count
from public.comments c
order by c.post_id, c.created_at desc, c.id desc;

-- ---------------------------------------------------------------------------
-- 3. Доступ
-- ---------------------------------------------------------------------------

-- Читают только участники workspace (RLS базовых таблиц) и серверный код.
revoke all on table public.conversation_message_previews from anon;
revoke all on table public.post_comment_previews from anon;

grant select on table public.conversation_message_previews to authenticated;
grant select on table public.conversation_message_previews to service_role;
grant select on table public.post_comment_previews to authenticated;
grant select on table public.post_comment_previews to service_role;
