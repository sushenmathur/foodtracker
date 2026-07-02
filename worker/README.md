# foodtracker-api (Cloudflare Worker)

Backend for cross-device sync: single-user auth (email + password + TOTP MFA)
and per-day meal-log storage in MongoDB Atlas. The browser never sees the Mongo
credentials — it calls this Worker, which holds them as encrypted secrets.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | `{ ok, registered }` |
| POST | `/auth/register` | register token | Create the one user (only when none exists). Returns `otpauth_url` for the authenticator QR. |
| POST | `/auth/activate` | — | Confirm the first TOTP code → session token, enables MFA. |
| POST | `/auth/login` | — | email+password → `{ mfaRequired, ticket }`. |
| POST | `/auth/mfa` | ticket | ticket + 6-digit code → `{ token }` session (30 days). |
| GET | `/days?from=&to=` | Bearer | List day logs in a date range. |
| GET/PUT | `/days/:YYYY-MM-DD` | Bearer | Read / upsert one day's log. |
| GET/PUT | `/state` | Bearer | Read / upsert app state (targets, foods, favourites, recents, profile). |

Security notes: passwords hashed with PBKDF2-SHA256 (210k iterations, per-user
salt); MFA is RFC-6238 TOTP; sessions are HS256 JWTs. Registration is gated by a
one-time `REGISTER_TOKEN` and only works while zero users exist.

## Deploy

Prerequisites: a Cloudflare account and MongoDB Atlas cluster.

```bash
cd worker
npm install
npx wrangler login

# Secrets (never commit these):
npx wrangler secret put MONGODB_URI      # mongodb+srv://user:<ROTATED-pw>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
npx wrangler secret put JWT_SECRET       # openssl rand -hex 32
npx wrangler secret put REGISTER_TOKEN   # openssl rand -hex 16

# Edit ALLOWED_ORIGIN in wrangler.toml if your site origin differs, then:
npm run deploy
```

Deploy prints the Worker URL (e.g. `https://foodtracker-api.<subdomain>.workers.dev`).
Give that URL back so the frontend can be pointed at it.

### MongoDB Atlas network access

Serverless Workers have dynamic egress IPs, so under **Atlas → Network Access**
either allow `0.0.0.0/0` (the DB-user password is the guard) or use Cloudflare's
published egress ranges. Use a **database user** scoped to the `foodtracker` DB —
not your Atlas admin account.

### Register the single user (one-time)

After deploy:

```bash
curl -X POST https://<worker-url>/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Register-Token: <REGISTER_TOKEN>" \
  -d '{"email":"you@example.com","password":"a-long-passphrase"}'
```

The response's `otpauth_url` can be turned into a QR for your authenticator app
(the frontend login screen will do this for you once wired up). Then the app's
login flow calls `/auth/activate` with your first 6-digit code to finish MFA
setup. (For now the frontend still runs local-only; wiring is the next step.)
