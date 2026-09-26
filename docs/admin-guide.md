# Datafluent BD — Admin Guide

## Overview

Datafluent BD helps track daily attendance for students, teachers, and staff. Admins can view summaries, manage the attendance sheets, and configure the system.

## Prerequisites

- A Google account connected to the app.
- Admin access granted (usually by the system owner).
- A Google Sheet that holds the attendance data. The sheet is used by the app to read employee/student records and store attendance.

## Logging In

1. Open the app homepage.
2. Click **Login** and sign in with your Google account.
3. If your account has admin rights, you will see the admin options.

## Dashboard

After login, you will see:

- **Attendance summary** for the current month.
- A table with each person’s name/email, present days, absent days, and total.
- Admins can see all employees/students. Regular users see only their own record.

## Spreadsheets (Admin / Employee / Bootcamp)

- The **Members** directory lives in the **Admin** spreadsheet (`Members` tab, Role = `Admin` / `Employee` / `Bootcamp`).
- Attendance is routed by Role: Admins -> admin sheet, Employees -> employee sheet, Bootcamp -> bootcamp sheet.
- If the employee/bootcamp sheet ID is not set, that group falls back to the admin sheet (old single-sheet behavior).
- Share **all three** spreadsheets with the service account email as **Editor**.
- `ADMIN_CAN_SUBMIT_ATTENDANCE=no` blocks admins from submitting (manage-only). Default `yes` (useful for testing).

### Holiday List (admin spreadsheet)

The admin spreadsheet has a **Holiday List** tab (rename with `HOLIDAYS_SHEET_TAB` if needed):

| Date | Day | Holiday Name |
| --- | --- | --- |
| 09-20-2026 | Sunday | ABC |
| 09-21-2026 | Monday | DD |

- Column A = date (a real date cell, or a typed date), column B = holiday name, column C = weekday.
- Column C is display-only: the app derives the weekday from the date in column A, so a wrong or blank `Day` never changes which days are treated as holidays. `scripts/verify-holidays.mjs` flags any row whose `Day` disagrees with its date.
- Every listed date is written as **Holiday** in the matching month tab, for the whole month at once — including today and future dates. A listed holiday replaces whatever was recorded for that date.
- On a holiday **nobody can submit attendance** (members and admins), and the homepage button shows `Holiday — submission disabled`. The API rejects the submit with `403` if a page was already open.
- Holiday rows — and every Friday — are shaded automatically in the sheet with Google Sheets palette **light yellow 3** (`#FFF2CC`), so they stand out from normal days.
- The holiday tab is hidden from the Manage Attendance tab picker so it is never mistaken for a month.
- Verify the parsing at any time with: `node --env-file=.env scripts/verify-holidays.mjs` (read-only).

## Admin Tasks

### 1. Configure the attendance sheet

The app reads from a Google Sheet. Administrative setup usually includes:

- Ensuring the sheet has a header row with emails or names.
- Making sure each column represents a person.
- Verifying that the sheet includes “On-site” and “Remote” attendance markers (or similar values the app recognizes).

If the sheet isn’t set up yet, the dashboard will show a message like “Attendance summary not available (sheets not configured).”

### 2. View overall attendance

Use the **Spreadsheet** switcher on the Manage Attendance page to view Admin / Employee / Bootcamp sheets.

Each sheet strictly holds only its own group: Bootcamp sheet = Bootcamp members only, Employee sheet = Employees only, Admin sheet = Admins only. Wrong-group writes are rejected automatically.

If an old tab still has mixed columns (from before the split), open that Spreadsheet + tab and press **Prune**: other groups' columns are deleted and missing members of this group are added.

Admins can see the full list of employees/students and their attendance for the month.

- Look for the **Attendance** card on the homepage.
- The table shows present, absent, and total days.
- If a person has no attendance column yet, they may not appear.

### 3. Mark or check attendance

- The attendance form on the page lets users record their own attendance.
- Admins can monitor the sheet directly to review or correct entries.
- To create a column for someone who doesn’t have one yet, mark attendance using the form with that person’s email.

### 4. Manage employees/students list

If your app has a **Manage Members** section (if available):

- Review the member list.
- Add or remove members as needed.
- Ensure each member has a valid email and name.

### 5. Troubleshooting

Common issues:

- **No attendance data:** check the sheet configuration and that the sheet has the expected headers.
- **Missing column for a user:** mark attendance for that user via the form to create a column.
- **Admin options not showing:** your Google account may not have admin rights. Contact the system owner to grant access.

## Support

If you need help with sheet setup or admin permissions, contact the person who provisioned the app. You may also check logs in the browser console if something fails during summary loading.

## Notes

- Attendance values like “On-site”, “Remote”, “On-site - ...”, and “Remote - ...” are treated as present.
- Absent days are tracked separately in the sheet.
- The month label comes from the sheet’s tab name.
