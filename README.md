# Domain Check

Track domain expirations and renewal costs across registrars, in a dense
keyboard-driven dashboard.

<div align="center">
  <img src="frontend/public/ionos_logo.png" alt="IONOS" width="200" />
</div>

IONOS and GoDaddy are implemented today, behind a pluggable registrar
interface. Adding a third is an adapter, not a rewrite.

---

## The one thing to know

**No registrar reports what a renewal will cost you.** The IONOS Domains API
has no price, cost or currency field anywhere in its OpenAPI document (a copy is
committed at [`docs/ionos-domains-openapi.yaml`](docs/ionos-domains-openapi.yaml)).
GoDaddy quotes a price when you *check availability* for a name you do not own,
but that is a registration price for a new name — not the renewal price on your
invoice, which depends on your account, promotions and term.

So cost is permanently *your* data, not synced data. The database is not a cache
of the registrar; it is a join of two things:

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

Point `DATABASE_URL` at it, then:

```bash
npm run db:check                      # verify it before trusting it
npm run db:migrate && npm run db:seed
```

`db:check` asserts the things that otherwise fail silently: that the host is
reachable, that TLS is actually in use if the server offers it, that advisory
locks really do exclude (see below), that the schema is applied, and that your
test database is a different one — the integration tests `TRUNCATE`.
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

### Exposing Postgres to the internet

Only if the database has to stay on a machine you control *and* something
without a fixed egress IP (a serverless platform) must reach it. Order matters
— step 3 before steps 1 and 2 means credentials in cleartext on a port that
scanners find within hours.

1. **TLS.** Give the host a DNS name, get a certificate for it
   (`certbot certonly --standalone -d db.example.com`), then set `ssl = on`,
   `ssl_cert_file` and `ssl_key_file`. Add a certbot deploy hook that copies
   the renewed files and reloads Postgres — otherwise it serves the old
   certificate from memory and connections break ~90 days later.
2. **A non-superuser role**, granted only this database:
   ```sql
   CREATE ROLE domaincheck LOGIN PASSWORD '<long random>';
   GRANT ALL ON DATABASE domain_check_db TO domaincheck;
   ```
   Then in `pg_hba.conf` allow only that role over TLS, and **delete the plain
   `host` lines for remote addresses** — a `hostssl` line does nothing while a
   `host` line still permits the downgrade:
   ```
   hostssl  domain_check_db  domaincheck  0.0.0.0/0  scram-sha-256
   ```
3. **Open the firewall** to `0.0.0.0/0` on the Postgres port.
4. **Point the app at the hostname, not the IP** — verification matches the
   name — and use `sslmode=require`.

`npm run db:check` asserts all of it, including the two that otherwise pass
silently: whether you are connecting as a superuser, and whether the server
*still* accepts unencrypted connections despite TLS working.

### Going live against IONOS

1. Create a key at <https://developer.hosting.ionos.com>. It has the shape
   `publicprefix.secret` and is sent verbatim as the `X-Api-Key` header.
2. Put it in `.env` as `IONOS_API_KEY`, set `MOCK_REGISTRAR=0`, restart.
3. **Settings → Verify.** This isolates an auth problem from a sync problem
   before you spend a minute of requests discovering it.
4. Run a **Quick** sync first — one cheap pass that proves pagination and auth —
   and check the domain count against the IONOS console. Then run a full sync.

### Going live against GoDaddy

1. Create a key pair at <https://developer.godaddy.com/keys>. GoDaddy issues a
   **key and a secret**, both secret, sent as `Authorization: sso-key <key>:<secret>`.
2. Put them in `.env` as `GODADDY_API_KEY` and `GODADDY_API_SECRET`, then run
   `npm run db:seed` again — the GoDaddy account row is only created once the
   key is present, so an IONOS-only install is never nagged about an account it
   does not have. Set `MOCK_REGISTRAR=0` and restart.
3. **Settings → Verify**, then Quick, then Full, exactly as above.

Two things to know before you start:

- **Production API access is gated.** GoDaddy restricts it to accounts holding
  20+ domains or a Discount Domain Club subscription; without that, a production
  key answers `403` on `/v1/domains`. The OTE sandbox
  (`GODADDY_BASE_URL=https://api.ote-godaddy.com`) is unrestricted but issues
  its own key pair and has its own test portfolio.
- **The account row stores one credential name, and GoDaddy needs two.** Rather
  than add a column only one registrar would ever use, the secret is resolved by
  convention: `credential_ref` names the key, and the secret is always read from
  `GODADDY_API_SECRET`. `isCredentialConfigured` checks both, so a half-filled
  `.env` shows as unconfigured instead of as a green tick that then 401s.

> ⚠️ **This app has no authentication.** Anyone who can reach the port is the
> user. It binds to `127.0.0.1` by default; keep it there, reach it over a
> tunnel or VPN, or put a reverse proxy with basic-auth in front. API keys are
> read from environment variables, never stored in the database, and no endpoint
> returns anything matching `/key|secret|token|password/i`.

## Deploying

By default the backend serves the built frontend from the same process and
port, so there is no base URL to configure and no CORS involved. `npm run
build && npm start` is the whole deployment.

### On Vercel (frontend and API together)

`vercel.json` builds all three packages, serves `frontend/dist`, and routes
`/api/*` to a catch-all function (`api/[...path].ts`) that exports the same
Express app. Three things behave differently from a long-lived server, and the
code adapts on its own via the `VERCEL` environment variable:

| Concern | Long-lived server | Vercel |
| --- | --- | --- |
| Scheduling | `node-cron` in process | Vercel Cron calls `GET /api/cron/sync` |
| Work after the response | detached promise | `waitUntil`, so the instance is not frozen mid-sync |
| Pool size | 10 | 2 — every instance opens its own |

Set `CRON_SECRET` in the project's environment; Vercel sends it as
`Authorization: Bearer …` and the endpoint refuses with 503 when it is unset,
rather than leaving a public "resync everything" button. The scheduled sync
runs to completion instead of answering 202, because a scheduler has nothing to
poll, and it takes the same advisory lock so it can never overlap a manual run.

> **The database has to be reachable from Vercel.** Functions have no stable
> egress IP outside Enterprise Secure Compute, so a Postgres behind an IP
> allowlist will not work — use a managed provider that authenticates instead,
> and remember the session-mode requirement above.

### Frontend on a CDN, backend elsewhere

Two settings, no code changes:

| Where | Variable | Example |
| --- | --- | --- |
| Frontend build | `VITE_API_URL` | `https://box.tailnet-name.ts.net` |
| Backend | `CORS_ORIGINS` | `https://domain-check.vercel.app` |

Unset, both keep today's same-origin behaviour. `CORS_ORIGINS` is an explicit
allowlist, never a wildcard — every response here carries the whole portfolio.

**The backend must be HTTPS.** A page served over HTTPS cannot call an `http://`
API; the browser blocks it as mixed content. There is no way around this, so
plan for a certificate before splitting the deployment.

**The backend must not be publicly reachable, because this app has no login.**
The combination that satisfies both without building an auth system is
Tailscale Serve: it issues a real Let's Encrypt certificate for a `*.ts.net`
name, so you get a valid HTTPS origin that only your tailnet can route to.
Tailnet membership becomes the authentication.

```bash
tailscale serve --bg 3001     # on the machine running the backend
```

Then set `VITE_API_URL` to the resulting `https://<machine>.<tailnet>.ts.net`
and `CORS_ORIGINS` to your frontend's origin. Keep the backend bound to
`127.0.0.1` (the default) — Tailscale proxies to it locally, so it never needs
to listen on a public interface.

The trade-off is that the dashboard only works while you are on the tailnet.
For a single-user tool with no login, that is the point.

## How sync works

Two phases, because a list endpoint and a detail endpoint answer at different
fidelities — and *how* different depends on the registrar:

1. **List** — the whole portfolio in a handful of requests. IONOS
   (`GET /v1/domainitems?includeDomainStatus=true`, offset pagination) yields
   only `status.provisioningStatus.setToExpireOn`. GoDaddy (`GET /v1/domains`,
   **marker** pagination) already returns the authoritative `expires` plus
   `renewAuto`, `locked` and `privacy`.
2. **Detail** — one request *per domain*, under a concurrency cap
   (`REGISTRAR_CONCURRENCY`, default 4) with retry and backoff on 429/5xx.

`mode: 'quick'` skips phase 2. Which columns that leaves stale is therefore a
per-registrar question, and the abstraction answers it by distinguishing
`undefined` from `null` on `RegistrarDomainSummary`: `undefined` means "this
registrar's list call does not carry this field", so sync omits the column from
the `SET` clause and the stored value survives; `null` means "the registrar says
there is no value", so sync writes the null. In practice a quick IONOS sync
keeps its previous expiry, while a quick GoDaddy sync updates it. The app sorts
and alerts on `COALESCE(expiration_date, set_to_expire_on)` either way.

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

## Availability

The one place this app looks outward at names you do *not* own, on the
**Availability** page (`g` then `a`). Paste a list, get one row per name: free
or taken, the registration price, and — the part a registrar's own search will
not tell you — whether it is already in your portfolio, linked straight to its
detail drawer.

It is still a read. The registrar abstraction is deliberately read-only (no
renew, transfer or register methods), and checking availability does not change
that; nothing here spends money.

Not every registrar can answer. IONOS exposes no availability endpoint at all,
so the capability is declared per adapter (`RegistrarCapabilities.availability`)
and the page explains what to configure rather than offering a button that
fails. `GET /api/availability/support` is the single place that predicate lives
— enabled, capable, credentialed, and not overridden by mock mode — so the UI
cannot drift from the server's answer.

Two caveats worth surfacing, both of which the UI does:

- **The price is a registration price**, for a name you do not own. It is not
  what renewal will cost you, which is why it does not flow into the cost
  dashboard.
- **A non-definitive answer is a hint.** GoDaddy can answer from its cache
  rather than the registry; those rows are flagged "Not confirmed". The adapter
  asks for `checkType=FULL`, so this should be rare.

In mock mode the fixture adapter answers, so the whole page works offline —
including the owned, available, non-definitive and per-name-error states.

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
  registrars/ Registrar interface, IONOS + GoDaddy clients, fixture adapter
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
| `POST /api/availability` | `{names: string[]}`, ≤50; returns availability, registration price and whether you already own it |
| `GET /api/availability/support` | whether any configured account can answer at all |
| `POST /api/sync` → `202` or `409` · `GET /api/sync/{status,runs,runs/:id}` | |
| `GET/PATCH /api/settings` · `GET /api/alerts` · `POST /api/alerts/{run,test}` | |

## Keyboard

`⌘K` palette · `/` search · `g` then `h`/`d`/`a`/`p`/`y`/`s` to navigate ·
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

Unit tests cover both mappers (IDN names in each direction, the string-typed
boolean the IONOS spec itself emits, a missing status block, GoDaddy's
micro-unit prices, and the stripping of the transfer auth code and registrant
PII before anything is persisted), error normalisation for each registrar's
error shape (IONOS's documented array, GoDaddy's object and its `retryAfterSec`
body field, an HTML 502 from a proxy, credential redaction), the GoDaddy
client's marker pagination and its handling of a `203` partial availability
response, the cost resolver and the alert threshold logic.

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

## Known open questions

**Multi-label TLDs.** Does IONOS report `uk` or `co.uk` for `vetpal.co.uk`? The
mapper trusts the registrar's `tld` field when the name actually ends with it
and otherwise falls back to the last label. Fixtures cannot settle which one
IONOS really sends, and it decides whether the `domains.tld → tld_prices.tld`
join lands. GoDaddy reports no TLD field at all, so it *always* takes the
fallback and always yields `uk` — the same join, reached a different way. Check
it against real data early — `DEBUG_REGISTRAR=1` logs raw requests and responses
with credentials redacted.

**GoDaddy has not been run against a live account.** The adapter is covered by
unit tests and was smoke-tested end to end — auth header, marker pagination,
detail-by-name, IDN round-tripping, a `203` partial availability response — but
against a local stub of the API, not GoDaddy itself. The first live run is
`Settings → Verify`, then a Quick sync, then a Full sync, checking the domain
count against the GoDaddy console at each step.

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
