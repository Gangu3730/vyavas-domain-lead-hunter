import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { allow } from './auth.js';
import { audit, db } from './db.js';
type R = Record<string, string>;
const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''),
  c = (v: unknown) =>
    v == null
      ? ''
      : v instanceof Date
        ? v.toISOString()
        : typeof v === 'string' || typeof v === 'number'
          ? String(v).trim()
          : '';
const a = {
  domain: ['domain', 'domainname'],
  email: ['email', 'registrantemail'],
  name: ['name', 'registrantname'],
  first: ['firstname', 'givenname'],
  last: ['lastname', 'surname', 'familyname'],
  company: ['company', 'organization', 'registrantcompany'],
  phone: ['phone', 'registrantphone'],
  country: ['country', 'registrantcountry'],
  state: ['state', 'registrantstate'],
  city: ['city', 'registrantcity'],
  created: ['createddate', 'created', 'creationdate', 'registrationdate'],
  privacy: ['privacy', 'proxy', 'redacted'],
};
const find = (h: string[], x: string[]) =>
  h.find((v) => x.includes(k(v))) ?? '';
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.replace(/\.$/, '') ?? '';
const valid = (s: string) =>
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
    s,
  );
const validEmail = (email: string) => {
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,63})+$/i.test(email)) return false;
  const local = email.split('@')[0] ?? '';
  const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
  if (['domain-contact.org', 'domaincontact.org'].includes(emailDomain)) return false;
  if (local.length < 2 || /^\d+$/.test(local)) return false;
  const compact = local.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const letters = (compact.match(/[a-z]/g) ?? []).length;
  const digits = (compact.match(/\d/g) ?? []).length;
  const vowels = (compact.match(/[aeiou]/g) ?? []).length;
  return !(compact.length >= 6 && digits >= 3 && letters >= 3 && vowels === 0);
};
const trustedFreeEmail = (email: string) => {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  return /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.(com|co\.uk|ca)|live\.(com|co\.uk|ca)|msn\.com|yahoo\.(com|co\.uk|ca|co\.in|in)|icloud\.com|me\.com|mac\.com|protonmail\.com|proton\.me|aol\.com|gmx\.(com|net)|mail\.com|rediffmail\.com)$/.test(domain);
};
const privateWords = [
  'redacted for privacy',
  'domains by proxy',
  'whois privacy',
  'privacy service',
  'data protected',
];
function csv(t: string) {
  const lines = t
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean),
    headers = (lines.shift() ?? '')
      .split(',')
      .map((x) => x.replace(/^"|"$/g, ''));
  return {
    headers,
    rows: lines.map((line) => {
      const cells = line.split(',').map((x) => x.replace(/^"|"$/g, '').trim());
      return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    }),
  };
}
export async function importRoutes(app: FastifyInstance) {
  app.post(
    '/api/imports',
    { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'File required' });
      const buf = await file.toBuffer();
      let headers: string[] = [],
        rows: R[] = [];
      if (file.filename.toLowerCase().endsWith('.csv'))
        ({ headers, rows } = csv(buf.toString('utf8')));
      else {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as any);
        const ws = wb.worksheets[0];
        if (!ws) return reply.code(400).send({ error: 'No worksheet' });
        headers = (ws.getRow(1).values as unknown[]).slice(1).map(c);
        ws.eachRow((row, n) => {
          if (n === 1) return;
          const vals = (row.values as unknown[]).slice(1);
          rows.push(Object.fromEntries(headers.map((h, i) => [h, c(vals[i])])));
        });
      }
      const m = Object.fromEntries(
        Object.entries(a).map(([f, v]) => [f, find(headers, v)]),
      ) as Record<string, string>;
      if (!m.domain)
        return reply.code(400).send({ error: 'Domain column not detected' });
      const value=(row:R,field:string)=>row[m[field]??'']??'';
      const [job] = await db.execute<any>(
        'INSERT INTO import_jobs(created_by,file_name,file_size,status,total_rows) VALUES(?,?,?,?,?)',
        [req.user.id, file.filename, buf.length, 'PROCESSING', rows.length],
      );
      const [ruleRows] = await db.query<any[]>('SELECT pattern FROM exclusion_rules');
      const exclusionPatterns = ruleRows.map((x) => String(x.pattern).toLowerCase());
      let pending = 0, rejected = 0, processed = 0;
      const batch:unknown[][]=[];
      const flush=async()=>{if(!batch.length)return;const placeholders=batch.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');await db.query(`INSERT IGNORE INTO leads(import_job_id,domain,first_name,last_name,company,email,phone,country,state,city,status,rejection_reason,discovery_date) VALUES ${placeholders}`,batch.flat());processed+=batch.length;batch.length=0;await db.execute('UPDATE import_jobs SET processed_rows=?,qualified_rows=?,rejected_rows=? WHERE id=?',[processed,pending,rejected,job.insertId])};
      for (const r of rows) {
        const d = norm(value(r,'domain')),
          email = value(r,'email').toLowerCase(),
          full = value(r,'name'),
          parts = full.split(/\s+/),
          first = value(r,'first') || parts.shift() || '',
          last = value(r,'last') || parts.join(' '),
          company = value(r,'company'),
          phone = value(r,'phone'),
          privacy = [value(r,'privacy'), full, company, email]
            .join(' ')
            .toLowerCase();
        const searchable = [d, email, full, company, first, last].join(' ').toLowerCase();
        let status = 'PENDING',
          reason: null | string = null;
        if (privateWords.some((x) => privacy.includes(x))) {
          status = 'REJECTED';
          reason = 'Privacy protected';
        } else if (exclusionPatterns.some((x) => searchable.includes(x))) {
          status = 'REJECTED';
          reason = 'User exclusion rule';
        } else if (!valid(d) || !email || !validEmail(email) || !trustedFreeEmail(email)) {
          status = 'REJECTED';
          reason = !valid(d) ? 'Invalid domain' : !email ? 'Email required' : !validEmail(email) ? 'Invalid or random email' : 'Only trusted free email accepted';
        }
        status === 'PENDING' ? pending++ : rejected++;
        batch.push([
            job.insertId,
            d,
            first || null,
            last || null,
            company || null,
            email || null,
            phone || null,
            value(r,'country') || null,
            value(r,'state') || null,
            value(r,'city') || null,
            status,
            reason,
            value(r,'created').slice(0, 10) || null,
          ]);
        if(batch.length>=500)await flush();
      }
      await flush();
      await db.execute(
        `UPDATE leads newer JOIN leads older ON older.domain=newer.domain AND older.id<newer.id
         SET newer.status='REJECTED',newer.rejection_reason='Duplicate domain'
         WHERE newer.import_job_id=? AND older.status<>'DELETED'`,
        [job.insertId],
      );
      await db.execute(
        "UPDATE import_jobs SET status='COMPLETED',processed_rows=?,qualified_rows=?,rejected_rows=? WHERE id=?",
        [rows.length, pending, rejected, job.insertId],
      );
      await audit(
        req.user.id,
        'IMPORT_FILE',
        'IMPORT_JOB',
        String(job.insertId),
        { file: file.filename, rows: rows.length },
        req.ip,
      );
      return reply
        .code(201)
        .send({ id: job.insertId, total: rows.length, pending, rejected });
    },
  );
  app.get(
    '/api/imports',
    { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
    async () => {
      const [items] = await db.query(
        'SELECT * FROM import_jobs ORDER BY id DESC LIMIT 100',
      );
      return { items };
    },
  );
}
