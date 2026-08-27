-- Личное сообщение автору комментария: кнопка «Написать в ЛС».
--
-- Meta называет это private reply: сообщение адресовано комментарию, а не
-- существующему треду, — и это единственный способ написать человеку, который
-- нам ещё не писал. Ограничения платформы, зафиксированные Zernio
-- (`sendPrivateReplyToComment`, docs.zernio.com/api/openapi): только Instagram и
-- Facebook, **один** private reply на комментарий и **только в течение 7 дней**
-- после него.
--
-- Решения схемы:
--
-- 1. Отдельная таблица, а не колонки в `comments`. У отправки есть свой
--    жизненный цикл (`pending` → `sent`/`failed`) и свой текст, который в
--    `comments` не место: это сообщение в переписке, а не комментарий под
--    постом. Заодно `comments` остаётся горячей таблицей ленты без лишних
--    UPDATE.
--
-- 2. `unique (workspace_id, comment_id)` — правило «один private reply на
--    комментарий» держит схема, а не код. Две вкладки, нажавшие кнопку
--    одновременно, получат отказ на второй вставке, а не два сообщения у
--    клиента.
--
-- 3. Строка появляется до похода к провайдеру, в статусе `pending`: наружу
--    отправляет Inngest-функция с ретраями (правило 8), и ей нужно, за что
--    держаться. `external_id` — id сообщения у провайдера, появляется после
--    успеха; по нему же вебхук `message.sent` узнаёт своё сообщение.
--
-- 4. `post_id` рядом с `comment_id` — ради индексного пути «все ЛС этого поста
--    одним запросом»: тред грузит их вместе с комментариями, чтобы показать
--    «Отвечено в ЛС» без запроса на каждый комментарий.
--
-- Privacy: строки содержат текст личного сообщения (§15) и удаляются каскадом
-- от workspace и от самого комментария.
--
-- Docs: docs/architecture/05-channels.md#capabilities-канала,
--       docs/architecture/06-data-model.md#comment_private_replies,
--       docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Таблица
-- ---------------------------------------------------------------------------

create table public.comment_private_replies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null,
  comment_id uuid not null,
  text text not null constraint comment_private_replies_text_check
    check (length(btrim(text)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  -- ID сообщения у провайдера; появляется только после успешной отправки.
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, post_id)
    references public.posts(workspace_id, id) on delete cascade,
  foreign key (workspace_id, comment_id)
    references public.comments(workspace_id, id) on delete cascade,
  unique (workspace_id, comment_id)
);

comment on table public.comment_private_replies is
  'Личные сообщения авторам комментариев (Meta private reply). Один на комментарий — это правило платформы, закреплённое уникальным ключом.';

comment on column public.comment_private_replies.status is
  'pending — строка создана, отправку ведёт Inngest; sent — провайдер принял; failed — ретраи исчерпаны или платформа отказала.';

comment on column public.comment_private_replies.external_id is
  'ID отправленного сообщения у провайдера; по нему вебхук message.sent узнаёт своё сообщение и не задваивает его в переписке.';

-- Тред поста читает все свои ЛС разом; поиск по одному комментарию закрыт
-- уникальным ключом.
create index comment_private_replies_post_idx
  on public.comment_private_replies (workspace_id, post_id);

create index comment_private_replies_workspace_id_idx
  on public.comment_private_replies (workspace_id);

create trigger comment_private_replies_set_updated_at
  before update on public.comment_private_replies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

-- Строку создаёт участник workspace из server action, статус доводит
-- Inngest-функция под service_role.
alter table public.comment_private_replies enable row level security;

revoke all on table public.comment_private_replies from anon;
grant select, insert, update, delete on table public.comment_private_replies to authenticated;
grant select, insert, update, delete on table public.comment_private_replies to service_role;

create policy comment_private_replies_member_access
on public.comment_private_replies
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
