# LOOP

An AI customer-feedback intelligence platform. Companies receive feedback through
support tickets, app-store reviews, surveys, sales notes and community posts faster
than anyone can read it. LOOP takes all of it, classifies it, groups it into themes,
shows what is trending, and answers plain-English questions with answers backed by the
actual feedback.

Built as a multi-tenant application: each company is a workspace, and no workspace can
read another workspace's data.

## Status

Foundation in place. Feature work in progress.

- [x] Multi-tenant data model
- [x] Authentication, workspaces and three roles
- [x] Member management
- [x] Seed data
- [ ] Feedback ingestion and inbox
- [ ] Analytics dashboard
- [ ] Auto-classification and theme trends
- [ ] Ask LOOP grounded question answering
- [ ] Voice-of-Customer report

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14, App Router, TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL with pgvector |
| ORM | Prisma |
| Auth | NextAuth credentials provider, JWT sessions |
| Validation | Zod on every API boundary |
| Charts | Recharts |
| Hosting | Vercel |

## Architecture

Three tiers. The browser talks only to this app's route handlers. Route handlers are the
only thing that talks to the database or to a model provider, so no API key ever reaches
the client.

    browser  ->  route handlers  ->  services  ->  PostgreSQL
                       |
                       +-> model provider, server-side only

Every tenant-scoped query filters on workspaceId. Route handlers call `requireSession`,
which returns the caller's user id, workspace id and role. There is no code path that
reads feedback without a workspace filter.

Roles are enforced on the server. `requireRole` guards every mutating route. Hiding a
button is not access control, so a forbidden action returns 403 rather than failing
somewhere deeper.

Ingestion calls a single `processFeedback` seam. Classification and embedding sit behind
it as independent steps, so one can fail without breaking the other or the request that
created the feedback.

## Roles

| Role | Can do |
|---|---|
| ADMIN | Everything, plus managing members and their roles |
| ANALYST | Ingest and manage feedback |
| VIEWER | Read-only |

## Running locally

Requires Node 18 or newer and a PostgreSQL database with the `vector` and `pg_trgm`
extensions available. Neon and Supabase both provide these on their free tiers.

```bash
git clone https://github.com/Rohit-Gahlawat/loop.git
cd loop
npm install

cp .env.example .env    # then fill in the values below

npx prisma migrate dev  # create the schema
npm run db:seed         # load the demo workspace

npm run dev             # http://localhost:3000
```

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled PostgreSQL connection string, used at runtime |
| `DIRECT_URL` | Unpooled connection string, used only by migrations |
| `NEXTAUTH_SECRET` | Session signing secret. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Base URL of the app |
| `AI_PROVIDER` | `anthropic` or `openai-compatible` |
| `AI_BASE_URL` | Base URL when `AI_PROVIDER=openai-compatible` |
| `AI_MODEL` | Chat model identifier |
| `AI_API_KEY` | Key for the model provider, used for chat and embeddings |
| `EMBEDDING_MODEL` | Embedding model identifier |
| `EMBEDDING_DIMENSIONS` | Must match the vector size in the Prisma schema |

### Useful commands

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:studio    # browse the database
npm run db:seed      # rebuild the demo workspace
```

## Demo accounts

The seed script creates one account per role in the Northwind Software workspace so the
role behaviour can be checked without signing up.

| Email | Role |
|---|---|
| `admin@loop.demo` | ADMIN |
| `analyst@loop.demo` | ANALYST |
| `viewer@loop.demo` | VIEWER |

Password for all three: `Demo1234!`

These exist only in seeded demo data.

## Repository layout

    app/
      (auth)/          sign-in and sign-up
      (app)/           the application shell and its pages
      api/             route handlers
    components/ui/     shared primitives
    lib/
      api.ts           response envelope and error handling
      auth.ts          session, workspace scoping, role guards
      db.ts            Prisma client
      ai/              model adapter and classification
      search/          embeddings and retrieval
      pipeline/        post-ingest processing
    prisma/
      schema.prisma
      seed.ts
