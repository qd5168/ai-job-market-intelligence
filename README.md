<div align="center">

# AI Job Market Intelligence

**An AI-driven job market intelligence platform** — aggregates remote job postings from
compliant data sources, parses them with LLMs into structured fields, and matches them
against your profile with a hybrid AI scoring model that explains _why_ a job fits (and
what skills you're missing).

[English](./README.md) | [中文](./README.zh.md)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)

**[Live Demo →](https://ai-job-market-intelligenceweb-production.up.railway.app)**

</div>

---

## Screenshots

|                                                                                                                                                                                                                        |                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Dashboard](screenshots/dashboard.png) **Dashboard** — jobs scored against your profile, application status at a glance, and a live skill-gap breakdown against a target role.                                        | ![Job detail](screenshots/job-detail.png) **Job detail** — hybrid score broken into LLM / embedding / rule components, plus an AI-drafted outreach message for that specific role. |
| ![Career Coach](screenshots/career-coach.png) **Career Coach** — a job scoring ≥ 90 triggers a real-time handoff from Opportunity Discovery; the coach proactively opens the conversation, and the timeline shows why. | ![Skill Market Intelligence](screenshots/skill-market.png) **Skill Market Intelligence** — skill demand ranking and a skill × role heatmap, computed from the live job pool.       |

<details>
<summary>Job list</summary>

![Job list](screenshots/jobs-list.png)

</details>

All screenshots are from a demo account seeded with real, unedited output from the
live scoring/Career Coach pipeline (not mocked copy) — see the [Live Demo](https://ai-job-market-intelligenceweb-production.up.railway.app)
to try it yourself.

---

## What is this?

You paste your resume or link your GitHub, and the platform:

1. Continuously ingests job postings from **5 Tier-1 compliant sources** (public APIs
   only — no scraping of ToS-prohibited sites like LinkedIn, Indeed, or Glassdoor).
2. Runs every job through an **LLM parsing pipeline** to extract structured fields
   (role, seniority, skills, salary range, remote policy) from freeform descriptions.
3. Deduplicates the same job posting when it appears across multiple sources, using
   embedding similarity.
4. Scores every job against your profile with a **hybrid model** (LLM reasoning +
   embedding similarity + rule-based signals), producing a match score, a structured
   "why this fits / what's missing" explanation, and a skill-gap breakdown.
5. Notifies you by email when a strong match shows up, and surfaces it in-app via
   Opportunity Discovery and your Daily Brief.
6. Hands you off to an AI Career Coach — a tool-calling chat assistant that can look up
   career paths, skill trends, and salary ranges, and proactively opens a conversation
   whenever a stand-out match (score ≥ 90) appears.

It's a monorepo, fully bilingual (English/Chinese), and built to be cheap to run — the
AI layer defaults to free models via [OpenRouter](https://openrouter.ai).

> **Note**: Billing on the live demo runs against **Stripe test mode** — the
> "Upgrade to Pro" flow does not charge real money and only accepts Stripe's test
> card numbers, e.g.:
>
> | Scenario                          | Card number           | Expiry / CVC / ZIP                            |
> | --------------------------------- | --------------------- | --------------------------------------------- |
> | Payment succeeds                  | `4242 4242 4242 4242` | any future date / any 3 digits / any 5 digits |
> | Payment is declined               | `4000 0000 0000 0002` | same as above                                 |
> | Requires 3D Secure authentication | `4000 0025 0000 3155` | same as above                                 |
>
> Full list: [Stripe's testing docs](https://docs.stripe.com/testing).

## Key Features

- **Email Magic Link auth** — no passwords, powered by Auth.js v5 + Resend
- **Career profile** — manual skill entry, resume upload (parsed by LLM), and GitHub
  public-profile parsing (language distribution, README summaries), merged into one
  profile with async parse-status feedback (pending/success/failed)
- **Compliant multi-source job ingestion** — RemoteOK, Greenhouse, Lever, Ashby,
  Himalayas; company discovery for the three ATS platforms runs via a free, zero-config
  mechanism (Common Crawl index queries), no paid search API required
- **AI structured job parsing** — role / seniority / skills / salary / remote policy
  extracted from raw job descriptions, with confidence scores
- **Cross-source deduplication** — the same posting appearing on multiple boards is
  merged via embedding similarity, not treated as duplicate listings
- **Hybrid AI scoring** — LLM + embedding + rule-based signals, with structured
  reasoning (strengths / gaps) rather than an opaque number
- **Skill gap analysis** — compares your skills against a target role's requirements
- **Skill Intelligence** — market-wide skill demand ranking and a skill co-occurrence
  heatmap (`/market/skills`)
- **AI Career Agent** — a Daily Brief digest of your top-matching jobs, real-time
  high-match alerts (Opportunity Discovery), and a Career Coach chat assistant with
  tool-calling (career path recommendations, skill trends, salary ranges)
- **Multi-agent handoff** — a job scoring ≥ 90 against your profile triggers an
  automatic handoff from Opportunity Discovery to Career Coach, which proactively opens
  a conversation about that specific match
- **Content-hash based incremental crawling** — unchanged postings skip re-parsing and
  re-embedding to control LLM cost
- **Job closure detection** — postings removed from a company's board are marked
  closed rather than lingering forever
- **Free / Pro subscription tiers** via Stripe (test mode on the live demo)
- **Bilingual UI** (English default / Chinese) via next-intl

## Tech Stack

| Layer           | Choice                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend        | Next.js 15 (App Router), TypeScript, shadcn/ui + Tailwind CSS, TanStack Query v5                                                                              |
| Backend         | Next.js Route Handlers, Prisma, Zod                                                                                                                           |
| Queue / Workers | BullMQ + Redis                                                                                                                                                |
| Database        | PostgreSQL 16 + `pgvector` (job & profile embeddings)                                                                                                         |
| AI              | [OpenRouter](https://openrouter.ai) — LLM (`google/gemma-4-26b-a4b-it:free`) + embeddings (`nvidia/llama-nemotron-embed-vl-1b-v2:free`), cost-first by design |
| Auth            | Auth.js v5 (Email Magic Link via Resend)                                                                                                                      |
| Payments        | Stripe (Free / Pro, test mode on the live demo)                                                                                                               |
| i18n            | next-intl (`en` default / `zh`)                                                                                                                               |
| Testing         | Vitest (unit) + Playwright (E2E)                                                                                                                              |
| CI              | GitHub Actions                                                                                                                                                |
| Deployment      | Railway (single project: Postgres + Redis + Worker + Web)                                                                                                     |

## Architecture

Monorepo managed with pnpm workspaces + Turborepo:

```
ai-job-market-intelligence/
├── apps/
│   ├── web/           # Next.js app — UI + REST API routes
│   └── worker/         # BullMQ worker — ingestion, AI parsing, scoring, notifications
├── packages/
│   ├── db/             # Prisma schema + generated client (single source of truth for data model)
│   ├── shared/         # Shared types/schemas, job source adapters, queue definitions
│   └── ai/             # LLM prompts, hybrid scoring, embeddings, resume/GitHub parsing
└── docker-compose.yml   # Local Postgres (pgvector) + Redis
```

Jobs are a **platform-wide pool** (not per-tenant) — every user is scored against the
same job data, keeping ingestion cost independent of user count. There is no
organization-level multi-tenancy; this is a B2C, single-user-per-account product.

### Data pipeline (high level)

```
Company Discovery (weekly, zero-config via Common Crawl)
  → upsert candidate companies for Greenhouse/Lever/Ashby
       ↓
Ingestion cron (per-adapter schedule)
  → fetch → normalize → filter (remote, recent, non-spam)
       ↓
AI Job Parsing (LLM structured extraction, skipped for sources with native structured data)
  → embedding generation
  → cross-source dedup (embedding similarity)
  → upsert jobs
       ↓
Scoring (hybrid LLM + embedding + rule model, per active user)
  → email notification if score is high enough (Pro only)
  → Opportunity Discovery + Daily Brief (in-app)
  → score ≥ 90 → Agent Handoff → Career Coach proactively opens a conversation
```

### Compliance stance

Job data sources are only added after being classified:

- **Tier 1 (used)** — official public APIs that explicitly allow programmatic access:
  RemoteOK, Greenhouse, Lever, Ashby, Himalayas
- **Tier 2 (evaluated case-by-case)** — public pages without an official API; requires
  `robots.txt`/ToS review before any ingestion
- **Tier 3 (permanently excluded)** — platforms whose ToS explicitly prohibit
  automated access or that have prior litigation history over scraping (LinkedIn,
  Indeed, Glassdoor). These are never scraped, regardless of demand.

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Docker (for local Postgres + Redis)

### Setup

```bash
git clone https://github.com/<your-username>/ai-job-market-intelligence.git
cd ai-job-market-intelligence
pnpm install

docker compose up -d

cp apps/web/.env.example apps/web/.env.local
cp apps/worker/.env.example apps/worker/.env
# fill in at minimum: OPENROUTER_API_KEY, RESEND_API_KEY

pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: http://localhost:3000
- Worker health check: http://localhost:3001
- Prisma Studio: `pnpm db:studio`

Job ingestion (company discovery, AI parsing, scoring) runs entirely with **zero
required external API keys** beyond `OPENROUTER_API_KEY` and `RESEND_API_KEY` — company
discovery for the ATS sources uses the free, public Common Crawl index, no search API
key needed.

### Common scripts

| Command                        | Description                          |
| ------------------------------ | ------------------------------------ |
| `pnpm dev`                     | Run web + worker in dev mode         |
| `pnpm build`                   | Build all apps/packages              |
| `pnpm lint` / `pnpm typecheck` | Lint / type-check the whole monorepo |
| `pnpm test`                    | Run unit tests (Vitest)              |
| `pnpm test:e2e`                | Run E2E tests (Playwright)           |
| `pnpm db:migrate`              | Apply Prisma migrations (dev)        |
| `pnpm db:studio`               | Open Prisma Studio                   |

## Deployment

Everything runs in a single [Railway](https://railway.app) project, as four services:

- **Postgres** (custom `pgvector/pgvector:pg16` image, not Railway's built-in Postgres
  plugin — the plugin's default image doesn't guarantee the pgvector extension) and
  **Redis** as database add-ons.
- **Worker** and **Web** connected directly to the GitHub repo, built with Railway's
  Railpack builder (`pnpm --filter <package> build` / `start`), auto-deploying on every
  push to `master`. Worker needs a persistent long-running process (BullMQ requires a
  raw TCP Redis connection and continuously running repeatable jobs), which is why it's
  a Railway service rather than a serverless function.
- All four services share the same Railway internal network, so Worker/Web connect to
  Postgres/Redis via internal hostnames rather than public endpoints.
- **CI** (GitHub Actions) runs lint → typecheck → test → build on every push/PR, and
  applies database migrations before Railway's own deploy on `master` (Railway's GitHub
  integration handles the actual service deploys, independently of this workflow).

## License

[MIT](./LICENSE)
