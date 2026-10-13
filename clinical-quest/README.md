# Clinical Quest — your own copy

This is the Clinical Quest game exported from Higgsfield, set up to run on **your own Cloudflare account and your own domain**. Same screens, same three cases, same student accounts, same Stripe membership code. The only changes from the Higgsfield version:

- The three hospital illustrations are now stored in `public/img/` instead of Higgsfield's servers.
- The site can no longer be embedded inside Higgsfield, and search engines are allowed to index it.
- Higgsfield-only build files were removed; everything runs with plain `npm` + Cloudflare's `wrangler`.

Student accounts created on the Higgsfield version do not carry over — this copy starts with an empty database.

---

## What you need

- **Node.js 22 or newer** — https://nodejs.org (pick the LTS installer)
- **A Cloudflare account** (free) — https://dash.cloudflare.com/sign-up
- **Your domain on Cloudflare.** Easiest: buy it in Cloudflare (Domain Registration → Register Domains). If you bought it elsewhere (GoDaddy, Namecheap…), add it in Cloudflare with "Add a domain" and switch the nameservers at your registrar to the two Cloudflare gives you.
- Later, to take payments: a **Stripe** account. For "forgot password" emails: a **Resend** account.

Cloudflare's free Workers plan covers this setup to start. The $5/month Workers Paid plan raises the limits once you have real traffic.

Open a terminal in this folder for every command below.

---

## 1. Try it on your computer

```bash
npm install
npm run dev
```

Open http://localhost:8787, create an account, and play. (Use Chrome or Firefox locally.)

## 2. Put it on Cloudflare

```bash
npx wrangler login
npx wrangler d1 create clinical-quest-db
```

The second command prints a `database_id`. Paste it into `wrangler.jsonc` in place of `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Then:

```bash
npm run db:migrate:remote
npm run deploy
```

You'll get a working link like `https://clinical-quest.<your-name>.workers.dev`.

## 3. Attach your domain

```bash
npm run set-domain -- yourdomain.com
npm run deploy
```

Cloudflare creates the DNS record and the SSL certificate automatically; give it a few minutes. To also serve `www.yourdomain.com`, add it in the Cloudflare dashboard: Workers & Pages → clinical-quest → Settings → Domains & Routes → Add → Custom domain.

---

## 4. Turn on paid memberships (Stripe)

The checkout, billing portal and webhook code are already built and switched off.

**Decide what's paid first.** Right now the three existing cases (`infection`, `dka`, `pe`) are free for anyone with an account, and only cases you add later require a membership. That rule is one line in `src/room.ts`:

```ts
if (verdict.ok && caseId && !["infection","dka","pe"].includes(caseId)) {
```

Remove IDs from that list to put those cases behind the paywall (e.g. keep only `"infection"` free as a sample).

**Then set up Stripe:**

1. Stripe dashboard → Product catalog → Add product ("Clinical Quest Membership") with two recurring prices: one monthly, one yearly. Copy both price IDs (`price_...`).
2. Settings → Billing → Customer portal → activate it (students use it to cancel or update cards).
3. Developers → Webhooks → Add endpoint: `https://yourdomain.com/api/stripe/webhook`, with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
   Copy the signing secret (`whsec_...`).
4. Store the keys (each command asks you to paste the value):
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   npx wrangler secret put STRIPE_PRICE_MONTHLY
   npx wrangler secret put STRIPE_PRICE_ANNUAL
   ```
5. In `wrangler.jsonc` change `"BILLING_ENABLED": "false"` to `"true"`, then `npm run deploy`.

Start with Stripe **test** keys (`sk_test_...`) and buy a membership with card 4242 4242 4242 4242. The site labels itself as test mode until you switch to the live key (`sk_live_...`); when you do, create a live-mode webhook and live prices too and update all four secrets.

## 5. Password-reset emails (optional)

1. Sign up at https://resend.com, verify your domain, create an API key.
2. ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM      # e.g.  Clinical Quest <support@yourdomain.com>
   ```
3. `npm run deploy`. The "Forgot password" option appears automatically.

---

## Before you start selling

- Remove the prototype labels: the **LEARNING DEMO** badge and the footer text "Educational prototype · Demo content pending medical review" in `public/index.html`, and "Demo content — pending medical review" / "Demo cases completed" in `public/client.js`.
- Add Terms of Service, Privacy Policy and refund policy pages — Stripe expects them on a site that takes payments.
- The illustrations and share images were generated in Higgsfield; check that your Higgsfield plan allows commercial use.

## Where things live

| Path | What it is |
|---|---|
| `src/logic.js` | The cases, questions, answers and explanations (the `CASES` list at the top) and the game rules |
| `public/client.js`, `public/style.css`, `public/index.html` | The game screens |
| `public/account.js` | Sign-in, sign-up and membership screens |
| `public/img/` | The three patient-room illustrations |
| `src/accounts.ts` | Accounts, sessions, password reset |
| `src/billing.ts` | Stripe checkout, portal and webhook |
| `src/room.ts` | Each student's private game room and saved progress; the paywall rule |
| `migrations/` | Database tables |
| `marketing/` | Cover art from the Higgsfield listing, for ads and social posts (not served by the site) |

## Handy commands

| Command | Does |
|---|---|
| `npm run dev` | Run locally |
| `npm run deploy` | Publish changes |
| `npm test` | Run the 31 automated tests (accounts, rooms, game state) |
| `npm run typecheck` | Check the TypeScript |
| `npx wrangler tail` | Watch live server logs |
