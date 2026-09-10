-- Исключённые отправители: чьи личные сообщения в drafta не попадают вовсе.
--
-- Малый бизнес часто держит бизнес-аккаунт на том же номере и в том же профиле,
-- что и личный. Сегодня в инбокс приезжает всё подряд, включая переписку с
-- семьёй, и «почистить» её можно только вручную — уже после того, как она
-- сохранена. Список исключений отбрасывает такие события **до** первой записи
-- в БД: ни контакта, ни переписки, ни строки в журнале вебхуков.
--
-- Решения схемы:
--
-- 1. Ключ — (workspace_id, platform), а не channel_connection_id. Удаление
--    подключения уносит каскадом всё, что на нём висит, а WhatsApp
--    переподключают регулярно (смена WABA, ошибка провайдера, «отключить →
--    включить»). Список, привязанный к подключению, при этом молча исчез бы, и
--    личные сообщения снова начали бы сохраняться — ровно та беда, от которой
--    список и заводят, причём незаметно для пользователя. Платформа переживает
--    переподключение, а подключений каждой платформы в workspace всё равно не
--    больше одного (unique (workspace_id, platform) у channel_connections).
--
-- 2. platform — свободный текст с проверкой на непустоту, как у
--    channel_connections.platform и contact_identities.platform. Набор
--    допустимых платформ держит lib/ignored-senders/validation.ts: список
--    поддерживает сегодня WhatsApp и Instagram, и расширение на Telegram не
--    должно требовать миграции.
--
-- 3. identifier хранится **нормализованным**: у номера — только цифры E.164 без
--    «+», у хэндла — нижний регистр без «@». Нормализует одна функция
--    (lib/ignored-senders/validation.ts), общая для формы настроек и для гейта
--    вебхука. Если бы каждая сторона нормализовала по-своему, список молча
--    перестал бы срабатывать — худший вид отказа для этой фичи. CHECK ниже
--    следит, чтобы ненормализованное значение не попало в таблицу в обход формы.
--
-- 4. label («Анна») — не идентификатор, а подпись для человека, и пустая
--    допустима: чип тогда показывает один адрес. Отдельной таблицы контактов
--    здесь нет намеренно — исключённый отправитель тем и отличается, что
--    контакта у него не заводится.
--
-- 5. Уникальный ключ (workspace_id, platform, identifier) служит и индексом под
--    запрос гейта: он фильтрует ровно по этому префиксу плюс identifier in (...).
--    Отдельный индекс не нужен.
--
-- Privacy: таблица хранит адреса, которые пользователь ввёл сам, и существует
-- ровно затем, чтобы персональные данные исключённого человека никогда не
-- попали в webhook_events и messages — data minimisation, Art. 5(1)(c) GDPR
-- (§15). Удаляется каскадом от workspace.
--
-- Docs: docs/architecture/05-channels.md,
--       docs/architecture/06-data-model.md,
--       docs/architecture/07-data-flows.md,
--       docs/architecture/10-ui.md,
--       docs/architecture/15-compliance-gdpr.md

create table public.ignored_senders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check (length(btrim(platform)) > 0),
  identifier text not null,
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ignored_senders_identifier_normalized_check
    check (identifier = btrim(lower(identifier))),
  constraint ignored_senders_identifier_length_check
    check (char_length(identifier) between 1 and 100),
  constraint ignored_senders_label_trimmed_check
    check (label = btrim(label)),
  constraint ignored_senders_label_length_check
    check (char_length(label) <= 120),
  constraint ignored_senders_label_characters_check
    check (label !~ '[[:cntrl:]]'),
  unique (workspace_id, platform, identifier)
);

comment on table public.ignored_senders is
  'Отправители, чьи личные сообщения не сохраняются: событие отбрасывается до записи в webhook_events.';
comment on column public.ignored_senders.platform is
  'Платформа канала (whatsapp, instagram). Список привязан к платформе, а не к подключению, чтобы пережить переподключение канала.';
comment on column public.ignored_senders.identifier is
  'Нормализованный адрес: цифры E.164 без «+» у номера, нижний регистр без «@» у хэндла.';
comment on column public.ignored_senders.label is
  'Подпись пользователя («Анна»). Пустая допустима — чип тогда показывает один адрес.';

-- ---------------------------------------------------------------------------
-- Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

-- Список правит участник workspace из настроек каналов; гейт вебхука читает его
-- под service_role (вебхук приходит без сессии пользователя).
alter table public.ignored_senders enable row level security;

revoke all on table public.ignored_senders from anon;

grant select, insert, update, delete on table public.ignored_senders to authenticated;
grant select, insert, update, delete on table public.ignored_senders to service_role;

create policy ignored_senders_member_access
on public.ignored_senders
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
