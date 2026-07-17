# Idena Shared Node Marketplace

This maintained fork preserves the public marketplace API used by Idena Web
while updating the service to Node.js 24, Next.js 16, React 19, PostgreSQL 18,
and a current Noble secp256k1 implementation.

## Security changes

- Paid key purchases now verify the transaction signer, provider recipient,
  and identity-specific payment amount before broadcasting the transaction.
- Activation transactions must target the requested coinbase.
- Candidate signatures accept the existing browser Buffer wire format but are
  recovered with the same Noble secp256k1 implementation used by the maintained
  Idena Web fork.
- Key allocation uses PostgreSQL advisory locks and `FOR UPDATE SKIP LOCKED` so
  concurrent requests cannot overwrite another reservation.
- Transaction hashes are one-time allocation proofs, enforced in application
  logic and by a partial unique database index to prevent payment replay.
- Outbound RPC calls have DNS/IP validation, pinned DNS results, TLS validation,
  five-second timeouts, request limits, and one-megabyte response limits.
- Manager bearer tokens use timing-safe comparison, sensitive responses are
  marked `no-store`, and CI runs cross-platform build, test, audit, and secret
  checks.

These changes do not alter Idena transaction serialization, signing, RPC method
names, or consensus behavior. A regression test pins the exact legacy signed
transaction bytes.

## Requirements

- Node.js 24.18 or newer on the Node 24 line
- npm 11.16 or newer
- PostgreSQL 18 (older supported PostgreSQL versions may work but are not in CI)

Create the database schema, then install and verify the service:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
npm ci --ignore-scripts
npm run check
npm start
```

Use `npm run dev` for a development server on port 3050.

## Configuration

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection URL.
- `PROXY_URL`: Trusted Idena node RPC URL. Loopback HTTP is allowed for a local
  node; remote URLs must use HTTPS.
- `PROXY_KEY`: API key for the trusted Idena node, when required.
- `MANAGER_TOKEN`: Bearer token for `/api/manager/key-list`.

Optional database pool settings are `PG_POOL_MAX`,
`PG_CONNECTION_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS`,
`PG_IDLE_TRANSACTION_TIMEOUT_MS`, `PG_LOCK_TIMEOUT_MS`,
`PG_QUERY_TIMEOUT_MS`, and `PG_STATEMENT_TIMEOUT_MS`. Remote production
database URLs should request certificate and hostname verification, for example
with `sslmode=verify-full` where the PostgreSQL deployment supports it.

Remote plain-HTTP RPC endpoints are rejected by default because they expose API
keys and responses to interception. Set `ALLOW_INSECURE_RPC_URLS=true` only for
a reviewed legacy deployment. Private or link-local provider targets are also
rejected; `ALLOW_PRIVATE_RPC_URLS=true` is an explicit deployment-level escape
hatch for controlled private networks.

## Compatibility and rollout

The API paths and successful response shapes used by Idena Web are preserved.
`/api/key/check` additionally accepts a POST body so new clients can avoid
placing API keys in URLs; the existing GET form remains available.

Before production rollout, back up the database, compare the existing schema to
`db/schema.sql`, and check for historical duplicate transaction hashes before
creating the unique index:

```sql
select lower(hash) as normalized_hash, count(*)
from keys
where hash is not null
group by lower(hash)
having count(*) > 1;
```

Resolve any returned rows, verify every provider URL under the stricter RPC
policy, and run the web-client purchase, activation, candidate, restore, and
polling flows in a staging epoch. Blockchain broadcast and PostgreSQL commit
cannot be made one atomic operation, so operators should retain transaction
reconciliation and database backup procedures.
