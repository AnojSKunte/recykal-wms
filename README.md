# Recykal WMS

Warehouse Management System — Cloudflare Pages + Google Sheets backend.

## Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages (free) |
| API / Backend | Cloudflare Pages Functions (Workers) |
| Auth | Google OAuth 2.0 |
| Database | Google Sheets API v4 |
| File storage | Google Drive API v3 |
| AI | Gemini 1.5 Flash |

---

## One-time Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/recykal-wms.git
cd recykal-wms
npm install
```

### 2. Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create project: **Recykal WMS**
3. Enable APIs: **Google Sheets API** + **Google Drive API**
4. Create **Service Account**: `recykal-wms-service`
   - Download JSON key → keep it safe, never commit it
5. Create **OAuth 2.0 Client ID** (Web application)
   - Authorized redirect URI: `https://YOUR_PAGES_URL.pages.dev/api/auth/google/callback`
   - Also add: `http://localhost:8788/api/auth/google/callback` for local dev
6. Share your Google Sheet with the service account email (Editor access)

### 3. Cloudflare setup

1. Sign up at [cloudflare.com](https://cloudflare.com)
2. Go to **Pages** → Connect to Git → select `recykal-wms`
3. Build settings:
   - Build command: (leave empty)
   - Build output directory: `public`
4. Deploy once to get your Pages URL

### 4. Set secrets

Run these one by one:

```bash
# The entire contents of your service account JSON file
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# From your Google Sheet URL: docs.google.com/spreadsheets/d/THIS_PART/edit
wrangler secret put GOOGLE_SHEET_ID

# From OAuth 2.0 credentials
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Random 32+ character string (generate at: randomkeygen.com)
wrangler secret put SESSION_SECRET

# Your Gemini API key
wrangler secret put GEMINI_API_KEY

# Google Drive folder IDs (from folder URL)
wrangler secret put PO_DRIVE_FOLDER_ID
wrangler secret put ATT_DRIVE_FOLDER_ID
wrangler secret put PROC_DRIVE_FOLDER_ID

# Your app URL (e.g. https://recykal-wms.pages.dev) — needed for email approval links
wrangler secret put APP_URL

# Operations team email for PO creation requests
wrangler secret put OPS_EMAIL
```

### 5. Update wrangler.toml

Add your Cloudflare account ID:
```toml
account_id = "YOUR_ACCOUNT_ID"  # found in Cloudflare dashboard → right sidebar
```

### 6. Deploy

```bash
# Local development
npm run dev
# Opens at http://localhost:8788

# Deploy to production
git push origin main
# Cloudflare auto-deploys on every push to main
```

---

## Project Structure

```
recykal-wms/
├── public/                    # Frontend (static files)
│   ├── index.html             # App entry point + login screen
│   ├── css/app.css            # All styles
│   └── js/
│       ├── app.js             # Auth, routing, API layer
│       └── pages/
│           ├── dashboard.js   # Dashboard with PC filter
│           ├── po.js          # PO Requisition form
│           ├── attendance.js  # Attendance form
│           └── processing.js  # Processing form + drafts
├── functions/                 # Cloudflare Pages Functions (backend)
│   └── api/
│       ├── _middleware.js     # Auth guard for all /api/* routes
│       ├── _sheets.js         # Google Sheets + Drive API helpers
│       ├── auth/google.js     # OAuth flow
│       ├── user.js            # GET /api/user
│       ├── dashboard.js       # GET /api/dashboard
│       ├── po.js              # POST /api/po + approval handler
│       ├── attendance.js      # POST /api/attendance
│       ├── processing.js      # Processing submit, lots, drafts
│       ├── gemini.js          # POST /api/gemini
│       └── formdata/
│           ├── po.js          # GET /api/formdata/po
│           ├── attendance.js  # GET /api/formdata/attendance
│           └── processing.js  # GET /api/formdata/processing
├── wrangler.toml              # Cloudflare config
├── package.json
└── .gitignore
```

---

## Google Sheet setup

The system auto-creates sheets on first use. Your existing sheets are read as-is.

**Employee Master columns required:**
```
Official Mail ID | Name | Processing Center | Role | PO form | Attendance form | Processing form
```
- Processing Center: comma-separated for multi-center: `Center A, Center B`
- Permission columns: `Y` = access, blank = no access

---

## Adding a new form

1. Create `functions/api/formdata/myform.js` — GET endpoint returning form data
2. Create `functions/api/myform.js` — POST endpoint handling submission
3. Create `public/js/pages/myform.js` — page module with `export async function render(container, G)`
4. Add nav item to `NAVDEF` array in `public/js/app.js`
5. Add permission column `My form` to Employee Master sheet

That's it. No other files change.

---

## Email setup (choose one)

Option A — **Resend** (recommended, free tier: 3000 emails/month):
```bash
wrangler secret put RESEND_API_KEY
```
Then update `sendEmail()` in `functions/api/po.js`.

Option B — **Gmail API** with domain-wide delegation (more complex setup).

Option C — Keep console.log for now, wire up later.
