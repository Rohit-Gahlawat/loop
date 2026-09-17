import { handler, ok, parseJson } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { rethrowProviderFailure } from "@/lib/search/model";
import { answerQuestion, askInputSchema } from "./_answer";

/** Every answer depends on the caller's workspace, so there is nothing to cache. */
export const dynamic = "force-dynamic";

/**
 * POST /api/ask
 * Answers a question from the caller's own feedback, and returns the items the
 * answer was built from so it can be checked.
 *
 * Asking is a read. Viewers may ask, exactly as they may read the inbox. The
 * workspace comes from the session, never from the body, so no question can
 * reach another tenant's feedback.
 */
export const POST = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const input = await parseJson(req, askInputSchema);

  try {
    return ok(await answerQuestion(workspaceId, input));
  } catch (error) {
    rethrowProviderFailure(error);
  }
});
