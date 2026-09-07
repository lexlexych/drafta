-- Автоответ не повторяет сам себя: уточнение клиента уходит человеку.
--
-- Контур смотрел только на текущее входящее. Клиент получал шаблон, писал
-- уточнение — и, если уточнение попадало в тот же сценарий, ему уходил тот же
-- самый текст второй раз. Для клиента это робот, который не слышит; а сам факт
-- повторного вопроса по теме означает обратное: шаблон не помог, нужен человек.
--
-- Само правило живёт в пайплайне (`lib/inngest/functions/auto-reply-pipeline.ts`):
-- данных для него достаточно тех, что уже есть — последняя строка журнала с
-- `outcome = 'sent'` даёт сценарий и время, а `messages.auto_reply_for_message_id`
-- отличает ответ человека от автоответа. Схеме остаётся дать исходу имя.
--
-- Отдельное значение, а не `cancelled_by_operator`: там оператор ответил и
-- отправлять стало нечего, здесь никто не отвечал и диалог как раз ждёт
-- человека. В журнале это разные ситуации, и разбирать их придётся по-разному.
--
-- Docs: docs/architecture/07-data-flows.md#67-автоответ,
--       docs/architecture/06-data-model.md#auto_reply_settings-auto_reply_scenarios-auto_reply_runs

alter table public.auto_reply_runs drop constraint auto_reply_runs_outcome_check;
alter table public.auto_reply_runs add constraint auto_reply_runs_outcome_check
  check (outcome in (
    'sent',
    'disabled',
    'no_text',
    'below_threshold',
    'no_template',
    'template_missing',
    'no_template_language',
    'cancelled_by_operator',
    'repeat_scenario',
    'superseded',
    'failed'
  ));

comment on column public.auto_reply_runs.outcome is
  'sent — автоответ отправлен; disabled — контур выключили за время ожидания; no_text — входящее без текста; below_threshold — уверенность ниже порога; no_template — сценарий настроен не отвечать; template_missing — шаблон сценария удалён; no_template_language — язык не определён или у шаблона нет текста на нём; cancelled_by_operator — оператор ответил сам; repeat_scenario — тот же сценарий, что у прошлого автоответа: клиент уточняет, отвечает человек; superseded — прогон уступил более свежему; failed — прогон упал.';
