"use client";

/**
 * Значок «шаблон» в поле ответа и поповер за ним.
 *
 * Два шага в одной панели — сперва шаблон, потом язык — потому что язык имеет
 * смысл только внутри выбранного шаблона: у одного заполнены немецкий и
 * английский, у другого ещё и украинский. Плоский список «шаблон × язык» на
 * десяти шаблонах превратился бы в тридцать строк.
 *
 * Своя реализация, а не библиотека: в проекте нет ни Radix, ни shadcn — тот же
 * приём с outside-click и Escape, что в `multi-select.tsx`.
 */

import { useEffect, useRef, useState } from "react";

import {
  sortTemplateLanguages,
  templateLanguageLabel,
  type TemplateLanguage,
} from "@/lib/i18n/template-languages";

import { BackIcon, TemplateIcon } from "./icons";
import styles from "./template-picker.module.css";

export type ReplyTemplateOption = {
  id: string;
  name: string;
  /** Код языка → текст. Языков без текста здесь не бывает: их не хранит база. */
  bodies: Record<string, string>;
};

export function TemplatePicker({
  templates,
  workspaceLanguage,
  onPick,
}: {
  templates: readonly ReplyTemplateOption[];
  /** Язык из «Настройки → Аккаунт»: он идёт первым в списке языков. */
  workspaceLanguage: TemplateLanguage;
  onPick: (text: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Пустой список значка не заслуживает: нажимать было бы не на что.
  if (templates.length === 0) {
    return null;
  }

  const openTemplate =
    templates.find((template) => template.id === openTemplateId) ?? null;

  const close = () => {
    setIsOpen(false);
    setOpenTemplateId(null);
  };

  const pick = (text: string) => {
    onPick(text);
    close();
  };

  return (
    <div className={styles.root} ref={containerRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Вставить шаблон"
        title="Вставить шаблон"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          setOpenTemplateId(null);
          setIsOpen((open) => !open);
        }}
      >
        <TemplateIcon size={16} />
      </button>

      {isOpen ? (
        <div className={styles.panel} role="menu" aria-label="Шаблоны ответов">
          {openTemplate ? (
            <>
              <div className={styles.panelHead}>
                <button
                  type="button"
                  className={styles.back}
                  aria-label="Назад к списку шаблонов"
                  onClick={() => setOpenTemplateId(null)}
                >
                  <BackIcon size={14} />
                </button>
                <span className={styles.panelTitle}>{openTemplate.name}</span>
              </div>
              <ul className={styles.list}>
                {sortTemplateLanguages(
                  Object.keys(openTemplate.bodies),
                  workspaceLanguage,
                ).map((language) => (
                  <li key={language}>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.option}
                      onClick={() => pick(openTemplate.bodies[language] ?? "")}
                    >
                      <span className={styles.optionLabel}>
                        {templateLanguageLabel(language)}
                      </span>
                      <span className={styles.optionPreview}>
                        {openTemplate.bodies[language]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <ul className={styles.list}>
              {templates.map((template) => {
                const languages = Object.keys(template.bodies);

                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.option}
                      onClick={() => {
                        // Единственный язык выбирать не из чего — вставляем сразу.
                        if (languages.length === 1) {
                          pick(template.bodies[languages[0]!] ?? "");
                          return;
                        }

                        setOpenTemplateId(template.id);
                      }}
                    >
                      <span className={styles.optionLabel}>{template.name}</span>
                      <span className={styles.optionHint}>
                        {languages.length === 1
                          ? templateLanguageLabel(languages[0]!)
                          : `${languages.length} яз.`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
