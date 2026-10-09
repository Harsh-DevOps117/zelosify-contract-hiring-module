# Running the contract hiring module

## Backend

Use Node.js 22 or newer. The application keeps the existing PostgreSQL, Keycloak and S3 integrations. No new application dependencies are required.

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
| `S3_BUCKET_NAME`, `S3_AWS_REGION` | Private profile storage. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Existing server integration credentials. The new adapter also supports the AWS default credential chain, but the legacy server storage factory still requires these variables. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Tool-calling model; default model is `llama-3.3-70b-versatile`. |
| `HIRING_WORKER_CONCURRENCY` | Concurrent profiles per worker process, 1–16, default 4. |

Configure the other existing Keycloak/session/encryption variables according to the original setup guide. The original server initializes Keycloak and S3 modules during startup, so those services must be configured even before using the new pages. The bucket must remain private. The browser needs no AWS credentials or S3 CORS access.

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

For development, use `npm run dev` and `npm run worker:hiring` in separate terminals. The worker is essential: accepted submissions stay pending until it runs. The worker refuses to start without Groq and S3 configuration and never falls back to fake recommendations.

The idempotent seed creates tenant `b0000000-0000-4000-8000-000000000001` (Bruce Wayne Corp), twelve varied openings, and a database-only manager placeholder. The placeholder is not a login account. Register vendor and manager users through the existing Keycloak-backed registration/TOTP flow using this tenant. Assign the manager's signed realm role and database role as `HIRING_MANAGER`, and the vendor's as `IT_VENDOR`.

Assign the seed openings to your registered manager's **database user ID**:

```bash
HIRING_SEED_MANAGER_ID=<manager-database-user-id> npm run seed:hiring
```

This validates that the manager belongs to the seeded tenant. Other tenants and unrelated openings are not seeded or reassigned.

## Frontend

```bash
cd Zelosify-Frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173/login`. Vendor and manager workspaces are `/vendor/openings` and `/hiring-manager/openings`. The existing dashboard also has an Openings link for each persona. `NEXT_PUBLIC_BACKEND_URL` should point to the backend's `/api/v1` base.

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

Do not send S3 keys, uploader IDs, tenant IDs or roles. Those are derived server-side.

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

The integration test uses real database transactions and JWT verification. S3 and the model are controlled test adapters. Production implementations remain separate.

To test the live model with the 100-profile workload, set your Groq key in the environment and run:

```bash
HIRING_PERF_LIVE=1 npm run test:hiring:performance
```

This intentionally makes real provider calls and may encounter model rate limits or exceed the strict processing budget. The test fails if any profile fails or its latency exceeds the stated limits. The default performance run clearly labels its scripted provider and does not establish live-provider compliance. Its documents are local generated fixtures; live S3 transfer latency requires separate deployed testing.

From `Zelosify-Frontend`:

```bash
npm run lint:hiring
npm run build
```

`npm run lint` also checks legacy files and currently reports ten pre-existing errors; the new feature passes. No lint rules are disabled to conceal those failures.

## Browser verification harness

`tests/hiring/browser-fixture.ts` is a test-only API/JWKS server with PostgreSQL persistence and scripted storage/model adapters. It is never imported by production. Point `HIRING_BROWSER_DATABASE_URL` at a dedicated, migrated test schema and run it with the existing `tsx` binary. It listens on ports 5091/5092, writes temporary test credentials/fixtures under `/tmp`, and removes the rows it creates on SIGINT/SIGTERM.

Run the frontend development server with `NEXT_PUBLIC_BACKEND_URL=http://localhost:5091`, then execute `tests/hiring/browser-check.cjs` with Playwright available in the test environment. `HIRING_PLAYWRIGHT_MODULE` can point to an existing Playwright installation; `HIRING_BROWSER_EXECUTABLE` can select an installed Chromium binary. Neither is an application dependency. Screenshots are written to `/tmp/hiring-*.png`.

Do not run `next dev` and `next build` simultaneously against the same `.next` directory. Stop the development server before the production build.

## Remaining deployment checks

Use real Keycloak users to verify the complete existing login/TOTP setup; configure private S3 storage and a Groq key; measure live provider/S3 latency, throughput, rate limits and recommendation quality. Review retention for unsubmitted/soft-deleted objects and the inherited authentication modules separately. The assignment's 1500 ms multi-turn LLM budget is enforced as a processing deadline, not claimed as a guaranteed successful response time from a free hosted model.

Groq integration follows its [local tool-calling documentation](https://console.groq.com/docs/tool-use/local-tool-calling) and [chat-completions API reference](https://console.groq.com/docs/api-reference).
