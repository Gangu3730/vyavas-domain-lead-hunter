# VYAVAS MySQL server

Production backend for the complete workflow:

`Login → Import/filter → Leads → Prospects → Email campaigns`

## Setup

1. Create a MySQL 8 database and run `sql/001_initial.sql`.
2. Copy `.env.example` to `.env` and set database, JWT and SMTP secrets.
3. Run `npm install`, `npm run build`, then `npm run bootstrap-admin` once.
4. Start the API with `npm start` and the independent email queue with `npm run worker`.

Use a process manager such as systemd or PM2 for both processes. Put HTTPS in front of the API. Never commit `.env` or SMTP passwords.

Hostinger uses `smtp.hostinger.com:465` with the mailbox password. Gmail uses `smtp.gmail.com:465` with a Google App Password.
