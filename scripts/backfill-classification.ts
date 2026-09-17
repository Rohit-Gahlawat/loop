import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

/**
 * Classifies feedback that has never been classified.
 *
 * Written for the rows that were already in the database before classification
 * shipped, and safe to run at any time afterwards: an item carrying
 * `classifiedAt` is skipped unless `--force` says otherwise, so re-running this
 * costs nothing and cannot overwrite a correction somebody made by hand.
 *
 * Usage, from the project root:
 *
 *   npx tsx scripts/backfill-classification.ts --workspace "Northwind Software"
 *   npx tsx scripts/backfill-classification.ts --workspace <id> --limit 20 --dry-run
 *   npx tsx scripts/backfill-classification.ts --workspace <id> --force
 *
 * Options:
 *   --workspace <id or name>  Which tenant to work on. Required when the
 *                             database holds more than one.
 *   --limit <n>               Stop after this many items. Useful for a first
 *                             run against a rate-limited key.
 *   --batch-size <n>          Items per model request. Default 8.
 *   --interval <ms>           Pause between requests. Default 1500, which sits
 *                             inside a free tier without much waiting.
 *   --force                   Classify items that already carry classifiedAt.
 *   --dry-run                 Report what would be sent and stop.
 *
 * The database and the model provider are read from `.env`, the same file the
 * app reads. `AI_MODEL` has to name a model the key can actually reach: a
 * retired model answers 404 and every item comes back for manual review.
 */

const argsSchema = z.object({
  workspace: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
  batchSize: z.coerce.number().int().min(1).max(25).default(8),
  interval: z.coerce.number().int().min(0).max(120_000).default(1_500),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  help: z.boolean().default(false),
});

type Args = z.infer<typeof argsSchema>;

const VALUE_FLAGS: Record<string, keyof Args> = {
  "--workspace": "workspace",
  "-w": "workspace",
  "--limit": "limit",
  "--batch-size": "batchSize",
  "--interval": "interval",
};

const BOOLEAN_FLAGS: Record<string, keyof Args> = {
  "--force": "force",
  "--dry-run": "dryRun",
  "--help": "help",
  "-h": "help",
};

const USAGE = `Classifies feedback that has never been classified.

  npx tsx scripts/backfill-classification.ts --workspace "Northwind Software"

  --workspace <id or name>  Which tenant to work on
  --limit <n>               Stop after this many items
  --batch-size <n>          Items per model request, default 8
  --interval <ms>           Pause between requests, default 1500
  --force                   Also re-classify items that already have a result
  --dry-run                 Report what would be sent and stop
`;

/** Validated the same way an API input would be, so a typo fails with a reason. */
function parseArgs(argv: string[]): Args {
  const raw: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    const booleanFlag = BOOLEAN_FLAGS[token];
    if (booleanFlag) {
      raw[booleanFlag] = true;
      continue;
    }

    const valueFlag = VALUE_FLAGS[token];
    if (valueFlag) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${token} needs a value.`);
      }
      raw[valueFlag] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unrecognised option: ${token}. Run with --help for the list.`);
  }

  return argsSchema.parse(raw);
}

/**
 * Next loads `.env` for the app and the Prisma CLI loads it for the seed. A
 * script run through tsx is neither, so it loads the file itself. Anything
 * already exported wins, which is how a one-off run can point at another model.
 */
function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  if (typeof process.loadEnvFile !== "function") return;

  try {
    process.loadEnvFile();
  } catch {
    // No .env beside the project root. The check below reports it properly.
  }
}

async function resolveWorkspace(
  prisma: PrismaClient,
  name: string | undefined,
): Promise<{ id: string; name: string }> {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  if (workspaces.length === 0) throw new Error("This database has no workspaces. Seed it first.");

  if (!name) {
    if (workspaces.length === 1) return workspaces[0];
    const options = workspaces.map((workspace) => `  ${workspace.id}  ${workspace.name}`).join("\n");
    throw new Error(
      `This database holds ${workspaces.length} workspaces, so --workspace is required:\n${options}`,
    );
  }

  const match = workspaces.find(
    (workspace) => workspace.id === name || workspace.name.toLowerCase() === name.toLowerCase(),
  );
  if (!match) throw new Error(`No workspace matches "${name}".`);

  return match;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 6) / 10} minutes`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  // Imported after the environment is in place: both modules build their client
  // the moment they are loaded.
  const { prisma } = await import("../lib/db");
  const { classifyBatch } = await import("../lib/ai/classify");

  try {
    const workspace = await resolveWorkspace(prisma, args.workspace);
    const where = { workspaceId: workspace.id, ...(args.force ? {} : { classifiedAt: null }) };

    const [total, pending] = await Promise.all([
      prisma.feedback.count({ where: { workspaceId: workspace.id } }),
      prisma.feedback.count({ where }),
    ]);

    console.log(`Workspace:  ${workspace.name} (${workspace.id})`);
    console.log(
      `Feedback:   ${total} items, ${pending} ${args.force ? "to re-classify" : "not classified yet"}`,
    );

    if (pending === 0) {
      console.log("Nothing to do.");
      return;
    }

    // Only the ids are read here. The classifier loads the content itself, and
    // it re-checks the workspace when it does.
    const rows = await prisma.feedback.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(args.limit ? { take: args.limit } : {}),
    });

    const batches = Math.ceil(rows.length / args.batchSize);
    console.log(
      `Sending:    ${rows.length} items in ${batches} ${batches === 1 ? "request" : "requests"} of up to ${args.batchSize}, ${args.interval}ms apart`,
    );
    console.log(`Model:      ${process.env.AI_MODEL ?? "not set"}`);

    if (args.dryRun) {
      console.log("Dry run, nothing was sent and nothing was written.");
      return;
    }

    const started = Date.now();

    const outcome = await classifyBatch(
      rows.map((row) => row.id),
      workspace.id,
      {
        force: args.force,
        batchSize: args.batchSize,
        spacingMs: args.interval,
        onProgress: ({ batch, batches: count, classified, needsReview }) => {
          console.log(
            `  batch ${batch}/${count}: ${classified} classified, ${needsReview} for review, ${duration(Date.now() - started)} elapsed`,
          );
        },
      },
    );

    console.log("");
    console.log(`Classified:     ${outcome.classified}`);
    console.log(`Skipped:        ${outcome.skipped} already had a result`);
    console.log(`Needs review:   ${outcome.needsReview.length}`);
    console.log(
      `Model requests: ${outcome.modelCalls}, of which ${outcome.throttledRetries} had to be repeated after a refusal`,
    );
    console.log(`Took:           ${duration(Date.now() - started)}`);

    if (outcome.newThemes.length > 0) {
      console.log(`New themes:     ${outcome.newThemes.join(", ")}`);
    }

    if (outcome.needsReview.length > 0) {
      console.log("");
      console.log("These items could not be read back from the model and were left unclassified.");
      console.log("They sit under the inbox's Unclassified filter. Running again retries them.");
      for (const id of outcome.needsReview) console.log(`  ${id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
