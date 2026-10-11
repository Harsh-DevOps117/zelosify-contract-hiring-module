# Running the contract hiring module

## Backend

Use Node.js 22 or newer. The hiring module uses PostgreSQL for metadata and binary document storage, Keycloak for authentication, and Groq for recommendations. It requires no S3 bucket or AWS credentials. No new application dependencies are required.

```bash
cd Zelosify-Backend/Server
npm ci
cp .env.example .env
```

Populate the empty environment values using your own configuration. Do not reuse example secrets from the supplied setup document. `HIRING_UPLOAD_SIGNING_SECRET` must contain at least 32 characters. A suitable random value can be generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep `.env` untracked.

Required for the hiring feature:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection with the intended application schema. |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` | JWT issuer and authorized client. |
| `KEYCLOAK_AUDIENCE` | Optional additional JWT audience enforcement when the realm emits the configured audience. |
| `FRONTEND_URL` | Exact allowed browser origin, normally `http://localhost:5173`. |
| `HIRING_UPLOAD_SIGNING_SECRET` | Signs backend upload reservations; at least 32 characters. |
| `LLM_API_KEY`, `GROQ_MODEL` | Tool-calling model; default model is `qwen/qwen3.8-27b`. |
| `HIRING_WORKER_CONCURRENCY` | Concurrent profiles per worker process, 1–16, default 4. |

Configure the other existing Keycloak/session/encryption variables according to the original setup guide. Keycloak still needs to be configured for API startup and login. Legacy AWS initialization is now lazy; AWS settings are needed only if you use the unrelated inherited AWS endpoints. Put your Groq key in the untracked backend `.env` as `LLM_API_KEY`. The legacy `GROQ_API_KEY` name is supported as a fallback, but the new setting takes precedence. Never prefix this secret with `NEXT_PUBLIC_`.

Start the existing database/Keycloak stack as described in the supplied guide. Apply the additive migration and seed:

```bash
npm run prisma:deploy
npm run prisma:generate
npm run seed:hiring
npm run build
npm start
```

In another terminal, from the same backend directory:

```bash
npm run worker:hiring:start
```

For development, use `npm run dev` and `npm run worker:hiring` in separate terminals. The worker is essential: accepted submissions stay pending until it runs. The worker refuses to start without a Groq key and never falls back to fake recommendations. On HTTP 429, worker consumers in the same process share a cooldown honoring `Retry-After` (60 seconds when absent); the job stays queued without consuming a processing attempt. Separate worker replicas do not share this in-memory cooldown.

The idempotent seed creates tenant `b0000000-0000-4000-8000-000000000001` (Bruce Wayne Corp), twelve varied openings, and a database-only manager placeholder. The placeholder is not a login account. Register vendor and manager users through the existing Keycloak-backed registration/TOTP flow using this tenant. Assign the manager's signed realm role and database role as `HIRING_MANAGER`, and the vendor's as `IT_VENDOR`.

Assign the seed openings to your registered manager's **database user ID**:

```bash
HIRING_SEED_MANAGER_ID=<manager-database-user-id> npm run seed:hiring
```

This validates that the manager belongs to the seeded tenant. Other tenants and unrelated openings are not seeded or reassigned.

For Docker Compose, set `HIRING_SEED_MANAGER_ID` in the root `.env`, then run
`docker compose run --rm --no-deps migrate node dist/scripts/seedHiring.js`.
The migration service also uses this setting on subsequent starts, so the demo
openings remain assigned to that manager.

## PostgreSQL document migration

Run `npm run prisma:deploy` before starting the updated server or worker. The new migration renames the former `s3Key` columns to `documentKey` without deleting their values and creates `ProfileDocument`, with a PostgreSQL `bytea` column and a foreign key to the upload reservation. Listing queries never select the blob column.

The binary upload and its completion marker commit in one transaction. Submission verifies document presence and creates profile/job records atomically. SHA-256 makes repeated uploads idempotent and rejects replacement content under an existing reservation. Soft deletion removes application access while retaining the stored document for audit.

The SQL migration cannot copy historical files from S3. If you have real profiles from an earlier S3 deployment, import their bytes into `ProfileDocument` under their preserved keys before cutover, or re-upload them. Existing metadata is preserved; absent bytes return `DOCUMENT_NOT_FOUND`. This storage change is the user's requested staging design and intentionally differs from the assignment PDF's S3 requirement.

The application does not automatically purge expired upload documents. Retention must target expired, unconsumed reservations only; database backups and disk capacity now need to account for file bytes.

## Frontend

```bash
cd Zelosify-Frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173/login`. Vendor and manager workspaces are `/vendor/openings` and `/hiring-manager/openings`. The existing dashboard also has an Openings link for each persona. `NEXT_PUBLIC_BACKEND_URL` should point to the backend's `/api/v1` base.

On `/register`, enter the **Organization ID** `b0000000-0000-4000-8000-000000000001`
for the seeded Bruce Wayne Corp tenant, and choose **IT Vendor** or **Hiring Manager**.
The organization ID must refer to an existing tenant; a company name is not an ID.
After registration, `/setup-totp` displays the authenticator QR code. Verify a code
within five minutes to complete signup. If the session expires, save the QR code
in your authenticator and sign in again. Google and Microsoft OAuth routes are not
implemented in this repository, so their sign-in buttons are not shown.

Production commands are `npm run build` and `npm start`. The hiring layouts verify authorization on the server using the access-token cookie. Hosting frontend and backend on unrelated domains therefore needs an explicit cookie/session integration; local development uses the same `localhost` host on different ports as in the supplied guide.

## API surface

Both `/api/v1` and the assignment's `/api` prefixes expose these paths. Every endpoint requires authenticated identity; writes using cookies also require the configured Origin.

| Method | Path after prefix | Purpose |
| --- | --- | --- |
| GET | `/hiring/session` | Verified actor/tenant/role for route guards. |
| GET | `/vendor/openings` | Paginated tenant openings. |
| GET | `/vendor/openings/:id` | Opening, manager name, own profile count and paginated own profiles. |
| GET | `/vendor/openings/:id/profiles` | Paginated own submissions. |
| POST | `/vendor/openings/:id/profiles/presign` | Signed backend upload reservations. |
| PUT | `/vendor/openings/:id/profiles/uploads/:uploadId?ticket=...` | Binary PDF/PPTX upload through the backend. |
| POST | `/vendor/openings/:id/profiles/upload` | Atomically submit reservations and queue recommendations. |
| DELETE | `/vendor/profiles/:id` | Soft delete an owned profile. |
| GET | `/vendor/profiles/:id/file` | Authorized private preview/download. |
| GET | `/hiring-manager/openings` | Paginated manager-owned openings. |
| GET | `/hiring-manager/openings/:id` | Scoped detail and candidate list. |
| GET | `/hiring-manager/openings/:id/profiles` | Paginated candidates with recommendation fields. |
| GET | `/hiring-manager/profiles/:id/file` | Authorized preview/download. |
| POST | `/hiring-manager/profiles/:id/shortlist` | Record shortlist decision. |
| POST | `/hiring-manager/profiles/:id/reject` | Record rejection decision. |
| POST | `/hiring-manager/profiles/:id/recommend` | Idempotently request a failed/outdated recommendation again. |

Pagination uses `page` and `pageSize`, with page size 1–100. Presign payload:

```json
{"files":[{"fileName":"candidate.pdf","size":12345,"contentType":"application/pdf"}]}
```

PUT the exact bytes to each returned `uploadPath` with the declared Content-Type. Submit payload:

```json
{"uploadIds":["reservation-uuid-from-presign"]}
```

Do not send document keys, uploader IDs, tenant IDs or roles. Those are derived server-side.

## Automated verification

From `Zelosify-Backend/Server`:

```bash
npm run build
npm test -- --run
npm run test:hiring:performance
```

The normal test run skips PostgreSQL integration unless an explicit test database URL is set. Use a dedicated test database. The suite creates a random schema, applies migrations there, and removes only that schema afterward.

For an isolated local PostgreSQL instance:

```bash
docker run --name hiring-test-db -e POSTGRES_PASSWORD=local_hiring_test -e POSTGRES_DB=hiring_test -p 127.0.0.1:5446:5432 -d postgres:17-alpine
HIRING_TEST_DATABASE_URL='postgresql://postgres:local_hiring_test@localhost:5446/hiring_test' npm test -- --run
```

The integration test uses real PostgreSQL binary storage, database transactions and JWT verification. Only the model is a controlled test adapter. It verifies immutable uploads, byte retrieval, ownership isolation and atomic rollback of blob and metadata writes. Production model code remains separate.

To test the live model with the 100-profile workload, set `LLM_API_KEY` in the backend `.env` or environment and run:

```bash
HIRING_PERF_LIVE=1 npm run test:hiring:performance
```

This intentionally makes real provider calls and may encounter model rate limits or exceed the strict processing budget. The test fails if any profile fails or its latency exceeds the stated limits. The default performance run clearly labels its scripted provider and does not establish live-provider compliance. Its documents are local generated fixtures; database blob retrieval and queue throughput require separate database-inclusive measurements.

A live smoke check on 2026-10-09 authenticated successfully. The 1500 ms production deadline expired; a separate diagnostic with a 15-second limit retrieved a generated PDF from PostgreSQL and completed all five tools in 2252 ms with a validated score of 1. This diagnostic did not publish a worker result. Another probe hit account rate limits. The production budget was not increased, so live SLA compliance remains unmet.

The default model is available to the tested account and supports batched calls. The former Llama default returned `model_not_found`; see [Groq’s deprecations](https://console.groq.com/docs/deprecations). Override `GROQ_MODEL` only with a tool-capable model available to your account.

From `Zelosify-Frontend`:

```bash
npm run lint:hiring
npm run build
```

`npm run lint` also checks legacy files and currently reports ten pre-existing errors; the new feature passes. No lint rules are disabled to conceal those failures.

## Browser verification harness

`tests/hiring/browser-fixture.ts` is a test-only API/JWKS server with real PostgreSQL binary storage and a scripted model adapter. It is never imported by production. Point `HIRING_BROWSER_DATABASE_URL` at a dedicated, migrated test schema and run it with the existing `tsx` binary. It listens on ports 5091/5092, writes temporary test credentials/fixtures under `/tmp`, and removes the rows it creates on SIGINT/SIGTERM.

Run the frontend development server with `NEXT_PUBLIC_BACKEND_URL=http://localhost:5091`, then execute `tests/hiring/browser-check.cjs` with Playwright available in the test environment. `HIRING_PLAYWRIGHT_MODULE` can point to an existing Playwright installation; `HIRING_BROWSER_EXECUTABLE` can select an installed Chromium binary. Neither is an application dependency. Screenshots are written to `/tmp/hiring-*.png`.

Do not run `next dev` and `next build` simultaneously against the same `.next` directory. Stop the development server before the production build.

## Remaining deployment checks

Registration, authenticator verification and a signed vendor session have been browser-tested against the local Keycloak realm. Measure live provider/database latency, throughput, rate limits and recommendation quality before claiming production SLA compliance. Review database capacity, backups and retention for unsubmitted/soft-deleted documents and the inherited authentication modules separately. The assignment's 1500 ms multi-turn LLM budget is enforced as a processing deadline, not claimed as a guaranteed successful response time from a free hosted model.

Groq integration follows its [local tool-calling documentation](https://console.groq.com/docs/tool-use/local-tool-calling) and [chat-completions API reference](https://console.groq.com/docs/api-reference).

## Current validation (2026-10-11)

The local-only storage decision was reconfirmed by the user. No AWS integration
or extra storage service is required. The Docker volume contains both metadata
and file bytes; `docker compose down` retains it.

All 75 backend tests pass with a dedicated PostgreSQL test database, including
17 integration tests. See `validation/local-performance.json` for the scripted
100-profile test and `validation/live-performance.json` for actual Groq results.
The live run had 1 success, 97 provider rate-limit failures and 2 processing
deadlines. Its aggregate P95 includes fast failures and must not be read as a
successful processing SLA. Backoff now prevents rapid worker retry exhaustion,
but it does not make the model faster or remove provider quotas.

The working signup UI and registration extension live under `src/features/onboarding`
(frontend) and `src/modules/onboarding` (backend). The supplied auth implementation
files are restored; app routes wire in the additive onboarding flow.
