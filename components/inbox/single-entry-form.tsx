"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import type { FeedbackListItem } from "@/app/api/feedback/_query";
import { sendJson } from "./client";

const MAX_CONTENT = 5000;

/**
 * Single-entry ingestion. The client checks the obvious things so the user gets
 * an instant answer, but the server validates everything again with Zod and is
 * the only thing that decides what gets saved.
 */
export function SingleEntryForm({ channels }: { channels: string[] }) {
  const router = useRouter();

  const [content, setContent] = useState("");
  const [channel, setChannel] = useState("");
  const [otherChannel, setOtherChannel] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");

  const [errors, setErrors] = useState<{ content?: string; channel?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usingOther = channel === "__other";
  const resolvedChannel = usingOther ? otherChannel.trim() : channel;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(null);

    const nextErrors: { content?: string; channel?: string } = {};
    if (content.trim().length === 0) nextErrors.content = "Feedback content is required.";
    if (content.trim().length > MAX_CONTENT) nextErrors.content = `Keep it under ${MAX_CONTENT} characters.`;
    if (resolvedChannel.length === 0) nextErrors.channel = "Choose a channel.";

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setBusy(true);
    const result = await sendJson<FeedbackListItem>("/api/feedback", "POST", {
      content: content.trim(),
      channel: resolvedChannel,
      customerLabel: customerLabel.trim() || undefined,
    });
    setBusy(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    setContent("");
    setCustomerLabel("");
    setSaved("Added. Classification runs in the background, so sentiment and themes appear shortly.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Add one piece of feedback" description="For anything that arrives by hand." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Feedback"
            htmlFor="entry-content"
            error={errors.content}
            hint={`${content.trim().length} of ${MAX_CONTENT} characters.`}
          >
            <Textarea
              id="entry-content"
              rows={4}
              placeholder="What did the customer actually say?"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel" htmlFor="entry-channel" error={errors.channel}>
              <Select
                id="entry-channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="">Choose a channel</option>
                {channels.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value="__other">Something else…</option>
              </Select>
            </Field>

            {usingOther ? (
              <Field label="New channel name" htmlFor="entry-other-channel">
                <Input
                  id="entry-other-channel"
                  maxLength={80}
                  placeholder="Webinar Q&A"
                  value={otherChannel}
                  onChange={(event) => setOtherChannel(event.target.value)}
                />
              </Field>
            ) : null}

            <Field label="Customer" htmlFor="entry-customer" hint="Optional.">
              <Input
                id="entry-customer"
                maxLength={120}
                placeholder="Acme Retail"
                value={customerLabel}
                onChange={(event) => setCustomerLabel(event.target.value)}
              />
            </Field>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          ) : null}

          {saved ? (
            <p role="status" className="text-sm text-emerald-700">
              {saved}
            </p>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Adding" : "Add feedback"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
