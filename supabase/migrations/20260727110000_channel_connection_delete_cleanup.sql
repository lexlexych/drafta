-- Удаление канала: чистим ссылки на него в категориях.
--
-- `categories.channel_connection_ids` — массив uuid без внешнего ключа, поэтому
-- каскад от `channel_connections` его не трогает. Оставшийся «висячий» id ломает
-- редактирование категории: `private.validate_category_channels` (миграция
-- 20260721120000) требует, чтобы каждый id массива существовал в текущем
-- workspace, и любое следующее сохранение такой категории падает с 23503.
--
-- Триггер убирает id удалённого канала из всех категорий workspace. Побочный
-- эффект по существующей семантике категорий: если у категории это был
-- единственный канал, её массив становится пустым, а пустой массив означает
-- «все каналы workspace» (`cardinality(channel_connection_ids) = 0`, см.
-- docs/architecture/09-categories.md). Иначе категория осталась бы с областью,
-- которая не совпадает ни с одним каналом.

create or replace function private.strip_deleted_channel_from_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.categories
  set channel_connection_ids =
    pg_catalog.array_remove(channel_connection_ids, old.id)
  where workspace_id = old.workspace_id
    and old.id = any(channel_connection_ids);

  return null;
end;
$$;

create trigger channel_connections_strip_from_categories
after delete on public.channel_connections
for each row
execute function private.strip_deleted_channel_from_categories();
