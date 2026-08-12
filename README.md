# Zone Sports & Athletic Meet Management System — Web Edition

A complete, standalone website version of the Zone Sports Portal: Node.js + Express backend, a real SQLite database (via Node's built-in `node:sqlite` — nothing to compile, works on any host running Node 22.5+), and the same public live dashboard + 5 role-based operations portals as the Google Sheets version, now talking to a REST API instead of `google.script.run`.

This runs completely independently of the old Google Apps Script system — nothing here touches that spreadsheet. You can run both in parallel and switch over whenever you're ready.

## What's inside

```
zone-sports-website/
├── server.js       # Express app + every REST endpoint
├── db.js           # SQLite schema (auto-creates data/zonesports.db on first run)
├── seed.js         # Creates the first Super Admin login + imports schools_import.csv
├── package.json
├── Dockerfile
├── schools_import.csv   # Real school list + bib ranges from the corrigendum PDF
└── public/
    ├── index.html   # Public dashboard + login + portal shell (same UI as before)
    └── app.js        # Client engine (fetch-based, no Google dependency)
```

## Run it locally

```bash
cd zone-sports-website
npm install
npm run seed      # creates the first Super Admin login + imports the 115 schools
npm start          # starts the server on http://localhost:3000
```

Open `http://localhost:3000` in a browser. The public dashboard loads immediately with no login. Click **Portal Login** to sign in as the Super Admin:

- **User ID or Email:** `lokeshraghav.in@gmail.com`
- **Password:** `Lokesh@123`

**Change this password after your first login** (there's no self-service password change screen yet — for now, re-run `node seed.js` after deleting that user row, or ask me to add a "change password" screen if you want it).

From the Super Admin dashboard you can then:
- Add Teachers/Officials (any of the 5 portal roles) — a login is generated automatically and shown on screen.
- Add students directly, or let School Teachers add their own once they have a login.
- Create events, set schedules, assign duties (with the Incharge checkbox), and use **Bulk Import** to paste/upload CSVs for schools, teachers, or events instead of typing them one by one.

## Deploying it for real (a real domain + always-on hosting)

This app needs a host that runs a persistent Node process and gives you a persistent disk (for the SQLite file) — **not** a serverless platform like Vercel/Netlify Functions. Good options:

**Render.com** (recommended, has a free tier)
1. Push this folder to a GitHub repo.
2. On Render: New → Web Service → connect the repo.
3. Build command: `npm install && npm run seed`
4. Start command: `npm start`
5. Add a **Disk** (Render dashboard → Disks) mounted at `/opt/render/project/src/data` so the database survives redeploys.
6. Once live, Render gives you a `https://your-app.onrender.com` URL — you can point your own domain at it from Render's Custom Domain settings.

**Railway.app** (also easy, has a free trial then paid)
1. New Project → Deploy from GitHub repo.
2. Railway auto-detects Node and runs `npm install && npm start`. Add `npm run seed` as a one-off command the first time (Railway → your service → "Run Command").
3. Add a **Volume** mounted at `/app/data`.
4. Attach your own domain under Settings → Domains.

**Any VPS (DigitalOcean, a friend's server, etc.) with Docker**
```bash
docker build -t zone-sports .
docker run -d -p 3000:3000 -v zonesports_data:/app/data zone-sports
```
Then put Nginx/Caddy in front for HTTPS and your domain.

I can't deploy this to a live URL directly from this chat session (no server-provisioning connection is currently active) — but the app is fully built, tested, and ready; any of the steps above will take about 10–15 minutes.

## Importing your real data

`schools_import.csv` (already included, already imported by `npm run seed`) has all 115 schools with their real allocated bib-number ranges from your corrigendum PDF. To bring in the teacher/official list and the 4-day event schedule the same way:

1. Log in as Super Admin → **Bulk Import** tab.
2. Paste or upload a CSV with the columns shown on that screen for Teachers & Officials, then Events.
3. Every teacher/official row with an email automatically gets a portal login — the created User ID + temporary password are shown in the import results.

## How data storage works here (vs. the Google Sheets version)

- Real SQLite database file at `data/zonesports.db` — proper tables, foreign keys, and indexes (not spreadsheet rows).
- Photos are stored as embedded `data:` URLs directly in the database — no separate file storage service needed.
- Certificates are generated as printable HTML pages (`/certificate/:id` — has a Print/Save-as-PDF button) instead of Google Docs, so there's no dependency on Drive.
- Sessions are server-side tokens (6-hour expiry), not Apps Script's `CacheService`.

## Notes on "Athletic Meet" vs "Zonal Sports" on the public dashboard

Events created with **Type = Track/Field** count toward the "Athletic Meet" leaderboard; events created with **Type = Team Game** (e.g. Kabaddi, Kho-Kho, Tug-of-War, Volleyball) count toward "Zonal Sports". Pick the right type when you add each event and the dashboard will sort itself into the right tab automatically.
