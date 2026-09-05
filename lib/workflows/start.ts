import "server-only";

import { getRun, start } from "workflow/api";

import { commentDraftsWorkflow } from "@/lib/workflows/drafts/comment-drafts.workflow";
import { generateDraftWorkflow } from "@/lib/workflows/drafts/generate-draft.workflow";
import { contactAvatarWorkflow } from "@/lib/workflows/media/contact-avatar.workflow";
import { postThumbnailWorkflow } from "@/lib/workflows/media/post-thumbnail.workflow";
import { sendCommentWorkflow } from "@/lib/workflows/outbound/send-comment.workflow";
import { sendMessageWorkflow } from "@/lib/workflows/outbound/send-message.workflow";
import { sendPrivateReplyWorkflow } from "@/lib/workflows/outbound/send-private-reply.workflow";
import { sendPushWorkflow } from "@/lib/workflows/push/send-push.workflow";

/**
 * Единственная точка, из которой приложение запускает durable-прогоны
 * (docs/architecture/18-workflows.md). Снаружи видны только эти обёртки, и
 * каждая явно выбирает границу отказа: падать или проглатывать.
 *
 * **Правило 7 живёт здесь.** Аргументы запуска — строго идентификаторы, никогда
 * тексты сообщений, имена или другие персональные данные; типы ниже и есть
 * enforcement, любое лишнее поле — ошибка компиляции.
 */

/**
 * Прогоны пиннятся во Франкфурт явно, а не «куда попадём». Без этой опции
 * `world-vercel` берёт регион вызывающей функции (`VERCEL_REGION`), а если его
 * нет — серверный дефолт `iad1`, то есть США. Состояние прогона (event log со
 * входами и выходами шагов) обязано лежать в ЕС
 * (docs/architecture/15-compliance-gdpr.md).
 */
const RUN_REGION = "fra1";

export type ContactAvatarSyncArgs = {
  workspaceId: string;
  contactIdentityId: string;
  conversationId: string;
};

export type PostThumbnailSyncArgs = {
  workspaceId: string;
  postId: string;
};

export type GenerateDraftArgs = {
  conversationId: string;
  workspaceId: string;
};

export type SendMessageArgs = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};

export type CommentDraftsArgs = {
  workspaceId: string;
  postId: string;
  commentId?: string;
};

export type SendCommentArgs = {
  workspaceId: string;
  postId: string;
  /** Строка `comments`, которую надо опубликовать. */
  replyCommentId: string;
};

export type SendPrivateReplyArgs = {
  workspaceId: string;
  postId: string;
  /** Строка `comment_private_replies`, которую надо доставить. */
  privateReplyId: string;
};

export type PushNotifyArgs = {
  messageId: string;
  conversationId: string;
  workspaceId: string;
};

/**
 * Проглатывает ошибку запуска. Для путей, где вызывающий уже durably сохранил
 * всё важное и не должен падать из-за фоновой задачи.
 */
async function startFailSafe(
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`[workflow] failed to start ${label}`, error);
  }
}

/**
 * Дочитать аватар контакта после того, как данные вебхука сохранены. Провал
 * косметический, поэтому та же fail-safe граница, что у пуша: ответ вебхука он
 * не меняет.
 */
export async function startContactAvatarSync(
  args: ContactAvatarSyncArgs,
): Promise<void> {
  await startFailSafe("contact-avatar", () =>
    start(contactAvatarWorkflow, [args], { region: RUN_REGION }),
  );
}

/**
 * Дочитать обложку поста. Прогон повторно проверяет `posts.thumbnail_url`
 * перед вызовом провайдера, поэтому повторные комментарии дёшевы.
 */
export async function startPostThumbnailSync(
  args: PostThumbnailSyncArgs,
): Promise<void> {
  await startFailSafe("post-thumbnail", () =>
    start(postThumbnailWorkflow, [args], { region: RUN_REGION }),
  );
}

/**
 * Мгновенный пуш, fail-safe: к моменту вызова сообщение уже лежит в Postgres, а
 * вебхук-роут всё равно вот-вот ответит 200 (правило 6 — роут держится в
 * доли секунды и не ставит свой ответ в зависимость от downstream-системы).
 * Zernio не должен видеть в этом повод для ретрая, а пропущенный пуш всё равно
 * добирается сводкой.
 */
export async function startPushNotify(args: PushNotifyArgs): Promise<void> {
  await startFailSafe("send-push", () =>
    start(sendPushWorkflow, [args], { region: RUN_REGION }),
  );
}

/**
 * Генерация черновика по кнопке. Намеренно падает: поле ввода уже заблокировано
 * в ожидании черновика, и провал запуска обязан всплыть тостом, а не оставить
 * композер заблокированным навсегда.
 */
export async function startGenerateDraft(args: GenerateDraftArgs): Promise<void> {
  await start(generateDraftWorkflow, [args], { region: RUN_REGION });
}

/**
 * Отправка исходящего DM. Намеренно падает (в отличие от пуша): вызывающий —
 * серверное действие, которое только что сохранило сообщение как `pending`;
 * если прогон не стартовал, отправить его не сможет никто, поэтому действие
 * обязано узнать о провале, пометить сообщение `failed` и показать кнопку
 * «Повторить» (docs/architecture/07-data-flows.md#63-отправка-ответа).
 */
export async function startSendMessage(args: SendMessageArgs): Promise<void> {
  await start(sendMessageWorkflow, [args], { region: RUN_REGION });
}

/**
 * Черновики ответов на комментарии. Намеренно падает: пользователь нажал
 * кнопку и ждёт, когда карточки начнут появляться.
 */
export async function startCommentDrafts(args: CommentDraftsArgs): Promise<void> {
  await start(commentDraftsWorkflow, [args], { region: RUN_REGION });
}

/**
 * Публикация ответа на комментарий. Падает по той же причине, что и отправка
 * DM: ответ уже сохранён как `pending`, и провал запуска компенсируется
 * вызывающим в `failed`, а не остаётся молча неотправленным.
 */
export async function startSendComment(args: SendCommentArgs): Promise<void> {
  await start(sendCommentWorkflow, [args], { region: RUN_REGION });
}

/**
 * Личный ответ автору комментария. Падает по той же причине: строка уже
 * сохранена как `pending`.
 */
export async function startSendPrivateReply(
  args: SendPrivateReplyArgs,
): Promise<void> {
  await start(sendPrivateReplyWorkflow, [args], { region: RUN_REGION });
}

/**
 * Снять запущенные прогоны генерации черновика — кнопка «стоп» под спиннером.
 *
 * Адрес прогона известен точно: `createGeneratingDraft` записал `runId` в
 * строку черновика, а гасящее действие вернуло его из
 * `discardGeneratingConversationDraft`.
 *
 * Fail-safe и это принципиально: пользовательская отмена уже произошла в БД —
 * именно она разблокировала поле ввода во всех вкладках, — а снятие прогона
 * лишь экономит остаток работы. Прогон мог и завершиться сам между двумя
 * запросами, и это не ошибка, о которой пользователю надо что-то делать.
 */
export async function cancelDraftGenerationRuns(
  runIds: readonly string[],
): Promise<void> {
  await Promise.all(
    runIds.map((runId) =>
      startFailSafe(`cancel ${runId}`, () => getRun(runId).cancel()),
    ),
  );
}
