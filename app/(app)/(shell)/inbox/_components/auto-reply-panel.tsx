"use client";

/**
 * Панель автоответов — правая часть «Сообщений» при `?autoreply=1`
 * (docs/architecture/10-ui.md#панель-автоответов).
 *
 * Открывается на месте беседы, а не в настройках: включают и выключают
 * автоответы там же, где смотрят входящие, и значок в шапке списка ведёт сюда.
 *
 * Состояние держится в компоненте и синхронизируется серверными экшенами;
 * `router.refresh()` после сохранения обновляет значок «вкл/выкл» в шапке,
 * который рисует серверная страница.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

import {
  MAX_SCENARIO_EXAMPLES,
  validateScenario,
  type ScenarioAction,
} from "@/lib/auto-reply/validation";

import { BackIcon, PlusIcon, TrashIcon } from "../../_components/icons";
import { showToast } from "../../_components/stub";
import styles from "./auto-reply-panel.module.css";
import panes from "../../_components/panes.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
  createAutoReplyScenarioAction,
  deleteAutoReplyScenarioAction,
  moveAutoReplyScenarioAction,
  saveAutoReplySettingsAction,
  updateAutoReplyScenarioAction,
} from "../auto-reply-actions";

export type AutoReplyTemplateOption = {
  id: string;
  name: string;
};

export type AutoReplyScenarioView = {
  id: string;
  name: string;
  condition: string;
  examples: string[];
  action: ScenarioAction;
  replyTemplateId: string | null;
};

export type AutoReplySettingsView = {
  isEnabled: boolean;
  delayMinutes: number;
  fallbackTemplateId: string | null;
};

/** Значение `<select>`, означающее «не отвечать автоматически». */
const NO_TEMPLATE = "";

type Draft = {
  id: string | null;
  name: string;
  condition: string;
  examples: string[];
  action: ScenarioAction;
  replyTemplateId: string | null;
};

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    condition: "",
    examples: [""],
    action: "reply",
    replyTemplateId: null,
  };
}

export function AutoReplyPanel({
  settings: serverSettings,
  scenarios: serverScenarios,
  templates,
}: {
  settings: AutoReplySettingsView;
  scenarios: AutoReplyScenarioView[];
  templates: AutoReplyTemplateOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [settings, setSettings] = useState(serverSettings);
  const [delayText, setDelayText] = useState(String(serverSettings.delayMinutes));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarios = serverScenarios;

  const saveSettings = (next: AutoReplySettingsView) => {
    setSettings(next);
    startTransition(async () => {
      const result = await saveAutoReplySettingsAction(next);

      if (!result.ok) {
        // Возвращаем переключатель туда, где он был: контур, который «вроде
        // включён», а на деле нет, хуже честной ошибки.
        setSettings(serverSettings);
        setDelayText(String(serverSettings.delayMinutes));
        showToast(result.error);
        return;
      }

      router.refresh();
    });
  };

  const commitDelay = () => {
    const parsed = Number(delayText.trim());

    if (!Number.isInteger(parsed) || parsed < 0) {
      setDelayText(String(settings.delayMinutes));
      showToast("Задержка должна быть целым числом минут.");
      return;
    }
    if (parsed === settings.delayMinutes) {
      return;
    }

    saveSettings({ ...settings, delayMinutes: parsed });
  };

  const submitScenario = (value: Draft) => {
    const validation = validateScenario({
      name: value.name,
      condition: value.condition,
      examples: value.examples,
      action: value.action,
      replyTemplateId: value.replyTemplateId,
    });

    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    startTransition(async () => {
      const result = value.id
        ? await updateAutoReplyScenarioAction({ id: value.id, ...validation.value })
        : await createAutoReplyScenarioAction(validation.value);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDraft(null);
      setError(null);
      router.refresh();
    });
  };

  const removeScenario = (scenario: AutoReplyScenarioView) => {
    if (!window.confirm(`Удалить сценарий «${scenario.name}»?`)) {
      return;
    }

    startTransition(async () => {
      const result = await deleteAutoReplyScenarioAction(scenario.id);

      if (!result.ok) {
        showToast(result.error);
        return;
      }

      router.refresh();
    });
  };

  const moveScenario = (scenarioId: string, direction: "up" | "down") => {
    startTransition(async () => {
      const result = await moveAutoReplyScenarioAction(scenarioId, direction);

      if (!result.ok) {
        showToast(result.error);
        return;
      }

      router.refresh();
    });
  };

  return (
    <>
      <div className={panes.threadHead}>
        <Link className={panes.backButton} href="/inbox" aria-label="Назад">
          <BackIcon />
        </Link>
        <div className={panes.threadWho}>
          <b>Автоответы</b>
          <div className={styles.headNote}>
            Отвечают готовыми шаблонами, пока вы не ответили сами
          </div>
        </div>
      </div>

      <div className={styles.body}>
        <section className={`${uiStyles.card} ${styles.mainCard}`}>
          <div className={styles.switchRow}>
            <button
              type="button"
              className={uiStyles.switch}
              role="switch"
              aria-checked={settings.isEnabled}
              aria-label={
                settings.isEnabled ? "Выключить автоответы" : "Включить автоответы"
              }
              disabled={isPending}
              onClick={() =>
                saveSettings({ ...settings, isEnabled: !settings.isEnabled })
              }
            />
            <span>{settings.isEnabled ? "Автоответы включены" : "Автоответы выключены"}</span>
          </div>

          <label className={styles.delayRow}>
            <span>Отвечать через</span>
            <input
              type="number"
              min={0}
              max={1440}
              inputMode="numeric"
              className={styles.delayInput}
              value={delayText}
              disabled={isPending}
              onChange={(event) => setDelayText(event.target.value)}
              onBlur={commitDelay}
              aria-label="Отвечать через, минут"
            />
            <span>минут</span>
          </label>
          <p className={styles.hint}>
            Если вы ответите клиенту сами за это время, автоответ не уйдёт.
          </p>
        </section>

        <div className={styles.sectionHead}>
          <h3>Сценарии</h3>
          <button
            type="button"
            className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonSmall}`}
            disabled={isPending}
            onClick={() => {
              setDraft(emptyDraft());
              setError(null);
            }}
          >
            <PlusIcon /> Добавить
          </button>
        </div>
        <p className={styles.hint}>
          Разбираются сверху вниз: побеждает первый подошедший.
        </p>

        {scenarios.length === 0 ? (
          <div className={styles.empty}>
            Сценариев нет — входящие попадут в «Иначе».
          </div>
        ) : null}

        <ul className={styles.scenarioList}>
          {scenarios.map((scenario, index) => (
            <li key={scenario.id} className={`${uiStyles.card} ${styles.scenario}`}>
              <div className={styles.scenarioHead}>
                <b>{scenario.name}</b>
                <div className={styles.scenarioActions}>
                  <button
                    type="button"
                    className={styles.orderButton}
                    aria-label={`Поднять сценарий «${scenario.name}»`}
                    disabled={isPending || index === 0}
                    onClick={() => moveScenario(scenario.id, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.orderButton}
                    aria-label={`Опустить сценарий «${scenario.name}»`}
                    disabled={isPending || index === scenarios.length - 1}
                    onClick={() => moveScenario(scenario.id, "down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${uiStyles.button} ${uiStyles.buttonGhost} ${uiStyles.buttonSmall}`}
                    disabled={isPending}
                    onClick={() => {
                      setDraft({ ...scenario, examples: [...scenario.examples, ""] });
                      setError(null);
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className={styles.orderButton}
                    aria-label={`Удалить сценарий «${scenario.name}»`}
                    disabled={isPending}
                    onClick={() => removeScenario(scenario)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {scenario.condition ? (
                <p className={styles.scenarioCondition}>{scenario.condition}</p>
              ) : null}
              <div className={styles.scenarioReply}>
                {describeReply(scenario, templates)}
              </div>
            </li>
          ))}
        </ul>

        <section className={`${uiStyles.card} ${styles.fallback}`}>
          <div className={styles.scenarioHead}>
            <b>Иначе</b>
          </div>
          <p className={styles.hint}>
            Входящие, не подошедшие ни к одному сценарию.
          </p>
          <TemplateSelect
            label="Шаблон для сценария «Иначе»"
            templates={templates}
            value={settings.fallbackTemplateId}
            disabled={isPending}
            onChange={(templateId) =>
              saveSettings({ ...settings, fallbackTemplateId: templateId })
            }
          />
        </section>
      </div>

      {draft ? (
        <ScenarioEditor
          draft={draft}
          templates={templates}
          error={error}
          isPending={isPending}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
          onSubmit={() => submitScenario(draft)}
        />
      ) : null}
    </>
  );
}

function describeReply(
  scenario: AutoReplyScenarioView,
  templates: AutoReplyTemplateOption[],
): string {
  if (scenario.action === "ignore") {
    return "Не отвечать автоматически";
  }

  const template = templates.find(
    (candidate) => candidate.id === scenario.replyTemplateId,
  );

  // Шаблон удалили, а сценарий остался настроенным отвечать — это сломанная
  // настройка, и молчать о ней панель не должна.
  return template ? `Шаблон: ${template.name}` : "Шаблон удалён — ответа не будет";
}

function TemplateSelect({
  label,
  templates,
  value,
  disabled,
  onChange,
}: {
  label: string;
  templates: AutoReplyTemplateOption[];
  value: string | null;
  disabled: boolean;
  onChange: (templateId: string | null) => void;
}) {
  return (
    <div className={uiStyles.field}>
      <select
        aria-label={label}
        value={value ?? NO_TEMPLATE}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value={NO_TEMPLATE}>Не отвечать автоматически</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScenarioEditor({
  draft,
  templates,
  error,
  isPending,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: Draft;
  templates: AutoReplyTemplateOption[];
  error: string | null;
  isPending: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const examples = draft.examples;

  return (
    <div className={styles.editorBackdrop}>
      <section
        className={styles.editorDialog}
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? "Изменить сценарий" : "Новый сценарий"}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className={uiStyles.field}>
            <label htmlFor="auto-reply-scenario-name">Название</label>
            <input
              id="auto-reply-scenario-name"
              type="text"
              value={draft.name}
              disabled={isPending}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </div>

          <div className={uiStyles.field}>
            <label htmlFor="auto-reply-scenario-condition">
              Условие: как отличить такие входящие
            </label>
            <textarea
              id="auto-reply-scenario-condition"
              rows={3}
              value={draft.condition}
              disabled={isPending}
              onChange={(event) =>
                onChange({ ...draft, condition: event.target.value })
              }
            />
          </div>

          <div className={styles.examples}>
            <span className={styles.examplesLabel}>Примеры входящих</span>
            {examples.map((example, index) => (
              <div key={index} className={styles.exampleRow}>
                <input
                  type="text"
                  value={example}
                  disabled={isPending}
                  aria-label={`Пример ${index + 1}`}
                  onChange={(event) => {
                    const next = [...examples];
                    next[index] = event.target.value;
                    onChange({ ...draft, examples: next });
                  }}
                />
                <button
                  type="button"
                  className={styles.orderButton}
                  aria-label={`Удалить пример ${index + 1}`}
                  disabled={isPending}
                  onClick={() =>
                    onChange({
                      ...draft,
                      examples: examples.filter((_, i) => i !== index),
                    })
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            {examples.length < MAX_SCENARIO_EXAMPLES ? (
              <button
                type="button"
                className={`${uiStyles.button} ${uiStyles.buttonGhost} ${uiStyles.buttonSmall} ${uiStyles.buttonSelfStart}`}
                disabled={isPending}
                onClick={() => onChange({ ...draft, examples: [...examples, ""] })}
              >
                <PlusIcon /> Пример
              </button>
            ) : null}
          </div>

          <div className={uiStyles.field}>
            <label htmlFor="auto-reply-scenario-template">Ответ</label>
            <select
              id="auto-reply-scenario-template"
              value={draft.action === "ignore" ? NO_TEMPLATE : draft.replyTemplateId ?? NO_TEMPLATE}
              disabled={isPending}
              onChange={(event) => {
                const templateId = event.target.value || null;
                onChange({
                  ...draft,
                  // «Не отвечать автоматически» — это action, а не пустая
                  // ссылка: пустой она станет и сама, если шаблон удалят.
                  action: templateId ? "reply" : "ignore",
                  replyTemplateId: templateId,
                });
              }}
            >
              <option value={NO_TEMPLATE}>Не отвечать автоматически</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.editorActions}>
            <button
              type="button"
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={onCancel}
            >
              Отмена
            </button>
            <button
              type="submit"
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
            >
              {isPending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
