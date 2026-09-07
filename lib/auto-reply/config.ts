/**
 * Порог уверенности классификатора.
 *
 * Живёт в окружении, а не в настройках workspace: это предохранитель всей
 * установки, а не бизнес-настройка одного тенанта, и подкручивают его по
 * распределению из журнала `auto_reply_runs`, а не из панели.
 *
 * Модуль чистый — ни `server-only`, ни импортов: значение читают и пайплайн, и
 * его тесты.
 */

export const DEFAULT_AUTO_REPLY_MIN_CONFIDENCE = 75;

/**
 * Уверенность (0..100), ниже которой автоответ не уходит.
 *
 * Мусор в переменной — это дефолт, а не падение: контур, который молчит из-за
 * опечатки в `.env`, отлаживать куда дольше, чем прочитать предупреждение. А вот
 * ноль или сто, заданные явно, остаются как есть: «отвечать всегда» и «не
 * отвечать никогда» — законные крайности.
 */
export function getAutoReplyMinConfidence(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.AUTO_REPLY_MIN_CONFIDENCE;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_AUTO_REPLY_MIN_CONFIDENCE;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    console.error(
      `[auto-reply] AUTO_REPLY_MIN_CONFIDENCE="${raw}" is not a number between 0 and 100; falling back to ${DEFAULT_AUTO_REPLY_MIN_CONFIDENCE}`,
    );
    return DEFAULT_AUTO_REPLY_MIN_CONFIDENCE;
  }

  return parsed;
}
