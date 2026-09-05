import "server-only";

import { FatalError, getWorkflowMetadata, sleep } from "workflow";

import { createAdminSupabaseClient } from "@/lib/db/admin";

/**
 * Ограничение конкурентности прогонов.
 *
 * В Workflow SDK нативного примитива нет: `lock()` заявлен в план v6, а до него
 * официальная рекомендация — принести свой семафор поверх общего хранилища.
 * Общее хранилище проекта одно, Supabase, поэтому слоты живут в
 * `public.workflow_leases` (миграция 20260905100000), а здесь — тонкая обвязка:
 * шаги захвата/освобождения и ожидание свободного слота через `sleep()`.
 *
 * ВРЕМЕННОЕ РЕШЕНИЕ: когда выйдет нативный `lock()`, этот модуль заменяется на
 * вызов примитива, а таблица и RPC удаляются. См.
 * docs/architecture/18-workflows.md.
 */

export type Lease = {
  /** `workspace:<uuid>`, `conversation:<uuid>`, `post:<uuid>`, `cron:<имя>`. */
  key: string;
  /** Сколько прогонов держат ключ одновременно. */
  limit: number;
  /**
   * Через сколько слот освободится сам, если прогон умер, не дойдя до
   * `release`. Должен с запасом перекрывать самое долгое удержание: отменённый
   * через `run.cancel()` прогон останавливается на границе шага и до `finally`
   * не доходит.
   */
  ttlSeconds: number;
  /** Null для глобальных ключей кронов — у них воркспейса нет. */
  workspaceId: string | null;
};

/**
 * Сколько ждать освобождения слота, прежде чем сдаться. Ожидание идёт через
 * `sleep()` — оно не тратит компьют, но каждая итерация пишет события в лог
 * прогона, поэтому пауза растёт: частые опросы нужны только в начале, когда
 * слот, скорее всего, вот-вот освободится.
 */
const WAIT_SCHEDULE_SECONDS = [2, 2, 2, 5, 5, 5, 10] as const;
const DEFAULT_MAX_WAIT_ATTEMPTS = 40;

function waitSeconds(attempt: number): number {
  return (
    WAIT_SCHEDULE_SECONDS[attempt] ??
    WAIT_SCHEDULE_SECONDS[WAIT_SCHEDULE_SECONDS.length - 1]
  );
}

/**
 * Захват идемпотентен по holder=runId: ретрай шага продлевает уже занятый слот,
 * а не забирает второй, поэтому шаг безопасно перезапускать.
 */
async function acquireLeaseSlot(lease: Lease): Promise<boolean> {
  "use step";

  const { workflowRunId } = getWorkflowMetadata();
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("acquire_workflow_lease", {
    p_key: lease.key,
    p_limit: lease.limit,
    p_holder: workflowRunId,
    p_ttl_seconds: lease.ttlSeconds,
    p_workspace_id: lease.workspaceId,
  });

  if (error) {
    throw new Error(
      `Acquiring the workflow lease ${lease.key} failed${
        error.code ? ` (${error.code})` : ""
      }.`,
    );
  }

  return data === true;
}

async function releaseLeaseSlot(key: string): Promise<void> {
  "use step";

  const { workflowRunId } = getWorkflowMetadata();
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.rpc("release_workflow_lease", {
    p_key: key,
    p_holder: workflowRunId,
  });

  if (error) {
    // Освобождение — оптимизация: слот всё равно протухнет по TTL, и ронять
    // из-за этого уже сделанную работу незачем.
    console.error(`[workflow] failed to release lease ${key}`, error);
  }
}

/**
 * Ждёт свободный слот и занимает его. Несколько лиз захватываются строго в
 * переданном порядке — одинаковый порядок у всех вызывающих исключает
 * взаимную блокировку. Если один из ключей так и не освободился, уже занятые
 * слоты этого набора отпускаются, а прогон падает: держать половину набора
 * нельзя, это заблокировало бы остальных.
 */
export async function acquireLeases(
  leases: readonly Lease[],
  maxWaitAttempts: number = DEFAULT_MAX_WAIT_ATTEMPTS,
): Promise<void> {
  const acquired: string[] = [];

  for (const lease of leases) {
    let ok = false;

    for (let attempt = 0; attempt <= maxWaitAttempts; attempt++) {
      if (await acquireLeaseSlot(lease)) {
        ok = true;
        break;
      }
      // После последней попытки не спим: ждать больше нечего, и лишняя пауза
      // только оттянула бы падение прогона.
      if (attempt < maxWaitAttempts) {
        await sleep(`${waitSeconds(attempt)}s`);
      }
    }

    if (!ok) {
      for (const key of acquired) {
        await releaseLeaseSlot(key);
      }
      throw new FatalError(
        `Timed out waiting for the workflow lease ${lease.key}.`,
      );
    }

    acquired.push(lease.key);
  }
}

/** Освобождает набор лиз. Безопасно вызывать, даже если слот уже протух. */
export async function releaseLeases(leases: readonly Lease[]): Promise<void> {
  for (const lease of leases) {
    await releaseLeaseSlot(lease.key);
  }
}

// ---------------------------------------------------------------------------
// Конструкторы ключей и их лимиты.
// ---------------------------------------------------------------------------

/**
 * Бюджет LLM воркспейса: сколько генераций одного тенанта идут параллельно.
 * Ограничивает, сколько оператор может сжечь, мышкой по значку AI.
 */
export function workspaceLlmLease(workspaceId: string): Lease {
  return {
    key: `workspace:${workspaceId}`,
    limit: 2,
    ttlSeconds: 600,
    workspaceId,
  };
}

/** Бюджет внешних отправок воркспейса. */
export function workspaceSendLease(workspaceId: string): Lease {
  return {
    key: `workspace-send:${workspaceId}`,
    limit: 2,
    ttlSeconds: 300,
    workspaceId,
  };
}

/** Web Push шире остальных отправок: лёгкий вызов, четыре параллельно. */
export function workspacePushLease(workspaceId: string): Lease {
  return {
    key: `workspace-push:${workspaceId}`,
    limit: 4,
    ttlSeconds: 120,
    workspaceId,
  };
}

/** Взаимоисключение по сущности: один прогон на переписку/пост/личность. */
export function entityLease(
  kind: "conversation" | "post" | "contact-identity",
  id: string,
  workspaceId: string,
  ttlSeconds = 300,
): Lease {
  return { key: `${kind}:${id}`, limit: 1, ttlSeconds, workspaceId };
}

/** Синглтон крона: пока прогон жив, следующий тик уходит ни с чем. */
export function cronLease(name: string, ttlSeconds: number): Lease {
  return { key: `cron:${name}`, limit: 1, ttlSeconds, workspaceId: null };
}
