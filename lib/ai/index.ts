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
export type { AiExchange } from "./exchange";
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
  CATEGORIES_MARKER,
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
  PromptInput,
  PromptKnowledgeBase,
  PromptLogger,
  PromptLogOptions,
} from "./prompt";
export { buildCommentDraftPrompt } from "./comment-prompt";
export type {
  CommentPromptAiSettings,
  CommentPromptBrief,
  CommentPromptInput,
  CommentPromptTarget,
} from "./comment-prompt";
export {
  AI_SYSTEM_PROMPT_MAX_LENGTH,
  DEFAULT_COMMENT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./default-prompts";
