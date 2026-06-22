# Your DJ Mix Store

A website where fans pay via M-Pesa and get an automatic download of your mix.

## What's included
- **Storefront** — grid of your mixes with cover art and price
- **Mix page** — audio preview player + M-Pesa checkout (enter phone number → STK push)
- **Auto-download** — once payment confirms, the browser automatically downloads the file
- **Admin page** (`/admin`) — upload new mixes, see orders and total sales, hide/delete mixes

## 1. Install and run locally

You need [Node.js](https://nodejs.org) installed (v18 or newer).

```bash
cd djstore
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `SITE_NAME` and `DJ_NAME` — your branding
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — your login for `/admin`
- `SESSION_SECRET` — any long random string

Then start it:
```bash
npm start
```

Visit `http://localhost:3000` for the storefront, and `http://localhost:3000/admin` to upload your first mix.

This version supports **both M-Pesa and card payments** via IntaSend — fans pick either on the checkout page. Card payments redirect to IntaSend's secure hosted payment page, so no card details ever touch your own server.

## 2. Set up M-Pesa payments (IntaSend)

1. Go to **intasend.com** and create a free account.
2. In your dashboard, switch to **Test mode** first (no real money) and copy your **Publishable Key** and **Secret Key**.
3. Paste them into `.env`:
   ```
   INTASEND_PUBLISHABLE_KEY=ISPubKey_test_...
   INTASEND_SECRET_KEY=ISSecretKey_test_...
   INTASEND_TEST_MODE=true
   ```
4. Test a purchase using IntaSend's sandbox test phone numbers (they provide these in their docs/dashboard).
5. Once you've tested it works, go through IntaSend's verification to enable **Live mode**, switch in your dashboard to get **live** keys, update `.env`:
   ```
   INTASEND_SECRET_KEY=ISSecretKey_live_...
   INTASEND_TEST_MODE=false
   ```
   Real M-Pesa payments will now land in your IntaSend account, which you withdraw to your bank or M-Pesa.

## 3. Add your mixes

Go to `/admin`, log in, and use the upload form:
- Title, price, description, duration label
- Cover image (optional but recommended)
- The actual mix audio file (mp3/wav)

Repeat any time you have a new release — no coding needed.

## 4. Going live (hosting)

This is a Node.js app with a small file-based database (SQLite) and local file storage for audio/covers, so it needs a host that keeps a persistent disk — not a static host like plain Netlify.

Good, cheap options that work well for this:
- **Railway.app** — easiest, free tier to start, persistent storage
- **Render.com** — similar, has a free tier with some sleep delay
- A small **VPS** (DigitalOcean, Linode) if you want full control

General steps for any of them:
1. Push this project to a GitHub repo
2. Connect the repo to your chosen host
3. Set the same environment variables from `.env` in their dashboard (never commit your real `.env` file)
4. Set `PUBLIC_BASE_URL` to your real live domain — IntaSend needs this for payment callbacks
5. Deploy

Once live, point your domain (e.g. from Namecheap, or a free subdomain the host gives you) at it.

## Security notes before you launch
- Change `ADMIN_PASSWORD` and `SESSION_SECRET` to strong unique values — don't leave the example values.
- Keep `.env` out of version control (a `.gitignore` is included).
- Download links are single-use tokens generated only after payment confirms — they can't be guessed.
- Back up `db/store.db` periodically (or migrate to a hosted database like Postgres if your catalog/orders grow large).

## Need a hand deploying?
Once you've got your IntaSend keys and have picked a host, I can help you through the actual deployment step by step.
