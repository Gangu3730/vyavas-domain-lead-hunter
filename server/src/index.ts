import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { audit, db } from './db.js';
import { allow, requireUser } from './auth.js';
import { importRoutes } from './imports.js';
const dashboardHtml = await readFile(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);
const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
await db.query(`CREATE TABLE IF NOT EXISTS processing_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  created_by BIGINT UNSIGNED NOT NULL,
  countries JSON NOT NULL,
  status ENUM('RUNNING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'RUNNING',
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  processed_rows INT UNSIGNED NOT NULL DEFAULT 0,
  qualified_rows INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_rows INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_processing_status(status)
)`);
await db.query(`CREATE TABLE IF NOT EXISTS exclusion_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pattern VARCHAR(255) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_exclusion_pattern(pattern)
)`);
await app.register(cookie);
await app.register(jwt, {
  secret: config.JWT_SECRET,
  cookie: { cookieName: 'vyavas_session', signed: false },
});
await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});
app.addHook('onSend', async (_req, reply) => {
  reply
    .header('Access-Control-Allow-Origin', config.APP_ORIGIN)
    .header('Access-Control-Allow-Credentials', 'true')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'no-store');
});
app.get('/', async (_req, reply) =>
  reply.type('text/html').send(dashboardHtml),
);
await importRoutes(app);
app.post('/api/auth/login', async (req, reply) => {
  const b = z
    .object({ email: z.string().email(), password: z.string().min(1) })
    .parse(req.body);
  const [rows] = await db.execute<any[]>(
    'SELECT id,email,password_hash,role,status FROM users WHERE email=? LIMIT 1',
    [b.email.toLowerCase()],
  );
  const u = rows[0];
  if (
    !u ||
    u.status !== 'ACTIVE' ||
    !(await bcrypt.compare(b.password, u.password_hash))
  )
    return reply.code(401).send({ error: 'Invalid credentials' });
  const token = await reply.jwtSign(
    { id: u.id, email: u.email, role: u.role },
    { expiresIn: '12h' },
  );
  reply.setCookie('vyavas_session', token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 43200,
  });
  await db.execute('UPDATE users SET last_login_at=NOW(3) WHERE id=?', [u.id]);
  await audit(u.id, 'LOGIN', 'USER', String(u.id), {}, req.ip);
  return { id: u.id, email: u.email, role: u.role };
});
app.post(
  '/api/auth/logout',
  { preHandler: requireUser },
  async (req, reply) => {
    reply.clearCookie('vyavas_session', { path: '/' });
    await audit(req.user.id, 'LOGOUT', 'USER', String(req.user.id), {}, req.ip);
    return { ok: true };
  },
);
app.get('/api/auth/me', { preHandler: requireUser }, async (req) => req.user);
app.get('/api/users', { preHandler: allow('SUPER_ADMIN') }, async () => {
  const [rows] = await db.query(
    'SELECT id,email,first_name,last_name,role,status,last_login_at,created_at FROM users ORDER BY created_at DESC',
  );
  return { items: rows };
});
app.post(
  '/api/users',
  { preHandler: allow('SUPER_ADMIN') },
  async (req, reply) => {
    const b = z
        .object({
          email: z.string().email(),
          password: z.string().min(12),
          firstName: z.string().max(100).optional(),
          lastName: z.string().max(100).optional(),
          role: z.enum(['ADMIN', 'USER']),
        })
        .parse(req.body),
      hash = await bcrypt.hash(b.password, 12);
    const [r] = await db.execute<any>(
      'INSERT INTO users(email,password_hash,first_name,last_name,role) VALUES(?,?,?,?,?)',
      [
        b.email.toLowerCase(),
        hash,
        b.firstName ?? null,
        b.lastName ?? null,
        b.role,
      ],
    );
    await audit(
      req.user.id,
      'CREATE_USER',
      'USER',
      String(r.insertId),
      { email: b.email, role: b.role },
      req.ip,
    );
    return reply.code(201).send({ id: r.insertId });
  },
);
app.patch(
  '/api/users/:id',
  { preHandler: allow('SUPER_ADMIN') },
  async (req) => {
    const id = z.coerce
        .number()
        .int()
        .positive()
        .parse((req.params as any).id),
      b = z
        .object({
          status: z.enum(['ACTIVE', 'DISABLED']).optional(),
          role: z.enum(['ADMIN', 'USER']).optional(),
        })
        .parse(req.body);
    if (id === req.user.id && b.status === 'DISABLED')
      throw new Error('Cannot disable your own account');
    await db.execute(
      'UPDATE users SET status=COALESCE(?,status),role=COALESCE(?,role) WHERE id=?',
      [b.status ?? null, b.role ?? null, id],
    );
    await audit(req.user.id, 'UPDATE_USER', 'USER', String(id), b, req.ip);
    return { ok: true };
  },
);
app.get(
  '/api/leads/summary',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') },
  async () => {
    const [rows] = await db.query<any[]>(`SELECT COUNT(*) total,
      SUM(status='QUALIFIED') qualified,
      SUM(status='REJECTED') rejected,
      SUM(status='PENDING') pending,
      SUM(website_status='LIVE') live_rejected,
      SUM(website_status IN ('PARKED','COMING_SOON','NO_WEBSITE') AND status='QUALIFIED') no_website,
      SUM(email IS NOT NULL AND email<>'') with_email,
      SUM(phone IS NOT NULL AND phone<>'') with_phone
      FROM leads WHERE status<>'DELETED'`);
    return rows[0]??{};
  },
);
app.get(
  '/api/leads',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') },
  async (req) => {
    const q = z
        .object({
          status: z.string().optional(),
          country: z.string().optional(),
          page: z.coerce.number().int().positive().default(1),
          limit: z.coerce.number().int().min(1).max(1000).default(50),
        })
        .parse(req.query),
      where: string[] = ["status<>'DELETED'"],
      args: any[] = [];
    if (q.status) {
      where.push('status=?');
      args.push(q.status);
    }
    if (q.country) {
      where.push('country=?');
      args.push(q.country);
    }
    const [rows] = await db.execute(
      `SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY lead_score DESC,id DESC LIMIT ? OFFSET ?`,
      [...args, q.limit, (q.page - 1) * q.limit],
    );
    return { items: rows, page: q.page };
  },
);
const countryCase = `CASE
  WHEN LOWER(TRIM(COALESCE(country,''))) IN ('us','usa','united states','united states of america') THEN 'USA'
  WHEN LOWER(TRIM(COALESCE(country,''))) IN ('ae','uae','united arab emirates') THEN 'UAE'
  WHEN LOWER(TRIM(COALESCE(country,''))) IN ('ca','can','canada') THEN 'Canada'
  WHEN LOWER(TRIM(COALESCE(country,''))) IN ('au','aus','australia') THEN 'Australia'
  WHEN LOWER(TRIM(COALESCE(country,''))) IN ('in','ind','india') THEN 'India'
  ELSE 'Other' END`;
app.get('/api/processing/status', { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') }, async () => {
  const [rows] = await db.query<any[]>('SELECT * FROM processing_batches ORDER BY id DESC LIMIT 1');
  return rows[0] ?? null;
});
app.post('/api/processing/start', { preHandler: allow('SUPER_ADMIN', 'ADMIN') }, async (req, reply) => {
  const b = z.object({ countries: z.array(z.enum(['USA','UAE','Canada','Australia','India','Other'])).min(1).max(6) }).parse(req.body);
  const [running] = await db.query<any[]>("SELECT id FROM processing_batches WHERE status='RUNNING' LIMIT 1");
  if (running[0]) return reply.code(409).send({ error: 'A processing batch is already running' });
  const marks = b.countries.map(() => '?').join(',');
  const [counts] = await db.execute<any[]>(`SELECT COUNT(*) total FROM leads WHERE status='PENDING' AND website_status='UNSCANNED' AND ${countryCase} IN (${marks})`, b.countries);
  const total = Number(counts[0]?.total ?? 0);
  const [result] = await db.execute<any>('INSERT INTO processing_batches(created_by,countries,status,total_rows) VALUES(?,?,?,?)', [req.user.id, JSON.stringify(b.countries), total ? 'RUNNING' : 'COMPLETED', total]);
  await audit(req.user.id, 'START_COUNTRY_PROCESSING', 'PROCESSING_BATCH', String(result.insertId), { countries: b.countries, total }, req.ip);
  return reply.code(201).send({ id: result.insertId, countries: b.countries, status: total ? 'RUNNING' : 'COMPLETED', total_rows: total, processed_rows: 0, qualified_rows: 0, rejected_rows: 0 });
});
app.get('/api/exclusions', { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') }, async () => {
  const [items] = await db.query('SELECT id,pattern,created_at FROM exclusion_rules ORDER BY id DESC');
  return { items };
});
app.post('/api/exclusions', { preHandler: allow('SUPER_ADMIN', 'ADMIN') }, async (req, reply) => {
  const b = z.object({ pattern: z.string().trim().min(2).max(255) }).parse(req.body);
  const pattern = b.pattern.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const [r] = await db.execute<any>('INSERT IGNORE INTO exclusion_rules(pattern,created_by) VALUES(?,?)', [pattern, req.user.id]);
  const like = `%${pattern.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const [updated] = await db.execute<any>(`UPDATE leads SET status='REJECTED',rejection_reason='User exclusion rule'
    WHERE status IN ('PENDING','QUALIFIED') AND LOWER(CONCAT_WS(' ',domain,email,company,first_name,last_name)) LIKE ? ESCAPE '\\\\'`, [like]);
  const [prospects] = await db.execute<any>(`UPDATE prospects SET status='DELETED'
    WHERE status<>'DELETED' AND LOWER(CONCAT_WS(' ',domain,email,company,first_name,last_name)) LIKE ? ESCAPE '\\\\'`, [like]);
  const eliminated = Number(updated.affectedRows) + Number(prospects.affectedRows);
  await audit(req.user.id, 'CREATE_EXCLUSION_RULE', 'EXCLUSION_RULE', String(r.insertId || ''), { pattern, eliminated }, req.ip);
  return reply.code(201).send({ pattern, eliminated });
});
app.post(
  '/api/leads/move-to-prospects',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
  async (req) => {
    const b = z
        .object({
          leadIds: z.array(z.number().int().positive()).min(1).max(500),
        })
        .parse(req.body),
      conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      for (const id of b.leadIds) {
        const [rows] = await conn.execute<any[]>(
          "SELECT * FROM leads WHERE id=? AND status='QUALIFIED' FOR UPDATE",
          [id],
        );
        const l = rows[0];
        if (!l) continue;
        await conn.execute(
          `INSERT INTO prospects(source_lead_id,domain,first_name,last_name,company,email,phone,country,state,city,lead_score,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_at=NOW(3)`,
          [
            id,
            l.domain,
            l.first_name,
            l.last_name,
            l.company,
            l.email,
            l.phone,
            l.country,
            l.state,
            l.city,
            l.lead_score,
            req.user.id,
          ],
        );
        await conn.execute(
          "UPDATE leads SET status='MOVED_TO_PROSPECT' WHERE id=?",
          [id],
        );
      }
      await conn.commit();
      await audit(
        req.user.id,
        'MOVE_TO_PROSPECTS',
        'LEAD',
        null,
        { leadIds: b.leadIds },
        req.ip,
      );
      return { ok: true };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
);
app.post('/api/leads/move-filtered-to-prospects', { preHandler: allow('SUPER_ADMIN', 'ADMIN') }, async (req) => {
  const b = z.object({ countries: z.array(z.enum(['USA','UAE','Canada','Australia','India','Other'])).min(1).max(6), minScore: z.number().int().min(0).max(100).default(0), emailOnly: z.boolean().default(false), phoneOnly: z.boolean().default(false) }).parse(req.body);
  const marks = b.countries.map(() => '?').join(',');
  const extra = `${b.emailOnly ? " AND email IS NOT NULL AND email<>''" : ''}${b.phoneOnly ? " AND phone IS NOT NULL AND phone<>''" : ''}`;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute<any>(`INSERT IGNORE INTO prospects(source_lead_id,domain,first_name,last_name,company,email,phone,country,state,city,lead_score,created_by)
      SELECT id,domain,first_name,last_name,company,email,phone,country,state,city,lead_score,? FROM leads
      WHERE status='QUALIFIED' AND ${countryCase} IN (${marks}) AND lead_score>=?${extra}`, [req.user.id, ...b.countries, b.minScore]);
    await conn.execute(`UPDATE leads SET status='MOVED_TO_PROSPECT' WHERE status='QUALIFIED' AND ${countryCase} IN (${marks}) AND lead_score>=?${extra}`, [...b.countries, b.minScore]);
    await conn.commit();
    await audit(req.user.id, 'BULK_MOVE_TO_PROSPECTS', 'LEAD', null, { ...b, moved: r.affectedRows }, req.ip);
    return { ok: true, moved: r.affectedRows };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
});
app.get(
  '/api/prospects',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') },
  async () => {
    const [rows] = await db.query(
      "SELECT * FROM prospects WHERE status<>'DELETED' ORDER BY created_at DESC LIMIT 10000",
    );
    return { items: rows };
  },
);
app.post(
  '/api/campaigns',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
  async (req, reply) => {
    const b = z
        .object({
          name: z.string().min(2).max(160),
          provider: z.enum(['HOSTINGER', 'GMAIL']),
          subject: z.string().min(1).max(255),
          htmlBody: z.string().min(1),
          prospectIds: z.array(z.number().int().positive()).min(1).max(5000),
          minDelaySeconds: z.number().int().min(30).max(3600),
          maxDelaySeconds: z.number().int().min(30).max(7200),
          hourlyLimit: z.number().int().min(1).max(500),
          dailyLimit: z.number().int().min(1).max(5000),
        })
        .refine((x) => x.maxDelaySeconds >= x.minDelaySeconds)
        .parse(req.body),
      conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.execute<any>(
        `INSERT INTO campaigns(name,provider,subject,html_body,min_delay_seconds,max_delay_seconds,hourly_limit,daily_limit,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          b.name,
          b.provider,
          b.subject,
          b.htmlBody,
          b.minDelaySeconds,
          b.maxDelaySeconds,
          b.hourlyLimit,
          b.dailyLimit,
          req.user.id,
        ],
      );
      for (const ids of chunk(b.prospectIds, 500))
        await conn.query(
          `INSERT IGNORE INTO campaign_recipients(campaign_id,prospect_id) SELECT ?,id FROM prospects WHERE id IN (${ids.map(() => '?').join(',')}) AND email IS NOT NULL AND status='ACTIVE'`,
          [r.insertId, ...ids],
        );
      await conn.commit();
      await audit(
        req.user.id,
        'CREATE_CAMPAIGN',
        'CAMPAIGN',
        String(r.insertId),
        { name: b.name, recipients: b.prospectIds.length },
        req.ip,
      );
      return reply.code(201).send({ id: r.insertId, status: 'DRAFT' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
);
app.patch(
  '/api/campaigns/:id/status',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
  async (req) => {
    const id = z.coerce
        .number()
        .int()
        .positive()
        .parse((req.params as any).id),
      b = z
        .object({ status: z.enum(['QUEUED', 'PAUSED', 'CANCELLED']) })
        .parse(req.body);
    await db.execute('UPDATE campaigns SET status=? WHERE id=?', [
      b.status,
      id,
    ]);
    await audit(
      req.user.id,
      'CAMPAIGN_STATUS',
      'CAMPAIGN',
      String(id),
      b,
      req.ip,
    );
    return { ok: true };
  },
);
app.post(
  '/api/suppressions',
  { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
  async (req) => {
    const b = z
      .object({
        email: z.string().email(),
        reason: z.enum(['UNSUBSCRIBED', 'BOUNCE', 'COMPLAINT', 'MANUAL']),
      })
      .parse(req.body);
    await db.execute(
      'INSERT INTO suppressions(email,reason) VALUES(?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)',
      [b.email.toLowerCase(), b.reason],
    );
    return { ok: true };
  },
);
app.setErrorHandler((e, _req, reply) =>
  reply
    .code(e instanceof z.ZodError ? 400 : 500)
    .send({
      error:
        e instanceof z.ZodError
          ? e.issues
          : e instanceof Error
            ? e.message
            : 'Unexpected error',
    }),
);
app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true };
});
await app.listen({ port: config.PORT, host: '0.0.0.0' });
function chunk<T>(a: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
