-- Ручной публичный ответ на комментарий: кнопка «Ответить» в строке действий.
--
-- До сих пор строка в `public.comments` со стороны приложения появлялась ровно
-- одним способом — через `accept_comment_draft_for_send` (20260725110000),
-- которая берёт текст из готового AI-черновика. Интерфейс черновиков снят с
-- экрана до его переработки, а отвечать надо уже сейчас: оператор пишет ответ
-- сам или подставляет шаблон.
--
-- Решения:
--
-- 1. Отдельная функция, а не необязательный аргумент у существующей. Та ведёт
--    жизненный цикл черновика (`ready`/`edited` → `sent`), эта не знает о
--    черновиках вовсе; склеивать их значило бы получить функцию с двумя
--    несвязанными режимами. Ср. `accept_reply_for_send` (20260723100000), где
--    ручной текст и черновик живут вместе только потому, что поле ответа в
--    переписке физически одно и то же.
--
-- 2. Отвечаем всегда конкретному комментарию: `parent_external_id` исходящей
--    строки — это `external_id` отвечаемого, ровно тот же контракт, что у
--    черновикового пути и что ждёт `send-comment` вместе с
--    `POST /v1/inbox/comments/{postId}` у Zernio.
--
-- 3. Блокировка поста `for update` — как в черновиковом пути: она сериализует
--    вставки ответов под одним постом и не даёт двум вкладкам разъехаться.
--
-- 4. Повторные ответы разрешены: Instagram позволяет отвечать на один
--    комментарий несколько раз, и в интерфейсе «Ответить» доступен всегда.
--    Уникального ключа здесь поэтому нет.
--
-- Privacy: строка содержит текст ответа оператора (§15), как и любой другой
-- исходящий комментарий.
--
-- Docs: docs/architecture/07-data-flows.md#63-отправка-ответа,
--       docs/architecture/10-ui.md

create function public.accept_manual_comment_reply(
  target_workspace_id uuid,
  target_comment_id uuid,
  reply_text text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_post_id uuid;
  answered_external_id text;
  outgoing_text text := nullif(pg_catalog.btrim(coalesce(reply_text, '')), '');
  outgoing_comment_id uuid;
begin
  if outgoing_text is null then
    return null;
  end if;

  select answered.post_id, answered.external_id
  into target_post_id, answered_external_id
  from public.comments as answered
  where answered.workspace_id = target_workspace_id
    and answered.id = target_comment_id
    and answered.direction = 'incoming';

  if not found then
    return null;
  end if;

  perform 1
  from public.posts as post
  where post.workspace_id = target_workspace_id
    and post.id = target_post_id
  for update;

  if not found then
    return null;
  end if;

  insert into public.comments (
    workspace_id,
    post_id,
    external_id,
    parent_external_id,
    direction,
    text,
    delivery_status
  )
  values (
    target_workspace_id,
    target_post_id,
    null,
    answered_external_id,
    'outgoing',
    outgoing_text,
    'pending'
  )
  returning id into outgoing_comment_id;

  return outgoing_comment_id;
end;
$$;

revoke all on function public.accept_manual_comment_reply(uuid, uuid, text)
  from public;
grant execute on function public.accept_manual_comment_reply(uuid, uuid, text)
  to authenticated, service_role;
