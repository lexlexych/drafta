-- Шаблоны ответов: готовые тексты, которые оператор подставляет в поле ответа.
--
-- База знаний (`kb_files`) отвечает на вопрос «что AI знает», а шаблон — на
-- вопрос «что оператор отправляет, не запуская генерацию». Это разные сущности:
-- шаблон не уходит в промпт, не стоит токенов и не имеет порядка в контексте —
-- он просто ложится в поле ввода целиком, дословно, на выбранном языке.
--
-- Отсюда решения схемы:
--   1. тексты лежат в `bodies jsonb` («язык» → «текст»), а не отдельной таблицей
--      на язык: набор языков у шаблона правится целиком одной формой, читается
--      всегда целиком (поповер показывает все языки шаблона сразу), а join ради
--      двух-трёх строк дал бы только лишний запрос и вторую RLS-политику;
--   2. активность — два независимых флага, а не один `is_enabled`: один и тот же
--      текст может годиться для личных сообщений, но не для публичного
--      комментария под постом, и наоборот;
--   3. допустимый список языков в SQL не зашит — только форма кода языка. Иначе
--      добавление языка в интерфейс требовало бы миграции; конкретные 20 языков
--      проверяет `lib/i18n/template-languages.ts`.
--
-- Docs: docs/architecture/10-ui.md (Разделы настроек),
--       docs/architecture/06-data-model.md#reply_templates

-- ---------------------------------------------------------------------------
-- 1. Форма jsonb-мешка с текстами
-- ---------------------------------------------------------------------------

-- Подзапрос в CHECK запрещён, а вызов immutable-функции — нет, поэтому проверка
-- «объект, все значения строки, ключи похожи на код языка» живёт функцией.
create or replace function private.is_language_text_map(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    pg_catalog.jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from pg_catalog.jsonb_each(value) as entry(key, body)
      where pg_catalog.jsonb_typeof(entry.body) <> 'string'
         or entry.key !~ '^[a-z]{2}(-[a-z]{2})?$'
    );
$$;

revoke all on function private.is_language_text_map(jsonb) from public;

-- CHECK-констрейнт вычисляется от лица того, кто пишет строку, поэтому право
-- на функцию выдаётся так же явно, как у `private.is_workspace_member`.
grant execute on function private.is_language_text_map(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Таблица
-- ---------------------------------------------------------------------------

create table public.reply_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  bodies jsonb not null default '{}'::jsonb,
  is_enabled_for_messages boolean not null default true,
  is_enabled_for_comments boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reply_templates_name_trimmed_check
    check (name = btrim(name)),
  constraint reply_templates_name_length_check
    check (char_length(name) <= 120),
  constraint reply_templates_name_characters_check
    check (name !~ '[[:cntrl:]]'),
  constraint reply_templates_bodies_shape_check
    check (private.is_language_text_map(bodies)),
  constraint reply_templates_bodies_size_check
    check (octet_length(bodies::text) <= 262144)
);

comment on table public.reply_templates is
  'Шаблоны ответов workspace: название + тексты по языкам. Оператор подставляет их в поле ответа вместо AI-генерации; в промпт они не уходят.';
comment on column public.reply_templates.bodies is
  'Тексты шаблона: код языка → текст. Язык без текста не хранится — он просто отсутствует в объекте.';
comment on column public.reply_templates.is_enabled_for_messages is
  'Шаблон предлагается в поле ответа переписки.';
comment on column public.reply_templates.is_enabled_for_comments is
  'Шаблон предлагается при ответе на комментарий.';

create index reply_templates_workspace_id_idx
  on public.reply_templates (workspace_id);

-- Название уникально в рамках workspace без учёта регистра: в поповере оператор
-- выбирает шаблон по названию, и два «Доставка» там неразличимы.
create unique index reply_templates_workspace_lower_name_idx
  on public.reply_templates (workspace_id, lower(name));

create index reply_templates_workspace_sort_order_idx
  on public.reply_templates (workspace_id, sort_order, created_at);

create trigger reply_templates_set_updated_at
before update on public.reply_templates
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

alter table public.reply_templates enable row level security;

revoke all on table public.reply_templates from anon;
grant select, insert, update, delete on table public.reply_templates to authenticated;
grant select, insert, update, delete on table public.reply_templates to service_role;

create policy reply_templates_member_access
on public.reply_templates
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));
