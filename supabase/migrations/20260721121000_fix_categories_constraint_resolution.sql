-- Category mutation RPCs deliberately use an empty search_path. Qualify the
-- deferrable unique constraint so SET CONSTRAINTS can resolve it at runtime.
-- Rebuild the deployed functions from PostgreSQL's canonical definitions to
-- avoid duplicating their bodies in a corrective migration.

do $migration$
declare
  target_function regprocedure;
  function_definition text;
  unqualified_statement constant text :=
    'set constraints categories_workspace_priority_key deferred';
  qualified_statement constant text :=
    'set constraints public.categories_workspace_priority_key deferred';
begin
  foreach target_function in array array[
    'public.create_category(uuid,text,text,text,uuid[],text,boolean)'::regprocedure,
    'public.delete_category(uuid,uuid)'::regprocedure,
    'public.reorder_categories(uuid,uuid[])'::regprocedure
  ] loop
    function_definition := pg_catalog.pg_get_functiondef(target_function::oid);

    if pg_catalog.strpos(function_definition, unqualified_statement) = 0 then
      raise exception using
        errcode = '42704',
        message = pg_catalog.format(
          'Expected SET CONSTRAINTS statement was not found in %s',
          target_function::text
        );
    end if;

    execute pg_catalog.replace(
      function_definition,
      unqualified_statement,
      qualified_statement
    );
  end loop;
end;
$migration$;
