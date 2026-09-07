import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { audit, db } from './db.js';
import { allow, requireUser } from './auth.js';
import { importRoutes } from './imports.js';
async function start() {
const dashboardHtml = await readFile(
  new URL('../public/index.html', import.meta.url),
  'utf8',
);
const app = Fastify({
  trustProxy: config.TRUST_PROXY,
  bodyLimit: 10 * 1024 * 1024,
  logger: {redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie']},
});
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
try { await db.query('ALTER TABLE import_jobs ADD COLUMN archived_at DATETIME(3) NULL'); } catch (e:any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
try { await db.query('ALTER TABLE processing_batches ADD COLUMN import_job_id BIGINT UNSIGNED NULL'); } catch (e:any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
try { await db.query('ALTER TABLE leads ADD COLUMN postal_code VARCHAR(30) NULL AFTER city'); } catch (e:any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
try { await db.query('ALTER TABLE prospects ADD COLUMN postal_code VARCHAR(30) NULL AFTER city'); } catch (e:any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
try { await db.query('CREATE INDEX idx_leads_scan ON leads(status,website_status,import_job_id,country,id)'); } catch (e:any) { if (e?.code !== 'ER_DUP_KEYNAME') throw e; }
try { await db.query('ALTER TABLE campaigns ADD COLUMN next_send_at DATETIME(3) NULL'); } catch (e:any) { if (e?.code !== 'ER_DUP_FIELDNAME') throw e; }
try { await db.query('CREATE INDEX idx_campaign_queue ON campaigns(status,next_send_at)'); } catch (e:any) { if (e?.code !== 'ER_DUP_KEYNAME') throw e; }
await app.register(cookie);
await app.register(jwt, {
  secret: config.JWT_SECRET,
  cookie: { cookieName: 'vyavas_session', signed: false },
});
await app.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});
await app.register(rateLimit,{global:false});
await app.register(helmet,{
  contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"]}},
});
app.addHook('onRequest',async(req,reply)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;
  const origin=req.headers.origin;
  if(origin&&origin!==config.APP_ORIGIN)return reply.code(403).send({error:'Invalid request origin'});
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
app.post('/api/auth/login', {config:{rateLimit:{max:5,timeWindow:'1 minute'}}}, async (req, reply) => {
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
    reply.clearCookie('vyavas_session', { path: '/',secure:config.NODE_ENV==='production',sameSite:'lax' });
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
  async (req, reply) => {
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
    if (id === req.user.id && (b.status === 'DISABLED'||b.role))
      return reply.code(400).send({error:'Cannot disable or change your own administrator role'});
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
  async (req, reply) => {
    const q=z.object({importJobId:z.coerce.number().int().positive().optional()}).parse(req.query), scope=q.importJobId?' AND l.import_job_id=?':' AND j.archived_at IS NULL';
    const [rows] = await db.query<any[]>(`SELECT COUNT(*) total,
      SUM(l.status='QUALIFIED') qualified,
      SUM(l.status='REJECTED') rejected,
      SUM(l.status='PENDING') pending,
      SUM(l.website_status='LIVE') live_rejected,
      SUM(l.website_status IN ('PARKED','COMING_SOON','NO_WEBSITE') AND l.status='QUALIFIED') no_website,
      SUM(l.email IS NOT NULL AND l.email<>'') with_email,
      SUM(l.phone IS NOT NULL AND l.phone<>'') with_phone
      FROM leads l JOIN import_jobs j ON j.id=l.import_job_id WHERE l.status<>'DELETED'${scope}`,q.importJobId?[q.importJobId]:[]);
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
          importJobId: z.coerce.number().int().positive().optional(),
        })
        .parse(req.query),
      where: string[] = ["l.status<>'DELETED'"],
      args: any[] = [];
    if (q.status) {
      where.push('l.status=?');
      args.push(q.status);
    }
    if (q.country) {
      where.push('l.country=?');
      args.push(q.country);
    }
    if(q.importJobId){where.push('l.import_job_id=?');args.push(q.importJobId)}else where.push('j.archived_at IS NULL');
    const [rows] = await db.execute(
      `SELECT l.* FROM leads l JOIN import_jobs j ON j.id=l.import_job_id WHERE ${where.join(' AND ')} ORDER BY l.lead_score DESC,l.id DESC LIMIT ? OFFSET ?`,
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
app.get('/api/processing/status', { preHandler: allow('SUPER_ADMIN', 'ADMIN', 'USER') }, async (req) => {
  const q=z.object({importJobId:z.coerce.number().int().positive().optional()}).parse(req.query);
  const [rows] = await db.execute<any[]>(q.importJobId?'SELECT * FROM processing_batches WHERE import_job_id=? AND total_rows>0 ORDER BY id DESC LIMIT 1':"SELECT b.* FROM processing_batches b LEFT JOIN import_jobs j ON j.id=b.import_job_id WHERE b.total_rows>0 AND (b.import_job_id IS NULL OR j.archived_at IS NULL) ORDER BY b.id DESC LIMIT 1",q.importJobId?[q.importJobId]:[]);
  return rows[0] ?? null;
});
app.post('/api/processing/start', { preHandler: allow('SUPER_ADMIN', 'ADMIN') }, async (req, reply) => {
  const b = z.object({ countries: z.array(z.enum(['USA','UAE','Canada','Australia','India','Other'])).min(1).max(6), importJobId:z.number().int().positive().nullable().optional() }).parse(req.body);
  const conn=await db.getConnection();
  let result:any,total=0;
  try{
    const [locks]=await conn.query<any[]>("SELECT GET_LOCK('vyavas_processing_start',5) acquired");
    if(!locks[0]?.acquired)return reply.code(409).send({error:'Processing is busy. Please try again'});
    const [running] = await conn.query<any[]>("SELECT id FROM processing_batches WHERE status='RUNNING' LIMIT 1");
    if (running[0]) return reply.code(409).send({ error: 'A processing batch is already running' });
    const marks = b.countries.map(() => '?').join(',');
    const jobScope=b.importJobId?' AND l.import_job_id=?':' AND j.archived_at IS NULL', countArgs=b.importJobId?[...b.countries,b.importJobId]:b.countries;
    const [counts] = await conn.execute<any[]>(`SELECT COUNT(*) total FROM leads l JOIN import_jobs j ON j.id=l.import_job_id WHERE l.status='PENDING' AND l.website_status='UNSCANNED' AND ${countryCase} IN (${marks})${jobScope}`, countArgs);
    total = Number(counts[0]?.total ?? 0);
    if(!total)return reply.code(409).send({error:`No pending leads found for ${b.countries.join(', ')} in the selected dataset`});
    [result] = await conn.execute<any>('INSERT INTO processing_batches(created_by,countries,status,total_rows,import_job_id) VALUES(?,?,?,?,?)', [req.user.id, JSON.stringify(b.countries), 'RUNNING', total,b.importJobId??null]);
  }finally{
    await conn.query("SELECT RELEASE_LOCK('vyavas_processing_start')").catch(()=>{});
    conn.release();
  }
  await audit(req.user.id, 'START_COUNTRY_PROCESSING', 'PROCESSING_BATCH', String(result.insertId), { countries: b.countries, total }, req.ip);
  return reply.code(201).send({ id: result.insertId, countries: b.countries, status: 'RUNNING', total_rows: total, processed_rows: 0, qualified_rows: 0, rejected_rows: 0 });
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
          `INSERT INTO prospects(source_lead_id,domain,first_name,last_name,company,email,phone,country,state,city,postal_code,lead_score,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_at=NOW(3)`,
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
            l.postal_code,
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
  const b = z.object({ countries: z.array(z.enum(['USA','UAE','Canada','Australia','India','Other'])).min(1).max(6), minScore: z.number().int().min(0).max(100).default(0), emailOnly: z.boolean().default(false), phoneOnly: z.boolean().default(false), importJobId:z.number().int().positive().nullable().optional() }).parse(req.body);
  const marks = b.countries.map(() => '?').join(',');
  const extra = `${b.emailOnly ? " AND email IS NOT NULL AND email<>''" : ''}${b.phoneOnly ? " AND phone IS NOT NULL AND phone<>''" : ''}${b.importJobId?' AND import_job_id=?':''}`;
  const filterArgs=b.importJobId?[...b.countries,b.minScore,b.importJobId]:[...b.countries,b.minScore];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute<any>(`INSERT IGNORE INTO prospects(source_lead_id,domain,first_name,last_name,company,email,phone,country,state,city,postal_code,lead_score,created_by)
      SELECT id,domain,first_name,last_name,company,email,phone,country,state,city,postal_code,lead_score,? FROM leads
      WHERE status='QUALIFIED' AND ${countryCase} IN (${marks}) AND lead_score>=?${extra}`, [req.user.id, ...filterArgs]);
    await conn.execute(`UPDATE leads SET status='MOVED_TO_PROSPECT' WHERE status='QUALIFIED' AND ${countryCase} IN (${marks}) AND lead_score>=?${extra}`, filterArgs);
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
app.get('/api/campaigns',{preHandler:allow('SUPER_ADMIN','ADMIN')},async()=>{
  const[items]=await db.query(`SELECT c.id,c.name,c.provider,c.subject,c.status,c.hourly_limit,c.daily_limit,c.created_at,
    COUNT(cr.id) recipients,SUM(cr.status='SENT') sent,SUM(cr.status='FAILED') failed,SUM(cr.status='PENDING') pending
    FROM campaigns c LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
    GROUP BY c.id ORDER BY c.id DESC LIMIT 200`);
  return{items};
});
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
          `INSERT IGNORE INTO campaign_recipients(campaign_id,prospect_id)
           SELECT ?,p.id FROM prospects p LEFT JOIN suppressions s ON s.email=p.email
           WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.email IS NOT NULL AND p.status='ACTIVE' AND s.id IS NULL`,
          [r.insertId, ...ids],
        );
      const[counts]=await conn.execute<any[]>('SELECT COUNT(*) total FROM campaign_recipients WHERE campaign_id=?',[r.insertId]);
      const recipients=Number(counts[0]?.total??0);
      if(!recipients){await conn.rollback();return reply.code(400).send({error:'No eligible email recipients were selected'})}
      await conn.commit();
      await audit(
        req.user.id,
        'CREATE_CAMPAIGN',
        'CAMPAIGN',
        String(r.insertId),
        { name: b.name, recipients },
        req.ip,
      );
      return reply.code(201).send({ id: r.insertId, status: 'DRAFT',recipients });
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
  async (req, reply) => {
    const id = z.coerce
        .number()
        .int()
        .positive()
        .parse((req.params as any).id),
      b = z
        .object({ status: z.enum(['QUEUED', 'PAUSED', 'CANCELLED']) })
        .parse(req.body);
    const allowed=b.status==='QUEUED'?['DRAFT','PAUSED']:b.status==='PAUSED'?['QUEUED','RUNNING']:['DRAFT','QUEUED','RUNNING','PAUSED'];
    const marks=allowed.map(()=>'?').join(',');
    const[result]=await db.execute<any>(`UPDATE campaigns SET status=? WHERE id=? AND status IN (${marks})`,[b.status,id,...allowed]);
    if(!result.affectedRows)return reply.code(409).send({error:'Campaign status can no longer be changed'});
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
app.get('/api/audit-logs',{preHandler:allow('SUPER_ADMIN')},async()=>{
  const[items]=await db.query(`SELECT a.id,a.action,a.entity_type,a.entity_id,a.ip_address,a.created_at,u.email user_email
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500`);
  return{items};
});
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
app.setErrorHandler((e:any, req, reply) => {
  if(e instanceof z.ZodError)return reply.code(400).send({error:e.issues});
  if(e?.statusCode===429)return reply.code(429).send({error:'Too many attempts. Please wait and try again'});
  if(e?.code==='ER_DUP_ENTRY')return reply.code(409).send({error:'This record already exists'});
  req.log.error({err:e},'Request failed');
  return reply.code(500).send({error:'Unexpected server error'});
});
app.get('/health', async () => {
  await db.query('SELECT 1');
  return { ok: true };
});
await app.listen({ port: config.PORT, host: '0.0.0.0' });
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{
  app.log.info({signal},'Shutting down');
  await app.close();
  await db.end();
  process.exit(0);
});
}

void start().catch((error) => {
  console.error('Application startup failed', error);
  process.exit(1);
});

function chunk<T>(a: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
