# Zelosify Task Monorepo

This monorepo is maintained for task and assessment purposes.

It contains:

- `Zelosify-Backend` for backend services and APIs
- `Zelosify-Frontend` for frontend application code

The repository is intended to organize and submit task-related implementation work in one place.

Regards,
Zelosify Team

## Run everything with Docker

From this folder (`eval-ebc4cd5c87b7`):

```bash
cp .env.example .env
# Set LLM_API_KEY in .env to your Groq API key.
docker compose up --build -d
docker compose ps -a
```

Open the app at http://localhost:5173. The API is at http://localhost:5000
and the Keycloak admin console is at http://localhost:8080/auth (user `admin`,
password `local-admin` unless overridden in `.env`). PostgreSQL is available
on localhost:5445, database `zelosify`, user `postgres`.

Document files are stored locally in PostgreSQL inside the persistent
`postgres_data` Docker volume. No AWS account or S3 configuration is required.
This is the explicitly requested local storage variant of the assignment.

Compose builds the frontend and backend from the root `Dockerfile`, starts
PostgreSQL and Keycloak, imports the Zelosify realm/client/roles, applies Prisma
migrations and seeds hiring data, then starts the API and recommendation worker.
The `migrate` container should exit successfully; the other five services stay up.
The frontend uses the internal Docker API address for server-side requests and
localhost for browser requests. The API loads Keycloak's public key at startup.

This is a local HTTP development stack with example credentials. It uses its own
named database volume; it does not use the older backend-only Compose stack or
the nested application `.env` files. A real Groq key is required; Compose reports
a configuration error if it is missing. AWS endpoints still require external
provider configuration. Google and Microsoft sign-in are not implemented.
Register application users using
the tenant and role instructions in [HIRING_SETUP.md](HIRING_SETUP.md); the seed
manager is a database placeholder, not a login account.

Expired or rejected sessions clear their stale cookies and return to sign-in.
To check redirect recovery against the running stack:

```bash
node --test Zelosify-Frontend/tests/auth-redirects.test.mjs
```

```bash
docker compose logs -f backend worker
docker compose down            # Stops the stack and retains database data.
```

Rebuild with `docker compose up --build -d` after source changes. Realm import and
bootstrap admin settings apply on first initialization; changing their values in
`.env` does not update an existing Keycloak realm/admin. See the official
[Keycloak realm import documentation](https://www.keycloak.org/server/importExport).

## Contract hiring module

See [arch.md](arch.md) for the implementation and design decisions, and [HIRING_SETUP.md](HIRING_SETUP.md) for configuration, launch commands, API routes, and validation.

## Submission status

See [SUBMISSION_STATUS.md](SUBMISSION_STATUS.md) for verified behavior, the local-storage decision, live performance results, and remaining publication requirements.
