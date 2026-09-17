"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/states";
import { sendJson } from "@/components/inbox/client";
import type { AskAnswer } from "@/app/api/ask/_answer";
import type { BackfillResult, EmbeddingCoverage } from "@/lib/search/embed";
import type { RetrievedFeedback } from "@/lib/search/retrieve";

/**
 * The Ask LOOP console.
 *
 * Everything shown under an answer comes from the API's own `citations` and
 * `considered` arrays, which are database rows. Nothing in this file renders
 * text the model produced as though it were feedback, so a reader can always
 * click through from a claim to the words a customer actually wrote.
 */

const MAX_QUESTION = 500;

/** Rows embedded per request while building the index, so no one call runs long. */
const INDEX_CHUNK = 32;

/** Stops a provider that never reports progress from looping forever. */
const MAX_INDEX_CALLS = 40;

const SUGGESTIONS = [
  "What are users saying about onboarding?",
  "Why are customers unhappy with billing?",
  "What do people think of the mobile experience?",
  "Which integrations do customers keep asking for?",
];

type Turn = {
  id: number;
  question: string;
  state: "pending" | "done" | "failed";
  answer: AskAnswer | null;
  error: string | null;
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function FeedbackCitation({ item, index }: { item: RetrievedFeedback; index?: number }) {
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {index === undefined ? null : (
          <span className="font-semibold text-slate-600">{index}.</span>
        )}
        <span>{DATE.format(new Date(item.createdAt))}</span>
        <span aria-hidden>&middot;</span>
        <span>{item.channel}</span>
        {item.customerLabel ? (
          <>
            <span aria-hidden>&middot;</span>
            <span>{item.customerLabel}</span>
          </>
        ) : null}
        <span aria-hidden>&middot;</span>
        <span title="Cosine similarity to the question">
          {(item.similarity * 100).toFixed(0)}% match
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-800">{item.content}</p>
      <p className="mt-1 font-mono text-[11px] text-slate-400">{item.id}</p>
    </li>
  );
}

function AnswerBlock({ answer }: { answer: AskAnswer }) {
  const [showAll, setShowAll] = useState(false);
  const citedIds = new Set(answer.citations.map((item) => item.id));
  const others = answer.considered.filter((item) => !citedIds.has(item.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {answer.answered ? (
          <Badge tone="positive">Answered from {answer.citations.length} items</Badge>
        ) : (
          <Badge tone="warning">Not in the data</Badge>
        )}
        {answer.needsIndex ? <Badge tone="info">Index not built</Badge> : null}
      </div>

      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{answer.answer}</p>

      {answer.note ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {answer.note}
        </p>
      ) : null}

      {answer.citations.length > 0 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Feedback this answer is based on
          </h4>
          <ul className="mt-2 space-y-2">
            {answer.citations.map((item, index) => (
              <FeedbackCitation key={item.id} item={item} index={index + 1} />
            ))}
          </ul>
        </div>
      ) : null}

      {others.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
            aria-expanded={showAll}
          >
            {showAll ? "Hide" : "Show"} the other {others.length} items that were searched
          </button>
          {showAll ? (
            <ul className="mt-2 space-y-2">
              {others.map((item) => (
                <FeedbackCitation key={item.id} item={item} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AskConsole({
  coverage: initialCoverage,
  canBuildIndex,
}: {
  coverage: EmbeddingCoverage;
  canBuildIndex: boolean;
}) {
  const [coverage, setCoverage] = useState(initialCoverage);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexNote, setIndexNote] = useState<string | null>(null);
  const nextId = useRef(1);

  const indexed = coverage.total > 0 && coverage.missing === 0;

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;

    const id = nextId.current;
    nextId.current += 1;

    setBusy(true);
    setQuestion("");
    setTurns((current) => [
      { id, question: trimmed, state: "pending", answer: null, error: null },
      ...current,
    ]);

    const result = await sendJson<AskAnswer>("/api/ask", "POST", { question: trimmed });

    setTurns((current) =>
      current.map((turn) =>
        turn.id === id
          ? result.ok
            ? { ...turn, state: "done", answer: result.data }
            : { ...turn, state: "failed", error: result.message }
          : turn,
      ),
    );
    if (result.ok) setCoverage(result.data.coverage);
    setBusy(false);
  }

  /**
   * The back-fill runs in chunks so no single request sits open for minutes,
   * and the count on screen moves between chunks rather than after them all.
   */
  async function buildIndex() {
    setIndexing(true);
    setIndexError(null);
    setIndexNote(null);

    for (let call = 0; call < MAX_INDEX_CALLS; call += 1) {
      const result = await sendJson<BackfillResult>("/api/ask/index", "POST", {
        limit: INDEX_CHUNK,
      });

      if (!result.ok) {
        setIndexError(result.message);
        break;
      }

      setCoverage({
        total: result.data.total,
        embedded: result.data.embedded,
        missing: result.data.missing,
      });

      if (result.data.remaining === 0) {
        setIndexNote("The search index is up to date.");
        break;
      }
    }

    setIndexing(false);
  }

  return (
    <div className="space-y-6">
      {coverage.missing > 0 ? (
        <Card>
          <CardHeader
            title="Search index"
            description={`${coverage.embedded} of ${coverage.total} items are indexed for search. Anything not indexed cannot be found or cited.`}
            action={
              canBuildIndex ? (
                <Button onClick={buildIndex} disabled={indexing || busy}>
                  {indexing ? <Spinner /> : null}
                  {indexing ? "Indexing" : "Build search index"}
                </Button>
              ) : null
            }
          />
          {indexing || indexError || indexNote || !canBuildIndex ? (
            <CardBody>
              {indexing ? (
                <p className="text-sm text-slate-600">
                  Indexing {coverage.missing} remaining items. This provider rate limits
                  heavily, so a full pass can pause for up to a minute.
                </p>
              ) : null}
              {indexError ? <p className="text-sm text-red-600">{indexError}</p> : null}
              {indexNote ? <p className="text-sm text-emerald-700">{indexNote}</p> : null}
              {!canBuildIndex ? (
                <p className="text-sm text-slate-600">
                  Ask an admin or analyst to build the index. Viewers can ask questions but
                  cannot write to it.
                </p>
              ) : null}
            </CardBody>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Ask a question"
          description="Answers are written only from feedback in this workspace, and every answer lists the items it used."
        />
        <CardBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
            className="space-y-3"
            noValidate
          >
            <label htmlFor="ask-question" className="sr-only">
              Your question
            </label>
            <Textarea
              id="ask-question"
              rows={3}
              value={question}
              maxLength={MAX_QUESTION}
              disabled={busy}
              placeholder="What are users saying about onboarding?"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift and Enter makes a new line.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {indexed
                  ? `Searching ${coverage.embedded} indexed items.`
                  : `Searching ${coverage.embedded} of ${coverage.total} items.`}
              </p>
              <Button type="submit" disabled={busy || question.trim().length < 3}>
                {busy ? <Spinner /> : null}
                {busy ? "Searching feedback" : "Ask"}
              </Button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={busy}
                onClick={() => void ask(suggestion)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <div aria-live="polite" className="space-y-4">
        {turns.length === 0 ? (
          <Card>
            <EmptyState
              title="No questions yet"
              description={
                coverage.total === 0
                  ? "There is no feedback in this workspace to search. Import some from the inbox first."
                  : "Ask anything about this workspace's feedback. Every answer comes back with the items behind it."
              }
            />
          </Card>
        ) : null}

        {turns.map((turn) => (
          <Card key={turn.id}>
            <CardHeader title={turn.question} />
            <CardBody>
              {turn.state === "pending" ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner />
                  Retrieving the closest feedback and reading it.
                </div>
              ) : null}
              {turn.state === "failed" ? (
                <ErrorState
                  title="That question could not be answered"
                  description={turn.error ?? undefined}
                  action={<Button onClick={() => void ask(turn.question)}>Try again</Button>}
                />
              ) : null}
              {turn.state === "done" && turn.answer ? <AnswerBlock answer={turn.answer} /> : null}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
