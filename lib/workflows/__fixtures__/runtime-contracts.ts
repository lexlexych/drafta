import { FatalError, getStepMetadata, sleep } from "workflow";

/**
 * Фикстуры для интеграционных тестов рантайма
 * (`../runtime-contracts.integration.test.ts`). Живут отдельным модулем, потому
 * что плагин собирает workflow-функции в собственный бандл: всё, что лежит в
 * одном файле с ними, уезжает туда же — включая сам `vitest`, если тест-файл
 * заодно и объявляет прогоны.
 *
 * Шаги ничего не пишут наружу и не держат состояние в модуле: они исполняются
 * из отдельно собранного бандла, поэтому наблюдать за ними можно только через
 * возвращаемые значения и ошибки, которые идут через event log.
 */

async function flakyStep(): Promise<number> {
  "use step";
  const { attempt } = getStepMetadata();
  if (attempt < 3) {
    throw new Error(`transient at attempt ${attempt}`);
  }
  return attempt;
}
flakyStep.maxRetries = 4;

async function alwaysFailingStep(): Promise<never> {
  "use step";
  const { attempt } = getStepMetadata();
  throw new Error(`broken at attempt ${attempt}`);
}
alwaysFailingStep.maxRetries = 2;

async function fatalStep(): Promise<never> {
  "use step";
  const { attempt } = getStepMetadata();
  throw new FatalError(`rejected at attempt ${attempt}`);
}
fatalStep.maxRetries = 4;

async function finishSlowly(): Promise<string> {
  "use step";
  return "done";
}

export async function retryingWorkflow(): Promise<number> {
  "use workflow";
  return flakyStep();
}

/** Форма всех перенесённых отправок: ретраи → catch-компенсация → finally. */
export async function compensatingWorkflow(
  mode: "fatal" | "exhausted",
): Promise<string[]> {
  "use workflow";

  const trace: string[] = [];
  try {
    await (mode === "fatal" ? fatalStep() : alwaysFailingStep());
    trace.push("no-error");
  } catch (error) {
    trace.push(`compensated: ${(error as Error).message}`);
  } finally {
    trace.push("released");
  }
  return trace;
}

/** Форма generate-draft: длинный прогон, который снимают снаружи. */
export async function cancellableWorkflow(): Promise<string> {
  "use workflow";
  await sleep("30s");
  return finishSlowly();
}
