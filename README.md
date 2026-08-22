# Elora Wish Backend — TASK 001 Auth

Fastify 5 / JavaScript ESM authentication API for the existing Elora Wish PostgreSQL database. This scope contains registration, login, current-user, logout, and health only.

## Requirements

- Node.js 22.12 or newer within the Node.js 22 release line
- PostgreSQL with the authoritative `public.tb_m_user` table
- Environment variables copied from `.env.example`

## Setup

```bash
npm install
cp .env.example .env
npm run prisma:pull
npm run prisma:generate
npm test
npm run seed:dev
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if desired. Set real values locally and never commit `.env`.

`AUTH_COOKIE_SECURE` accepts only `true` or `false`. It defaults to `false` in
development and test so local HTTP works, and can be enabled explicitly when
testing HTTPS. Production always forces secure authentication cookies even if
the environment value is mistakenly set to `false`.

For local authentication integration, set `WEB_ORIGIN=http://localhost:3001`.
This allows credentialed requests from the dashboard only; the homepage on port
3000 redirects users to the dashboard and does not call the authentication API.

This project is database-first. `prisma/schema.prisma` was introspected from the authoritative development database and retains its exact native types, relationships, defaults, and generator metadata. Use `prisma db pull` to refresh it after intentional database-side schema changes. Review introspection diffs before accepting them. Do not run Prisma migrations or `db push` against this database.

## API

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Public, rate limited | Create a `CLIENT` / `ACTIVE` account and session |
| `POST` | `/api/v1/auth/login` | Public, rate limited | Authenticate and update `LAST_LOGIN_DT` |
| `GET` | `/api/v1/auth/me` | Cookie | Reload the current active user from PostgreSQL |
| `POST` | `/api/v1/auth/logout` | Public | Clear the auth cookie |
| `GET` | `/api/v1/health` | Public | Service liveness |
| `GET` | `/api/v1/invitations/catalog` | CLIENT cookie | Active invitation types and usable current templates |
| `GET` | `/api/v1/invitations` | CLIENT cookie | List the authenticated client&apos;s invitations |
| `GET` | `/api/v1/invitations/:invitationId` | CLIENT cookie | Read one owned invitation |
| `POST` | `/api/v1/invitations` | CLIENT cookie | Atomically create one DRAFT, two people, and one event |
| `PATCH` | `/api/v1/invitations/:invitationId` | CLIENT cookie | Concurrency-safe update of one owned DRAFT and its existing children |

The JWT is sent only in an `HttpOnly`, `SameSite=Lax` cookie and is never
included in JSON. The cookie is always `Secure` in production and follows
`AUTH_COOKIE_SECURE` in development and test. Normal sessions use
`AUTH_SESSION_DAYS`; `rememberMe: true` uses `AUTH_REMEMBER_DAYS`.

Registration input is strict. Unknown properties—including `role`, `roleCode`, `status`, and `statusCode`—are rejected. The repository independently fixes public registrations to `role_cd=CLIENT`, `status_cd=ACTIVE`, and `deleted_flag=false`.

Registration validation matches `tb_m_user`: names are limited to 150
characters, emails to 255 characters, and phone numbers to 30 characters.
The same 255-character email limit applies to login.

Invitation creation validates and normalizes the slug, requires exactly one
`GROOM` and one `BRIDE`, fixes the event timezone to `Asia/Jakarta`, and accepts
only an active/current template version belonging to the requested active
invitation type. Ownership and audit actors always come from the authenticated
CLIENT session. Header, people, and event inserts share one Prisma transaction;
PostgreSQL generates all `INV`, `PRS`, and `EVT` identifiers.

Owned invitation list/detail queries include `user_id` and `deleted_flag=false`
inside the repository query. A missing invitation and another client&apos;s
invitation both return the same safe `404 NOT_FOUND` response.

Draft updates require the last returned `updatedAt` as `expectedUpdatedAt`.
Ownership, `DRAFT` status, and the stored version are constrained inside one
transaction. A stale editor receives `409 EDIT_CONFLICT`; a non-draft receives
`409 INVITATION_NOT_EDITABLE`. Existing person and event identifiers are
preserved, and all changed audit fields share one authenticated actor/timestamp.

## Existing USER_ID generator

`PrismaUserRepository.createPublicUser()` deliberately omits `user_id`. PostgreSQL's existing default invokes `fn_generate_transaction_code('USR', 'seq_user_id')`, producing IDs from the authoritative sequence in `USR-YYMMDD-...` form. The application does not calculate IDs and does not use `MAX()+1`.

## Structure

```text
src/
  app.js                  Fastify composition and shared plugins
  server.js               environment loading, listener, shutdown
  config/env.js           Zod environment validation
  modules/auth/           routes, schemas, service, guards, password hashing
  modules/user/           Prisma persistence adapter
  shared/                 errors, validation, safe user mapping
prisma/schema.prisma      database-first model mapping
tests/auth.test.js        inject tests with fake persistence
```

`buildApp()` accepts an injected repository and password hasher. Tests use these seams and never instantiate Prisma or contact the shared database.

## Development authentication users

Run `npm run seed:dev` to idempotently create or reconcile the local CLIENT and
ADMIN authentication accounts. The command uses Argon2id, PostgreSQL's existing
`USER_ID` default, and refuses to run when `NODE_ENV=production`. It seeds only
the two development users and does not run automatically during application startup.

## Development template catalog

Invitation creation requires an active `TB_M_TEMPLATE_VERSION` because
`TB_R_INVITATION_H.TEMPLATE_VERSION_CD` is mandatory and foreign-keyed to that
master. Run `npm run seed:dev:templates` before developing invitation creation.

The development-only command idempotently manages these approved keys and their
single active/current `1.0.0` versions: `SUNDAY_BLOOM`, `AFTERGLOW`,
`PAPER_HEARTS`, `MIDNIGHT_KISS`, `CHERRY_LOVE`, and `SOFT_PROMISE`. It resolves
the `WEDDING` invitation type and template categories by business key, lets the
database generate `TPL`/`TPV` codes, and refuses to run in production.

Only those six template and version master rows can be inserted or reconciled;
the seed never creates invitations or related transaction, user, order, or
payment data. Rerunning it leaves matching rows unchanged. Rows owned by another
creator or master keys that are missing, inactive, or deleted cause a safe
failure instead of being overwritten or repaired.

## Validation

```bash
npm run validate
npm run db:check
```

`validate` runs ESLint and all Vitest tests. The auth tests use `Fastify.inject()` and fake in-memory persistence; they do not mutate PostgreSQL. `db:check` separately verifies the configured database, the introspected user delegate, a missing-user lookup, and the health route using read-only operations.
