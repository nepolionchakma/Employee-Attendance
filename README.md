# Attendance App (v3)

Employees sign in with their Google account, then mark today's attendance
(Office / Home) with real-time GPS location. Records live in a Google Sheets
spreadsheet. Admins manage attendance and members from a built-in dashboard.

```
User → Google sign-in → Location gate → Attendance form → Google Sheets
```

## Quick start

```bash
yarn install            # or npm install
cp .env.example .env    # then fill it in (see below)
yarn dev
```

Open http://localhost:3000 and sign in with an email listed in the **Members**
tab of your spreadsheet.

> 📖 **Full documentation: [`Version 3.md`](./Version%203.md)** — setup guide,
> sheet structure, deployment, testing, troubleshooting.

## Features

- **Google OAuth login** — only emails in the Members tab can sign in
- **Location-gated attendance** — browser GPS required, reverse-geocoded to an address
- **One submit per day** — form locks after submitting; duplicates rejected server-side (409)
- **Monthly summary** — present/absent counts on the home page
- **All-members pre-fill** — new month tabs come pre-created for every member, with past days auto-marked
- **Custom auto-absent time** — `AUTO_ABSENT_TIME` env var (default `12:00 AM`)
- **Admin dashboard** — `/manage-attendance` (sticky spreadsheet-style grid) and `/manage-members`
- **Sheet maintenance API** — refresh / add-column / rebuild tabs from the admin side
- **Auto-absent job** — hourly (top of the hour) + on every page load

## The spreadsheet

| Tab | Purpose |
|---|---|
| `Members` | Directory: Full Name, Gmail, Phone, Role (`Admin`/`Employee`), Address |
| `September 2026` (auto) | One **Presence + Location** column pair per member, one row per day, COUNTIF `Absent Days` row |

- Presence format: `Status - Time` (e.g. `Office - 9:00 AM`, `Absent - 12:00 AM`)
- Fridays auto-fill as `Holiday`
- Roles come from the Members tab (`Role` = `Admin` or `Employee`)

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client (login) |
| `SPREADSHEET_ID` | Yes | From the spreadsheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Service account JSON string (or base64 via `_BASE64`, or `service-account.json` in the project root) |
| `SESSION_SECRET` | Yes | Random string for JWT signing (`openssl rand -base64 32`) |
| `AUTO_ABSENT_TIME` | No | Time written into auto-absent cells (default `12:00 AM`) |
| `NEXT_PUBLIC_AUTO_ABSENT_TIME` | No | Same value for the admin panel auto-fill — keep in sync |
| `ATTENDANCE_SHEET_TAB` | No | Pin a fixed tab instead of the auto month tab |
| `EMPLOYEES_SHEET_TAB` | No | Members tab name (default `Members`) |
| `GOOGLE_ALLOWED_DOMAINS` | No | Restrict login to specific email domains |

## Scripts

| Command | Description |
|---|---|
| `yarn dev` | Dev server |
| `yarn build` / `yarn start` | Production build / serve |
| `yarn lint` | ESLint |
| `yarn verify:absent` | End-to-end test of auto-absent + submit (runs on a scratch tab, live data untouched) |

## Google Cloud setup (summary)

1. Enable **Google Sheets API**
2. Create an **OAuth client** (Web application) — redirect URI: `http://localhost:3000/api/auth/callback`
3. Create a **service account**, download the JSON key as `service-account.json`
4. **Share the spreadsheet with the service account as Editor** — without this, writes fail with "The caller does not have permission"

Detailed step-by-step instructions with screenshots-level detail are in
[`Version 3.md`](./Version%203.md).
