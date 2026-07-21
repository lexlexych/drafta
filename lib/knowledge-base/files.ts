export const MAX_KNOWLEDGE_FILE_BYTES = 512 * 1024;
export const MAX_KNOWLEDGE_FILE_NAME_LENGTH = 120;

export type MarkdownFileValidationResult =
  | { ok: true; name: string; content: string }
  | { ok: false; error: string };

/**
 * Keeps the browser upload flow and server actions on the same contract.
 * Names without an extension get `.md`; a different extension is rejected.
 */
export function normalizeMarkdownFileName(value: string): string {
  const name = value.trim();

  if (!name || name.toLowerCase().endsWith(".md")) {
    return name;
  }

  return name.includes(".") ? name : `${name}.md`;
}

export function validateMarkdownFile(
  rawName: string,
  rawContent: string,
): MarkdownFileValidationResult {
  const name = normalizeMarkdownFileName(rawName);
  const content = rawContent.replace(/\r\n?/g, "\n");

  if (!name) {
    return { ok: false, error: "Введите имя файла." };
  }
  if (name.length > MAX_KNOWLEDGE_FILE_NAME_LENGTH) {
    return {
      ok: false,
      error: `Имя файла не должно быть длиннее ${MAX_KNOWLEDGE_FILE_NAME_LENGTH} символов.`,
    };
  }
  if (/[\\/\u0000-\u001f\u007f]/u.test(name)) {
    return { ok: false, error: "Имя файла содержит недопустимые символы." };
  }
  if (!name.toLowerCase().endsWith(".md")) {
    return { ok: false, error: "Можно добавлять только файлы Markdown (.md)." };
  }
  if (new TextEncoder().encode(content).length > MAX_KNOWLEDGE_FILE_BYTES) {
    return {
      ok: false,
      error: "Файл слишком большой. Максимальный размер — 512 КБ.",
    };
  }

  return { ok: true, name, content };
}
