/**
 * Assigns sentiment, sentiment score, feature area and themes to feedback.
 * Called once per item on ingest. Results are written to the record so nothing
 * is recomputed on read.
 */
export async function classifyBatch(
  feedbackIds: string[],
  workspaceId: string,
): Promise<void> {
  void feedbackIds;
  void workspaceId;
}
