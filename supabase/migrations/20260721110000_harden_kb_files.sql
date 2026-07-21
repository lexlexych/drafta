alter table public.kb_files
  add constraint kb_files_name_trimmed_check
    check (name = btrim(name)),
  add constraint kb_files_name_length_check
    check (char_length(name) <= 120),
  add constraint kb_files_markdown_name_check
    check (lower(name) like '%.md'),
  add constraint kb_files_name_characters_check
    check (name !~ '[\\/]' and name !~ '[[:cntrl:]]'),
  add constraint kb_files_content_size_check
    check (octet_length(content) <= 524288);

create unique index kb_files_workspace_lower_name_idx
  on public.kb_files (workspace_id, lower(name));

create index kb_files_workspace_sort_order_idx
  on public.kb_files (workspace_id, sort_order, created_at);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger kb_files_set_updated_at
before update on public.kb_files
for each row execute function private.set_updated_at();
