# VYAVAS MySQL server

Production backend for the complete workflow:

`Login → Import/filter → Leads → Prospects → Email campaigns`

## Setup

1. Create a MySQL 8 database and run `sql/001_initial.sql`.
2. Copy `.env.example` to `.env` and set database, JWT and SMTP secrets.
3. Run `npm install`, `npm run build`, then `npm run bootstrap-admin` once.
4. Start the API with `npm start` and the independent email queue with `npm run worker`.

Run `npm run scan-worker` as a third process for parallel website qualification.

Use a process manager such as systemd or PM2 for both processes. Put HTTPS in front of the API. Never commit `.env` or SMTP passwords.

Hostinger uses `smtp.hostinger.com:465` with the mailbox password. Gmail uses `smtp.gmail.com:465` with a Google App Password.

## Production on a Hostinger VPS

1. Install Docker and Docker Compose, copy `.env.example` to `.env`, and replace every placeholder secret.
2. Set `APP_ORIGIN` to the final HTTPS origin and keep MySQL port private.
3. Run `docker compose -f docker-compose.production.yml up -d --build`.
4. Point the domain's HTTPS reverse proxy to `127.0.0.1:4000`.
5. Run `docker compose -f docker-compose.production.yml exec api node dist/bootstrap-admin.js` once.

Use `npm run backfill-postal -- path/to/file.xlsx IMPORT_JOB_ID` only when an older imported dataset needs its postal codes restored.

Back up the `vyavas_mysql` volume daily. Test restoring that backup before importing production lead files. Never expose port 3306 publicly.
