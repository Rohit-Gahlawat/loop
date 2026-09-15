import Anthropic from "@anthropic-ai/sdk";

/**
 * Single point of contact with the chat model.
 * Provider and model are environment configuration, so nothing above this file
 * needs to know which vendor is answering.
 */

export type CompleteArgs = {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function completeAnthropic({ system, prompt, maxTokens, temperature }: CompleteArgs) {
  const client = new Anthropic({ apiKey: env("AI_API_KEY") });

  const message = await client.messages.create({
    model: env("AI_MODEL", "claude-sonnet-4-6"),
    max_tokens: maxTokens ?? 1024,
    temperature: temperature ?? 0,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function completeOpenAiCompatible({
  system,
  prompt,
  maxTokens,
  temperature,
}: CompleteArgs) {
  const response = await fetch(`${env("AI_BASE_URL")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("AI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: env("AI_MODEL"),
      max_tokens: maxTokens ?? 1024,
      temperature: temperature ?? 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return body.choices[0]?.message?.content ?? "";
}

export async function complete(args: CompleteArgs): Promise<string> {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  return provider === "anthropic"
    ? completeAnthropic(args)
    : completeOpenAiCompatible(args);
}
