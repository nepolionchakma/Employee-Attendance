# Attendance App (v6)

Employees sign in with their Google account, then mark today's attendance
(On-site / Remote). Records live in Google Sheets spreadsheets, routed by member
Role: Admins -> admin sheet, Employees -> employee sheet, Bootcamp -> bootcamp
sheet. Admins manage all three spreadsheets from the built-in dashboard.

```
User → Google sign-in → Attendance form → Google Sheets
```

> 📖 **This is Version 6** — same setup as v4, plus the Sheets quota fix for
> attendance history below.

## Quick start

```bash
yarn install            # or npm install
cp .env.example .env    # then fill it in (see below)
yarn dev
```

Open http://localhost:3000 and sign in with an email listed in the **Members**
tab of your spreadsheet.

## Sheets quota fix (v6)

### Symptom

```
Could not load attendance history. Quota exceeded for quota metric
'Read requests' and limit 'Read requests per minute per user'
of service 'sheets.googleapis.com' for consumer 'project_number:...'.
```

### Why it happened so fast

* The `60 reads/minute` limit is **shared per service-account project**, not per
  app user. All users and all API routes share it.
* One history view cost **~5-6 reads, not 1**:
  `getEmployees` (`spreadsheets.get` + `values.get` x2), `getHolidays`
  (`spreadsheets.get` + `values.get`), `listMonthTabs` (`spreadsheets.get`),
  `getAdminGrid` (`spreadsheets.get` + full-tab `values.get`).
* Clicking Prev/Next ~10 times fast = ~60 reads = quota exceeded.
* Every history read also ran `markAbsentForPastDays + updateAbsentSummary +
  formatting` — writes on a read-only view, costing write quota too.

### What changed

| File | Change |
|---|---|
| `lib/googleSheets.ts` | `loadGrid` / `getAdminGrid` accept `{ readonly: true }` — history does a pure `values.get` with no absent-fill, summary writes, or formatting. Members + holidays cache `60s -> 5min`. |
| `app/api/attendance/history/route.ts` | Removed duplicate `listMonthTabs` read, members + holidays load in parallel, 90s server cache + in-flight dedupe per `email-year-month`, quota errors return `429 + Retry-After: 60` with a wait-a-minute message. |
| `app/components/AttendanceHistory.tsx` | 300ms debounce on month navigation — rapid clicks fetch only the settled month. |

### Behavior now

* First open hits Sheets; repeat open within 90s serves cache.
* Rapid month switching no longer burns the quota.
* Viewing history no longer spends write quota.
* On 429: wait ~1 minute, avoid rapid month clicks and many open tabs.

If many concurrent users still hit the limit, raise it in Google Cloud Console:
`APIs & Services > Quotas > sheets.googleapis.com > Read requests per minute per user`.

## Features

- **Google OAuth login** — only emails in the Members tab can sign in
- **One submit per day** — form locks after submitting; duplicates rejected server-side (409)
- **Monthly summary** — present/absent counts on the home page
- **Attendance history calendar** — per-user month view with 90s server cache and debounced navigation
- **All-members pre-fill** — new month tabs come pre-created for every member, with past days auto-marked
- **Custom auto-absent time** — `AUTO_ABSENT_TIME` env var (default `12:00 AM`)
- **Admin dashboard** — `/manage-attendance` (sticky spreadsheet-style grid) and `/manage-members`
- **Sheet maintenance API** — refresh / add-column / rebuild tabs from the admin side
- **Auto-absent job** — hourly (top of the hour) + on every page load
