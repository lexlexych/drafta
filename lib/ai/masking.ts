export type MaskedEntityKind = "phone" | "email" | "iban" | "card";

export type MaskedEntity = {
  placeholder: string;
  kind: MaskedEntityKind;
  value: string;
};

export type MaskedResult = {
  maskedText: string;
  entities: MaskedEntity[];
};

const IBAN_PATTERN =
  /(?<![A-Z0-9])([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30})/gi;
const CARD_PATTERN =
  /(?<![+\d])(?<!\d[ -])(\d(?:[ -]?\d){11,17}\d)(?![ -]?\d)/g;
const EMAIL_PATTERN =
  /(?<![A-Z0-9.!#$%&'*+/=?^_`{|}~-])([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+)(?![A-Z0-9-])/gi;
const PHONE_PATTERN =
  /(?<![\w+])(?:\+\d{1,3}(?:[ \t()./-]*\d){6,14}|0\d(?:[ \t()/-]*\d){7,13}|\(0\d{2,5}\)(?:[ \t/-]*\d){5,12})(?![ \t()/-]*\d)/g;
const PLACEHOLDER_PATTERN = /\{\{(PHONE|EMAIL|IBAN|CARD)_\d+\}\}/g;

const IBAN_COUNTRIES_BY_LENGTH = {
  15: ["NO"],
  16: ["BE"],
  18: ["DK", "FI", "FO", "GL", "NL", "SD"],
  19: ["MK", "SI"],
  20: ["AT", "BA", "EE", "KZ", "LT", "LU", "MN", "XK"],
  21: ["CH", "HR", "LI", "LV"],
  22: ["BG", "BH", "DE", "GB", "GE", "IE", "ME", "RS"],
  23: ["AE", "GI", "IL", "IQ", "OM", "SO", "TL"],
  24: ["AD", "CZ", "ES", "MD", "PK", "RO", "SA", "SE", "SK", "TN", "VG"],
  25: ["PT", "ST"],
  26: ["IS", "TR"],
  27: ["BI", "DJ", "FR", "GR", "IT", "MC", "MR", "SM"],
  28: ["AL", "AZ", "BY", "CY", "DO", "GT", "HU", "LB", "PL", "SV"],
  29: ["BR", "EG", "PS", "QA", "UA"],
  30: ["JO", "KW", "MU"],
  31: ["MT", "SC"],
  32: ["LC", "NI"],
  33: ["RU"],
} as const;

const IBAN_LENGTH_BY_COUNTRY = new Map<string, number>(
  Object.entries(IBAN_COUNTRIES_BY_LENGTH).flatMap(([length, countries]) =>
    countries.map((country) => [country, Number(length)]),
  ),
);

const PLACEHOLDER_KIND = {
  phone: "PHONE",
  email: "EMAIL",
  iban: "IBAN",
  card: "CARD",
} as const satisfies Record<MaskedEntityKind, string>;

type MaskingState = {
  entities: MaskedEntity[];
  entitiesByValue: Map<string, MaskedEntity>;
  nextIndex: Record<MaskedEntityKind, number>;
};

function entityKey(kind: MaskedEntityKind, value: string): string {
  return `${kind}\0${value}`;
}

function createState(existing: MaskedEntity[]): MaskingState {
  const entities = [...existing];
  const entitiesByValue = new Map<string, MaskedEntity>();
  const nextIndex: Record<MaskedEntityKind, number> = {
    phone: 1,
    email: 1,
    iban: 1,
    card: 1,
  };

  for (const entity of entities) {
    const key = entityKey(entity.kind, entity.value);
    if (!entitiesByValue.has(key)) {
      entitiesByValue.set(key, entity);
    }

    const expectedPrefix = PLACEHOLDER_KIND[entity.kind];
    const match = new RegExp(`^\\{\\{${expectedPrefix}_(\\d+)\\}\\}$`).exec(
      entity.placeholder,
    );
    if (match) {
      nextIndex[entity.kind] = Math.max(
        nextIndex[entity.kind],
        Number(match[1]) + 1,
      );
    }
  }

  return { entities, entitiesByValue, nextIndex };
}

function placeholderFor(
  kind: MaskedEntityKind,
  value: string,
  state: MaskingState,
): string {
  const key = entityKey(kind, value);
  const existing = state.entitiesByValue.get(key);
  if (existing) {
    return existing.placeholder;
  }

  const index = state.nextIndex[kind]++;
  const entity: MaskedEntity = {
    placeholder: `{{${PLACEHOLDER_KIND[kind]}_${index}}}`,
    kind,
    value,
  };
  state.entities.push(entity);
  state.entitiesByValue.set(key, entity);
  return entity.placeholder;
}

function replaceMatches(
  text: string,
  pattern: RegExp,
  kind: MaskedEntityKind,
  state: MaskingState,
  isValid: (value: string) => boolean = () => true,
): string {
  return text.replace(pattern, (value: string) =>
    isValid(value) ? placeholderFor(kind, value, state) : value,
  );
}

function isStructurallyValidIban(value: string): boolean {
  const compact = value.replaceAll(" ", "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact);
}

function passesIbanChecksum(value: string): boolean {
  const compact = value.replaceAll(" ", "").toUpperCase();
  if (!isStructurallyValidIban(compact)) {
    return false;
  }

  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const expanded = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function extractIbanPrefix(candidate: string, compactLength: number): string | null {
  let seenCharacters = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] === " ") {
      continue;
    }

    seenCharacters += 1;
    if (seenCharacters === compactLength) {
      const nextCharacter = candidate[index + 1];
      if (nextCharacter && nextCharacter !== " ") {
        return null;
      }
      return candidate.slice(0, index + 1);
    }
  }

  return null;
}

/**
 * The checksum is deliberately optional, so registered country lengths define
 * the boundary for checksum-invalid IBANs. The checksum scan remains a safe
 * fallback for a newly introduced country that is not in the registry yet.
 */
function extractIbanValue(candidate: string): string | null {
  const country = candidate.slice(0, 2).toUpperCase();
  const countryLength = IBAN_LENGTH_BY_COUNTRY.get(country);
  if (countryLength) {
    return extractIbanPrefix(candidate, countryLength);
  }

  let compactLength = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== " ") {
      compactLength += 1;
    }
    if (compactLength < 15) {
      continue;
    }

    const value = candidate.slice(0, index + 1);
    if (passesIbanChecksum(value)) {
      return value;
    }
  }
  return null;
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function isLikelyPhone(value: string): boolean {
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 9 && digitCount <= 15;
}

function maskWithState(text: string, state: MaskingState): string {
  let maskedText = replaceMatches(text, EMAIL_PATTERN, "email", state);
  maskedText = maskedText.replace(IBAN_PATTERN, (candidate: string) => {
    const value = extractIbanValue(candidate);
    if (!value || !isStructurallyValidIban(value)) {
      return candidate;
    }
    return placeholderFor("iban", value, state) + candidate.slice(value.length);
  });
  maskedText = replaceMatches(
    maskedText,
    CARD_PATTERN,
    "card",
    state,
    passesLuhn,
  );
  maskedText = replaceMatches(
    maskedText,
    PHONE_PATTERN,
    "phone",
    state,
    isLikelyPhone,
  );
  return maskedText;
}

export function maskText(
  text: string,
  existing: MaskedEntity[] = [],
): MaskedResult {
  const state = createState(existing);
  return {
    maskedText: maskWithState(text, state),
    entities: state.entities,
  };
}

export function maskMessages(texts: string[]): {
  masked: string[];
  entities: MaskedEntity[];
} {
  const state = createState([]);
  return {
    masked: texts.map((text) => maskWithState(text, state)),
    entities: state.entities,
  };
}

export function unmaskText(text: string, entities: MaskedEntity[]): string {
  const valuesByPlaceholder = new Map(
    entities.map((entity) => [entity.placeholder, entity.value]),
  );

  return text.replace(
    PLACEHOLDER_PATTERN,
    (placeholder) => valuesByPlaceholder.get(placeholder) ?? placeholder,
  );
}
