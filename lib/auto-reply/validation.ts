/**
 * Контракт настроек автоответов, общий для браузерной панели и серверных
 * экшенов (тот же приём, что у `lib/templates/validation.ts`).
 *
 * Лимиты повторяют CHECK-констрейнты `auto_reply_settings` и
 * `auto_reply_scenarios`, поэтому значение, прошедшее здесь, не может упасть на
 * стороне базы.
 */

export const MAX_SCENARIO_NAME_LENGTH = 120;
export const MAX_SCENARIO_CONDITION_LENGTH = 2000;
export const MAX_SCENARIO_EXAMPLES = 20;
export const MAX_SCENARIO_EXAMPLES_BYTES = 16 * 1024;
export const MAX_AUTO_REPLY_DELAY_MINUTES = 1440;

/**
 * Что делает сценарий, когда классификатор его выбрал.
 *
 * `ignore` — «не отвечать автоматически». Отдельное значение, а не пустая
 * ссылка на шаблон: пустой она станет и сама, если шаблон удалить, а это
 * сломанная настройка, которую панель обязана показать иначе.
 */
export type ScenarioAction = "reply" | "ignore";

export type ScenarioInput = {
  name: string;
  condition: string;
  examples: string[];
  action: ScenarioAction;
  replyTemplateId: string | null;
};

export type AutoReplySettingsInput = {
  isEnabled: boolean;
  delayMinutes: number;
  fallbackTemplateId: string | null;
};

export type AutoReplyValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Управляющие символы запрещены и в базе (`auto_reply_scenarios_name_characters_check`). */
const FORBIDDEN_NAME_CHARACTERS = /\p{Cc}/u;

export function validateScenario(
  input: ScenarioInput,
): AutoReplyValidationResult<ScenarioInput> {
  const name = input.name.trim();

  if (!name) {
    return { ok: false, error: "Введите название сценария." };
  }
  if (name.length > MAX_SCENARIO_NAME_LENGTH) {
    return {
      ok: false,
      error: `Название не должно быть длиннее ${MAX_SCENARIO_NAME_LENGTH} символов.`,
    };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return {
      ok: false,
      error: "Название не должно содержать управляющие символы.",
    };
  }

  const condition = input.condition.replace(/\r\n?/g, "\n").trim();

  if (condition.length > MAX_SCENARIO_CONDITION_LENGTH) {
    return {
      ok: false,
      error: `Условие не должно быть длиннее ${MAX_SCENARIO_CONDITION_LENGTH} символов.`,
    };
  }

  // Пустой пример не сохраняется: классификатору он ничего не даёт, а токены в
  // промпте занимает.
  const examples = input.examples
    .map((example) => example.replace(/\r\n?/g, "\n").trim())
    .filter((example) => example.length > 0);

  if (examples.length > MAX_SCENARIO_EXAMPLES) {
    return {
      ok: false,
      error: `Примеров не должно быть больше ${MAX_SCENARIO_EXAMPLES}.`,
    };
  }
  if (
    new TextEncoder().encode(JSON.stringify(examples)).length >
    MAX_SCENARIO_EXAMPLES_BYTES
  ) {
    return { ok: false, error: "Примеры слишком длинные. Максимум — 16 КБ." };
  }

  // Сценарий без условия и без примеров классификатору не отличить ни от чего:
  // он попадёт в промпт одним названием и будет выбираться наугад.
  if (!condition && examples.length === 0) {
    return {
      ok: false,
      error: "Опишите условие сценария или добавьте хотя бы один пример.",
    };
  }

  if (input.action === "ignore") {
    return {
      ok: true,
      value: { name, condition, examples, action: "ignore", replyTemplateId: null },
    };
  }

  if (!input.replyTemplateId) {
    return {
      ok: false,
      error: "Выберите шаблон ответа или «Не отвечать автоматически».",
    };
  }

  return {
    ok: true,
    value: {
      name,
      condition,
      examples,
      action: "reply",
      replyTemplateId: input.replyTemplateId,
    },
  };
}

export function validateAutoReplySettings(
  input: AutoReplySettingsInput,
): AutoReplyValidationResult<AutoReplySettingsInput> {
  const delayMinutes = Number(input.delayMinutes);

  if (!Number.isInteger(delayMinutes) || delayMinutes < 0) {
    return { ok: false, error: "Задержка должна быть целым числом минут." };
  }
  if (delayMinutes > MAX_AUTO_REPLY_DELAY_MINUTES) {
    return {
      ok: false,
      error: `Задержка не должна превышать ${MAX_AUTO_REPLY_DELAY_MINUTES} минут (сутки).`,
    };
  }

  return {
    ok: true,
    value: {
      isEnabled: input.isEnabled,
      delayMinutes,
      fallbackTemplateId: input.fallbackTemplateId || null,
    },
  };
}
