import { postThumbnailSyncRequestedEvent } from "../events";
import { inngest } from "../client";
import {
  runPostThumbnailPipeline,
  type PostThumbnailSteps,
} from "./post-thumbnail-pipeline";

function stepAdapter(step: unknown): PostThumbnailSteps {
  return step as PostThumbnailSteps;
}

export const postThumbnail = inngest.createFunction(
  {
    id: "post-thumbnail",
    triggers: [postThumbnailSyncRequestedEvent],
    retries: 2,
    concurrency: [
      {
        scope: "env",
        key: '"post:" + event.data.postId',
        limit: 1,
      },
    ],
  },
  async ({ event, step }) =>
    runPostThumbnailPipeline(event.data, stepAdapter(step)),
);
