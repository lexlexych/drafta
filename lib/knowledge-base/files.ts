export const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;
export const MAX_KNOWLEDGE_FILE_NAME_LENGTH = 120;

export type CategoryValidationResult =
  | { ok: true; name: string; content: string }
  | { ok: false; error: string };

/**
 * Slashes and control characters mirror the `kb_files_name_characters_check`
 * constraint; the comma is ours — it separates names in the `CATEGORIES:` line
 * the model returns, so a name containing one could not be resolved back.
 */
const FORBIDDEN_NAME_CHARACTERS = /[\\/,]|\p{Cc}/u;

/**
 * Keeps the browser editor and the server actions on the same contract.
 *
 * A category is edited in the app and never uploaded, so its name is a human
 * title («Прайс и доставка»), not a file name: no extension is added or
 * required. The limits mirror the `kb_files` constraints, so a value that
 * passes here cannot fail on the database side.
 */
export function validateCategory(
  rawName: string,
  rawContent: string,
): CategoryValidationResult {
  const name = rawName.trim();
  const content = rawContent.replace(/\r\n?/g, "\n");

  if (!name) {
    return { ok: false, error: "Введите название категории." };
  }
  if (name.length > MAX_KNOWLEDGE_FILE_NAME_LENGTH) {
    return {
      ok: false,
      error: `Название не должно быть длиннее ${MAX_KNOWLEDGE_FILE_NAME_LENGTH} символов.`,
    };
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) {
    return {
      ok: false,
      error: "Название не должно содержать запятую и символы / \\.",
    };
  }
  if (new TextEncoder().encode(content).length > MAX_KNOWLEDGE_FILE_BYTES) {
    return {
      ok: false,
      error: "Описание слишком большое. Максимальный размер — 512 КБ.",
    };
  }

  return { ok: true, name, content };
}
