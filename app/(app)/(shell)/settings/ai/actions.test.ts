import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  getCurrentWorkspace: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/workspace", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getCurrentWorkspace: mocks.getCurrentWorkspace,
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { saveAiSettingsAction } from "./actions";

function createSupabaseClient() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "settings-1",
      workspace_id: "workspace-1",
      system_prompt: "Пиши от лица бизнеса.",
      comment_system_prompt: "Отвечай на комментарии коротко.",
      model: "mistral-small-latest",
    },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));

  return {
    client: { from } as unknown as SupabaseClient,
    from,
    upsert,
  };
}

beforeEach(() => {
  vi.stubEnv("MISTRAL_API_KEY", "mistral-secret");
  vi.stubEnv("OPENROUTER_API_KEY", "openrouter-secret");
  vi.stubEnv("OPENROUTER_MODEL", "vendor/fallback-model");
  mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  mocks.getCurrentWorkspace.mockResolvedValue({ id: "workspace-1" });
  mocks.revalidatePath.mockReset();
});

describe("saveAiSettingsAction validation", () => {
  it("accepts the debounce upper boundary and a configured Mistral model", async () => {
    const supabase = createSupabaseClient();
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);

    const result = await saveAiSettingsAction({
      systemPrompt: "Пиши от лица бизнеса.",
      commentSystemPrompt: "Отвечай на комментарии коротко.",
      model: "mistral-small-latest",
    });

    expect(result.ok).toBe(true);
    expect(supabase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ workspace_id: "workspace-1" }),
      { onConflict: "workspace_id" },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects an unknown model before querying ai_settings", async () => {
    const supabase = createSupabaseClient();
    mocks.createServerSupabaseClient.mockResolvedValue(supabase.client);

    const result = await saveAiSettingsAction({
      systemPrompt: "Пиши от лица бизнеса.",
      commentSystemPrompt: "Отвечай на комментарии коротко.",
      model: "vendor/fallback-model",
    });

    expect(result).toEqual({ ok: false, error: "Выбранная модель недоступна." });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
