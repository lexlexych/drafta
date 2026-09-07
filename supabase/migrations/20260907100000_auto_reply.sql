-- Автоответы: сценарии, задержка и журнал решений.
--
-- До сих пор drafta ничего не отправляла клиенту сама: черновик рождался только
-- по нажатию значка AI, а отправку начинал оператор
-- (20260826100000_drafts_on_demand.sql). Автоответ возвращает автоматику, но на
-- другом материале — уходит не сгенерированная проза, а **уже утверждённый
-- человеком шаблон** (`reply_templates`), и только когда модель уверенно отнесла
-- входящее к настроенному сценарию.
--
-- Решения схемы:
--
-- 1. Отдельная таблица настроек, а не колонки в `ai_settings`. `ai_settings` —
--    про генерацию черновиков, и поля автогенерации оттуда однажды уже
--    выпиливали; смешивать два контура снова означало бы повторить ту же
--    ошибку. Ряд один на workspace, как и у `ai_settings`.
--
-- 2. Сценарий ссылается на шаблон, а не хранит текст. Тексты живут в
--    `reply_templates` вместе со своими языками и вариантами: у автоответа не
--    должно быть второго, расходящегося набора формулировок. «Не отвечать
--    автоматически» — отдельное значение `action`, а не пустая ссылка: пустой
--    она станет и сама, когда шаблон удалят, а это уже сломанная настройка,
--    которую панель обязана показать иначе.
--
-- 3. Сценарий «иначе» — не строка в `auto_reply_scenarios`, а колонка
--    `fallback_template_id` в настройках. Он существует всегда, ровно один, и
--    не участвует в сортировке: строка в таблице сценариев потребовала бы
--    защищать оба этих инварианта констрейнтами вместо одной колонки.
--
-- 4. Примеры входящих — `jsonb`-массив строк, а не отдельная таблица и не
--    `text[]`: набор правится целиком одной формой и читается всегда целиком,
--    ровно как `reply_templates.bodies`. Форму проверяет immutable-функция —
--    подзапрос в CHECK запрещён, вызов функции нет.
--
-- 5. `messages.auto_reply_for_message_id` — ссылка, а не булев флаг. Значок «A»
--    рисуют два экрана, и оба читают сообщения одним запросом, так что признак
--    обязан лежать на самом сообщении. Ссылкой же, а не флагом, потому что она
--    заодно служит ключом идемпотентности отправки: уникальный индекс не даёт
--    отправить два автоответа на одно входящее, а повторный вызов RPC после
--    ретрая шага находит уже созданное сообщение вместо отказа.
--
-- 6. `auto_reply_runs` — журнал решений. Без него «почему клиенту не ответили»
--    выясняется только по логам Inngest, которые ротируются; в журнале же
--    видно и выбранный сценарий, и уверенность, и язык, и причину молчания.
--
-- Privacy: журнал хранит только ID, оценку и код языка — ни текста входящего,
-- ни текста ответа (§15). Всё удаляется каскадом от workspace.
--
-- Docs: docs/architecture/06-data-model.md,
--       docs/architecture/07-data-flows.md,
--       docs/architecture/08-ai-subsystem.md,
--       docs/architecture/10-ui.md

-- ---------------------------------------------------------------------------
-- 1. Форма списка примеров
-- ---------------------------------------------------------------------------

-- Массив непустых строк. Пустая строка отбрасывается формой, а не хранится:
-- пример без текста ничего не даёт классификатору и только занимает место в
-- промпте.
create or replace function private.is_text_list(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    pg_catalog.jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(value) as entry(item)
      where pg_catalog.jsonb_typeof(entry.item) <> 'string'
         or pg_catalog.btrim(entry.item #>> '{}') = ''
    );
$$;

comment on function private.is_text_list(jsonb) is
  'Форма `auto_reply_scenarios.examples`: jsonb-массив непустых строк.';

revoke all on function private.is_text_list(jsonb) from public;

-- CHECK-констрейнт вычисляется от лица того, кто пишет строку, поэтому право на
-- функцию выдаётся так же явно, как у `private.is_language_text_map`.
grant execute on function private.is_text_list(jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Шаблон как цель ссылки
-- ---------------------------------------------------------------------------

-- Композитный внешний ключ `(workspace_id, id)` — общая дисциплина схемы
-- (см. `conversations`, `messages`): он не даёт сослаться на шаблон чужого
-- workspace даже при ошибке в коде. У `reply_templates` такого уникального
-- ключа не было, потому что до сих пор на неё никто не ссылался.
alter table public.reply_templates
  add constraint reply_templates_workspace_id_key unique (workspace_id, id);

-- ---------------------------------------------------------------------------
-- 3. Настройки автоответов
-- ---------------------------------------------------------------------------

create table public.auto_reply_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique
    references public.workspaces(id) on delete cascade,
  is_enabled boolean not null default false,
  delay_minutes integer not null default 5
    constraint auto_reply_settings_delay_minutes_check
    check (delay_minutes >= 0 and delay_minutes <= 1440),
  fallback_template_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, fallback_template_id)
    references public.reply_templates(workspace_id, id)
    on delete set null (fallback_template_id)
);

comment on table public.auto_reply_settings is
  'Настройки автоответов workspace: включён ли контур, через сколько минут отвечать и каким шаблоном отвечать на сценарий «иначе».';
comment on column public.auto_reply_settings.delay_minutes is
  'Пауза между входящим и автоответом. Ноль означает «сразу»; за это время ответ оператора отменяет автоотправку.';
comment on column public.auto_reply_settings.fallback_template_id is
  'Шаблон сценария «иначе». NULL — не отвечать автоматически (значение по умолчанию).';

create index auto_reply_settings_fallback_template_idx
  on public.auto_reply_settings (workspace_id, fallback_template_id);

create trigger auto_reply_settings_set_updated_at
  before update on public.auto_reply_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Сценарии
-- ---------------------------------------------------------------------------

create table public.auto_reply_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  condition text not null default '',
  examples jsonb not null default '[]'::jsonb,
  action text not null default 'reply'
    constraint auto_reply_scenarios_action_check
    check (action in ('reply', 'ignore')),
  reply_template_id uuid,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Цель композитного внешнего ключа из журнала прогонов.
  unique (workspace_id, id),
  constraint auto_reply_scenarios_name_trimmed_check
    check (name = btrim(name)),
  constraint auto_reply_scenarios_name_length_check
    check (char_length(name) <= 120),
  constraint auto_reply_scenarios_name_characters_check
    check (name !~ '[[:cntrl:]]'),
  constraint auto_reply_scenarios_condition_length_check
    check (char_length(condition) <= 2000),
  constraint auto_reply_scenarios_examples_shape_check
    check (private.is_text_list(examples)),
  -- `jsonb_array_length` падает на не-массиве, а порядок вычисления CHECK-ов не
  -- определён, поэтому тип проверяется здесь ещё раз, а не только в функции.
  constraint auto_reply_scenarios_examples_count_check
    check (jsonb_typeof(examples) = 'array' and jsonb_array_length(examples) <= 20),
  constraint auto_reply_scenarios_examples_size_check
    check (octet_length(examples::text) <= 16384),
  -- «Не отвечать автоматически» — это `action`, а не отсутствие шаблона: NULL в
  -- ссылке появляется и сам, когда шаблон удалили, и различать «так задумано» и
  -- «конфигурация сломалась» нужно и панели, и журналу.
  constraint auto_reply_scenarios_ignore_has_no_template_check
    check (action <> 'ignore' or reply_template_id is null),
  foreign key (workspace_id, reply_template_id)
    references public.reply_templates(workspace_id, id)
    on delete set null (reply_template_id)
);

comment on table public.auto_reply_scenarios is
  'Сценарии автоответа: описание типа входящего и шаблон, которым на него отвечают. Разбираются сверху вниз по sort_order.';
comment on column public.auto_reply_scenarios.condition is
  'Условие для классификатора: чем этот тип входящих отличается от остальных. Уходит в промпт как есть.';
comment on column public.auto_reply_scenarios.examples is
  'Примеры входящих сообщений сценария — jsonb-массив строк. Уходят в промпт вместе с условием.';
comment on column public.auto_reply_scenarios.action is
  'reply — отвечать шаблоном; ignore — сценарий распознаётся, но автоответ не отправляется.';
comment on column public.auto_reply_scenarios.reply_template_id is
  'Шаблон ответа при action = reply. NULL при action = reply означает удалённый шаблон — сломанную настройку, а не молчание по замыслу.';
comment on column public.auto_reply_scenarios.sort_order is
  'Порядок разбора: сценарии перечисляются классификатору в этом порядке, и он же виден оператору в панели.';

create index auto_reply_scenarios_workspace_id_idx
  on public.auto_reply_scenarios (workspace_id);

-- Название уникально в рамках workspace без учёта регистра: оператор различает
-- сценарии по названию, и два «Цены» в списке неразличимы.
create unique index auto_reply_scenarios_workspace_lower_name_idx
  on public.auto_reply_scenarios (workspace_id, lower(name));

create index auto_reply_scenarios_workspace_sort_order_idx
  on public.auto_reply_scenarios (workspace_id, sort_order, created_at);

create index auto_reply_scenarios_reply_template_idx
  on public.auto_reply_scenarios (workspace_id, reply_template_id);

create trigger auto_reply_scenarios_set_updated_at
  before update on public.auto_reply_scenarios
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Пометка автоответа на сообщении
-- ---------------------------------------------------------------------------

-- Не булев флаг, а ссылка на входящее, ради которого автоответ отправлен.
-- Признак «это автоответ» из неё выводится (`is not null`), а сверх того она
-- закрывает главную дыру ретраев: шаг Inngest может успеть вставить сообщение и
-- упасть до того, как результат шага сохранён. На повторе та же ссылка находит
-- уже созданную строку, и `create_auto_reply_message` возвращает её id вместо
-- отказа — иначе автоответ навсегда завис бы в `pending`, ничего не отправив.
alter table public.messages
  add column auto_reply_for_message_id uuid;

comment on column public.messages.auto_reply_for_message_id is
  'Входящее, на которое это исходящее отправлено автоответчиком. NULL — сообщение отправил оператор. Основание для значка «A» и ключ идемпотентности автоотправки; на счётчик непрочитанного не влияет.';

alter table public.messages
  add constraint messages_auto_reply_direction_check
  check (direction = 'outgoing' or auto_reply_for_message_id is null);

alter table public.messages
  add constraint messages_auto_reply_for_message_id_fkey
  foreign key (workspace_id, conversation_id, auto_reply_for_message_id)
  references public.messages(workspace_id, conversation_id, id)
  on delete set null (auto_reply_for_message_id);

-- Один автоответ на входящее — правило держит схема, а не код: два прогона,
-- проснувшихся на одно и то же сообщение, дадут клиенту одну реплику.
create unique index messages_auto_reply_for_message_id_key
  on public.messages (workspace_id, conversation_id, auto_reply_for_message_id)
  where auto_reply_for_message_id is not null;

-- Список диалогов показывает значок «A» у превью последнего сообщения. Вью
-- перечисляет колонки явно (см. 20260828130000_add_thread_preview_views.sql),
-- поэтому новая колонка обязана быть добавлена здесь руками.
create or replace view public.conversation_message_previews
with (security_invoker = on) as
select distinct on (m.conversation_id)
  m.id,
  m.workspace_id,
  m.conversation_id,
  m.direction,
  m.text,
  m.attachments,
  m.delivery_status,
  m.created_at,
  m.auto_reply_for_message_id
from public.messages m
order by m.conversation_id, m.created_at desc, m.id desc;

-- ---------------------------------------------------------------------------
-- 6. Журнал решений
-- ---------------------------------------------------------------------------

create table public.auto_reply_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null,
  trigger_message_id uuid not null,
  decided_for_message_id uuid not null,
  scenario_id uuid,
  -- Копия названия: журнал обязан пережить удаление сценария, иначе разбор
  -- «почему тогда ответили так» упирается в пустую ссылку.
  scenario_name text,
  confidence smallint
    constraint auto_reply_runs_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  detected_language text
    constraint auto_reply_runs_detected_language_check
    check (detected_language is null or detected_language ~ '^[a-z]{2}(-[a-z]{2})?$'),
  template_id uuid,
  -- Ключ `reply_templates.bodies` (`ru`, `ru-2`): вариант выбирается случайно,
  -- и без записи невозможно понять, какой именно текст ушёл клиенту.
  template_body_key text,
  outcome text not null
    constraint auto_reply_runs_outcome_check
    check (outcome in (
      'sent',
      'disabled',
      'no_text',
      'below_threshold',
      'no_template',
      'template_missing',
      'no_template_language',
      'cancelled_by_operator',
      'superseded',
      'failed'
    )),
  reply_message_id uuid,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, conversation_id)
    references public.conversations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, conversation_id, trigger_message_id)
    references public.messages(workspace_id, conversation_id, id) on delete cascade,
  foreign key (workspace_id, conversation_id, decided_for_message_id)
    references public.messages(workspace_id, conversation_id, id) on delete cascade,
  foreign key (workspace_id, conversation_id, reply_message_id)
    references public.messages(workspace_id, conversation_id, id)
    on delete set null (reply_message_id),
  foreign key (workspace_id, scenario_id)
    references public.auto_reply_scenarios(workspace_id, id)
    on delete set null (scenario_id),
  foreign key (workspace_id, template_id)
    references public.reply_templates(workspace_id, id)
    on delete set null (template_id)
);

comment on table public.auto_reply_runs is
  'Журнал автоответчика: что решено по каждому входящему. Хранит только ID, оценку и код языка — ни текста входящего, ни текста ответа.';
comment on column public.auto_reply_runs.trigger_message_id is
  'Входящее, с которого начался прогон.';
comment on column public.auto_reply_runs.decided_for_message_id is
  'Входящее, по которому в итоге принято решение: клиент мог дописать, пока шло ожидание, и тогда отвечают на последнее сообщение серии.';
comment on column public.auto_reply_runs.scenario_id is
  'Распознанный сценарий; NULL вместе с пустым scenario_name — сценарий «иначе».';
comment on column public.auto_reply_runs.outcome is
  'sent — автоответ отправлен; disabled — контур выключили за время ожидания; no_text — входящее без текста; below_threshold — уверенность ниже порога; no_template — сценарий настроен не отвечать; template_missing — шаблон сценария удалён; no_template_language — язык не определён или у шаблона нет текста на нём; cancelled_by_operator — оператор ответил сам; superseded — прогон уступил более свежему; failed — прогон упал.';

create index auto_reply_runs_workspace_id_idx
  on public.auto_reply_runs (workspace_id);

-- «Что происходило по этому диалогу» — основной способ читать журнал.
create index auto_reply_runs_conversation_created_at_idx
  on public.auto_reply_runs (workspace_id, conversation_id, created_at desc);

create index auto_reply_runs_scenario_idx
  on public.auto_reply_runs (workspace_id, scenario_id);

create index auto_reply_runs_reply_message_idx
  on public.auto_reply_runs (workspace_id, reply_message_id);

create index auto_reply_runs_template_idx
  on public.auto_reply_runs (workspace_id, template_id);

-- ---------------------------------------------------------------------------
-- 7. Создание автоответа одной транзакцией
-- ---------------------------------------------------------------------------

-- Отдельная функция, а не `accept_reply_for_send`: у автоответа другая
-- семантика. Оператор, нажимая «отправить», закрывает пачку входящих — поэтому
-- та функция гасит живые черновики диалога. Автоответчик так делать не вправе:
-- набранный человеком черновик — его работа, и автоматика её не отменяет.
--
-- Решение принимается по `decided_for_message_id` — последнему входящему на
-- момент решения, а не по тому, с которого начался прогон: клиент мог дописать,
-- пока шло ожидание, и отвечать нужно на всю серию.
--
-- Всё, что может разойтись между «прочитали» и «вставили», проверяется здесь,
-- под `for update` на той же строке беседы, которую берёт
-- `accept_reply_for_send`, — то есть ручная отправка и автоответ выстраиваются
-- в очередь, а не гонятся:
--
--   1. уже есть автоответ на это же входящее — возвращаем его id. Это не
--      «повтор», а идемпотентность: шаг Inngest мог вставить сообщение и упасть
--      до сохранения результата, и на повторе прогон обязан узнать своё
--      сообщение, иначе оно навсегда останется `pending` и никуда не уйдёт;
--   2. есть исходящее не старше решения — оператор ответил сам;
--   3. есть входящее новее решения — клиент дописал уже после того, как мы
--      решили; отвечать будет прогон того сообщения.
--
-- Сравнение парой `(created_at, id)` — тот же порядок, что у превью треда
-- (20260828130000), поэтому «последнее сообщение» здесь и в интерфейсе значит
-- одно и то же даже при совпавших до микросекунды метках.
--
-- Зовёт её только Inngest-функция под service_role, поэтому право выдаётся ей
-- одной: у оператора есть `accept_reply_for_send`.
create function public.create_auto_reply_message(
  target_workspace_id uuid,
  target_conversation_id uuid,
  decided_for_message_id uuid,
  reply_text text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  outgoing_message_id uuid;
  outgoing_text text := nullif(pg_catalog.btrim(coalesce(reply_text, '')), '');
  decided_created_at timestamptz;
begin
  if outgoing_text is null then
    return null;
  end if;

  perform 1
  from public.conversations as conversation
  where conversation.workspace_id = target_workspace_id
    and conversation.id = target_conversation_id
  for update;

  if not found then
    return null;
  end if;

  select message.id
  into outgoing_message_id
  from public.messages as message
  where message.workspace_id = target_workspace_id
    and message.conversation_id = target_conversation_id
    and message.auto_reply_for_message_id = decided_for_message_id;

  if outgoing_message_id is not null then
    return outgoing_message_id;
  end if;

  select message.created_at
  into decided_created_at
  from public.messages as message
  where message.workspace_id = target_workspace_id
    and message.conversation_id = target_conversation_id
    and message.id = decided_for_message_id
    and message.direction = 'incoming';

  if decided_created_at is null then
    return null;
  end if;

  if exists (
    select 1
    from public.messages as message
    where message.workspace_id = target_workspace_id
      and message.conversation_id = target_conversation_id
      and message.direction = 'outgoing'
      and message.created_at >= decided_created_at
  ) then
    return null;
  end if;

  if exists (
    select 1
    from public.messages as message
    where message.workspace_id = target_workspace_id
      and message.conversation_id = target_conversation_id
      and message.direction = 'incoming'
      and (message.created_at, message.id) > (decided_created_at, decided_for_message_id)
  ) then
    return null;
  end if;

  insert into public.messages (
    workspace_id,
    conversation_id,
    external_id,
    direction,
    text,
    delivery_status,
    auto_reply_for_message_id
  )
  values (
    target_workspace_id,
    target_conversation_id,
    null,
    'outgoing',
    outgoing_text,
    'pending',
    decided_for_message_id
  )
  returning id into outgoing_message_id;

  return outgoing_message_id;
end;
$$;

comment on function public.create_auto_reply_message(uuid, uuid, uuid, text) is
  'Вставляет автоответ в статусе pending, если оператор не ответил сам и клиент не прислал более свежее сообщение. Повторный вызов на то же входящее возвращает уже созданное сообщение. NULL — отправлять не нужно.';

revoke all on function public.create_auto_reply_message(uuid, uuid, uuid, text)
  from public;
grant execute on function public.create_auto_reply_message(uuid, uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. Автоответ как отдельная операция в журналах AI
-- ---------------------------------------------------------------------------

-- `ai_usage` (20260726100000) и `ai_request_log` (20260803100000) перечисляют
-- операции явным CHECK-ом (прецедент расширения — 20260827100000). Писать
-- классификацию автоответа как 'classification' нельзя: дашбордная вью
-- агрегирует именно по паре (operation, surface), и расходы двух разных
-- операций слились бы в одну строку.
alter table public.ai_usage drop constraint ai_usage_operation_check;
alter table public.ai_usage add constraint ai_usage_operation_check
  check (operation in ('classification', 'draft', 'translation', 'auto_reply'));

alter table public.ai_request_log drop constraint ai_request_log_operation_check;
alter table public.ai_request_log add constraint ai_request_log_operation_check
  check (operation in ('classification', 'draft', 'translation', 'auto_reply'));

-- ---------------------------------------------------------------------------
-- 9. Доступ: Data API + RLS
-- ---------------------------------------------------------------------------

-- Настройки и сценарии правит участник workspace из панели автоответов;
-- журнал пишет Inngest под service_role, участник его только читает.
alter table public.auto_reply_settings enable row level security;
alter table public.auto_reply_scenarios enable row level security;
alter table public.auto_reply_runs enable row level security;

revoke all on table public.auto_reply_settings from anon;
revoke all on table public.auto_reply_scenarios from anon;
revoke all on table public.auto_reply_runs from anon;

grant select, insert, update, delete on table public.auto_reply_settings to authenticated;
grant select, insert, update, delete on table public.auto_reply_settings to service_role;
grant select, insert, update, delete on table public.auto_reply_scenarios to authenticated;
grant select, insert, update, delete on table public.auto_reply_scenarios to service_role;
grant select on table public.auto_reply_runs to authenticated;
grant select, insert, update, delete on table public.auto_reply_runs to service_role;

create policy auto_reply_settings_member_access
on public.auto_reply_settings
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy auto_reply_scenarios_member_access
on public.auto_reply_scenarios
for all
to authenticated
using ((select private.is_workspace_member(workspace_id)))
with check ((select private.is_workspace_member(workspace_id)));

create policy auto_reply_runs_member_read
on public.auto_reply_runs
for select
to authenticated
using ((select private.is_workspace_member(workspace_id)));
