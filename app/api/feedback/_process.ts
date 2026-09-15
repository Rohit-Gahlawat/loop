import { processFeedback } from "@/lib/pipeline";

/**
 * Every ingestion path ends here.
 *
 * `processFeedback` already settles its classification and embedding steps with
 * Promise.allSettled and logs whichever one failed, so it resolves even when the
 * model provider is down. Awaiting it would only make ingestion as slow as the
 * slowest provider call for no benefit to the caller, so it is started and left
 * to run. The catch is a backstop for a throw that happens before that settling,
 * such as a bad import or a provider client that throws while being constructed.
 * Nothing is swallowed: either the pipeline logs it or this does.
 */
export function startProcessing(feedbackIds: string[], workspaceId: string): void {
  if (feedbackIds.length === 0) return;

  void processFeedback(feedbackIds, workspaceId).catch((error: unknown) => {
    console.error("Feedback processing could not be started:", {
      workspaceId,
      count: feedbackIds.length,
      error,
    });
  });
}
