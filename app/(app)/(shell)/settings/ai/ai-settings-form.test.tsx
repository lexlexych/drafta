// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_COMMENT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "@/lib/ai/default-prompts";

import { AiSettingsForm, type AiSettingsFormValue } from "./ai-settings-form";

const saveAiSettingsAction = vi.fn();

vi.mock("./actions", () => ({
  saveAiSettingsAction: (...args: unknown[]) => saveAiSettingsAction(...args),
}));

const initialValue: AiSettingsFormValue = {
  systemPrompt: "Пиши от лица мастерской.",
  commentSystemPrompt: "Отвечай на комментарии коротко.",
  model: "mistral-large-latest",
};

const modelOptions = [
  { value: "mistral-small-latest", label: "Mistral Small (EU)" },
  { value: "mistral-large-latest", label: "Mistral Large (EU)" },
];

beforeEach(() => {
  saveAiSettingsAction.mockResolvedValue({
    ok: true,
    data: {
      system_prompt: "Пиши от лица мастерской.",
      comment_system_prompt: "Отвечай на комментарии коротко.",
      model: "",
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AiSettingsForm", () => {
  it("renders current workspace values and every editable setting", () => {
    render(
      <AiSettingsForm initialValue={initialValue} modelOptions={modelOptions} />,
    );

    expect(
      (screen.getByLabelText("Черновики сообщений") as HTMLTextAreaElement).value,
    ).toBe("Пиши от лица мастерской.");
    expect(
      (screen.getByLabelText("Черновики комментариев") as HTMLTextAreaElement)
        .value,
    ).toBe("Отвечай на комментарии коротко.");
    // Тон, язык и подпись отдельными полями больше не настраиваются — они
    // живут внутри текста промпта.
    expect(screen.queryByLabelText("Тон ответов")).toBeNull();
    expect(screen.queryByLabelText("Язык ответов")).toBeNull();
    expect(screen.queryByLabelText("Подпись")).toBeNull();
    expect((screen.getByLabelText("Модель") as HTMLSelectElement).value).toBe(
      "mistral-large-latest",
    );
    // Черновики теперь только по запросу — настраивать паузу и автогенерацию
    // больше нечем.
    expect(screen.queryByLabelText("Пауза перед генерацией")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.getByText(/Черновики не создаются автоматически/),
    ).toBeDefined();
  });

  it("restores the default template into the edited prompt", () => {
    render(
      <AiSettingsForm initialValue={initialValue} modelOptions={modelOptions} />,
    );

    const [restoreDraftPrompt] = screen.getAllByRole("button", {
      name: "Вернуть шаблон",
    });
    fireEvent.click(restoreDraftPrompt!);

    expect(
      (screen.getByLabelText("Черновики сообщений") as HTMLTextAreaElement).value,
    ).toBe(DEFAULT_SYSTEM_PROMPT);
    // Кнопка возвращает только своё поле — второй промпт не трогает.
    expect(
      (screen.getByLabelText("Черновики комментариев") as HTMLTextAreaElement)
        .value,
    ).toBe("Отвечай на комментарии коротко.");
    expect(restoreDraftPrompt!.hasAttribute("disabled")).toBe(true);

    const [, restoreCommentPrompt] = screen.getAllByRole("button", {
      name: "Вернуть шаблон",
    });
    fireEvent.click(restoreCommentPrompt!);
    expect(
      (screen.getByLabelText("Черновики комментариев") as HTMLTextAreaElement)
        .value,
    ).toBe(DEFAULT_COMMENT_SYSTEM_PROMPT);
  });

  it("keeps optimistic edits, shows pending state and confirms persistence", async () => {
    render(
      <AiSettingsForm initialValue={initialValue} modelOptions={modelOptions} />,
    );

    fireEvent.change(screen.getByLabelText("Модель"), {
      target: { value: "" },
    });
    expect(screen.getByText("Есть несохранённые изменения.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() =>
      expect(saveAiSettingsAction).toHaveBeenCalledWith({
        ...initialValue,
        model: "",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "Настройки сохранены.",
    );
  });

  it("shows validation and server errors without discarding edits", async () => {
    const unavailableValue = {
      ...initialValue,
      model: "removed-model",
    };
    render(
      <AiSettingsForm
        initialValue={unavailableValue}
        modelOptions={modelOptions}
      />,
    );

    fireEvent.change(screen.getByLabelText("Черновики сообщений"), {
      target: { value: "Edited locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "Выбранная модель недоступна.",
    );
    expect(saveAiSettingsAction).not.toHaveBeenCalled();

    cleanup();
    saveAiSettingsAction.mockClear();
    saveAiSettingsAction.mockResolvedValueOnce({
      ok: false,
      error: "Не удалось сохранить AI-настройки.",
    });
    render(
      <AiSettingsForm
        initialValue={initialValue}
        modelOptions={modelOptions}
      />,
    );
    fireEvent.change(screen.getByLabelText("Черновики сообщений"), {
      target: { value: "Edited locally" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Не удалось сохранить AI-настройки.",
    );
    expect(
      (screen.getByLabelText("Черновики сообщений") as HTMLTextAreaElement).value,
    ).toBe("Edited locally");
  });
});
