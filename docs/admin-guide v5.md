# Datafluent BD — Admin Guide v5

## Overview

Datafluent BD helps track daily attendance for students, teachers, and staff. Admins can view summaries, manage the attendance sheets, and configure the system.

---

## Project Setup Guide

### Prerequisites

- **Node.js** 18.18+ (recommended: 20+)
- **Yarn** or **npm** package manager
- A **Google Cloud** project with OAuth 2.0 credentials
- A **Google Cloud** service account with Sheets API access
- A **Google Spreadsheet** to use as the database

### Step 1: Clone & Install

```bash
git clone <repository-url>
cd attendance-app
yarn install
```

### Step 2: Google Cloud — Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick one).
2. Navigate to **APIs & Services → Library** and enable:
   - **Google Sheets API**
   - **Google OAuth2 API** (for login)

### Step 3: Google Login (OAuth Client)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs** add:
   - `http://localhost:3000/api/auth/callback`
   - (when deploying, also add your production URL, e.g. `https://your-domain.com/api/auth/callback`)
4. Create, then copy the **Client ID** and **Client Secret** — you'll put them in `.env`.

### Step 4: Spreadsheet Access (Service Account)

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Create it (name it e.g. `attendance-app`), then **Create and continue** (skip optional fields).
3. Open the new service account → **Keys → Add key → Create new key → JSON** → download the file.
4. Copy the **service account email** (looks like `attendance-app@project.iam.gserviceaccount.com`).
5. Save the downloaded JSON in the project root as **`service-account.json`**.

### Step 5: Share Spreadsheets with Service Account

**Important — without this, attendance will NOT save.**

1. Open your spreadsheet in Google Sheets.
2. Click **Share** (top right).
3. Paste the service account email and set role to **Editor**.
4. Click **Send**.
5. Repeat for **ALL THREE** spreadsheets (Admin, Employee, Bootcamp).

> **Verification:** after sharing, press **Share → People** and confirm the service account email is listed with **Editor**.

### Step 6: Create Spreadsheets

1. Go to [Google Sheets](https://sheets.google.com/) and create **three** spreadsheets:
   - **Admin Spreadsheet** (contains Members directory + Admin attendance)
   - **Employee Spreadsheet** (Employee attendance)
   - **Bootcamp Spreadsheet** (Bootcamp attendance)
2. Copy each **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```

### Step 7: Configure `.env`

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# === Google OAuth (for login) ===
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# === Google Sheets (for data) ===
# Option A: Paste the entire service account JSON as a string
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
# Option B: Base64-encode the JSON and paste here
# GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Ii...

# Spreadsheet IDs (required)
ADMIN_SPREADSHEET_ID=your-admin-spreadsheet-id
EMPLOYEE_SPREADSHEET_ID=your-employee-spreadsheet-id
BOOTCAMP_SPREADSHEET_ID=your-bootcamp-spreadsheet-id

# === Session ===
SESSION_SECRET=any-random-string-here

# === Optional ===
# ATTENDANCE_SHEET_TAB=September 2026
# EMPLOYEES_SHEET_TAB=Members
# GOOGLE_ALLOWED_DOMAINS=gmail.com
# AUTO_ABSENT_TIME="12:00 AM"
# NEXT_PUBLIC_AUTO_ABSENT_TIME="12:00 AM"
# ADMIN_CAN_SUBMIT_ATTENDANCE=yes
```

**Windows (no openssl)?** Run this in PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Step 8: Run the App

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) → sign in with Google → you're on the attendance page.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth Client Secret |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Service account JSON (string, base64, or file path) |
| `SPREADSHEET_ID` | Yes | Admin Google Spreadsheet ID (legacy fallback) |
| `ADMIN_SPREADSHEET_ID` | Yes | Admin spreadsheet (Members + Admin attendance) |
| `EMPLOYEE_SPREADSHEET_ID` | No | Employee attendance spreadsheet (falls back to admin) |
| `BOOTCAMP_SPREADSHEET_ID` | No | Bootcamp attendance spreadsheet (falls back to admin) |
| `SESSION_SECRET` | Yes | Random string for JWT signing |
| `ATTENDANCE_SHEET_TAB` | No | Override auto-detected month tab |
| `EMPLOYEES_SHEET_TAB` | No | Members tab name (default: `Members`) |
| `GOOGLE_ALLOWED_DOMAINS` | No | Comma-separated email domains to restrict login |
| `AUTO_ABSENT_TIME` | No | Time written into auto-absent cells (default: `12:00 AM`) |
| `NEXT_PUBLIC_AUTO_ABSENT_TIME` | No | Same value, shown in the admin panel auto-fill |
| `ADMIN_CAN_SUBMIT_ATTENDANCE` | No | `yes` (default) lets admins submit; `no` blocks admin submits |

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── admin/
│   │   │   ├── batch/route.ts       # Batch cell updates
│   │   │   ├── data/route.ts        # Get sheet data
│   │   │   ├── members/route.ts     # CRUD members
│   │   │   ├── maintenance/route.ts # Tab maintenance (refresh / add-col / rebuild)
│   │   │   └── update/route.ts      # Single cell update
│   │   ├── attendance/
│   │   │   ├── route.ts             # Mark attendance
│   │   │   └── status/route.ts      # Check attendance
│   │   └── auth/
│   │       ├── callback/route.ts    # OAuth callback
│   │       └── logout/route.ts      # Logout
│   ├── components/
│   │   ├── HomeSummaryTable.tsx      # Monthly summary (present/absent)
│   │   ├── Navbar.tsx               # Navigation bar
│   │   └── AttendanceHistory.tsx    # Attendance history view
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
│   ├── employees.ts                 # Fallback employee list
│   ├── googleSheets.ts              # Google Sheets API integration
│   ├── memoryStore.ts               # In-memory fallback store
│   ├── oauth.ts                     # Google OAuth + access control
│   ├── storage.ts                   # Storage abstraction
│   └── utils.ts                     # Utility functions
├── scripts/
│   └── verify-auto-absent.mjs       # Verification test
├── .env                             # Environment variables (not committed)
├── service-account.json             # Google service account key (not committed)
├── proxy.js                         # Route protection
├── instrumentation.js               # Hourly auto-absent job
└── package.json
```

---

## Features

### Employee Side
- **Google OAuth login** — sign in with your Gmail account
- **One-click attendance** — select On-site / Remote with auto-captured time
- **Monthly summary** — see your present/absent days on the home page
- **Auto-refresh** — summary table updates immediately after submitting attendance
- **Already-attended detection** — submit button disabled if attendance already submitted today

### Admin Side
- **Manage Attendance** (`/manage-attendance`) — full spreadsheet view with inline editing
- **Manage Members** (`/manage-members`) — inline editing for member data
- **Sheet maintenance** — repair or refresh attendance tabs (refresh / add-col / rebuild)
- **Spreadsheet switcher** — view Admin / Employee / Bootcamp sheets

---

## Google Sheets Structure

### Members Tab

| Full Name | Gmail | Phone | Role | Address |
|---|---|---|---|---|
| Nepolion Chakma | nepolionchakma.nc@gmail.com | | Admin | |
| John Doe | johndoe@gmail.com | 017... | Employee | Dhaka |

- **Role** must be exactly `Admin`, `Employee`, or `Bootcamp` (capitalized)
- All users listed here can log in
- Only users with `Admin` role see the admin panel

### Attendance Tab (e.g., September 2026)

| | | Nepolion Chakma \<email\> | John Doe \<email\> |
|---|---|---|---|
| **Date** | **Day** | **Presence** | **Time** |
| 1 | Mon | On-site | 9:00 AM |
| 2 | Tue | Absent | 12:00 AM |
| 3 | Wed | Remote | 3:30 PM |
| ... | ... | ... | ... |
| 30 | Fri | Holiday | |
| **Absent Days** | | `=COUNTIF(C3:C32,"Absent*")` | `=COUNTIF(D3:D32,"Absent*")` |

- **Presence**: pure status — `On-site` / `Remote` / `Absent` / `Holiday`
- **Time**: separate column next to Presence (e.g. `9:00 AM`); empty for Holidays
- **Fridays**: auto-filled as `Holiday` for past dates

### Holiday List (admin spreadsheet)

The admin spreadsheet has a **Holiday List** tab (rename with `HOLIDAYS_SHEET_TAB` if needed):

| Date | Name |
| --- | --- |
| 09-20-2026 | ABC |
| 09-21-2026 | DD |

- Column A = date, column B = holiday name
- Every listed date is written as **Holiday** in the matching month tab
- On a holiday **nobody can submit attendance**
- Verify with: `node --env-file=.env scripts/verify-holidays.mjs`

---

## Admin Tasks

### 1. Configure the attendance sheet

- Ensure the sheet has a header row with emails or names
- Make sure each column represents a person
- Verify that the sheet includes "On-site" and "Remote" attendance markers

### 2. View overall attendance

Use the **Spreadsheet** switcher on the Manage Attendance page to view Admin / Employee / Bootcamp sheets.

- Each sheet strictly holds only its own group
- Wrong-group writes are rejected automatically
- If an old tab has mixed columns, press **Prune** to fix

### 3. Mark or check attendance

- The attendance form lets users record their own attendance
- Admins can monitor the sheet directly to review or correct entries
- To create a column for someone, mark attendance using the form with that person's email

### 4. Manage employees/students list

- Review the member list at `/manage-members`
- Add or edit members directly in the table
- Ensure each member has a valid email and name
- Batch save with dirty tracking

---

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Dev server |
| `yarn build` / `yarn start` | Production build / serve |
| `yarn lint` | ESLint |
| `yarn verify:absent` | End-to-end test of auto-absent + submit |

---

## Deploying to Vercel

`service-account.json` is gitignored. Store its content as an environment variable:

1. Generate the stringified JSON:
   ```bash
   node -e "console.log(JSON.stringify(require('./service-account.json')))"
   ```
2. In Vercel → **Settings → Environment Variables**, add all `.env` variables
3. In Google Cloud OAuth client, add production URL to **Authorized redirect URIs**:
   `https://your-app.vercel.app/api/auth/callback`
4. Redeploy

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "Google login is not configured yet" | Check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` |
| "The caller does not have permission" | Spreadsheet not shared with service account as **Editor** |
| "Employee not found in sheet headers" | Employee must log in once to auto-create their column |
| Attendance form not showing | Refresh the page — check server logs if persists |
| Admin can't see Manage Attendance | User's `Role` must be `Admin` in Members tab |
| Login blocked for valid user | User's email must exist in Members tab |
| Data not updating | Employee cache is 60 seconds — wait or restart server |
| Attendance resets on restart | `service-account.json` is missing — app falls back to in-memory storage |
| Auto-absent shows wrong time | Set `AUTO_ABSENT_TIME` and `NEXT_PUBLIC_AUTO_ABSENT_TIME` in `.env` |

> After editing `.env`, restart the dev server (`Ctrl+C`, then `yarn dev`).

---

## Support

If you need help with sheet setup or admin permissions, contact the person who provisioned the app. You may also check logs in the browser console if something fails during summary loading.
