# Local hiring-module submission status

Updated 2026-10-11. This is the local-storage variant requested by the user.

## Implemented and verified

- Docker Compose runs Next.js, the API, the recommendation worker, PostgreSQL, and Keycloak. Migrations and the twelve-opening Bruce Wayne Corp seed run before application startup.
- PDF/PPTX bytes and metadata are stored locally in PostgreSQL. Uploads are tenant scoped, immutable by checksum, private, and committed with their reservation state. Docker's named volume retains them across normal restarts.
- Vendor and hiring-manager workflows include role/ownership checks, pagination, uploads, private file access, soft deletion, shortlist/reject, recommendation display, loading/error states, themes and profile virtualization.
- The recommendation agent uses real Groq tool calls, schema validation, ordered tool prerequisites, deterministic weighted scoring, prompt-injection defenses, retries, durable jobs and structured execution metadata.
- Only available tool definitions are sent at each agent stage; the final response uses JSON mode. The API base is configurable through `LLM_BASE_URL`.
- Rate-limited worker consumers share an in-process cooldown, honor `Retry-After`, and keep jobs pending without consuming processing attempts. This does not coordinate separate worker replicas.
- All 75 backend tests passed against a dedicated local PostgreSQL test database, including 17 integration tests. The integration model is scripted; it is not presented as a live-model test.
- Both Docker images build successfully. The rebuilt local stack is healthy, and Chromium signup, wrong-code retry, valid TOTP, signed session and vendor routing pass.
- Login redirect recovery passes ten regression tests, plus browser checks for expired and backend-rejected cookies. Stale credentials are cleared automatically before returning to login.
- Hiring/onboarding lint and backend compilation pass. Frontend lint still has pre-existing errors in untouched legacy files; onboarding has two image optimization warnings.

## User-authorized differences from the supplied documents

The PDF requests S3. The user explicitly requested local storage instead, including reconfirmation on 2026-10-11. This application therefore needs no AWS account. That is an intentional scope decision, not a claim of exact S3 compliance.

The supplied authentication implementation files are restored to the original revision. Working signup and TOTP setup are implemented in new onboarding modules, connected through app routes. Necessary integration/configuration changes remain in the server entry point, frontend route wiring, schema, scripts and navigation. The inherited storage controller retains a lazy-initialization fix so an unrelated AWS module does not prevent a local-only application from starting.

## Live performance result — not passing

`validation/live-performance.json` records the actual 100-profile Groq test: **1 success, 97 provider rate-limit failures, and 2 processing-deadline failures**. The key's response headers reported an 8,000-token-per-minute quota. The aggregate P95 includes fast rejected requests and must not be treated as successful processing latency.

`validation/local-performance.json` records the separate 100-profile scripted-model test with real parsers. It passes, but does not establish live-model or database-inclusive throughput.

The production 1,500 ms processing deadline remains enforced. Provider backoff improves recovery; it does not prove the 1,500 ms maximum or the live 2,000 ms P95. Meeting those requirements still needs suitable provider quota, consistently faster model execution, and another successful live workload measurement. No fake recommendations or increased deadline are used to conceal this gap.

## Publication

The intended destination is the user-owned `Harsh-DevOps117/Intern23` repository, not the original Zelosify repository. GitHub authentication is not available in this session. A clean local submission repository has been prepared on branch `submission/local-hiring`, with full source instead of the original Git submodule. A matching archive is provided outside this application folder. Neither contains real `.env` files or Git history from the original Zelosify repository. No remote push has succeeded.

Run the application with the commands in `README.md`. Keep real credentials in the ignored root `.env`; they must not be included in a submission archive.
