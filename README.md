# AI Job Portal — Microservices Platform

A modular rewrite of the AI job portal as independently deployable services.
The legacy three-app setup (monolith backend + 2 frontends) is untouched and
keeps running; this platform is the replacement backend.

```
platform/
├─┄ packages/shared          @portal/shared — contracts: types, events, JWT, http, mongo, redis
├─┄ services/
│   ├─┄ api-gateway          :8000  JWT at the edge, routing, rate limiting, CORS
│   ├─┄ auth-service         :8001  users, register/login/refresh (rotation + theft detection)
│   ├─┄ job-service          :8002  job CRUD, text search, AI job description
│   ├─┄ application-service  :8003  applications, AI screening, status workflow, AI interview summary on GET /:id
│   ├─┄ resume-service       :8004  resume CRUD, PDF export, AI content feed
│   ├─┄ company-service      :8005  company profiles, hardened logo uploads
│   ├─┄ ai-service           :8006  ALL AI calls (interview AI, screening, content) — internal only
│   ├─┄ interview-service    :8008  dedicated AI Interview lifecycle (start/answer/report)
│   └─┄ notification-service :8007  Redis Streams consumer → notifications, activities, emails
├─┄ infra/Dockerfile.service  one parametrized Dockerfile for all services
└─┄ docker-compose.yml        full local stack (mongo, redis, 8 services + gateway)
```

## Run locally (Docker)

```bash
cd platform
cp .env.example .env        # fill JWT secrets, AI_API_KEY, ADMIN_EMAIL/PASSWORD
docker compose up -d --build
```

Gateway (and every API route) is then at `http://localhost:8000`.

## API documentation

OpenAPI 3.0 spec + Swagger UI are served by the gateway (no extra deps):

- `http://localhost:8000/api-docs` — Swagger UI (loads swagger-ui-dist from CDN).
- `http://localhost:8000/openapi.json` — machine-readable spec (import into Postman/Insomnia/curl).

Sign in with `POST /api/auth/login` to get an `accessToken`, paste `Bearer <token>` into the **Authorize** dialog in the UI (auth is persisted across requests), then try out any endpoint. Docs are generated from the real gateway route table (see `services/api-gateway/src/openapi.ts`) and reflect the shared Zod contracts. Offline? The UI needs the CDN; `/openapi.json` is always available regardless.

### Postman collection

A ready-to-import Postman Collection v2.1 is committed at `infra/postman_collection.json`
(41 requests across Auth / Companies / Jobs / Applications / Interviews / Notifications,
Bearer auth on `{{access_token}}`, `{{base_url}}` = `http://localhost:8000`).

Import with **File → Import → Upload Files** inside Postman, then:

1. `POST /api/auth/login` (email/password) → copy `data.accessToken` into `{{access_token}}`
   (or paste it into the **Authorize** dialog — `persistAuthorization` is on),
2. run any other request.

## Run locally (bare Node 20+)

```bash
cd platform
cp .env.example .env
npm install
npm run build               # builds shared, then every service
npm run dev --workspace services/api-gateway
# in other terminals:
npm run dev --workspace services/auth-service
npm run dev --workspace services/job-service
npm run dev --workspace services/application-service
npm run dev --workspace services/resume-service
npm run dev --workspace services/company-service
npm run dev --workspace services/ai-service
npm run dev --workspace services/interview-service
npm run dev --workspace services/notification-service
```

## API surface

| Route prefix | Service | Auth |
|---|---|---|
| `/api/auth/*` | auth-service | public (login/register/refresh) + admin role management |
| `/api/jobs` | job-service | read public; write: employer |
| `/api/applications` | application-service | participant/employer |
| `/api/resumes` | resume-service | owner only |
| `/api/companies` | company-service | read public; write: owner |
| `/api/notifications` | notification-service | bearer |
| `/api/interviews` | interview-service | job-seeker / employer |

## AI Interview feature

Candidates take an **AI-conducted interview** on one of their applications.
Interviews live in their own service (`interview-service`, port 8008) with a
database-per-service (`portal_interviews`). The session snapshot (job title,
candidate/employer ids) is captured from application-service at start, so the
interview survives job/employer changes later.

| Endpoint (via gateway) | Role | What |
|---|---|---|
| `POST /api/interviews/start` { applicationId, language } | candidate | AI generates a tailored question set (technical/behavioral/resume/intro) from the job + the candidate's resume |
| `POST /api/interviews/start` { applicationId, language, **customQuestions** } | candidate | **Employer-custom mode**: the employer-supplied questions are used verbatim (`mode: "custom"`) — answers are human-graded (no AI score); the employer evaluates the transcript + DISC profile |
| `POST /api/interviews/:id/answer` { answer } | candidate | AI scores 0–10 with feedback + next question (in `custom` mode the answer is stored **without** an AI score and evaluated by the employer) |
| `POST /api/interviews/:id/answer/stream` { answer } | candidate | **SSE stream**: tokens flow live as `{"type":"token","content":"..."}`, then a final `{"type":"done"}` carrying the scored answer + next question (same scoring/DB logic as `answer`). In `custom` mode it records the answer and returns a confirmation + `done` |
| `GET /api/interviews/:id/disc/items` | participant | The 24 assessment statements (localized fa/en) with their factor |
| `POST /api/interviews/:id/disc/answers` { responses: [{index, rating 1-5}] } | candidate | Submit the personality assessment → server computes D/I/S/C scores (0–100) + primary profile; stored on the session |
| `GET /api/interviews/:id/disc` | employer | The candidate's personality profile (factor scores, primary label) for human evaluation |
| `GET /api/interviews/:id` | participant | Session state (questions, answers, scores, mode, DISC summary) |
| `GET /api/interviews/by-application/:applicationId` | participant | Find the interview attached to a given application |
| `PATCH /api/interviews/:id/abandon` | candidate | Abandon an in-progress interview |
| `GET /api/interviews/:id/report` | employer | Full transcript + hiring report (score, strengths, weaknesses, recommendation) |
| `GET /api/interviews/employer` | employer | List + filter interviews across their jobs |

Two interview modes:

- **`ai`** (default) — AI generates the questions and scores each answer 0–10
  (streaming supported). Completion writes an AI hiring report back to the
  application and publishes `interview.completed` with the overall score.
- **`custom`** — the employer supplies the questions at `start`
  (`customQuestions`). Answers are recorded **without** an AI score; the
  employer evaluates the transcript themselves, supported by the
  **personality assessment**: 24 statements (6 per factor — Dominance /
  Influence / Steadiness / Conscientiousness, a generic model, not the
  trademarked DISC instrument) rated 1–5 by the candidate, normalized to
  0–100 per factor with the highest factor as the primary profile. The
  `interview.completed` event carries `overallScore: null` +
  `recommendation: "pending"` for this mode.

On completion an `interview.completed` event is published on the
`portal:events` Redis stream; `notification-service` consumes it to notify the
employer (dashboard activity + email) and to log the candidate's activity.
The interview is also **written back** onto the originating application
(`application.interviewScore` / `application.interviewRecommendation`) via an
internal call to `application-service` — so the application's `GET /:id` still
exposes the interview summary, and employer application lists can sort by it.

Design points:

- **One interview per application** (`applicationId` unique index) — cannot double-book.
- **Access control**: a session can only be read/answered by its candidate or seen by
  its employer (admin override); employer list is scope-filtered.
- **Graceful degradation**: if AI fails to generate questions, the start returns a
  clear 503; a failed answer-score leaves the answer unsaved (retryable, no partial
  score); on report failure the overall score falls back to the average of per-answer
  scores and the recommendation follows a simple threshold.
- **Injection guard**: resume + cover-letter content from application/job/resume
  services is wrapped in a `<candidate_data>` block with a system prompt in every
  AI request — the same guard used for job descriptions, screening and cover letters.
- **No AI keys here**: interview-service never holds secrets; it calls ai-service
  over the internal network using the shared internal token.

## Architecture notes

- **Database-per-service**: each service owns its Mongo database; no cross-service
  joins. One shared `mongod` in dev compose, differentiated by db name.
- **Events over Redis Streams** (`portal:events`): services publish validated (zod)
  domain events; `notification-service` consumes them in a consumer group with a
  dead-letter stream.
- **Internal calls**: `/internal/*` endpoints on each service require the shared
  `x-internal-token`. AI keys live only in `ai-service`.
- **Auth**: short-lived access JWT (15m) verified at the gateway — one DB hit per
  login, zero per request after that; rotating refresh tokens (30d) stored as
  JTI→family in Redis — replay of a revoked token kills the whole family (theft
  detection).
- **Edge-to-service trust**: the gateway resolves the JWT **once** and injects
  `x-user-*` headers; internal endpoints additionally require the internal token.
- **Uploads**: company logos are re-encoded with `sharp` (magic-byte safety), stored
  under server-generated UUID names, served from a strict allowlist route.
- **Admin bootstrap**: admin accounts can only be created via `AUTH_SERVICE_ADMIN_EMAIL`
  + `AUTH_SERVICE_ADMIN_PASSWORD` env at auth-service startup — never by registration.
- **Admin role management**: an admin can promote/demote any user via
  `PATCH /api/auth/users/:id/role` with `{ role: "job-seeker" | "employer" | "admin" }`.
  The endpoint is gated on the JWT role (injected by the gateway as `x-user-role`);
  non-admin callers receive 403. Setting a user to their current role returns 409,
  and an invalid role enum returns 400. A `user.role_updated` event is published
  on the `portal:events` stream on every successful change.

### Performance note — bcryptjs

This service uses `bcryptjs` (pure JavaScript) with configurable cost via the
`BCRYPT_ROUNDS` env var (default 12). On most machines a 12-round compare takes
**~700 ms** — this is the dominant cost in login/register latency.

| Config | Login time (measured) |
|---|---|
| `BCRYPT_ROUNDS=12` (default) | ~700 ms |
| `BCRYPT_ROUNDS=10` | ~200 ms |

**For local dev**: set `BCRYPT_ROUNDS=10` in your root `.env` and restart
`auth-service`. Existing `$2a$12$` hashes still verify correctly (bcrypt
embeds the cost in the hash).

**For production**: swap `bcryptjs` → native `bcrypt` (`npm install bcrypt`
in auth-service, same API). Native compare at 12 rounds is **~20-40 ms** —
an 18× improvement with no security trade-off.

## Environment

- Root `.env` (read by compose via `env_file`) holds shared config and service URLs
  (overridable per environment for production — see the prod notes below).
- Each service also has its own `.env.example` with its specific vars.
- `JWT_SECRET` / `JWT_REFRESH_SECRET`: generate with
  `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. Never
  commit the filled `.env`.

## Production notes

- `INTERNAL_API_TOKEN` must be a long random secret rotated with all services.
- Point `MONGODB_URI` at a managed cluster; enable TLS in compose overrides.
- `AI_API_KEY` + `AI_BASE_URL` go in `ai-service`'s environment only — never the
  gateway or any other service/container.
- `NOTIFICATION_SMTP_*` enable real email; omitted → console fallback (dev only).

## Next steps (not in this scaffold)

- Frontend migration: point `frontend-jobseeker` + `company-frontend` at the gateway
  (`/api`) — route shapes are compatible by design.
- Test suite (vitest + supertest, incl. AI mock) + CI.
- Observability: structured logging (pino) + request ids, a `/metrics` endpoint,
  Docker healthchecks already in `compose`.

## AI Interview flow

```
candidate                       gateway                       interview-service                 ai-service       application-svc     notification-svc
   |                            |                                |                              |                 |                    |
   | POST /api/interviews/start |                                |                                |                 |                    |
   |------------------------->|                                |                                |                 |                    |
   |           (x-user-* headers)                              |                                |                 |                    |
   |                            | GET /internal/:id (app)        |                                |                 |                    |
   |                            |----------------------------->|                                |                 |                    |
   |                            |           GET /internal/:jobId |                                |                 |                    |
   |                            |                                |----------------------------->|                 |                    |
   |                            |                                | POST /internal/interview/questions
   |                            |                                |<-----------------------------|                 |                    |
   |                            |                                | create session               |                 |                    |
   |                            | 201 created (next question)    |                                |                 |                    |
   |<---------------------------|                                |                                |                 |                    |
   | POST .../answer            |                                |                                |                 |                    |
   |------------------------->|                                |                                |                 |                    |
   |                            | POST /internal/interview/score-answer                        |
   |                            |------------------------------->|                                |                 |                    |
   |                            |                                |<-------------------------------|                 |                    |
   |    [score + feedback + next Q]                                |                                |                 |                    |
   |<---------------------------|                                |                                |                 |                    |
   | ... (repeat per answer) ... |                                |                                |                 |                    |
   |                            | POST /internal/interview/report                          |         |                 |                    |
   |                            |------------------------------->|                                |                 |                    |
   |    [final report]                                              |                                |                 |                    |
   |                            | PATCH /api/applications/internal/:id/interview-result     |         |                    |
   |                            |--------------------------------------------------------->|         |                    |
   |                            |                    publish interview.completed ------------->|     |
   |                            |                                                               |     |
   |                            | 200 completed                                                 |     |
   |<---------------------------|                                                              |     |
   |                            |                                                              | notify (email/dashboard/activity)
```
