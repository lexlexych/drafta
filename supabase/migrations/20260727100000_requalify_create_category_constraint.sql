-- Restore the qualified constraint name inside create_category.
--
-- Миграция 20260721121000 уже чинила это: внутри функций с `search_path = ''`
-- команда `set constraints categories_workspace_priority_key deferred` не может
-- разрешить имя ограничения и падает с 42704 «constraint does not exist».
-- Позже 20260725110000 и 20260725120000 пересоздали create_category с новой
-- сигнатурой и вернули неквалифицированное имя, потому что исправление жило
-- только в развёрнутом определении функции, но не в исходниках миграций.
-- Здесь функция переписывается целиком с `public.`-квалификацией, чтобы
-- правильная версия находилась обычным grep'ом по репозиторию.

create or replace function public.create_category(
  target_workspace_id uuid,
  category_name text,
  category_description text,
  category_draft_instruction text default null,
  category_channel_connection_ids uuid[] default '{}'::uuid[],
  category_skip_draft boolean default false,
  category_kb_file_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := pg_catalog.btrim(category_name);
  normalized_description text := pg_catalog.btrim(category_description);
  normalized_instruction text := nullif(pg_catalog.btrim(category_draft_instruction), '');
  normalized_channel_ids uuid[];
  normalized_kb_file_ids uuid[];
  default_priority integer;
  new_category_id uuid;
begin
  if not (select private.is_workspace_member(target_workspace_id)) then
    raise exception using errcode = '42501', message = 'Workspace access denied';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception using errcode = '22023', message = 'Category name is required';
  end if;
  if normalized_description is null or normalized_description = '' then
    raise exception using errcode = '22023', message = 'Category description is required';
  end if;

  select coalesce(array_agg(distinct channel_id), '{}'::uuid[])
  into normalized_channel_ids
  from unnest(coalesce(category_channel_connection_ids, '{}'::uuid[]))
    as requested(channel_id);

  perform private.validate_category_channels(
    target_workspace_id,
    normalized_channel_ids
  );

  -- NULL must survive normalization: it means "inherit kb_files.is_enabled",
  -- which is a different instruction from the empty array.
  if category_kb_file_ids is null then
    normalized_kb_file_ids := null;
  else
    select coalesce(array_agg(distinct kb_file_id), '{}'::uuid[])
    into normalized_kb_file_ids
    from unnest(category_kb_file_ids) as requested(kb_file_id);
  end if;

  perform private.validate_category_kb_files(
    target_workspace_id,
    normalized_kb_file_ids
  );

  perform 1
  from public.categories
  where workspace_id = target_workspace_id
  order by priority
  for update;

  select priority
  into default_priority
  from public.categories
  where workspace_id = target_workspace_id
    and is_default
  for update;

  if default_priority is null then
    raise exception using errcode = '23514', message = 'Default category is missing';
  end if;

  -- The constraint name must stay schema-qualified: this function runs with an
  -- empty search_path, so an unqualified name raises 42704.
  set constraints public.categories_workspace_priority_key deferred;

  update public.categories
  set priority = priority + 1,
      updated_at = now()
  where workspace_id = target_workspace_id
    and is_default;

  insert into public.categories (
    workspace_id,
    name,
    description,
    draft_instruction,
    channel_connection_ids,
    skip_draft,
    kb_file_ids,
    priority,
    is_default
  ) values (
    target_workspace_id,
    normalized_name,
    normalized_description,
    normalized_instruction,
    normalized_channel_ids,
    category_skip_draft,
    normalized_kb_file_ids,
    default_priority,
    false
  )
  returning id into new_category_id;

  return new_category_id;
end;
$$;

-- delete_category и reorder_categories не пересоздавались после 20260721121000,
-- поэтому в БД у них уже квалифицированное имя. Проверяем это явно, чтобы
-- миграция падала здесь, а не в рантайме, если инвариант когда-нибудь нарушат.
do $migration$
declare
  target_function regprocedure;
  unqualified_statement constant text :=
    'set constraints categories_workspace_priority_key deferred';
begin
  foreach target_function in array array[
    'public.create_category(uuid,text,text,text,uuid[],boolean,uuid[])'::regprocedure,
    'public.delete_category(uuid,uuid)'::regprocedure,
    'public.reorder_categories(uuid,uuid[])'::regprocedure
  ] loop
    if pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(target_function::oid),
      unqualified_statement
    ) > 0 then
      raise exception using
        errcode = '42704',
        message = pg_catalog.format(
          'Unqualified SET CONSTRAINTS left in %s',
          target_function::text
        );
    end if;
  end loop;
end;
$migration$;
