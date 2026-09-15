import { classifyBatch } from "@/lib/ai/classify";
import { embedBatch } from "@/lib/search/embed";

/**
 * Runs after feedback is created, whatever the source: the single-entry form,
 * a CSV import, or a simulated channel.
 *
 * Ingestion calls this and nothing else. The two steps are independent, so a
 * failure in one must not stop the other or fail the request that triggered it.
 */
export async function processFeedback(
  feedbackIds: string[],
  workspaceId: string,
): Promise<void> {
  if (feedbackIds.length === 0) return;

  const results = await Promise.allSettled([
    classifyBatch(feedbackIds, workspaceId),
    embedBatch(feedbackIds, workspaceId),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Feedback processing step failed:", result.reason);
    }
  }
}
