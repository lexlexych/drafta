import { describe, expect, it } from "vitest";
import { getRun, start } from "workflow/api";

import {
  cancellableWorkflow,
  compensatingWorkflow,
  retryingWorkflow,
} from "./__fixtures__/runtime-contracts";

/**
 * Контракты рантайма, на которых держится вся архитектура прогонов: ретраи,
 * `FatalError`, компенсация в `catch`, освобождение лизы в `finally` и внешняя
 * отмена. Если что-то из этого перестанет выполняться, поведение разойдётся с
 * docs/architecture/18-workflows.md, и разойдётся молча.
 */

describe("step retries", () => {
  it("retries a step until it succeeds", async () => {
    const run = await start(retryingWorkflow, []);

    // Третья попытка — то есть исходный вызов плюс два ретрая.
    expect(await run.returnValue).toBe(3);
    expect(await run.status).toBe("completed");
  });

  it("stops at maxRetries and lets the error reach the workflow body", async () => {
    const run = await start(compensatingWorkflow, ["exhausted"]);

    // maxRetries = 2 → последняя попытка третья. Это и заменяет onFailure:
    // компенсация видит исчерпанные ретраи, а finally всё равно отрабатывает.
    // Рантайм оборачивает исчерпанную ошибку пояснением, сохраняя исходный
    // текст, — в отличие от FatalError ниже, который доезжает дословно.
    const trace = (await run.returnValue) as string[];
    expect(trace[0]).toContain("failed after 2 retries");
    expect(trace[0]).toContain("broken at attempt 3");
    expect(trace[1]).toBe("released");
  });
});

describe("FatalError", () => {
  it("skips retries entirely and still runs the compensation", async () => {
    const run = await start(compensatingWorkflow, ["fatal"]);

    expect(await run.returnValue).toEqual([
      "compensated: rejected at attempt 1",
      "released",
    ]);
  });
});

describe("run cancellation", () => {
  it("cancels a suspended run, which is what «стоп» relies on", async () => {
    const run = await start(cancellableWorkflow, []);

    await getRun(run.runId).cancel();

    expect(await getRun(run.runId).status).toBe("cancelled");
    await expect(getRun(run.runId).returnValue).rejects.toThrow();
  });
});
