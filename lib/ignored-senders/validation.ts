/**
 * Контракт исключённого отправителя, общий для формы настроек, серверных
 * экшенов и гейта вебхука (тот же приём, что у `lib/templates/validation.ts`).
 *
 * Нормализация здесь — единственная: форма приводит к каноническому виду то,
 * что ввёл человек, а гейт — то, что прислал провайдер. Две разные реализации
 * означали бы, что список молча перестаёт срабатывать, а это худший вид отказа
 * для фичи, которая обещает «сообщение не сохранится».
 *
 * Лимиты повторяют CHECK-констрейнты `ignored_senders`, поэтому значение,
 * прошедшее здесь, не может упасть на стороне базы.
 */

export const IGNORED_SENDER_PLATFORMS = ["whatsapp", "instagram"] as const;

export type IgnoredSenderPlatform = (typeof IGNORED_SENDER_PLATFORMS)[number];

export const MAX_IGNORED_SENDER_LABEL_LENGTH = 120;
export const MAX_IGNORED_SENDERS_PER_PLATFORM = 100;

/** E.164 без «+»: код страны плюс номер. */
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

/** Instagram: латиница, цифры, точка и подчёркивание. */
const MAX_HANDLE_LENGTH = 30;

export type IgnoredSenderInput = {
  platform: IgnoredSenderPlatform;
  /** Уже нормализованный адрес — ровно в том виде, в каком лежит в БД. */
  identifier: string;
  label: string;
};

export type IgnoredSenderValidationResult =
  | { ok: true; value: IgnoredSenderInput }
  | { ok: false; error: string };

export function isIgnoredSenderPlatform(value: string): value is IgnoredSenderPlatform {
  return (IGNORED_SENDER_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Форма номера: цифры и разделители, которыми люди разбивают номер на группы.
 *
 * Проверка обязательна до «оставить только цифры». Гейт подаёт сюда в том числе
 * внутренние ID провайдера (`wa_user_60214`), и без неё такой ID превратился бы
 * в короткий номер `60214`, способный случайно совпасть с чужим исключением.
 */
const PHONE_SHAPE = /^\+?[0-9\s()\-. ]+$/;

/** «+49 151 234-56 78» → «491512345678». `null`, если это вообще не номер. */
export function normalizePhoneIdentifier(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed || !PHONE_SHAPE.test(trimmed)) {
    return null;
  }

  let digits = trimmed.replace(/\D/g, "");

  // Международный префикс набора: «0049…» — тот же номер, что и «+49…».
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Ведущий ноль остаётся только у национального формата без кода страны
  // («0151 …»), а wa_id всегда содержит код страны — сопоставить их не по чему.
  if (digits.startsWith("0")) {
    return null;
  }
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return digits;
}

const HANDLE_SHAPE = /^[a-z0-9._]+$/;
const HANDLE_URL_PREFIX = /^https?:\/\/(www\.)?instagram\.com\//i;

/** «@Lena.Fischer», «instagram.com/lena.fischer/» → «lena.fischer». */
export function normalizeHandleIdentifier(raw: string): string | null {
  let value = raw.trim();

  // Пользователи копируют ссылку на профиль так же часто, как набирают хэндл.
  value = value.replace(HANDLE_URL_PREFIX, "").replace(/\/+$/, "");
  value = value.replace(/^@+/, "").trim().toLowerCase();

  if (!value || value.length > MAX_HANDLE_LENGTH || !HANDLE_SHAPE.test(value)) {
    return null;
  }

  return value;
}

/**
 * Канонический вид адреса для платформы. `null` — «это не адрес такого вида»:
 * у формы это ошибка ввода, у гейта — просто кандидат, который не с чем
 * сравнивать.
 */
export function normalizeIgnoredSenderIdentifier(
  platform: string,
  raw: string,
): string | null {
  if (platform === "whatsapp") {
    return normalizePhoneIdentifier(raw);
  }
  if (platform === "instagram") {
    return normalizeHandleIdentifier(raw);
  }

  return null;
}

/** Управляющие символы запрещены и в базе (`ignored_senders_label_characters_check`). */
const FORBIDDEN_LABEL_CHARACTERS = /\p{Cc}/u;

export function validateIgnoredSender(input: {
  platform: string;
  identifier: string;
  label: string;
}): IgnoredSenderValidationResult {
  if (!isIgnoredSenderPlatform(input.platform)) {
    return { ok: false, error: "Исключения доступны только для WhatsApp и Instagram." };
  }

  const label = input.label.trim();

  if (label.length > MAX_IGNORED_SENDER_LABEL_LENGTH) {
    return {
      ok: false,
      error: `Имя не должно быть длиннее ${MAX_IGNORED_SENDER_LABEL_LENGTH} символов.`,
    };
  }
  if (FORBIDDEN_LABEL_CHARACTERS.test(label)) {
    return { ok: false, error: "Имя не должно содержать управляющие символы." };
  }

  const rawIdentifier = input.identifier.trim();

  if (!rawIdentifier) {
    return {
      ok: false,
      error:
        input.platform === "whatsapp"
          ? "Введите номер телефона."
          : "Введите имя пользователя Instagram.",
    };
  }

  const identifier = normalizeIgnoredSenderIdentifier(input.platform, rawIdentifier);

  if (!identifier) {
    return { ok: false, error: identifierError(input.platform, rawIdentifier) };
  }

  return { ok: true, value: { platform: input.platform, identifier, label } };
}

/** Разбор причины отказа: одна общая формулировка ничего не подсказала бы. */
function identifierError(platform: IgnoredSenderPlatform, raw: string): string {
  if (platform === "instagram") {
    if (normalizeHandleIdentifier(raw.replace(/^@+/, "").slice(0, MAX_HANDLE_LENGTH))) {
      return `Имя пользователя не должно быть длиннее ${MAX_HANDLE_LENGTH} символов.`;
    }

    return "Имя пользователя может состоять только из латинских букв, цифр, точки и подчёркивания.";
  }

  if (!PHONE_SHAPE.test(raw)) {
    return "Номер может содержать только цифры, пробелы, скобки и дефисы.";
  }

  const digits = raw.replace(/\D/g, "").replace(/^00/, "");

  if (digits.startsWith("0")) {
    return "Введите номер в международном формате, с кодом страны — например, +49 151 2345678.";
  }

  return `Номер должен содержать от ${MIN_PHONE_DIGITS} до ${MAX_PHONE_DIGITS} цифр.`;
}
