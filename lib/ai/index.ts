export {
  AI_REQUEST_TIMEOUT_MS,
  AiProviderError,
  generateCompletion,
  generateCompletionWithUsage,
} from "./client";
export type {
  AiMessage,
  AiUsage,
  GenerateCompletionOptions,
  GenerateCompletionResult,
} from "./client";
export {
  AiConfigurationError,
  resolveGenerationModel,
  selectProviderModel,
} from "./config";
export type { AiProvider } from "./config";
export { maskMessages, maskText, unmaskText } from "./masking";
export type {
  MaskedEntity,
  MaskedEntityKind,
  MaskedResult,
} from "./masking";
export {
  MANUAL_REVIEW_MARKER,
  buildDraftPrompt,
  groundingRules,
  logPromptIfEnabled,
  parseDraftCompletion,
} from "./prompt";
export type {
  ParsedDraftCompletion,
  MaskedPromptMessage,
  PromptAiSettings,
  PromptCategory,
  PromptInput,
  PromptKnowledgeBase,
  PromptLogger,
  PromptLogOptions,
} from "./prompt";
export {
  DEFAULT_CLASSIFICATION_MAX_TOKENS,
  buildClassificationPrompt,
  logClassificationPromptIfEnabled,
  parseCategorySelection,
} from "./classification";
export type {
  ClassificationCategory,
  ClassificationInput,
} from "./classification";
export { buildCommentDraftPrompt } from "./comment-prompt";
export type {
  CommentPromptBrief,
  CommentPromptInput,
  CommentPromptTarget,
} from "./comment-prompt";
