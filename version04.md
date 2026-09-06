# Attendance App (v4)

Employees sign in with their Google account, then mark today's attendance
(Office / Home). Records live in a Google Sheets spreadsheet. Admins manage
attendance and members from a built-in dashboard.

```
User → Google sign-in → Attendance form → Google Sheets
```

## Quick start

```bash
yarn install            # or npm install
cp .env.example .env    # then fill it in (see below)
yarn dev
```

Open http://localhost:3000 and sign in with an email listed in the **Members**
tab of your spreadsheet.

> 📖 **This is Version 4** — setup guide, sheet structure, deployment,
> testing, troubleshooting below.

## Features

- **Google OAuth login** — only emails in the Members tab can sign in
- **One submit per day** — form locks after submitting; duplicates rejected server-side (409)
- **Monthly summary** — present/absent counts on the home page
- **All-members pre-fill** — new month tabs come pre-created for every member, with past days auto-marked
- **Custom auto-absent time** — `AUTO_ABSENT_TIME` env var (default `12:00 AM`)
- **Admin dashboard** — `/manage-attendance` (sticky spreadsheet-style grid) and `/manage-members`
- **Sheet maintenance API** — refresh / add-column / rebuild tabs from the admin side
- **Auto-absent job** — hourly (top of the hour) + on every page load
- **Sticky Date + Day columns** — in manage-attendance, both Date and Day columns stay pinned while scrolling horizontally (Version 4 addition)

## The spreadsheet

| Tab | Purpose |
|---|---|
| `Members` | Directory: Full Name, Gmail, Phone, Role (`Admin`/`Employee`), Address |
| `September 2026` (auto) | One **Presence + Time** column pair per member, one row per day, COUNTIF `Absent Days` row |

- Presence holds the pure status (`Office` / `Home` / `Absent` / `Holiday`); Time holds e.g. `9:00 AM`
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

## Architecture

```
app/
├── page.tsx                  # Home page (attendance form + summary)
├── attendance-form.tsx       # Attendance form component
├── manage-attendance/
│   ├── page.tsx              # Admin attendance page (server)
│   └── admin-client.tsx      # Admin client-side table component
├── manage-members/           # Admin members management
├── api/
│   ├── auth/callback/        # Google OAuth callback
│   ├── admin/data/           # Fetch sheet data for admin panel
│   └── admin/batch/          # Save attendance changes
└── layout.tsx                # Root layout with Navbar
```

### Key libraries

- **Next.js 16.3.1** — App Router, server components
- **React 19.2.8** — UI framework
- **TypeScript ^6.0.3** — Type safety
- **googleapis ^175.0.0** — Google Sheets & OAuth
- **jose ^6.2.9** — JWT signing/verification for sessions
- **ldrs ^1.1.9** — Loading animations

### Data flow

1. User signs in via Google OAuth → JWT session created
2. Attendance form reads today's date, checks if already submitted
3. On submit: status (Office/Home) + timestamp written to Google Sheets
4. Auto-absent job: runs hourly + on page load, marks absent users as `Absent`
5. Admin panel fetches sheet data, displays sticky grid, allows inline edits
6. Admin saves: batch updates sent to Google Sheets

## Admin panel — manage-attendance

The admin attendance table has:

- **Sticky Date column** (`left: 0`) — stays visible when scrolling horizontally
- **Sticky Day column** (`left: var(--admin-date-w)`) — also stays pinned (Version 4)
- **Two-row header**: Employee names (row 1) + Presence/Time sub-headers (row 2)
- **Inline editing**: select dropdowns for status, text inputs for time
- **Pending changes**: local state until Save is pressed
- **Friday highlighting**: rows with Friday get a subtle orange tint
- **Dirty cell indicator**: purple dot on unsaved edits

The table uses CSS custom properties for sticky positioning:

```css
--admin-date-w: 56px;   /* Date column width */
--admin-head1-h: 36px;  /* First header row height */
```

## Testing

### verify:absent script

```bash
yarn verify:absent
```

This runs an end-to-end test:
1. Creates a scratch tab in the spreadsheet
2. Simulates auto-absent logic
3. Submits attendance
4. Verifies the data is written correctly
5. Cleans up the scratch tab

Live data is never touched.

### Manual testing checklist

- [ ] Sign in with a member email
- [ ] Submit attendance (Office/Home)
- [ ] Try duplicate submission → should get 409
- [ ] Admin: open manage-attendance, scroll horizontally → Date & Day columns stay sticky
- [ ] Admin: edit a cell, verify dirty indicator appears
- [ ] Admin: save changes, verify they persist in Google Sheets
- [ ] Auto-absent: wait for hourly job or trigger manually → absent users marked

## Deployment

### Vercel (recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment variables for production

All the same as development, plus:

- Set `AUTO_ABSENT_TIME` and `NEXT_PUBLIC_AUTO_ABSENT_TIME` to matching values
- Ensure service account has Editor access to the production spreadsheet

## Troubleshooting

| Problem | Solution |
|---|---|
| "The caller does not have permission" | Share spreadsheet with service account as Editor |
| Login fails | Check `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and allowed domains |
| Attendance not saving | Verify `SPREADSHEET_ID` and service account JSON |
| Sticky columns not working | Ensure `--admin-date-w` and `--admin-head1-h` are defined in CSS |
| Auto-absent not triggering | Check `AUTO_ABSENT_TIME` env var and service account permissions |

## Changelog — Version 4

- **Sticky Day column**: Date and Day columns both sticky in admin attendance table
- **CSS custom properties**: `--admin-date-w` and `--admin-head1-h` now active (were commented out in v3)
- **Improved admin table UX**: Friday highlighting, dirty cell indicators, pending changes badge

## License

MIT
