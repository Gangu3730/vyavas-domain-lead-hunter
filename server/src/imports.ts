import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import {parse} from 'csv-parse/sync';
import {z} from 'zod';
import { allow } from './auth.js';
import { audit, db } from './db.js';
import {config} from './config.js';
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
  postal: ['postalcode', 'postcode', 'pincode', 'zip', 'zipcode', 'registrantpostalcode', 'registrantzip'],
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
  const rows=parse(t,{bom:true,columns:true,skip_empty_lines:true,relax_column_count:true,trim:true}) as R[];
  return {headers:rows[0]?Object.keys(rows[0]):[],rows};
}
export async function importRoutes(app: FastifyInstance) {
  app.post(
    '/api/imports',
    { preHandler: allow('SUPER_ADMIN', 'ADMIN') },
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'File required' });
      const extension=file.filename.toLowerCase().split('.').pop();
      if(!extension||!['csv','xlsx'].includes(extension))return reply.code(400).send({error:'Only CSV and XLSX files are supported'});
      const buf = await file.toBuffer();
      const mode = String((file.fields as any)?.mode?.value ?? 'MERGE').toUpperCase();
      if (!['MERGE','FRESH'].includes(mode)) return reply.code(400).send({error:'Invalid import mode'});
      let headers: string[] = [],
        rows: R[] = [];
      if (extension==='csv')
        ({ headers, rows } = csv(buf.toString('utf8')));
      else {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as any);
        const ws = wb.worksheets[0];
        if (!ws) return reply.code(400).send({ error: 'No worksheet' });
        headers = (ws.getRow(1).values as unknown[]).slice(1).map(c);
        ws.eachRow((row, n) => {
          if (n === 1) return;
          if(rows.length>=config.MAX_IMPORT_ROWS)throw new Error(`Import exceeds the ${config.MAX_IMPORT_ROWS.toLocaleString()} row limit`);
          const vals = (row.values as unknown[]).slice(1);
          rows.push(Object.fromEntries(headers.map((h, i) => [h, c(vals[i])])));
        });
      }
      if(rows.length>config.MAX_IMPORT_ROWS)return reply.code(413).send({error:`Import exceeds the ${config.MAX_IMPORT_ROWS.toLocaleString()} row limit`});
      if(!rows.length)return reply.code(400).send({error:'The uploaded file has no data rows'});
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
      try {
      const [ruleRows] = await db.query<any[]>('SELECT pattern FROM exclusion_rules');
      const exclusionPatterns = ruleRows.map((x) => String(x.pattern).toLowerCase());
      let pending = 0, rejected = 0, processed = 0;
      const batch:unknown[][]=[];
      const flush=async()=>{if(!batch.length)return;const placeholders=batch.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');await db.query(`INSERT IGNORE INTO leads(import_job_id,domain,first_name,last_name,company,email,phone,country,state,city,postal_code,status,rejection_reason,discovery_date) VALUES ${placeholders}`,batch.flat());processed+=batch.length;batch.length=0;await db.execute('UPDATE import_jobs SET processed_rows=?,qualified_rows=?,rejected_rows=? WHERE id=?',[processed,pending,rejected,job.insertId])};
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
            value(r,'postal') || null,
            status,
            reason,
            value(r,'created').slice(0, 10) || null,
          ]);
        if(batch.length>=500)await flush();
      }
      await flush();
      await db.execute(
        `UPDATE leads newer JOIN leads older ON older.domain=newer.domain AND older.id<newer.id
         JOIN import_jobs older_job ON older_job.id=older.import_job_id
         SET newer.status='REJECTED',newer.rejection_reason='Duplicate domain'
         WHERE newer.import_job_id=? AND newer.status='PENDING' AND older.status IN ('PENDING','QUALIFIED','MOVED_TO_PROSPECT')
           AND (older.import_job_id=? OR (?='MERGE' AND older_job.archived_at IS NULL))`,
        [job.insertId,job.insertId,mode],
      );
      await db.execute(
        `UPDATE leads newer JOIN leads older ON older.email=newer.email AND older.id<newer.id
         JOIN import_jobs older_job ON older_job.id=older.import_job_id
         SET newer.status='REJECTED',newer.rejection_reason='Duplicate email'
         WHERE newer.import_job_id=? AND newer.status='PENDING' AND newer.email IS NOT NULL AND newer.email<>''
           AND older.status IN ('PENDING','QUALIFIED','MOVED_TO_PROSPECT')
           AND (older.import_job_id=? OR (?='MERGE' AND older_job.archived_at IS NULL))`,
        [job.insertId,job.insertId,mode],
      );
      const [finalCounts] = await db.execute<any[]>(
        `SELECT COUNT(*) total,
          SUM(status='PENDING') pending,
          SUM(status='REJECTED') rejected,
          SUM(rejection_reason IN ('Duplicate domain','Duplicate email')) duplicate_rows
         FROM leads WHERE import_job_id=?`,
        [job.insertId],
      );
      const saved=Number(finalCounts[0]?.total??0), finalPending=Number(finalCounts[0]?.pending??0), finalRejected=Number(finalCounts[0]?.rejected??0), duplicateRows=Number(finalCounts[0]?.duplicate_rows??0);
      if(mode==='FRESH'){
        await db.execute('UPDATE import_jobs SET archived_at=NOW(3) WHERE archived_at IS NULL AND id<>?',[job.insertId]);
        await db.execute("UPDATE processing_batches SET status='CANCELLED' WHERE status='RUNNING'");
      }
      await db.execute(
        "UPDATE import_jobs SET status='COMPLETED',processed_rows=?,qualified_rows=?,rejected_rows=? WHERE id=?",
        [saved, finalPending, finalRejected, job.insertId],
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
        .send({ id: job.insertId, total: saved, pending:finalPending, rejected:finalRejected, duplicatesRemoved:rows.length-saved+duplicateRows, mode });
      } catch(error) {
        const message=error instanceof Error?error.message:'Import failed';
        await db.execute("UPDATE import_jobs SET status='FAILED',error_message=? WHERE id=?",[message.slice(0,1000),job.insertId]).catch(()=>{});
        throw error;
      }
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
  app.patch('/api/imports/:id/archive',{preHandler:allow('SUPER_ADMIN','ADMIN')},async(req)=>{
    const id=Number((req.params as any).id);
    if(!Number.isInteger(id)||id<1)throw new Error('Invalid import id');
    await db.execute('UPDATE import_jobs SET archived_at=COALESCE(archived_at,NOW(3)) WHERE id=?',[id]);
    await audit(req.user.id,'ARCHIVE_IMPORT','IMPORT_JOB',String(id),{},req.ip);
    return{ok:true};
  });
  app.post('/api/imports/deduplicate',{preHandler:allow('SUPER_ADMIN','ADMIN')},async(req)=>{
    const body=z.object({importJobId:z.number().int().positive().nullable().optional()}).parse(req.body??{});
    const importJobId=body.importJobId??null;
    const conn=await db.getConnection();
    try{
      await conn.beginTransaction();
      const targetScope=importJobId?' AND newer.import_job_id=?':' AND newer_job.archived_at IS NULL';
      const params=importJobId?[importJobId]:[];
      const [domainResult]=await conn.execute<any>(`UPDATE leads newer
        JOIN import_jobs newer_job ON newer_job.id=newer.import_job_id
        JOIN leads older ON older.domain=newer.domain AND older.id<newer.id
        JOIN import_jobs older_job ON older_job.id=older.import_job_id AND older_job.archived_at IS NULL
        SET newer.status='REJECTED',newer.rejection_reason='Duplicate domain'
        WHERE newer.status IN ('PENDING','QUALIFIED') AND older.status IN ('PENDING','QUALIFIED','MOVED_TO_PROSPECT')${targetScope}`,params);
      const [emailResult]=await conn.execute<any>(`UPDATE leads newer
        JOIN import_jobs newer_job ON newer_job.id=newer.import_job_id
        JOIN leads older ON older.email=newer.email AND older.id<newer.id
        JOIN import_jobs older_job ON older_job.id=older.import_job_id AND older_job.archived_at IS NULL
        SET newer.status='REJECTED',newer.rejection_reason='Duplicate email'
        WHERE newer.status IN ('PENDING','QUALIFIED') AND newer.email IS NOT NULL AND newer.email<>''
          AND older.status IN ('PENDING','QUALIFIED','MOVED_TO_PROSPECT')${targetScope}`,params);
      await conn.commit();
      const removed=Number(domainResult.affectedRows)+Number(emailResult.affectedRows);
      await audit(req.user.id,'DEDUPLICATE_LEADS','IMPORT_JOB',importJobId?String(importJobId):null,{removed},req.ip);
      return{removed,domainDuplicates:Number(domainResult.affectedRows),emailDuplicates:Number(emailResult.affectedRows)};
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  });
}
