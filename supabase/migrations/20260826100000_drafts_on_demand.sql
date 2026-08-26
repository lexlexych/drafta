-- Черновики DM только по запросу оператора.
--
-- Раньше черновик рождался сам: вебхук эмитил `interaction/received`, прогон
-- Inngest выжидал окно дебаунса (`ai_settings.debounce_seconds`) и, если
-- `ai_settings.auto_generate_dm` не выключен, звал LLM. Теперь генерацию
-- запускает только значок AI в поле ввода треда
-- (docs/architecture/07-data-flows.md#62-генерация-черновика), поэтому:
--
--   1. настройки дебаунса и автогенерации, а также опубликованный дедлайн
--      обратного отсчёта (`conversations.draft_debounce_until`) больше не
--      нужны — колонок не остаётся;
--   2. у черновика появляется терминальный статус `failed`: поле ввода
--      заблокировано на время генерации и узнаёт о сдавшемся прогоне через
--      realtime-подписку на `drafts`, а та умеет только INSERT/UPDATE —
--      в payload DELETE нет `workspace_id`, по которому фильтруется канал;
--   3. `accept_reply_for_send` перестаёт затирать переданный текст текстом
--      черновика: оператор правит черновик прямо в поле ввода, и уходить
--      должно именно то, что он видит. Черновик при этом всё равно
--      закрывается как `sent`, а не `superseded` — «черновиком
--      воспользовались» остаётся видно в данных.

-- ---------------------------------------------------------------------------
-- 1. Настройки дебаунса и автогенерации
-- ---------------------------------------------------------------------------

alter table public.ai_settings
  drop column debounce_seconds;

alter table public.ai_settings
  drop column auto_generate_dm;

alter table public.conversations
  drop column draft_debounce_until;

-- ---------------------------------------------------------------------------
-- 2. drafts.status: терминальный `failed`
-- ---------------------------------------------------------------------------

alter table public.drafts
  drop constraint drafts_status_check;

alter table public.drafts
  add constraint drafts_status_check
  check (
    status in (
      'generating',
      'ready',
      'edited',
      'sent',
      'discarded',
      'superseded',
      'failed'
    )
  );

comment on column public.drafts.status is
  'generating → ready | failed; ready/edited → sent | discarded | superseded. '
  '`failed` ставит onFailure функции generate-draft, когда прогон исчерпал '
  'ретраи: поле ввода треда снимает блокировку по этому UPDATE.';

-- ---------------------------------------------------------------------------
-- 3. accept_reply_for_send: явный текст побеждает
-- ---------------------------------------------------------------------------

create or replace function public.accept_reply_for_send(
  target_workspace_id uuid,
  target_conversation_id uuid,
  reply_text text,
  target_draft_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  outgoing_message_id uuid;
  outgoing_text text := nullif(trim(coalesce(reply_text, '')), '');
  draft_text text;
begin
  perform 1
  from public.conversations as conversation
  where conversation.workspace_id = target_workspace_id
    and conversation.id = target_conversation_id
  for update;

  if not found then
    return null;
  end if;

  -- Черновик, из которого взят текст, закрывается как использованный. Если он
  -- уже не активен (успели отклонить в другой вкладке), отправку это не
  -- отменяет: текст оператора важнее судьбы строки черновика.
  if target_draft_id is not null then
    update public.drafts as draft
    set status = 'sent',
        updated_at = now()
    where draft.workspace_id = target_workspace_id
      and draft.conversation_id = target_conversation_id
      and draft.id = target_draft_id
      and draft.status in ('ready', 'edited')
    returning nullif(trim(draft.text), '') into draft_text;

    -- `returning ... into` обнуляет цель, когда обновлять было нечего, поэтому
    -- текст черновика идёт через отдельную переменную.
    if outgoing_text is null then
      outgoing_text := draft_text;
    end if;
  end if;

  if outgoing_text is null then
    return null;
  end if;

  update public.drafts as draft
  set status = 'superseded',
      updated_at = now()
  where draft.workspace_id = target_workspace_id
    and draft.conversation_id = target_conversation_id
    and (target_draft_id is null or draft.id <> target_draft_id)
    and draft.status in ('ready', 'edited');

  insert into public.messages (
    workspace_id,
    conversation_id,
    external_id,
    direction,
    text,
    delivery_status
  )
  values (
    target_workspace_id,
    target_conversation_id,
    null,
    'outgoing',
    outgoing_text,
    'pending'
  )
  returning id into outgoing_message_id;

  return outgoing_message_id;
end;
$$;
