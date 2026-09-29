# Date-By-Date (DBD)
A responsive dating web app with durable profiles, queues, matches, conversations and paid-feature entitlements.

Source: [RobertMLayne/date-by-date](https://github.com/RobertMLayne/date-by-date) (private). See [project architecture and file organization](docs/ARCHITECTURE.md).

## Product rules
- Free: one active match. DBD Plus: five active matches for $4.99 USD/month, capped at five.
- Queue Freedom: independent $4.99 USD/month add-on, allowing arbitrary incoming-profile review.
- Both: $9.98/month. All accounts have unlimited swipes; discovery and swipe actions pause at capacity.
- Incoming unreviewed likes are presented oldest first. Like or pass to continue; queued reciprocal likes do not obstruct later discovery.
- Matching requires reciprocal likes and room for both participants. Oldest eligible incoming consent wins; occupied candidates retain their sequence.
- The viewed profile shows your prospective/current queue position at top left; current-match clock and reciprocal-like check in the middle; outstanding outgoing-like count at right.
- DBD Plus members can inspect only current partners' other matches and ordered queues. This is read-only, excludes blocked profiles, and never includes chats or contact/billing details.
- Unmatch and block end the exact relationship and atomically promote eligible queues. Downgrades never end existing matches.

## Included
Desktop and mobile layouts; touch and keyboard swipes; editable adult profiles; up to six photos; age/gender/city filters; paid intention/interest filters and unlimited rewind; persistent messaging with polling; conversation prompts; date invitations with acceptance/decline; reporting/blocking; discoverability pause; authenticated accounts; isolated fictional demo; Stripe Checkout, portal and signed webhook handlers.

## Run locally
Node 22.13+; npm. Install dependencies, then run:
```sh
npm install
npm run dev
```
Local preview is http://127.0.0.1:5173. The starter's local sign-in uses a development identity only. Hosted identity is supplied by Sites.
Generate changed schema with `npm run db:generate`. Never rewrite applied migrations.
Build once and apply each pending `drizzle/*.sql` migration to local D1 using:
```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/FILE.sql
```
Apply migration files in numeric order, once each. Production deployment applies migrations separately.

## Verify
```sh
npm test
node node_modules/typescript/bin/tsc --noEmit
npm run build
```
Tests cover mutual consent, free and paid capacity, FIFO ordering, queued busy users, downgrade preservation, blocking, immutable match endpoints, transaction rollback, duplicate likes, filtered discovery, per-conversation history, recipient-specific drafts, paid transparency, and signed webhook tampering/expiry.

## Connect billing
Purchases remain disabled until configured. No real charges have been tested.
1. Create two Stripe recurring prices: $4.99 USD, every month, one for each add-on.
2. Configure hosted secrets from `.env.example`: Stripe secret key, webhook signing secret, capacity price ID, queue price ID, and trusted APP_ORIGIN.
3. Configure Checkout customer portal and subscription cancellation at period end.
4. Point Stripe subscription created/updated/deleted webhooks to `/api/billing/webhook`, API version `2025-06-30.basil`.
5. The initial Site is owner-private. Before enabling public signup/payments, configure an audience that permits external webhook requests while retaining the app's sign-in protection. Verify signed webhook delivery in Stripe test mode before using live keys.
6. Run a real Stripe test-mode checkout, renewal, cancellation, failed-payment and expired-entitlement exercise. Entitlements are never granted by the client or checkout redirect.

## Release boundaries
This is a working first web version, not an App Store/Play Store release. It uses ChatGPT sign-in through Sites. Video/voice calling, push/SMS notifications, identity verification and a staffed moderation operation are not implemented.
Profiles are self-reported adults. Onboarding requires acknowledgement that profile/activity information can be visible in eligible partners' connection/queue views. Uploaded photos are resized and re-encoded client-side to remove original metadata. Reports are stored, but no response-time promise is made.
Community discovery returns up to 100 new candidates at a time; related profiles and the viewer are fetched independently so accounts beyond the first page remain valid. Each active conversation returns its own latest 300 messages. Discovery filters and blocks are applied before the candidate limit. Paused or previously passed incoming profiles are omitted from actionable queues; unpausing restores the original arrival order.
Do not claim identities are verified, that demo users are real, or that billing is live before configuration and payment testing.
The registered browser WebMCP tool only navigates app views. It does not swipe, message or purchase.

## Photo credits
Illustrative fictional demo portraits from Pexels; the photographed people are not claimed to participate in DBD:
- Josue Velasquez — https://www.pexels.com/photo/portrait-of-a-young-brunette-smiling-outdoors-16564600/
- IULIIA TIUNOVA — https://www.pexels.com/photo/young-woman-smiling-outdoors-in-casual-attire-33482275/
- Anh Tuấn Lê — https://www.pexels.com/photo/portrait-of-a-woman-smiling-13205272/
- Sóc Năng Động — https://www.pexels.com/photo/close-up-portrait-of-smiling-young-man-outdoors-37720662/
- nappy — https://www.pexels.com/photo/smiling-man-wearing-black-snapback-cap-and-black-crew-neck-shirt-936090/


