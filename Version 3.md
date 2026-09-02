# Attendance Management App — Version 3

A Next.js attendance management system backed by Google Sheets. Employees sign in via Google OAuth, mark daily attendance with real-time GPS location, and admins manage everything through a dynamic dashboard — all data lives in Google Sheets.

```
User → Google sign-in → Attendance form → Google Sheets
```

---

## Features

### Employee Side
- **Google OAuth login** — sign in with your Gmail account
- **Location-gated attendance** — browser geolocation required before marking attendance
- **One-click attendance** — select Office / Home / Absent with auto-captured time and GPS address
- **Monthly summary** — see your present/absent days on the home page
- **Auto-refresh** — summary table updates immediately after submitting attendance
- **Already-attended detection** — submit button disabled if attendance already submitted today

### Admin Side
- **Manage Attendance** (`/manage-attendance`) — full spreadsheet view with inline editing
  - Dropdown per employee to change Presence (Office / Home / Absent)
  - Custom time input (auto-filled with system time, editable)
  - Real-time GPS location auto-filled when selecting Office / Home
  - Location can be manually edited after auto-fill
  - Batch save — edit many cells, then save all at once
  - Present Days + Absent Days computed via COUNTIF formulas
  - All sheets accessible via dropdown (attendance + raw sheets)
  - Title dynamically shows current sheet name

- **Manage Members** (`/manage-members`) — inline editing for member data
  - Add, edit, delete members directly in the table
  - Batch save with dirty tracking
  - Columns: Full Name, Gmail, Phone, Role, Address
  - Roles: Admin / Employee (capitalized)

### Google Sheets Integration
- **2-column structure per employee** — Presence (`Office - 8:00 AM`) + Location
- **Dynamic column creation** — new employee columns auto-added on first login
- **Auto-absent marking** — past empty days filled with `Absent - 12:00 AM`
- **Friday holiday** — past Fridays auto-filled as `Holiday` with orange background
- **COUNTIF formulas** — absent days count updates automatically in the sheet
- **Text clipping** — `wrapStrategy: CLIP` prevents cell overflow
- **50-column default** — sheets created wide enough for 25+ employees
- **Data preservation** — auto-absent marking no longer truncates existing columns
- **Same-name users** — email-based matching only, two users with same name but different emails work independently

---

## Setup Guide

### Prerequisites
- Node.js 18.18+ (recommended: 20+)
- A Google Cloud project with OAuth 2.0 credentials
- A Google Cloud service account with Sheets API access
- A Google Spreadsheet to use as the database

---

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Google Cloud — Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick one).
2. **APIs & Services → Library** and enable:
   - **Google Sheets API**
   - **Google OAuth2 API** (for login)

### Step 3: Google Login (OAuth Client)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs** add:
   - `http://localhost:3000/api/auth/callback`
   - (when deploying, also add your production URL, e.g. `https://your-domain.com/api/auth/callback`)
4. Create, then copy the **Client ID** and **Client Secret** — you'll put them in `.env` (Step 6).

### Step 4: Spreadsheet Access (Service Account)

The app writes to Google Sheets through a service account:

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Create it (name it e.g. `attendance-app`), then **Create and continue** (skip optional fields).
3. Open the new service account → **Keys → Add key → Create new key → JSON** → download the file.
4. Copy the **service account email** (looks like `attendance-app@project.iam.gserviceaccount.com`).
5. Save the downloaded JSON in the project root as **`service-account.json`**.

### Step 5: Share the Spreadsheet with the Service Account

**Important — without this, attendance will NOT save.**

1. Open your spreadsheet in Google Sheets.
2. Click **Share** (top right).
3. Paste the service account email and set role to **Editor**.
4. Click **Send**.

> **Verification:** after sharing, press **Share → People** and confirm the service account email is listed with **Editor**.

### Step 6: Create the Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com/) and create a new spreadsheet.
2. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```
3. Share it with the service account as **Editor** (Step 5).

The spreadsheet will have these tabs after first run:

| Tab Name | Purpose |
|---|---|
| `Members` | Employee directory (Full Name, Gmail, Phone, Role, Address) |
| `September 2026` (auto-created) | Monthly attendance sheet |

### Step 7: Configure `.env`

```env
# === Google OAuth (for login) ===
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# === Google Sheets (for data) ===
# Option A: Paste the entire service account JSON as a string
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
# Option B: Base64-encode the JSON and paste here
# GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...

# Spreadsheet ID from the URL
SPREADSHEET_ID=your-spreadsheet-id

# === Session ===
SESSION_SECRET=any-random-string-here

# === Optional ===
# ATTENDANCE_SHEET_TAB=September 2026    # override auto-detected month tab
# EMPLOYEES_SHEET_TAB=Members            # default is "Members"
# GOOGLE_ALLOWED_DOMAINS=gmail.com       # restrict login to specific domains
```

> **Important:** Do NOT set `ALLOWED_EMAILS` or `ADMIN_EMAILS` — all users and roles come from the **Members** sheet.

**Windows (no openssl)?** Run this in PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Step 8: Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → sign in with Google → you're on the attendance page.

---

## Google Sheets Structure

### Members Tab

| Full Name | Gmail | Phone | Role | Address |
|---|---|---|---|---|
| Nepolion Chakma | nepolionchakma.nc@gmail.com | | Admin | |
| John Doe | johndoe@gmail.com | 017... | Employee | Dhaka |

- **Role** must be exactly `Admin` or `Employee` (capitalized)
- All users listed here can log in
- Only users with `Admin` role see the admin panel
- **Address** is a free-text field for the member's address

### Attendance Tab (e.g., September 2026)

| | | Nepolion Chakma \<email\> | John Doe \<email\> |
|---|---|---|---|
| **Timestamp** | | | |
| **Date** | **Day** | **Presence** | **Location** |
| 1 | Mon | Office - 9:00 AM | Road 5, Dhaka |
| 2 | Tue | Absent - 12:00 AM | N/A |
| 3 | Wed | Home - 3:30 PM | Road 5, Dhaka |
| ... | ... | ... | ... |
| 30 | Fri | Holiday | |
| **Absent Days** | | `=COUNTIF(C3:C32,"Absent*")` | `=COUNTIF(D3:D32,"Absent*")` |

- **Presence format**: `Status - Time` (e.g., `Office - 9:00 AM`, `Absent - 12:00 AM`)
- **Location**: real GPS address from browser geolocation (reverse geocoded via OpenStreetMap)
- **Fridays**: auto-filled as `Holiday` for past dates (orange background)
- **Absent Days**: COUNTIF formula auto-counts — no manual Total row needed

---

## How It Works

### Authentication Flow

1. User clicks "Sign in with Google" → redirected to Google OAuth
2. Google returns to `/api/auth/callback` with auth code
3. App exchanges code for user info (email, name, picture)
4. Checks if email exists in the **Members** tab → if not, blocked (`/login?error=not_allowed`)
5. Creates JWT session cookie → user is logged in

### Attendance Submission Flow

1. Employee opens home page → `LocationGate` checks browser geolocation permission
2. Location must be granted before the attendance form is visible
3. Employee selects Office / Home / Absent
4. On submit:
   - Browser captures GPS coordinates → reverse geocoded via OpenStreetMap
   - Time captured from system clock (Asia/Dhaka timezone)
   - Writes to Google Sheet: `["Office - 9:30 AM", "Road 5, Dhaka"]`
5. Page refreshes → summary table updates immediately

### Admin Flow

1. Admin opens `/manage-attendance` → sees dropdown of all spreadsheet tabs
2. Current month attendance tab is auto-selected
3. Grid shows all employees with Presence dropdown + Location input + Time input
4. Presence dropdown shows the full format (e.g., `Office - 03:33 PM`)
5. When selecting Office/Home:
   - Time auto-fills with current system time
   - Location auto-fills with real GPS address (browser geolocation)
6. When selecting Absent:
   - Time auto-fills with `12:00 AM`
   - Location auto-fills with `N/A`
7. Admin can manually edit time and location after auto-fill
8. Press **Save** → batch writes all changes to Google Sheets at once
9. Absent Days row recomputes via COUNTIF formula on save

### Auto-Absent Marking

- Every time the grid loads, `markAbsentForPastDays()` runs
- For each past day, empty cells are filled:
  - **Friday**: `Holiday` (orange background)
  - **Other days**: `Absent - 12:00 AM` / `N/A`
- Today's cells are never auto-filled (you can still submit)
- Data is preserved — only empty cells are filled, existing data is not overwritten

### Role-Based Access

- **Employee**: can mark own attendance, see own monthly summary
- **Admin**: can access `/manage-attendance` and `/manage-members`
- Roles are determined by the `Role` column in the Members tab
- Role changes take effect within 60 seconds (employee cache TTL)
- Removing a user from the Members tab blocks their login within 60 seconds

### Same-Name Users

- Two users with the same name but different emails work independently
- Each gets their own column in the attendance sheet
- Email is the unique identifier (not name)
- Column header format: `Name <email@example.com>`

---

## Pages

| Route | Access | Description |
|---|---|---|
| `/` | All users | Home page with monthly attendance summary |
| `/login` | Public | Google OAuth sign-in page |
| `/manage-attendance` | Admin only | Full spreadsheet view with inline editing |
| `/manage-members` | Admin only | Members directory with inline editing |

---

## API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/callback` | Public | Google OAuth callback |
| POST | `/api/auth/logout` | All | Clear session |
| GET | `/api/attendance` | All | Get today's attendance status |
| POST | `/api/attendance` | All | Submit attendance |
| GET | `/api/attendance/status` | All | Check if already attended today |
| GET | `/api/admin/data` | Admin | Get spreadsheet data (attendance or raw) |
| POST | `/api/admin/batch` | Admin | Batch update cells |
| GET | `/api/admin/members` | Admin | Get member list |
| POST | `/api/admin/members` | Admin | Add member |
| PUT | `/api/admin/members` | Admin | Update member |
| DELETE | `/api/admin/members` | Admin | Delete member |

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── admin/
│   │   │   ├── batch/route.ts       # Batch cell updates
│   │   │   ├── data/route.ts        # Get sheet data
│   │   │   ├── members/route.ts     # CRUD members
│   │   │   └── update/route.ts      # Single cell update
│   │   ├── attendance/
│   │   │   ├── route.ts             # Mark attendance
│   │   │   └── status/route.ts      # Check attendance
│   │   └── auth/
│   │       ├── callback/route.ts    # OAuth callback
│   │       └── logout/route.ts      # Logout
│   ├── components/
│   │   ├── HomeSummaryTable.tsx      # Monthly summary (present/absent)
│   │   ├── LocationGate.tsx          # GPS permission gate
│   │   └── Navbar.tsx               # Navigation bar
│   ├── login/page.tsx               # Login page
│   ├── manage-attendance/
│   │   ├── admin-client.tsx         # Admin spreadsheet view
│   │   └── page.tsx                 # Admin page wrapper
│   ├── manage-members/
│   │   ├── members-client.tsx       # Members management
│   │   └── page.tsx                 # Members page wrapper
│   ├── attendance-form.tsx          # Attendance submission form
│   ├── globals.css                  # Global styles
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Home page
├── lib/
│   ├── auth.ts                      # JWT session management
│   ├── employees.ts                 # Fallback employee list (empty)
│   ├── googleSheets.ts              # Google Sheets API integration
│   ├── memoryStore.ts               # In-memory fallback store
│   ├── oauth.ts                     # Google OAuth + access control
│   ├── storage.ts                   # Storage abstraction
│   └── utils.ts                     # Utility functions
├── .env                             # Environment variables (not committed)
└── package.json
```

---

## Deploying to Vercel

`service-account.json` is gitignored, so it never reaches Vercel. Instead, store its content as an environment variable:

1. Generate the stringified JSON (single line):
   ```bash
   node -e "console.log(JSON.stringify(require('./service-account.json')))"
   ```
2. In the Vercel project → **Settings → Environment Variables**, add:
   - `SPREADSHEET_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the stringified JSON from step 1
3. In the Google Cloud OAuth client, add your production URL to **Authorized redirect URIs**: `https://your-app.vercel.app/api/auth/callback`
4. Redeploy.

> **Alternative:** `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` (base64 of the file) also works.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth Client Secret |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Service account JSON (string or file path) |
| `SPREADSHEET_ID` | Yes | Google Spreadsheet ID from URL |
| `SESSION_SECRET` | Yes | Random string for JWT signing |
| `ATTENDANCE_SHEET_TAB` | No | Override auto-detected month tab |
| `EMPLOYEES_SHEET_TAB` | No | Override members tab name (default: `Members`) |
| `GOOGLE_ALLOWED_DOMAINS` | No | Comma-separated email domains to restrict login |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "Google login is not configured yet" | Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` |
| "The caller does not have permission" | Spreadsheet not shared with service account as **Editor** |
| "Employee not found in sheet headers" | Employee must log in once to auto-create their column |
| Attendance form not showing | Allow browser geolocation permission |
| Admin can't see Manage Attendance | User's `Role` must be `Admin` in Members tab |
| Login blocked for valid user | User's email must exist in Members tab |
| Data not updating | Employee cache is 60 seconds — wait or restart server |
| "No header row with Date found" | Sheet doesn't have the expected attendance structure |
| Attendance resets on restart | `service-account.json` is missing — app falls back to in-memory storage |
| Sign-in session expired | Google's redirect URI is wrong — check OAuth config |

> After editing `.env` or `lib/employees.ts`, restart the dev server (`Ctrl+C`, then `npm run dev`).
