# Contract hiring module

## What changed and why

Implemented the vendor and hiring manager workflows from `Round_One_Task.pdf` inside the supplied repository. The feature adds tenant-scoped openings, private PDF/PPTX uploads, asynchronous tool-calling recommendations, and shortlist/reject decisions. New source and test files contain no code comments; explanations live here. Existing unrelated source comments and modules are retained.

The setup guide supplied integration context. Its instruction to publish to another repository was not treated as a request to publish, and its example credentials were not copied into the application. No packages or external infrastructure products were added to the application's dependency manifests.

The original project provides Express/TypeScript, Next.js, Prisma/PostgreSQL, Keycloak, AWS SDK, AJV, Vitest, and react-dropzone. The implementation reuses them. Groq uses Node's native HTTP client. The existing PDF library performs PDF extraction; a bounded ZIP/OOXML reader handles PPTX without adding an archive service or package.

## Module boundaries

| Location | Responsibility and rationale |
| --- | --- |
| `Zelosify-Backend/Server/src/modules/hiring/routes.ts` | Registers HTTP endpoints, authentication/role middleware, correlation IDs and module error handling. |
| `controller.ts` | Converts HTTP inputs and outputs. It contains no scoring or workflow policy. |
| `auth.ts`, `domain.ts` | Verifies Keycloak identity, derives tenant/role from the database, and defines reusable ownership predicates. |
| `validation.ts` | Compiled AJV schemas and bounded pagination/file validation. |
| `repository.ts` | Scoped reads, explicit persona response projections, serializable transaction helper and bounded conflict retries. |
| `service.ts`, `upload-ticket.ts` | Upload reservation/signing, immutable upload completion, atomic submission, soft delete, decisions and recommendation re-runs. |
| `storage.ts` | Private S3 retrieval and immutable encrypted writes behind a testable interface. |
| `parser.ts`, `workers/resume.cjs` | Bounded document extraction in terminable worker threads so parsing cannot freeze the API event loop. |
| `agent/provider.ts` | Groq function-calling transport, response validation and cancellation. No SDK dependency is needed. |
| `agent/tools.ts`, `scoring.ts` | Stateful tool registry and pure skill, experience, location and weighted-scoring policy. |
| `agent/orchestrator.ts` | Bounded LLM/tool loop, schema validation, malformed-output retries and final decision verification. |
| `recommendation-service.ts`, `worker.ts` | Durable job claims, crash recovery, retry scheduling and atomic result publication. |
| `Zelosify-Frontend/src/features/hiring` | API client, cancellable query/polling hook, server authorization, scoped styling and reusable UI components. |
| `Zelosify-Frontend/src/app/(Hiring)` | Thin role-specific routes and layouts, loading states and error boundary. |

Shared changes are limited to registering the new backend router, extending Prisma, exposing navigation and middleware routing, and fixing the frontend ESLint integration. A separate route group avoids the existing dashboard's mobile-blocking overlay while preserving the old dashboard.

## Request and job flow

```mermaid
flowchart LR
  UI[Role guarded Next.js pages] --> Auth[Verified JWT and database identity]
  Auth --> API[Controller and hiring service]
  API --> DB[(Prisma and PostgreSQL)]
  API --> Storage[Private S3 adapter]
  DB --> Claim[Worker lease]
  Claim --> Agent[Agent orchestrator]
  Agent <--> LLM[Groq tool calling]
  Agent --> Tools[Parse / Extract / Normalize / Match / Score]
  Tools --> Storage
  Tools --> Parser[Bounded document worker]
  Agent --> Policy[Validate score and decision]
  Policy --> DB
```

## Authorization and tenancy

The new module verifies RS256 signatures using cached Keycloak JWKS keys, issuer, expiration, authorized client (`azp`), and an optional configured audience. The user's current tenant and role are read from PostgreSQL for every request, rather than trusting client fields or a stale role cache. Both database role and signed token role must allow access.

Vendor opening queries include `tenantId`. Their profile queries additionally include `uploadedBy`, including preview, delete and reservation completion. Manager queries include both `tenantId` and `hiringManagerId`. Cross-owner and cross-tenant resources return 404. Wrong personas return 403. Anonymous, forged, expired and wrong-client tokens return 401. Cookie-authenticated writes require the configured frontend Origin to prevent cross-site mutations.

Vendor response projections omit recommendation fields, storage keys, reasoning metadata and other vendors' profiles. Counts use the same visibility filter as profile lists. Manager projections expose the score, confidence, explanation, processing state and latency, but omit raw storage and execution internals.

Frontend server layouts call the authenticated backend session endpoint before rendering either persona's workspace. The middleware handles navigation redirects; it is not the security authority. The API always rechecks authorization.

The migration adds a composite foreign key from an opening's manager and tenant to the user record. An opening therefore cannot point to a manager in another tenant. User roles are still checked at the application boundary.

## Storage and upload protocol

The assignment asks for presigned uploads while also prohibiting browser-to-S3 access. The presign endpoint therefore returns an HMAC-signed **backend upload path**, not an S3 URL. The signature binds the reservation, opening, authenticated uploader, expiry, size and media type. The database reservation expires after fifteen minutes and authorization is required even with a valid signature.

1. Validate a batch of one to ten files, each at most 10 MB. Accept PDF and PPTX only; reject path separators, control characters and mismatched extensions/types.
2. Transactionally create upload reservations. Limit each vendor to fifty unexpired, unconsumed reservations.
3. Upload bytes to the signed backend path. Validate size and file magic before transferring to private S3 with server-side encryption and conditional immutable writes.
4. Submit reservation IDs. A serializable Prisma transaction creates profiles and durable jobs together and consumes every reservation, or rolls back the whole batch.
5. Retrying the same submitted reservation IDs returns the same profiles without duplicate jobs. The browser retains the batch during a failed attempt so a lost response can be retried safely.
6. Serve authorized file bytes through the backend with private/no-store caching, safe content disposition and a sandbox policy. PDFs open inline; PPTX files download for a local viewer.

Keys use `<tenantId>/<openingId>/<timestamp>_<reservationId>_<sanitizedFilename>`. S3 never receives a browser-selected key. The additional reservation identifier prevents collisions. Soft deletion retains audit records and private objects while removing read, decision and worker-publication access.

The adapter uses bounded buffers for the 10 MB maximum, rather than exposing signed download URLs. Transport failures after storage upload may leave an unsubmitted object. Production retention must reconcile expired unconsumed reservations with objects before deleting them; a blanket prefix lifecycle deletion would incorrectly remove submitted profiles.

## Transactions and worker recovery

`ProfileUpload` tracks upload intent. `RecommendationJob` is a transactional outbox and work queue in the existing PostgreSQL database, avoiding an additional broker. Profile creation and job creation cannot partially succeed.

Workers use serializable conditional claims, unique lease tokens and ten-second leases. Processing runs outside database transactions. Multiple workers can run concurrently with a default of four active jobs per worker process. A crashed worker's expired job can be reclaimed. Retries are bounded to three attempts with exponential delay.

Final persistence checks the current lease, state and profile visibility, then writes the recommendation and job completion in one transaction. A deleted profile or stale worker cannot receive a late successful result. Failed attempts store a sanitized error code, latency, attempt number and available execution metadata. Successful results store validated scores, explanation, confidence, version, time and tool metadata.

Shortlist/reject operations recheck manager scope inside the transaction, record the actor/time, clear incompatible decision fields, and update the opening's action date. Repeating the same decision is idempotent. Re-running a completed recommendation at the current version is a no-op; failed or outdated recommendations can be queued again by their manager.

## Agent execution and validation

The production path always uses a real function-calling LLM. The scripted provider exists only under `tests/hiring` and is never selected by production code. Missing Groq configuration does not produce fabricated recommendations.

The orchestrator sends a small opening requirements object, not a raw Prisma model. Tool-call batching is enabled: the model can submit feature extraction and the subsequent state-based tools together, and the registry executes them in dependency order as listed to reduce provider round trips. It gives the model a tool registry and lets the model select tool calls. The registry enforces prerequisites and retains trusted intermediate state:

1. `parse_resume`: retrieve the assigned private object and extract bounded untrusted text.
2. `extract_features`: accept validated experience, skills, location, education and keywords proposed from the document. Reject skills absent from extracted text.
3. `normalize_skills`: normalize aliases and deduplicate the extracted skills.
4. `match_candidate`: pass the registry's structured features to the deterministic matching engine.
5. `score_candidate`: apply the specified formula to the trusted matching output.

State is held server-side so the model cannot substitute arbitrary IDs, storage keys or matching scores. Feature re-extraction invalidates previously derived state. The agent may retry tools, but cannot skip required stages and still persist a result.

Every stage validates its input/output. There are at most ten model turns and two malformed-output/tool corrections. The final response must match the JSON schema and agree with the exact scoring tool result and threshold decision. The model's explanation is accompanied by a server-generated verified breakdown.

Resume text never appears in system instructions. Extraction removes control and bidirectional override characters and caps text at 24,000 characters. Tool results label it as untrusted data. The model has no database, arbitrary file, network-fetch or mutation tools. Schema checks, job-bound access and score verification enforce the boundary even if a resume attempts to instruct the model. These controls limit capabilities; they cannot guarantee that an LLM will interpret all adversarial factual claims correctly. Managers retain the final decision.

Persisted execution metadata includes tool names, success/failure, durations, retries, token usage, model/version and score breakdown. Raw resumes and private model chain-of-thought are not logged or persisted as reasoning metadata.

The PDF worker uses the existing library's bundled `v2.0.550` parser with a `Uint8Array`, disabled dynamic evaluation and disabled font-face loading, correcting a compatibility failure found with the default bundled parser on a valid PDF fixture. PPTX parsing bounds ZIP entry counts, declared and actual decompressed sizes, accepts only supported compression methods, rejects encrypted/multipart archives and XML entity declarations, and extracts slide text in numeric order. Worker memory and execution time are bounded. Scanned/image-only documents fail explicitly; OCR is outside the assignment.

## Scoring policy

| Component | Policy |
| --- | --- |
| Experience | Below minimum: 0. Inclusive range: 1. Above an explicit maximum: 0.8. A missing maximum is unbounded. |
| Skills | Unique normalized overlap divided by unique normalized required skills. No required skills means no skill restriction, therefore 1. |
| Location | Remote opening or normalized exact match: 1. Onsite mismatch or unknown location: 0.5. |
| Total | `0.5 × skills + 0.3 × experience + 0.2 × location`, rounded to six decimals. |
| Decision | At least 0.75: recommended. At least 0.5 but below 0.75: borderline. Below 0.5: not recommended. |

Confidence is a validated model estimate of evidence completeness, not another matching score. Missing experience is represented as zero; missing skills/location remain empty rather than being invented. Database checks constrain stored score/confidence ranges, positive file sizes and valid opening experience ranges.

## Frontend behavior

The vendor list shows role, location, contract, posted date and manager. Detail pages show requirements, experience, dates, multi-file drag/drop, per-file progress, errors and confirmations. Vendors can preview or soft delete their own submissions.

Manager detail cards show processing/completed/failed state, recommended/borderline/not-recommended badge, score, confidence, explanation, latency and decision controls. Failed assessments can be retried. Polling runs only while visible profiles are pending or processing and is cancelled on unmount. Requests cancel when their route or pagination changes.

Both personas share metadata, badges, pagination, loading, errors and theme controls. Page sizes are 20, 50 and 100. Collections above fifty profiles render a fixed-height virtual window with overscan; long explanations scroll inside their card. Responsive layouts work on mobile without the old dashboard overlay.

## Latency and observability

The worker applies a 1500 ms processing abort signal spanning profile loading, private object retrieval, parsing and model/tool execution. It checks the deadline again before result publication. Provider calls and parser workers honor cancellation. Network/database scheduling and final transaction commit can add overhead; there is no claim of a mathematically exact wall-clock ceiling.

Submission returns after the profile/job transaction; it does not wait for model inference. JSON requests use short client timeouts. Binary upload transfers have a separate 30-second browser transport timeout so large files on slow connections can finish. This is a practical exception to interpreting the assignment's two-second limit as an absolute end-to-end file-transfer bound.

Module logs are structured JSON and include request correlation ID, status, start time, queue delay, parsing/matching tool durations, token usage, final score, retries, sanitized errors and processing latency. Legacy modules retain their existing logging behavior. Queue delay is reported separately from processing time.

A free hosted model requiring several tool-calling round trips may exceed 1500 ms. Such attempts fail/retry rather than report a fictitious success. Live provider performance, S3 latency and deployment-scale API P95 require configured services and measured verification.

## Validation performed

- Backend TypeScript build and Prisma generation pass.
- The additive migration applies to real PostgreSQL; the Bruce Wayne Corp seed creates twelve varied openings.
- The complete backend test run passes: 54 tests, including existing tests, policy boundaries, malformed output, prompt isolation, real parsers and HTTP/database integration.
- HTTP integration uses real RS256-signed tokens and a local JWKS endpoint, real PostgreSQL transactions, and test-only storage/model adapters. It covers upload → submit → recommend → shortlist, cross-tenant/cross-vendor/cross-manager access, origin checks, replayed submissions, rollback, concurrent claims and deletion during inference.
- The 100-profile performance test uses real PDF/PPTX parsers and a scripted model. One isolated run completed 100/100, processing P95 126 ms, maximum 147 ms, queue-delay P95 1484 ms, total 1686 ms at concurrency four. These measurements are not live Groq or S3 results.
- The hiring frontend lint check and production build pass. Chromium checks covered vendor listing/upload, hidden vendor recommendations, dark mode, 390 px mobile layout without horizontal overflow, manager shortlist/reject, virtualization with 66 profiles, and anonymous/wrong-role redirects, with zero page errors.
- The legacy repository-wide frontend lint command exposes ten pre-existing errors and sixteen warnings in unrelated files. Build lint is scoped to the new hiring feature; `npm run lint` still reports the legacy issues instead of silently disabling those rules.

See `HIRING_SETUP.md` for environment configuration, launch commands and repeatable tests. Live Keycloak login against a configured realm, live S3 upload/download, Groq reasoning quality and live SLA compliance remain external-service verification items. Nothing has been pushed or deployed.
