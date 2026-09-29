# Project organization

| Directory | Purpose |
| --- | --- |
| `app/` | Responsive discovery, queue, connection and profile screens, dialogs and authenticated API routes |
| `lib/` | Matching rules, state queries, billing integration, validation and fictional demo data |
| `db/` | D1 access and Drizzle schema |
| `drizzle/` | Ordered, immutable schema migrations and database invariants |
| `components/ui/` | Shared accessible UI primitives |
| `tests/` | SQLite matching/state regressions and webhook signature tests |
| `scripts/`, `build/` | Local development and Cloudflare-compatible build tooling |
| `.openai/hosting.json` | Sites project identity and logical storage bindings |

## Data and authorization

Hosted requests use the identity supplied by Sites. The demo has a separate, authenticated-user-specific database scope; live accounts share the live scope. Browser clients never choose the authenticated account identifier. Mutations require the app origin and an idempotency key.

Directed likes carry monotonically increasing IDs. Reciprocal consent can become a match only if both accounts have room. Database triggers enforce capacity, mutual consent, FIFO review, immutable match participants and active-connection messaging. D1 batches couple unmatching/blocking with eligible queue promotion. A downgrade preserves conversations while stopping new matches until room is available again.

Capacity and queue-order entitlements are independent. The capacity plan grants five total slots and read-only visibility into a current partner's other connections and ordered queue. Queue Freedom changes incoming-profile review order; it does not add slots. All accounts have unlimited swipes while below capacity.

Public profile responses omit birth dates, email addresses, payment details and other people's conversations. Blocks remove bilateral visibility. Activity transparency ends when the relevant connection or entitlement ends. Chat drafts remain local to their specific connection.

## Storage and billing

Clique uses separate friendship, request, group-interest and conversation tables. An undirected friendship is stored once with ordered endpoints. A transactional acceptance removes only the explicitly selected replacement edges before creating a mutual new edge, guarded by a four-friend cap at each endpoint. Group membership is derived from current friendship edges. Membership revisions and invalidation triggers prevent stale invitations; group guards require equal sizes, disjoint rosters, all-member opt-in, and no blocks anywhere within the combined group.

D1 persists profiles, likes, passes, matches, messages, invitations, reports, plans and idempotency records. R2 stores uploaded profile photos. Stripe Checkout and the billing portal manage subscriptions after the owner configures keys and prices. Signed webhooks, verified against the current Stripe subscription and customer, grant entitlements. A browser redirect cannot grant paid features.

## Repository contents

The private source repositories contain application source, lockfiles, migrations, tests, assets and documentation. Local secrets, credentials, installed dependencies, database contents, uploaded photos, logs and generated build output are excluded by `.gitignore`. Sites receives a separate build archive for deployment.

See [README](../README.md) for setup, validation, product rules and the remaining public-launch prerequisites.
