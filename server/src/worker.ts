import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';
const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
  disableFileAccess:true,
  disableUrlAccess:true,
});
type Job = {
  recipient_id: number;
  campaign_id: number;
  subject: string;
  html_body: string;
  min_delay_seconds: number;
  max_delay_seconds: number;
  hourly_limit: number;
  daily_limit: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  domain: string;
  country: string | null;
};
const render = (s: string, j: Job) =>
  s
    .replaceAll('{{first_name}}', j.first_name || 'there')
    .replaceAll('{{last_name}}', j.last_name || '')
    .replaceAll('{{company}}', j.company || 'your business')
    .replaceAll('{{domain}}', j.domain)
    .replaceAll('{{country}}', j.country || '');
async function claim(): Promise<Job | null> {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.query<any[]>(
      `SELECT cr.id recipient_id,c.id campaign_id,c.subject,c.html_body,c.min_delay_seconds,c.max_delay_seconds,c.hourly_limit,c.daily_limit,p.email,p.first_name,p.last_name,p.company,p.domain,p.country FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id JOIN prospects p ON p.id=cr.prospect_id LEFT JOIN suppressions s ON s.email=p.email WHERE cr.status='PENDING' AND (cr.next_attempt_at IS NULL OR cr.next_attempt_at<=NOW(3)) AND (c.next_send_at IS NULL OR c.next_send_at<=NOW(3)) AND c.status IN ('QUEUED','RUNNING') AND p.status='ACTIVE' AND p.email IS NOT NULL AND s.id IS NULL ORDER BY cr.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const j = rows[0] as Job | undefined;
    if (!j) {
      await c.commit();
      return null;
    }
    const [hourRows] = await c.query<any[]>(
      "SELECT COUNT(*) n FROM campaign_recipients WHERE campaign_id=? AND status='SENT' AND sent_at>=DATE_SUB(NOW(),INTERVAL 1 HOUR)",
      [j.campaign_id],
    );
    const [dayRows] = await c.query<any[]>(
      "SELECT COUNT(*) n FROM campaign_recipients WHERE campaign_id=? AND status='SENT' AND sent_at>=DATE_SUB(NOW(),INTERVAL 1 DAY)",
      [j.campaign_id],
    );
    const hour = hourRows[0] ?? { n: 0 },
      day = dayRows[0] ?? { n: 0 };
    if (hour.n >= j.hourly_limit || day.n >= j.daily_limit) {
      await c.query(
        'UPDATE campaign_recipients SET next_attempt_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE) WHERE id=?',
        [j.recipient_id],
      );
      await c.commit();
      return null;
    }
    await c.query("UPDATE campaigns SET status='RUNNING' WHERE id=?", [
      j.campaign_id,
    ]);
    await c.query(
      "UPDATE campaign_recipients SET status='SENDING',attempt_count=attempt_count+1 WHERE id=?",
      [j.recipient_id],
    );
    await c.commit();
    return j;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function work() {
  const j = await claim();
  if (!j) return false;
  try {
    const info = await transport.sendMail({
      from: { name: config.SMTP_FROM_NAME, address: config.SMTP_FROM_EMAIL },
      to: j.email,
      subject: render(j.subject, j).replace(/[\r\n]+/g,' ').trim(),
      html: render(j.html_body, j),
      headers: { 'X-Auto-Response-Suppress': 'All' },
    });
    const delay =
      j.min_delay_seconds +
      Math.floor(
        Math.random() * (j.max_delay_seconds - j.min_delay_seconds + 1),
      );
    await db.execute(
      "UPDATE campaign_recipients SET status='SENT',sent_at=NOW(3),provider_message_id=? WHERE id=?",
      [info.messageId, j.recipient_id],
    );
    await db.execute("UPDATE campaigns SET next_send_at=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE id=?",[delay,j.campaign_id]);
    const [remaining]=await db.execute<any[]>("SELECT COUNT(*) total FROM campaign_recipients WHERE campaign_id=? AND status IN ('PENDING','SENDING')",[j.campaign_id]);
    if(!Number(remaining[0]?.total))await db.execute("UPDATE campaigns SET status='COMPLETED' WHERE id=?",[j.campaign_id]);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SMTP failure';
    await db.execute(
      "UPDATE campaign_recipients SET status=IF(attempt_count>=3,'FAILED','PENDING'),next_attempt_at=DATE_ADD(NOW(),INTERVAL 15 MINUTE),last_error=? WHERE id=?",
      [message.slice(0, 500), j.recipient_id],
    );
    return true;
  }
}
await db.execute("UPDATE campaign_recipients SET status='PENDING',next_attempt_at=NOW(3),last_error='Recovered after worker restart' WHERE status='SENDING' AND updated_at<DATE_SUB(NOW(),INTERVAL 15 MINUTE)");
console.log(`VYAVAS email worker started with ${config.SMTP_PROVIDER}`);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{console.log(`${signal} received; finishing current email`);stopping=true});
while (!stopping) {
  const active = await work().catch((e) => {
    console.error(e);
    return false;
  });
  if(!stopping)await new Promise((r) => setTimeout(r, active ? 1000 : 10000));
}
transport.close();
await db.end();
