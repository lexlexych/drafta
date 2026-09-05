-- public.workflow_leases — ограничение конкурентности прогонов workflow.
--
-- Нативного примитива конкурентности в Workflow SDK нет: `lock()` заявлен в план
-- v6, а до него официальная рекомендация — «принесите свою конкурентность»,
-- то есть собственный семафор поверх общего хранилища. Единственное общее
-- хранилище проекта — Supabase, поэтому семафор живёт здесь.
--
-- Модель: на ключ заведено ровно `limit` слотов, слот занимается вставкой
-- строки. Гонка двух прогонов за один слот разрешается первичным ключом
-- (key, slot) — проигравший берёт следующий свободный, а если свободных нет,
-- получает `false` и ждёт в теле workflow через `sleep()`. Перезанять слот
-- сверх лимита невозможно ни при какой гонке; в худшем случае прогон подождёт
-- лишний цикл.
--
-- `expires_at` (TTL) страхует от прогонов, которые умерли, не освободив слот:
-- отменённый через `run.cancel()` прогон останавливается на границе шага, и
-- блок `finally` в теле workflow до освобождения может не дойти. Просроченные
-- слоты вычищаются при следующей попытке захвата того же ключа.
--
-- ВРЕМЕННОЕ РЕШЕНИЕ: когда в Workflow SDK появится нативный `lock()`, эта
-- таблица и обе функции удаляются, а `lib/workflows/leases.ts` заменяется на
-- вызов примитива. См. docs/architecture/18-workflows.md.
--
-- Docs: docs/architecture/18-workflows.md, docs/architecture/07-data-flows.md

create table public.workflow_leases (
  -- Ключ конкурентности: `workspace:<uuid>`, `conversation:<uuid>`,
  -- `post:<uuid>`, `contact-identity:<uuid>`, `cron:<имя>`.
  key text not null check (length(btrim(key)) > 0),
  slot smallint not null check (slot >= 0),
  -- Nullable, и это осознанное отступление от правила 3 («каждая новая таблица
  -- сразу с workspace_id»): синглтон-лизы кронов (`cron:push-digest`,
  -- `cron:cleanup-ai-request-log`) глобальные и воркспейса не имеют. Там, где
  -- воркспейс есть, каскад от него удаляет висящие слоты вместе с тенантом.
  workspace_id uuid references public.workspaces(id) on delete cascade,
  -- runId прогона-владельца (`wrun_…`). Захват идемпотентен по holder: ретрай
  -- шага не занимает второй слот, а продлевает уже занятый.
  holder text not null check (length(btrim(holder)) > 0),
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  primary key (key, slot)
);

comment on table public.workflow_leases is
  'Семафор конкурентности workflow-прогонов: временная замена нативного lock(), которого в Workflow SDK пока нет. Пишется только под service role.';

-- Захват слота идемпотентен по holder, поэтому нужен быстрый поиск «есть ли уже
-- слот у этого прогона» в пределах ключа.
create index workflow_leases_key_holder_idx
  on public.workflow_leases (key, holder);

alter table public.workflow_leases enable row level security;

-- Таблица служебная: её не читает ни один экран, только серверные шаги под
-- service role (который RLS обходит). Политик нет по той же причине, что у
-- ai_request_log и webhook_events — ни у одной другой роли нет и грантов.
revoke all on table public.workflow_leases from anon;
revoke all on table public.workflow_leases from authenticated;

grant select, insert, update, delete on table public.workflow_leases to service_role;

-- ---------------------------------------------------------------------------
-- acquire_workflow_lease — занять слот под ключом или честно ответить «занято»
-- ---------------------------------------------------------------------------

create or replace function public.acquire_workflow_lease(
  p_key text,
  p_limit integer,
  p_holder text,
  p_ttl_seconds integer,
  p_workspace_id uuid default null
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_slot integer;
  v_expires timestamptz := clock_timestamp() + make_interval(secs => p_ttl_seconds);
begin
  if p_limit < 1 then
    raise exception 'workflow lease limit must be >= 1, got %', p_limit;
  end if;

  if p_ttl_seconds < 1 then
    raise exception 'workflow lease ttl must be >= 1s, got %', p_ttl_seconds;
  end if;

  -- Слоты умерших прогонов освобождаются лениво: чистим только тот ключ, за
  -- который сейчас борются, — это дешевле фонового сборщика и не требует крона.
  delete from public.workflow_leases
   where key = p_key
     and expires_at <= clock_timestamp();

  -- Идемпотентность: тот же прогон, пришедший повторно (ретрай шага, реплей),
  -- продлевает свой слот вместо захвата второго.
  update public.workflow_leases
     set expires_at = v_expires
   where key = p_key
     and holder = p_holder;

  if found then
    return true;
  end if;

  for v_slot in 0 .. p_limit - 1 loop
    begin
      insert into public.workflow_leases (key, slot, workspace_id, holder, expires_at)
      values (p_key, v_slot, p_workspace_id, p_holder, v_expires);
      return true;
    exception when unique_violation then
      -- Слот занят — возможно, конкурентом, вставившимся между проверкой и
      -- вставкой. Пробуем следующий; лимит при этом не превышается никогда.
      null;
    end;
  end loop;

  return false;
end;
$$;

comment on function public.acquire_workflow_lease(text, integer, text, integer, uuid) is
  'Занимает свободный слот под ключом (0..limit-1) для holder=runId. true — слот наш, false — все слоты заняты живыми прогонами.';

-- ---------------------------------------------------------------------------
-- release_workflow_lease — освободить слот
-- ---------------------------------------------------------------------------

create or replace function public.release_workflow_lease(
  p_key text,
  p_holder text
) returns void
language sql
set search_path = ''
as $$
  delete from public.workflow_leases
   where key = p_key
     and holder = p_holder;
$$;

comment on function public.release_workflow_lease(text, text) is
  'Освобождает слот прогона. Безопасна при повторном вызове и при уже истёкшем TTL.';

revoke all on function public.acquire_workflow_lease(text, integer, text, integer, uuid) from public;
revoke all on function public.release_workflow_lease(text, text) from public;

grant execute on function public.acquire_workflow_lease(text, integer, text, integer, uuid) to service_role;
grant execute on function public.release_workflow_lease(text, text) to service_role;
