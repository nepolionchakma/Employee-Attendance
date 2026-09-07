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

## Admin Tasks

### 1. Configure the attendance sheet

The app reads from a Google Sheet. Administrative setup usually includes:

- Ensuring the sheet has a header row with emails or names.
- Making sure each column represents a person.
- Verifying that the sheet includes “Office” and “Home” attendance markers (or similar values the app recognizes).

If the sheet isn’t set up yet, the dashboard will show a message like “Attendance summary not available (sheets not configured).”

### 2. View overall attendance

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

- Attendance values like “Office”, “Home”, “Office - ...”, and “Home - ...” are treated as present.
- Absent days are tracked separately in the sheet.
- The month label comes from the sheet’s tab name.
