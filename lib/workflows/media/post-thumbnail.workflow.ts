import { acquireLeases, entityLease, releaseLeases } from "@/lib/workflows/leases";

import {
  fetchAndSavePostThumbnail,
  loadPostThumbnailContext,
  type PostThumbnailInput,
  type PostThumbnailResult,
} from "./post-thumbnail.steps";

/**
 * Обложка поста подтягивается по запросу, а не при каждом входящем комментарии
 * (docs/architecture/05-channels.md): вебхук шлёт IDs-only запуск, а внешний
 * вызов делает уже этот прогон, повторно проверив `posts.thumbnail_url`.
 *
 * Лиза `post:<id>` заменяет `concurrency` Inngest с тем же лимитом 1: пачка
 * комментариев к одному посту не должна превращаться в пачку одинаковых
 * запросов к провайдеру.
 */
export async function postThumbnailWorkflow(
  input: PostThumbnailInput,
): Promise<PostThumbnailResult> {
  "use workflow";

  const leases = [entityLease("post", input.postId, input.workspaceId)];
  await acquireLeases(leases);

  try {
    const loaded = await loadPostThumbnailContext(input);
    if (loaded.status === "skip") {
      return { status: "skipped", reason: loaded.reason };
    }

    const result = await fetchAndSavePostThumbnail({
      workflowInput: input,
      context: loaded.context,
    });
    if (result === "provider-unsupported") {
      return { status: "skipped", reason: result };
    }

    return { status: result };
  } finally {
    await releaseLeases(leases);
  }
}
