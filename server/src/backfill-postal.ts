import ExcelJS from 'exceljs';
import { db } from './db.js';

const [filePath, jobArg] = process.argv.slice(2);
const jobId = Number(jobArg);
if (!filePath || !Number.isInteger(jobId)) throw new Error('Usage: backfill-postal <xlsx> <import-job-id>');
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
const sheet = workbook.worksheets[0];
if (!sheet) throw new Error('Worksheet not found');
const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''));
const domainIndex = headers.findIndex((x) => ['domain','domainname'].includes(x));
const postalIndex = headers.findIndex((x) => ['postalcode','postcode','pincode','zip','zipcode','registrantpostalcode','registrantzip'].includes(x));
if (domainIndex < 0 || postalIndex < 0) throw new Error('Domain or postal column not found');
const conn = await db.getConnection();
try {
  await conn.query('CREATE TEMPORARY TABLE postal_backfill(domain VARCHAR(253) PRIMARY KEY,postal_code VARCHAR(30))');
  let batch: unknown[][] = [];
  const flush = async () => {
    if (!batch.length) return;
    await conn.query(`INSERT INTO postal_backfill(domain,postal_code) VALUES ${batch.map(() => '(?,?)').join(',')} ON DUPLICATE KEY UPDATE postal_code=VALUES(postal_code)`, batch.flat());
    batch = [];
  };
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const values = (row.values as unknown[]).slice(1);
    const domain = String(values[domainIndex] ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const postal = String(values[postalIndex] ?? '').trim();
    if (domain && postal) batch.push([domain, postal]);
  });
  for (let start = 0; start < batch.length; start += 1000) {
    const part = batch.slice(start, start + 1000);
    await conn.query(`INSERT INTO postal_backfill(domain,postal_code) VALUES ${part.map(() => '(?,?)').join(',')} ON DUPLICATE KEY UPDATE postal_code=VALUES(postal_code)`, part.flat());
  }
  batch = [];
  const [result] = await conn.execute<any>('UPDATE leads l JOIN postal_backfill p ON p.domain=l.domain SET l.postal_code=p.postal_code WHERE l.import_job_id=?', [jobId]);
  console.log(`Backfilled ${result.affectedRows} lead postal codes for import #${jobId}`);
} finally {
  conn.release();
  await db.end();
}
