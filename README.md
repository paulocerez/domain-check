# Domain Check

Track domain expirations and renewal costs across registrars, in a dense
keyboard-driven dashboard.

<div align="center">
  <img src="frontend/public/ionos_logo.png" alt="IONOS" width="200" />
</div>

IONOS is implemented today, behind a pluggable registrar interface. GoDaddy is
the next adapter, not a rewrite.

---

## The one thing to know

**The IONOS Domains API exposes no pricing data at all** — there is no price,
cost or currency field anywhere in its OpenAPI document (a copy is committed at
[`docs/ionos-domains-openapi.yaml`](docs/ionos-domains-openapi.yaml)).

So cost is permanently *your* data, not synced data. The database is not a cache
of IONOS; it is a join of two things:

| Registrar-owned | User-owned |
| --- | --- |
| expiry, auto-renew, locks, DNSSEC, privacy, provisioning/process status | renewal price, term, notes, tags, project, alert preferences |
| overwritten on every sync | **never touched by a sync** |

That split is enforced by an explicit allow-list (`REGISTRAR_OWNED_FIELDS` in
`backend/src/db/schema.ts`), not by convention, and it has a dedicated test.

Prices come from a **per-TLD table with optional per-domain overrides**, both
maintained on the Prices page.

## Quick start

```bash
cp .env.example .env      # defaults run against fixtures — no credentials needed
npm install
npm run db:up             # Postgres 16 in Docker on port 5433
npm run db:migrate
npm run db:seed           # settings row, ~20 indicative TLD prices, an IONOS account
npm run dev               # http://localhost:5173
```

Then hit **Sync now** in the sidebar. With `MOCK_REGISTRAR=1` (the default) that
loads a 28-domain fixture portfolio covering every state worth designing for:
expiring tomorrow, already expired, auto-renew off, set to cancel, mid-transfer,
an IDN, a multi-label TLD, an unpriced TLD, and one domain whose detail fetch
fails on purpose.

### Using a hosted Postgres

Point `DATABASE_URL` at it and run `npm run db:migrate && npm run db:seed`.
Credentials can go in `.env`, or in `.env.local` — the backend loads `.env`
first and lets `.env.local` win, so a file written by a provider CLI overrides
the hand-maintained defaults without you merging anything by hand.

**Connect through a session-mode endpoint, not a transaction pooler.** This is
the one requirement this app places on your provider, and getting it wrong
fails silently.

Most managed Postgres services put PgBouncer (or equivalent) in front and hand
you two URLs — a pooled one and a direct one. In *transaction* pooling mode a
client is not kept on one server connection between statements, so
**session-level advisory locks stop excluding anything.** Measured against a
live pooled provider:

| Endpoint | client A | client B | mutual exclusion |
| --- | --- | --- | --- |
| pooled (transaction mode) | acquired | **also acquired** | broken |
| direct / session mode | acquired | refused | works |

Sync mutual exclusion rests entirely on that lock, so through a transaction
pooler two syncs would reconcile the same account at once — with no error,
just wrong data. This app opens a handful of connections for a single user, so
the direct endpoint costs nothing.

`backend/src/env.ts` prefers `DATABASE_URL_UNPOOLED` when it is set (some
providers expose the direct endpoint under that name). With a provider that
gives you one URL, simply make `DATABASE_URL` the direct one.

Pick a region near you. A 28-domain sync took **107 ms** against local Postgres
and **22 s** against a US-East database from Europe — the work is many small
round trips, so latency dominates.

### Going live against IONOS

1. Create a key at <https://developer.hosting.ionos.com>. It has the shape
   `publicprefix.secret` and is sent verbatim as the `X-Api-Key` header.
2. Put it in `.env` as `IONOS_API_KEY`, set `MOCK_REGISTRAR=0`, restart.
3. **Settings → Verify.** This isolates an auth problem from a sync problem
   before you spend a minute of requests discovering it.
4. Run a **Quick** sync first — one cheap pass that proves pagination and auth —
   and check the domain count against the IONOS console. Then run a full sync.

> ⚠️ **This app has no authentication.** Anyone who can reach the port is the
> user. It binds to `127.0.0.1` by default; keep it there, reach it over a
> tunnel or VPN, or put a reverse proxy with basic-auth in front. API keys are
> read from environment variables, never stored in the database, and no endpoint
> returns anything matching `/key|secret|token|password/i`.

## How sync works

Two phases, because the API offers expiry at two fidelities:

1. **List** — `GET /v1/domainitems?includeDomainStatus=true` returns the whole
   portfolio, including `status.provisioningStatus.setToExpireOn`, in
   `ceil(count / 100)` requests.
2. **Detail** — the authoritative `expirationDate`, plus `autoRenew`,
   `cancelOnExpire` and the locks, need one request *per domain*. These run
   under a concurrency cap (`IONOS_CONCURRENCY`, default 4) with retry and
   backoff on 429/5xx.

`mode: 'quick'` skips phase 2 and leaves those columns at their previous values
rather than nulling them. The app sorts and alerts on
`COALESCE(expiration_date, set_to_expire_on)`, so a quick sync still yields a
usable dashboard.

A few deliberate behaviours:

- **Nothing is ever hard-deleted by a sync.** A domain the registrar stops
  returning becomes `sync_state = 'missing'`, keeping your cost data, and is
  revived automatically if it comes back.
- **A run that hit any API error does not conclude anything is gone.** It
  degrades to `partial` and skips the missing-domain sweep — disappearance is
  far more often a transient upstream fault than a real deletion.
- **Concurrent syncs are refused, not queued.** A Postgres advisory lock (not an
  in-process flag, which `tsx watch` restarts would defeat) means a second
  request gets a `409`.

## Alerts

One **digest** per evaluation, grouped by urgency — not one email per domain,
which you would start filtering to trash within a week. Sent via Resend.

Deduplication is keyed on `(domain, alert_kind, expiration_date)`. Including the
expiry the alert was *about* makes it idempotent per renewal cycle: exactly one
"30 days left" email per domain per expiry, and when the domain renews and the
date moves a year forward, the same alert becomes eligible again on its own — no
cleanup job, no TTL.

Rows are claimed with `INSERT … ON CONFLICT DO NOTHING RETURNING id` *before*
the mail is sent, and released if sending fails. A crash costs one missed
notification; the other ordering would cost a duplicate storm.

Day counts use the timezone in Settings, not UTC. A domain expiring at 00:30
Berlin time must read as "tomorrow" in Berlin.

With `RESEND_API_KEY` unset, a console transport renders and logs the digest
instead — so the whole alert path is testable offline.

## Costs

Resolution chain: **per-domain override → TLD table → unknown**.

"Unknown" is surfaced everywhere as unknown, never summed as zero. A missing
price that quietly counts as free produces a total that looks authoritative and
is wrong.

There is also **no currency conversion**. Domains priced outside your base
currency are excluded from totals and reported as excluded ("3 domains excluded
(USD)"). Converting at an unpinned rate produces a number nobody can reconcile
against an invoice.

Money is stored as integer minor units plus an ISO-4217 code — never `numeric`,
which Drizzle returns as a string and which would poison the in-browser total
recomputation.

## Layout

```
shared/     types, zod schemas, and the pure cost functions used by BOTH sides
backend/    Express API
  db/         Drizzle schema, migrations, seed
  registrars/ Registrar interface, IONOS client, fixture adapter
  services/   sync, cost, alerts, stats, settings
  routes/     the REST surface
frontend/   Vite + React SPA, Tailwind v4, dark-first
```

`shared/` holds real code, not just types: the zod schemas validate Express
requests *and* the frontend's forms, and the price resolver runs in the backend
for stats and in the browser so the dashboard recomputes totals instantly when
you change a filter.

## API

Every response is `{ok: true, data, meta?}` or
`{ok: false, error: {code, message, details?}}`.

| | |
| --- | --- |
| `GET /api/health` | db status, registrar mode, last sync |
| `GET /api/domains` | `q, tld[], state, tag[], project, expiringWithinDays, autoRenew, priceKnown, favorite, sort, dir` |
| `GET /api/domains/:id` | detail, incl. recent changes and alerts |
| `PATCH /api/domains/:id` | **user-owned fields only** — a registrar field is a 400, not a silent no-op |
| `POST /api/domains/:id/refresh` · `/archive` · `/unarchive` | |
| `DELETE /api/domains/:id` | archived rows only |
| `GET /api/stats/{summary,cost-by-tld,renewal-calendar,expiry-buckets,expiry-timeline}` | |
| `GET /api/tld-prices` · `PUT /api/tld-prices/:tld` · `POST /api/tld-prices/bulk` | |
| `GET /api/registrar-accounts` · `POST /api/registrar-accounts/:id/verify` | |
| `POST /api/sync` → `202` or `409` · `GET /api/sync/{status,runs,runs/:id}` | |
| `GET/PATCH /api/settings` · `GET /api/alerts` · `POST /api/alerts/{run,test}` | |

## Keyboard

`⌘K` palette · `/` search · `g` then `h`/`d`/`p`/`y`/`s` to navigate ·
`j`/`k` rows · `Enter` open · `e` edit price · `f` favourite · `?` cheat sheet.

## Scripts

| | |
| --- | --- |
| `npm run dev` | shared watcher + API + client |
| `npm run build` / `npm start` | production build; the backend serves the SPA on one port |
| `npm test` | vitest — unit plus integration against `TEST_DATABASE_URL` |
| `npm run typecheck` | all three packages |
| `npm run db:up` / `db:migrate` / `db:seed` / `db:studio` / `db:generate` | |

## Testing

Unit tests cover the IONOS mapper (IDN names, the string-typed boolean the spec
itself emits, a missing status block), error normalisation (the documented array
shape, an HTML 502 from a proxy, key redaction), the cost resolver and the alert
threshold logic.

Integration tests run against a **real Postgres** — the behaviours worth testing
here are the `ON CONFLICT` dedupe, advisory locks, array columns and CHECK
constraints, none of which an in-memory fake reproduces. They cover sync
idempotency, the missing/reappeared cycle, registrar-id adoption by name, quick
vs full sync, `409` on concurrent syncs, alert dedupe across a renewal, and —
the one that matters most — **that a sync cannot overwrite a price override**.

```bash
MIGRATE_TARGET=test npm run db:migrate   # once
npm test
```

Fixture expiries are stored as offsets from the start of the day, not absolute
dates. Absolute dates rot silently: six months on, your "expiring in 30 days"
case has become an "expired 150 days ago" case and the test still passes.

## Known open question

**Multi-label TLDs.** Does IONOS report `uk` or `co.uk` for `vetpal.co.uk`? The
mapper trusts the registrar's `tld` field when the name actually ends with it
and otherwise falls back to the last label. Fixtures cannot settle which one
IONOS really sends, and it decides whether the `domains.tld → tld_prices.tld`
join lands. Check it against real data early — `DEBUG_REGISTRAR=1` logs raw
requests and responses with the key redacted.

## Notes

- `.npmrc` sets `legacy-peer-deps=true`. drizzle-orm declares an optional peer on
  `@op-engineering/op-sqlite`, which drags React Native (React 19) into the tree
  and conflicts with the frontend's React 18. None of it is ever installed or
  imported — the only driver used is `drizzle-orm/node-postgres`.
- **Regenerate the lockfile with a clean install, never an incremental one.**
  Rollup, esbuild, Tailwind's oxide and lightningcss all ship per-platform
  native binaries as optional dependencies. `npm install` on top of an existing
  `node_modules` prunes the entries for every platform except the one you are
  on, and the result installs fine locally while failing any Linux CI with
  "Cannot find module @rollup/rollup-linux-x64-gnu"
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Always
  `rm -rf node_modules package-lock.json && npm install`, then check that
  `grep -c '@rollup/rollup-' package-lock.json` is in the twenties rather than
  1.
- `.env` is loaded with `override: true`, so the file always beats the ambient
  environment. A stale `DATABASE_URL` exported in your shell would otherwise
  silently point migrations at another project's database. `NODE_ENV` and
  `LOG_LEVEL` are deliberately absent from the file for the same reason in
  reverse — a test runner needs to be able to set them.
