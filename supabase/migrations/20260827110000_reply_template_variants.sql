-- Несколько вариантов текста шаблона на один язык.
--
-- Шаблоны ответов (20260826110000_reply_templates.sql) хранят тексты в
-- `bodies jsonb`, где ключом был ровно код языка. Значит, на русском у шаблона
-- могла быть только одна формулировка. Под постом это заметно: десять
-- одинаковых дословных ответов подряд читаются как спам, оператору нужны
-- вариации одной и той же мысли на одном языке.
--
-- Ключ становится «язык + номер записи»: `ru` — первый вариант, `ru-2`,
-- `ru-3`, … — следующие. Первый вариант остаётся голым кодом языка, поэтому
-- все уже сохранённые строки валидны и переписывать данные не нужно.
--
-- Меняется только форма ключа, то есть одна функция; таблица, констрейнты,
-- индексы и политики остаются как были. Имя `is_language_text_map` не трогаем:
-- оно зашито в `reply_templates_bodies_shape_check`, и переименование ради
-- косметики потребовало бы снести и пересоздать констрейнт.
--
-- Docs: docs/architecture/06-data-model.md#reply_templates,
--       docs/architecture/10-ui.md (Разделы настроек)

-- Ветка `[a-z]{2}` в суффиксе сохраняется намеренно: старые значения и локали
-- вида `pt-br` остаются валидными, и миграция ничего не ломает. Номер варианта
-- начинается с 2 — вариант 1 это голый код языка, `ru-1` быть не должно.
-- Потолок в 99 вариантов задаётся самой формой, отдельного лимита не нужно.
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
         or entry.key !~ '^[a-z]{2}(-([a-z]{2}|[2-9]|[1-9][0-9]))?$'
    );
$$;

comment on function private.is_language_text_map(jsonb) is
  'Форма `reply_templates.bodies`: объект, значения — строки, ключ — код языка с необязательным номером варианта (ru, ru-2, ru-3). Конкретный список языков проверяет lib/i18n/template-languages.ts.';

-- `create or replace` сохраняет права, но повторяем их явно: миграция должна
-- читаться самостоятельно, а не отсылать к соседнему файлу.
revoke all on function private.is_language_text_map(jsonb) from public;
grant execute on function private.is_language_text_map(jsonb)
  to authenticated, service_role;
