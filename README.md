# Attendance App

Employees sign in with their Google account, then mark today's attendance
(Office / Home). Records are stored in a Google Sheets spreadsheet.

```
User → Google sign-in → Attendance form → Google Sheets
```

## Prerequisites

- Node.js 18.18+ (recommended: 20+)
- A Google account (for Google Cloud console + Gmail sign-in)
- A Google Sheets spreadsheet for attendance records

## Setup — step by step

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Google Cloud — enable APIs

1. Go to <https://console.cloud.google.com> and create a project (or pick one).
2. **APIs & Services → Library** and enable:
   - `Google Sheets API`
3. Note your project name — you'll need it below.

### Step 3: Google login (OAuth client)

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized redirect URIs** add:
   - `http://localhost:3000/api/auth/callback`
   - (when deploying, also add your production URL, e.g. `https://your-domain.com/api/auth/callback`)
4. Create, then copy the **Client ID** and **Client secret** — you'll put them in `.env` (Step 6).

### Step 4: Spreadsheet access (service account)

The app writes to Google Sheets through a service account:

1. Go to **APIs & Services → Credentials → Create Credentials → Service account**.
2. Create it (name it e.g. `attendance-app`), then **Create and continue** (skip optional fields).
3. Open the new service account → **Keys → Add key → Create new key → JSON** → download the file.
4. Save the downloaded file in the project root as **`service-account.json`**.

### Step 5: Share the spreadsheet with the service account

**Important — without this, attendance will NOT save** (error: "The caller does not
have permission").

1. Open your attendance spreadsheet in Google Sheets (the one whose URL contains
   the ID you put in `SPREADSHEET_ID`).
2. Click **Share** (top right).
3. In the **Add people and groups** box, paste the service account email found
   inside `service-account.json` (key `client_email`). For this project it is:
   ```
   datafluent-attendance@procg-446107.iam.gserviceaccount.com
   ```
4. **Critical:** the role dropdown next to the email must say **Editor** —
   not Viewer, not Commenter. If it says Viewer, your attendance writes will
   keep failing.
5. Click **Send**.

> **Why does the error still appear after sharing?** Common causes:
> - Typo in the service account email (copy it directly from `service-account.json`).
> - Role is **Viewer** instead of **Editor** — open Share again and change it.
> - You shared a *different* spreadsheet than the one in `SPREADSHEET_ID`.
> - If this is a Google Workspace account, the workspace admin may block sharing
>   outside the organization — allow "anyone with the link can edit" temporarily,
>   or ask the admin to allow external sharing.
>
> **Verification:** right after sharing, press **Share → People** and confirm the
> service account email is listed with **Editor**.

### Step 6: Configure `.env`

Copy the example file and fill it in:

```bash
cp .env.example .env
```

```
# --- Google Sheets storage ---
SPREADSHEET_ID=                # The long ID in your spreadsheet's URL
                               # https://docs.google.com/spreadsheets/d/<THIS IS THE ID>/edit
ATTENDANCE_SHEET_TAB=          # Optional: use a specific tab (e.g. "August 2026").
                               # If empty, the app creates one tab per month automatically.

# --- Google login ---
GOOGLE_CLIENT_ID=              # From Step 3
GOOGLE_CLIENT_SECRET=          # From Step 3
GOOGLE_ALLOWED_DOMAINS=        # Optional: extra restriction — comma-separated domains.
                               # Main filter is the ALLOWED_EMAILS list in lib/employees.js.

# --- Session ---
SESSION_SECRET=                # Run: openssl rand -base64 32
```

- **Windows (no openssl)?** Run this in PowerShell: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- Leave `ATTENDANCE_SHEET_TAB` empty the first time — the app creates a tab
  named after the current month automatically.

### Step 7: Run

```bash
npm run dev
```

Open <http://localhost:3000> → sign in with Google → you're on the attendance page.
Select **Office** or **Home** and submit. Your attendance appears in the sheet
immediately.

## How it works

| File | Purpose |
| --- | --- |
| `app/login/page.js` | Google sign-in page |
| `app/page.js` | Home page — the attendance form (login required) |
| `app/api/auth/google`, `callback`, `logout` | Google OAuth flow (login/logout) |
| `app/api/attendance/route.js` | POST — marks attendance, rejects duplicates (409) |
| `app/api/attendance/status/route.js` | GET — checks if an employee already marked today |
| `proxy.js` | Redirects unauthenticated users to `/login` |
| `lib/storage.js` | Storage backend: Google Sheets or in-memory fallback |
| `lib/employees.js` | Employee names (must match Google login names, case-insensitive) |

### Attendance sheet structure

- One tab per month, auto-created with the name **"August 2026"** style when
  missing (or use `ATTENDANCE_SHEET_TAB` to pin a fixed tab).
- One row per day of the month (`Date`, `Day`), one column per employee.
- Employee columns use the person's **Google full name** and are added
  automatically the first time they sign in.
- Each employee can mark attendance **once per day** (duplicates are rejected).
- An **"Absent Days"** row (bold header) under the grid shows how many days
  each employee was absent, with a calculated **Total** row.
- **Auto-absent:** anyone who doesn't submit by midnight (Asia/Dhaka) is marked
  **"Absent"** for the previous day automatically (checked every hour and on
  every request).

### Adding / removing employees

Only people whose **Gmail address** is listed can sign in. Edit
`lib/employees.js`:

```js
export const ALLOWED_EMAILS = ['arif@gmail.com', 'ovi@gmail.com', ...]
```

- The Google account's **full name** becomes their column in the sheet
  (auto-added on first login).
- A new employee's column is added automatically — no sheet edits needed.
- To remove someone, just remove their email from the list.

## Troubleshooting

| Error | Fix |
| --- | --- |
| "Google login is not configured yet" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing or server not restarted after editing `.env` |
| "The caller does not have permission" | Spreadsheet is not shared with the service account as **Editor** (Step 5). Check: exact email, **Editor** role, correct spreadsheet |
| "Employee ... not found in the sheet headers" | The person isn't in `ALLOWED_EMAILS` (login is blocked) or the name differs from their Google full name — columns are created from the Google name at login |
| Login says "Sign-in session expired" | Google's redirect URI is wrong — check Step 3 |
| Attendance resets on restart | `service-account.json` is missing — the app falls back to in-memory storage (dev only) |

**Note:** after editing `.env` or `lib/employees.js`, restart the dev server
(`Ctrl+C`, then `npm run dev`).
