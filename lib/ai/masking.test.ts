import { describe, expect, it } from "vitest";

import {
  maskMessages,
  maskText,
  type MaskedEntity,
  unmaskText,
} from "./masking";

describe("maskText", () => {
  it.each([
    ["Rufen Sie mich unter +49 (30) 1234-5678 an.", "+49 (30) 1234-5678"],
    ["Meine Nummer ist 0176 12345678.", "0176 12345678"],
    ["Call me at +1 202-555-0123.", "+1 202-555-0123"],
    ["Festnetz: (030) 12345678.", "(030) 12345678"],
  ])("masks a supported phone format in %s", (text, phone) => {
    expect(maskText(text)).toEqual({
      maskedText: text.replace(phone, "{{PHONE_1}}"),
      entities: [
        { placeholder: "{{PHONE_1}}", kind: "phone", value: phone },
      ],
    });
  });

  it("masks email, German and non-German IBANs, and a Luhn-valid card", () => {
    const text = [
      "E-Mail: kunde+shop@example.de",
      "DE: DE89 3704 0044 0532 0130 00",
      "GB: GB82 WEST 1234 5698 7654 32",
      "Karte: 4539 1488 0343 6467",
    ].join("; ");

    expect(maskText(text)).toEqual({
      maskedText:
        "E-Mail: {{EMAIL_1}}; DE: {{IBAN_1}}; GB: {{IBAN_2}}; Karte: {{CARD_1}}",
      entities: [
        {
          placeholder: "{{EMAIL_1}}",
          kind: "email",
          value: "kunde+shop@example.de",
        },
        {
          placeholder: "{{IBAN_1}}",
          kind: "iban",
          value: "DE89 3704 0044 0532 0130 00",
        },
        {
          placeholder: "{{IBAN_2}}",
          kind: "iban",
          value: "GB82 WEST 1234 5698 7654 32",
        },
        {
          placeholder: "{{CARD_1}}",
          kind: "card",
          value: "4539 1488 0343 6467",
        },
      ],
    });
  });

  it("does not absorb a word following a valid IBAN", () => {
    expect(maskText("IBAN DE89 3704 0044 0532 0130 00 bitte verwenden.")).toEqual(
      {
        maskedText: "IBAN {{IBAN_1}} bitte verwenden.",
        entities: [
          {
            placeholder: "{{IBAN_1}}",
            kind: "iban",
            value: "DE89 3704 0044 0532 0130 00",
          },
        ],
      },
    );
  });

  it("does not mask prices, dates, short order numbers, or invalid cards", () => {
    const text =
      "Preis: 49,90 €. Datum: 12.03.2026. Bestellung: 12345. Referenz: 1234 5678 9012 3456.";

    expect(maskText(text)).toEqual({ maskedText: text, entities: [] });
  });

  it("numbers different phones independently", () => {
    const result = maskText("Mobil 0176 12345678, Büro 030 12345678");

    expect(result.maskedText).toBe("Mobil {{PHONE_1}}, Büro {{PHONE_2}}");
    expect(result.entities.map((entity) => entity.placeholder)).toEqual([
      "{{PHONE_1}}",
      "{{PHONE_2}}",
    ]);
  });

  it("reuses an existing entity and continues numbering per kind", () => {
    const existing: MaskedEntity[] = [
      {
        placeholder: "{{PHONE_2}}",
        kind: "phone",
        value: "0176 12345678",
      },
      {
        placeholder: "{{EMAIL_1}}",
        kind: "email",
        value: "first@example.de",
      },
    ];

    const result = maskText(
      "0176 12345678, 030 12345678, second@example.de",
      existing,
    );

    expect(result.maskedText).toBe(
      "{{PHONE_2}}, {{PHONE_3}}, {{EMAIL_2}}",
    );
    expect(result.entities).toHaveLength(4);
    expect(existing).toHaveLength(2);
  });

  it.each(["", "Hallo, wie kann ich helfen?"])(
    "leaves text without identifiers unchanged",
    (text) => {
      expect(maskText(text)).toEqual({ maskedText: text, entities: [] });
    },
  );
});

describe("maskMessages", () => {
  it("uses one placeholder for the same phone across messages", () => {
    expect(
      maskMessages([
        "Meine Nummer ist 0176 12345678.",
        "Nochmal: 0176 12345678.",
      ]),
    ).toEqual({
      masked: [
        "Meine Nummer ist {{PHONE_1}}.",
        "Nochmal: {{PHONE_1}}.",
      ],
      entities: [
        {
          placeholder: "{{PHONE_1}}",
          kind: "phone",
          value: "0176 12345678",
        },
      ],
    });
  });
});

describe("unmaskText", () => {
  it("restores every original value in a round trip", () => {
    const original =
      "Bitte an hello@example.de schreiben oder +49 30 12345678 anrufen.";
    const masked = maskText(original);

    expect(unmaskText(masked.maskedText, masked.entities)).toBe(original);
  });

  it("leaves unknown placeholders unchanged", () => {
    expect(unmaskText("Kontakt: {{PHONE_99}}", [])).toBe(
      "Kontakt: {{PHONE_99}}",
    );
  });
});
