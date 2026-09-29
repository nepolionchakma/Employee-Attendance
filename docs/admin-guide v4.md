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
- Admins see every member's present/absent counts for the month, except other admin accounts (admins don't mark attendance). Regular users see only their own record.

## Spreadsheets (Admin / Employee / Bootcamp)

- The **Members** directory lives in the **Admin** spreadsheet (`Members` tab, Role = `Admin` / `Employee` / `Bootcamp`).
- Attendance is routed by Role: Admins -> admin sheet, Employees -> employee sheet, Bootcamp -> bootcamp sheet.
- If the employee/bootcamp sheet ID is not set, that group falls back to the admin sheet (old single-sheet behavior).
- Share **all three** spreadsheets with the service account email as **Editor**.
- Admins **cannot mark their own attendance**: the form is hidden from their home page and the API rejects admin submits. Set `ADMIN_CAN_SUBMIT_ATTENDANCE=yes` in the environment to bring it back.

## Admin Tasks

### 1. Configure the attendance sheet

The app reads from a Google Sheet. Administrative setup usually includes:

- Ensuring the sheet has a header row with emails or names.
- Making sure each column represents a person.
- Verifying that the sheet includes “On-site” and “Remote” attendance markers (or similar values the app recognizes).

If the sheet isn’t set up yet, the dashboard will show a message like “Attendance summary not available (sheets not configured).”

### 2. View overall attendance

Use the **Spreadsheet** switcher on the Manage Attendance page to view the Employee / Bootcamp sheets. It opens on **Employee**, and the admin sheet is not listed (admins don't mark attendance).

The homepage gives admins a read-only summary of every member (admin accounts excluded); this page is where you open the sheets and correct entries.

- Pick a **Spreadsheet** and **Sheet (tab)** to load that group's month.
- The table shows presence and location per day, with **Absent Days** at the bottom.
- If a person has no attendance column yet, they may not appear.

### 3. Mark or check attendance

- The attendance form on the homepage lets members record their own attendance.
- Admin accounts get **no form** — review or correct entries in the sheet instead (step 2).
- Someone without a column yet gets one the first time they mark attendance from their own account.

### 4. Manage employees/students list

If your app has a **Manage Members** section (if available):

- Review the member list.
- Add or remove members as needed.
- Ensure each member has a valid email and name.

### 5. Troubleshooting

Common issues:

- **No attendance data:** check the sheet configuration and that the sheet has the expected headers.
- **Missing column for a user:** columns are created automatically the next time the page is refreshed; if one is still missing, check that the member has an email in the `Members` tab.
- **Admin options not showing:** your Google account may not have admin rights. Contact the system owner to grant access.

## Support

If you need help with sheet setup or admin permissions, contact the person who provisioned the app. You may also check logs in the browser console if something fails during summary loading.

## Notes

- Attendance values like “On-site”, “Remote”, “On-site - ...”, and “Remote - ...” are treated as present.
- Absent days are tracked separately in the sheet.
- The month label comes from the sheet’s tab name.
