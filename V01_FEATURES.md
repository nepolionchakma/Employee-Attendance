# Attendance App — Version 0.1 Features

> Next.js 16.3 + React 19 | TypeScript | Google Sheets backend | OAuth2 Google Sign-in

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Home Page — Mark Attendance](#home-page--mark-attendance)
4. [Home Page — Attendance Summary](#home-page--attendance-summary)
5. [Admin — Manage Attendance](#admin--manage-attendance)
6. [Admin — Members / Employees](#admin--members--employees)
7. [API Routes](#api-routes)
8. [Google Sheets Integration](#google-sheets-integration)
9. [Storage Backend](#storage-backend)
10. [UI / Styling](#ui--styling)
11. [File Structure](#file-structure)

---

## Architecture Overview

```
┌─────────────┐     OAuth2      ┌──────────────┐
│  Google     │◄───────────────►│  Google      │
│  Account    │   Sign-in      │  Sheets      │
└─────────────┘                 └──────────────┘
        │                               │
        ▼                               ▼
┌──────────────┐              ┌──────────────────┐
│   Next.js    │              │   Service        │
│   App Router │              │   Account JSON   │
│              │              │   (file / env)   │
└──────────────┘              └──────────────────┘
        │
   ┌────┴────┬──────────────────┬──────────────┐
   ▼         ▼                  ▼              ▼
┌──────┐ ┌──────────┐  ┌────────────┐ ┌──────────┐
│login │ │ / (home) │  │ /admin     │ │ /manage- │
│page  │ │          │  │            │ │ attendance│
└──────┘ └────┬─────┘  └────────────┘ └──────────┘
              │
         ┌────┴─────┐
         ▼          ▼
   ┌─────────┐ ┌──────────┐
   │Attendance│ │HomeSummary│
   │  Form   │ │   Table  │
   └─────────┘ └──────────┘
```

**Flow:**
1. User signs in with Google OAuth → JWT session cookie set
2. Redirect to home page → attendance form + summary table
3. Admin users also get access to `/manage-attendance` (sheet editor) and `/manage-attendance/members` (employee CRUD)
4. All data persists in Google Sheets; falls back to in-memory if no credentials

---

## Authentication

### Google OAuth2 Sign-in

**Files:** `lib/oauth.ts`, `lib/auth.ts`, `app/api/auth/google/route.js`, `app/api/auth/callback/route.js`, `app/api/auth/logout/route.js`

**How it works:**
1. `GET /api/auth/google` — checks if OAuth is configured (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`), generates a cryptographically random `state` token stored in a cookie, redirects to Google's OAuth2 consent screen
2. Google redirects back to `GET /api/auth/callback?code=...&state=...` — validates state, exchanges code for tokens, calls `exchangeCodeForUser()` to extract email/name/picture from the ID token
3. `isAllowedEmail(email)` checks if the email is in the allowlist (`ALLOWED_EMAILS` env or `lib/employees.ts` or sheet)
4. `createSessionToken(user)` creates a JWT (`HS256`) signed with `SESSION_SECRET`, valid for 7 days
5. Session cookie (`session`) is set with `httpOnly`, `sameSite: lax`, `secure` in production
6. `GET /api/auth/logout` (POST) — deletes the session cookie and redirects to `/login`

**Email allowlist resolution (priority order):**
1. Environment variable (`ALLOWED_EMAILS` comma-separated)
2. Google Sheet `Employees` tab (if credentials available)
3. `lib/employees.ts` fallback list (`ALLOWED_EMAILS` + `ADMIN_EMAILS`)

**Admin check (`isAdminEmail`):**
1. `ADMIN_EMAILS` env var
2. Sheet employees with `role === 'admin'`
3. `ADMIN_EMAILS` in `lib/employees.ts`

**Files:**
- `lib/oauth.ts` — `isOAuthConfigured()`, `isAllowedEmail()`, `isAdminEmail()`, `buildAuthUrl()`, `exchangeCodeForUser()`
- `lib/auth.ts` — `createSessionToken()`, `verifySessionToken()`, `getSessionUser()`, JWT utilities

---

## Home Page — Mark Attendance

**File:** `app/attendance-form.tsx` (client component)

**Features:**
- Shows the logged-in employee's name and email
- Radio buttons for **Office** / **Home** status
- On mount, calls `GET /api/attendance/status?email=...` to check if already attended today
- If already attended → shows "already attended" message (read-only, radio buttons disabled)
- On submit → `POST /api/attendance` with `{ employeeName, employeeEmail, status }`
- Server returns **409 Conflict** if duplicate attendance already exists for today
- Status messages: success (green), already-attended (amber), error (red)
- Submit button disabled if no employee data or while submitting

**Key logic:**
```
Component mounts → fetch status → set check state
  ├── already attended → disable radios, show message
  ├── not attended → show "ready" message, allow submit
  └── error → show error message
Submit → POST /api/attendance → success/duplicate/error feedback
```

---

## Home Page — Attendance Summary

**File:** `app/page.tsx` (server component), `app/components/HomeSummaryTable.tsx` (client component)

**How it works:**
1. `HomePage` (server) calls `getSessionUser()` — redirects to `/login` if not authenticated
2. If Google Sheets configured, fetches the current month's attendance grid via `getAdminGrid('')` and the employee directory via `getEmployees()`
3. Builds a per-employee summary: **present count**, **absent count** (from `Absent Days` row), **total**
4. **Non-admin users** only see their own row (matched by email or name)
5. **Admin users** see all employees
6. If the employee has no column in the sheet yet (never signed in), shows "no column found — mark attendance below to create it"
7. If sheets not configured, shows "sheets not configured" message

**HomeSummaryTable component:**
- Paginated table (10 rows per page) with Prev/Next buttons and page dots
- Highlights the current user's row with a blue background + "You" badge
- Color coding: Present (green), Absent (red), Total (bold)
- Shows "(no column found)" for employees without a sheet column

---

## Admin — Manage Attendance

**Files:** `app/manage-attendance/page.js`, `app/manage-attendance/admin-client.tsx`

**Access:** Admin only (`user.isAdmin` required)

**Features:**
- **Sheet tab selector** — dropdown showing all month tabs (e.g., "August 2026"), refresh button
- **Attendance grid view** (when sheet is attendance-shaped):
  - Rows = days of month, Columns = employees
  - Each cell has a `<select>` dropdown: `—` (empty), `Office`, `Home`, `Absent`
  - Color-coded cells: Office (green border), Home (blue border), Absent (red background)
  - Unsaved edits highlighted with purple tint + dot indicator
  - **Absent Days row** — auto-computed count of "Absent" per employee
  - **Total row** — total days tracked
- **Raw sheet view** (when sheet is generic/empty):
  - 2D grid with `<input>` fields for every cell
  - Header row distinguished visually
- **Toolbar:**
  - Sheet selector dropdown + Refresh button
  - Unsaved changes badge (animated dot + count)
  - **Discard** button — reverts all local edits
  - **Save** button — batches all changes to `POST /api/admin/batch`
- **Edit flow:**
  - Changes are stored locally in component state (`pendingAttendance` or `pendingRaw`)
  - Changes are NOT sent to the server until **Save** is clicked
  - On Save, sends `{ tab, attendanceUpdates: [{employeeName, day, status}], rawUpdates: [{row, col, value}] }`
  - After save, re-fetches data and clears pending state

**Key design:** All edits are optimistic/local until explicitly saved. The "Absent Days" summary is recomputed server-side on save.

---

## Admin — Members / Employees

**Files:** `app/manage-attendance/members/page.js`, `app/manage-attendance/members/members-client.tsx`

**Access:** Admin only

**Features:**
- **Member list table** showing: #, Full Name, Gmail, Phone, Role
- **Add Member** button → form with fields: Full Name, Gmail (required), Phone, Role (employee/admin)
- **Edit Member** → pre-fills form, email becomes read-only (can't change)
- **Delete Member** → confirmation dialog, then `DELETE /api/admin/members?index=...`
- Data stored in the **Employees** sheet (column: Full Name, Gmail, Phone, Role)
- Auto-seeded from `lib/employees.ts` on first access
- 60-second cache on employee data (invalidated on add/edit/delete)
- Tip: employees can also be edited directly in Google Sheets

---

## API Routes

### Auth APIs

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/google` | GET | Initiate OAuth2 flow, redirect to Google |
| `/api/auth/callback` | GET | Handle OAuth callback, create session, redirect to home |
| `/api/auth/logout` | POST | Destroy session cookie, redirect to login |

### Attendance APIs

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/attendance` | POST | Mark attendance for today. Returns 409 if duplicate |
| `/api/attendance/status` | GET | Check if employee already attended today |

**POST `/api/attendance` body:**
```json
{ "employeeName": "Nepolion Chakma", "employeeEmail": "nepolion@gmail.com", "status": "Office" }
```

**GET `/api/attendance/status` query:** `?email=...` or `?employee=...`

### Admin APIs

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/data` | GET | Fetch sheet data (tabs + grid). Returns `kind: 'attendance'` or `kind: 'raw'` |
| `/api/admin/batch` | POST | Batch update: `attendanceUpdates` or `rawUpdates` |
| `/api/admin/members` | GET | List all employees |
| `/api/admin/members` | POST | Add a new employee |
| `/api/admin/members` | PUT | Update an employee by index |
| `/api/admin/members` | DELETE | Delete an employee by index |
| `/api/admin/update` | POST | Single cell update (raw coords or attendance) |

---

## Google Sheets Integration

**File:** `lib/googleSheets.ts` (948 lines — the core data layer)

### Spreadsheet Structure

```
Spreadsheet (SPREADSHEET_ID)
├── Employees          ← employee directory (Full Name, Gmail, Phone, Role)
├── August 2026        ← monthly attendance tab (auto-created)
│   ├── Row 0 (header): Date | Day | Emp1<email> | Emp2<email> | ...
│   ├── Row 1:         1  | Mon | Office    | Home      | ...
│   ├── Row 2:         2  | Tue | Office    | Office    | ...
│   ├── ...
│   ├── Absent Days    |   | 2         | 1         | ...
│   └── Total          |   | 20        | 18        | ...
└── September 2026     ← next month tab
```

### Key Functions

| Function | Description |
|----------|-------------|
| `getAdminGrid(tab)` | Returns full structured grid: `{ tab, headers, employees, days, absentDays, total }` |
| `getEmployees()` | Reads the Employees sheet (cached 60s), falls back to `lib/employees.ts` |
| `addEmployee({name, email, phone, role})` | Appends a row to Employees sheet |
| `updateEmployee(rowIndex, {name, email, phone, role})` | Updates a specific row |
| `deleteEmployee(rowIndex)` | Deletes a row via batchUpdate |
| `ensureEmployeeColumn(tab, name, email)` | Adds a column for an employee on first login. Claims legacy name-only columns |
| `ensureMonthTab(sheets)` | Ensures the current month's tab exists (creates if missing) |
| `markAttendance(name, email, day, status)` | Writes Office/Home/Absent into today's cell |
| `getAttendance(name, email, day)` | Reads today's status |
| `batchUpdateAttendanceCells(tab, updates)` | Batch writes multiple attendance cells + recomputes Absent Days |
| `updateAbsentSummary(sheets, tab, rows)` | Recomputes the Absent Days count per employee |
| `markAbsentForPastDays(sheets, tab, rows)` | Auto-fills unmarked past days with "Absent" |
| `getRawSheet(tab)` | Returns raw 2D values for any sheet |
| `updateRawCell(tab, row, col, value)` | Updates a single cell |
| `batchUpdateRawCells(tab, cells)` | Batch updates multiple cells |

### Employee Column Format
Employee headers are stored as `Name <email>` (e.g., `Nepolion Chakma <nepolion@gmail.com>`) so that employees with the same name are distinguished by Gmail.

### Timezone
All dates use **Asia/Dhaka** (`TZ = 'Asia/Dhaka'`).

---

## Storage Backend

**Files:** `lib/storage.ts`, `lib/memoryStore.ts`

**Dual-backend architecture:**
- **Google Sheets mode** (default when `service-account.json` or credentials env is present): All attendance data persists in Google Sheets
- **In-memory mode** (fallback when no credentials): Uses `lib/memoryStore.ts` — a `Map<string, string>` keyed by `${email}::${day}` → status. **Resets on server restart.**

The switch happens at module load time: `const useGoogle = hasGoogleCredentials()`

This allows development without Google Cloud setup — just edit `lib/employees.ts` with allowed emails and mark attendance in memory.

---

## UI / Styling

**File:** `app/globals.css` (806 lines)

### Design System
- **CSS custom properties** with light/dark mode (`prefers-color-scheme: dark`)
- Color tokens: `--text`, `--text-h`, `--bg`, `--border`, `--accent` (purple `#aa3bff`), `--code-bg`, `--social-bg`
- Font: `Geist` (sans) + `Geist Mono` (mono) from `next/font/google`
- Base font: `system-ui, 'Segoe UI', Roboto, sans-serif` at 18px

### Key Components Styled
- **Navbar** — sticky top, blur backdrop, brand icon, active link highlighting, admin badge, logout button
- **Cards** — bordered, rounded, padded, with `var(--social-bg)` background
- **Buttons** — `.btn` base, `.btn.primary` (accent filled), `.btn-icon` (inline flex), hover effects with accent border/shadow
- **Attendance form** — radio group, fieldset/legend, status messages (already/success/error/ready colors)
- **Admin tables** — sticky headers, sticky first column, scrollable wrapper, dirty cell highlighting
- **Home summary table** — paginated, color-coded present/absent, "You" badge, own-row highlight
- **Pagination** — page dots with active state, Prev/Next buttons, info text

### Responsive
- `max-width` constraints: 900px (page), 1300px (admin), 460px (login), 360px (form)
- `overflow-x: auto` on table wrappers for horizontal scroll on small screens
- `flex-wrap: wrap` on toolbars and navbar

---

## File Structure

```
attendance-app/
├── app/
│   ├── layout.tsx                  # Root layout (Geist fonts, metadata)
│   ├── page.tsx                    # Home page (attendance form + summary)
│   ├── globals.css                 # All styles (light/dark mode)
│   ├── attendance-form.tsx         # Mark attendance form (client component)
│   ├── login/
│   │   └── page.tsx                # Google sign-in page
│   ├── admin/
│   │   └── page.js                 # Redirect to /manage-attendance
│   │   └── members/
│   │       └── page.js             # Redirect to /manage-attendance/members
│   ├── manage-attendance/
│   │   ├── page.js                 # Admin wrapper (auth + Navbar)
│   │   ├── admin-client.tsx        # Sheet editor (client component, 383 lines)
│   │   └── members/
│   │       ├── page.js             # Members wrapper
│   │       └── members-client.tsx  # Employee CRUD (client component, 254 lines)
│   ├── components/
│   │   ├── Navbar.tsx              # Navigation bar (83 lines)
│   │   └── HomeSummaryTable.tsx    # Paginated summary table (93 lines)
│   └── api/
│       ├── auth/
│       │   ├── google/route.js     # OAuth initiation
│       │   ├── callback/route.js   # OAuth callback handler
│       │   └── logout/route.js     # Logout handler
│       ├── attendance/
│       │   ├── route.js            # POST mark / GET status
│       │   └── status/route.js     # Check attendance status
│       └── admin/
│           ├── data/route.js       # Fetch sheet data
│           ├── batch/route.js      # Batch update
│           ├── members/route.js    # Employee CRUD (GET/POST/PUT/DELETE)
│           └── update/route.js     # Single cell update
├── lib/
│   ├── auth.ts                     # JWT session management (64 lines)
│   ├── oauth.ts                    # OAuth2, email allowlists (108 lines)
│   ├── googleSheets.ts             # Google Sheets integration (948 lines)
│   ├── employees.ts                # ALLOWED_EMAILS + ADMIN_EMAILS (28 lines)
│   ├── memoryStore.ts              # In-memory fallback (44 lines)
│   └── storage.ts                  # Storage backend abstraction (52 lines)
├── proxy.js                        # Route middleware (redirects, auth guards)
├── service-account.json            # Google service account (gitignored)
├── .env.example                    # Environment variable template
├── package.json                    # Dependencies (Next 16.3, React 19)
├── next.config.mjs                 # Next.js config (default)
├── tsconfig.json                   # TypeScript config
├── README.md                       # Setup documentation
└── V01_FEATURES.md                 # This file
```

---

## Code Review — Key Observations

### ✅ Strengths
1. **Clean separation of concerns** — auth, sheets, storage, and UI layers are well-isolated
2. **Dual-backend flexibility** — works with Google Sheets or in-memory, great for development
3. **Optimistic local editing** — admin sheet edits are local until saved, with discard support
4. **Gmail-based identity** — uses `Name <email>` header format to handle name collisions
5. **Auto-absent backfill** — past unmarked days automatically filled with "Absent"
6. **Dark mode** — full `prefers-color-scheme: dark` support via CSS custom properties
7. **Pagination** — summary table paginated at 10 rows/page
8. **Admin member management** — full CRUD on the Employees sheet

### ⚠️ Issues & Suggestions

1. **`// @ts-nocheck` everywhere** — most files start with this directive, disabling TypeScript checks entirely. Consider removing these and fixing type errors properly.

2. **`proxy.js` vs App Router middleware** — the project uses a custom `proxy.js` file for route guarding, but Next.js App Router has a built-in `middleware` mechanism. The proxy approach works but is non-standard and may not cover all edge cases (e.g., server-side `redirect()` calls bypass it).

3. **Hardcoded employee list** — `lib/employees.ts` has a fixed list of emails. While env vars can override, the hardcoded list is a maintenance burden and sensitive data in source code. Consider removing the hardcoded list and relying solely on the Employees sheet or env vars.

4. **In-memory storage is volatile** — if `service-account.json` is missing, all attendance data is lost on restart. There's no warning escalation or data recovery mechanism.

5. **`any` types and implicit `any`** — several functions use untyped parameters (e.g., `admin-client.tsx` `handleAttendanceEdit`, `members-client.tsx` `startEdit`). TypeScript strictness would catch many bugs.

6. **Race conditions in attendance marking** — `POST /api/attendance` checks for duplicates then marks, but between the check and the write, another request could slip in. A database-level unique constraint would be safer (though not possible with Google Sheets).

7. **`sessionCookieOptions` maxAge type** — the `maxAge` parameter is typed as `number` but `cookies().set()` in Next.js expects a specific cookie maxAge format. The `60 * 10` (10 min) for OAuth state is hardcoded in `google/route.js`.

8. **No input validation on member edit** — `members-client.tsx` allows editing an email to an invalid format after the initial validation (only checked on save, not on field change).

9. **`lib/googleSheets.ts` is a monolith** — 948 lines in a single file. Consider splitting into: `sheets-client.ts` (auth + client), `sheets-read.ts` (read operations), `sheets-write.ts` (write operations), `sheets-employees.ts` (employee management).

10. **`admin-client.tsx` uses `eval`-like patterns** — the `grid.kind === 'attendance'` / `'raw'` discriminator is fragile. A proper type system with discriminated unions would be safer.

11. **`useEffect` with `void`** — the `// eslint-disable-next-line react-hooks/set-state-in-effect` comment is used in multiple places. This pattern works but is fragile; a proper async hook wrapper would be more robust.

12. **No error boundary** — if any component throws, the entire page crashes with a white screen. An error boundary component would improve UX.

13. **`nowParts()` uses `new Date()`** — this uses the server's local time, not necessarily Asia/Dhaka, for the `Date` object construction. The `Intl.DateTimeFormat` with `timeZone` correctly formats, but `new Date()` for the month/day calculation in `createTab` uses local time.

14. **Missing `key` prop warnings** — `members-client.tsx` uses `m.email + idx` as key which is fragile (emails can change). Using a stable ID from the sheet would be better.

### 🔧 Quick Wins
- Remove `// @ts-nocheck` and fix types properly
- Replace `proxy.js` with Next.js App Router middleware
- Extract `lib/googleSheets.ts` into smaller focused modules
- Remove hardcoded employee emails from `lib/employees.ts`
- Add an error boundary component
- Add unit tests for `googleSheets.ts` utility functions (`parseHeaderEmail`, `columnLetter`, `monthLabel`)