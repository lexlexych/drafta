import type { CommentEntryView, CommentView } from "@/lib/comments/types";

/**
 * Раскладывает плоский список комментариев в два уровня: сверху комментарии
 * под постом, под каждым — его ветка (наши ответы и ответы других людей).
 *
 * Родство идёт по провайдерским id: у ответа `parentExternalId` равен
 * `externalId` того, кому отвечают. Instagram укладывает ветку в два уровня —
 * ответ на ответ виден в той же ветке, — поэтому ответ поднимается к своему
 * верхнему предку, а не создаёт третий уровень. Ответ, чьего родителя в
 * загруженном окне нет, остаётся верхним уровнем: потерять его хуже, чем
 * показать не с тем отступом.
 *
 * Функция чистая и живёт не в `lib/db`, потому что её вызывает клиент: тред
 * грузится страницами (`lib/db/thread-page.ts`), и дерево пересобирается из
 * всего накопленного окна каждый раз, когда сверху приезжает предыдущая
 * страница.
 */
export function buildCommentThread(
  comments: readonly CommentEntryView[],
): CommentView[] {
  const byExternalId = new Map<string, CommentEntryView>();

  for (const comment of comments) {
    if (comment.externalId) {
      byExternalId.set(comment.externalId, comment);
    }
  }

  const topLevelAncestor = (comment: CommentEntryView): CommentEntryView => {
    let current = comment;
    const visited = new Set<string>([comment.id]);

    while (current.parentExternalId) {
      const parent = byExternalId.get(current.parentExternalId);
      // Неизвестный или зациклившийся родитель — дальше подниматься некуда.
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }

    return current;
  };

  const threads: CommentView[] = [];
  const threadById = new Map<string, CommentView>();

  for (const comment of comments) {
    const ancestor = topLevelAncestor(comment);

    if (ancestor.id === comment.id) {
      const thread: CommentView = { ...comment, replies: [] };
      threads.push(thread);
      threadById.set(comment.id, thread);
      continue;
    }

    const thread = threadById.get(ancestor.id);
    if (thread) {
      thread.replies.push(comment);
    } else {
      // Предок есть в окне, но ещё не разобран — такого при хронологическом
      // порядке не бывает, и всё же лучше показать комментарий, чем потерять.
      const orphan: CommentView = { ...comment, replies: [] };
      threads.push(orphan);
      threadById.set(comment.id, orphan);
    }
  }

  return threads;
}
