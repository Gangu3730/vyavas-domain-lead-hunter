import {db} from './db.js';
import {config} from './config.js';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const parked=[/domain (?:is )?(?:for sale|parking)/i,/buy this domain/i,/afternic/i,/sedo/i,/hugedomains/i,/coming soon/i,/under construction/i];
const it=/(^|[^a-z])(software|technolog(?:y|ies)|tech|digital|agency|web|website|developer|development|hosting|cloud|saas|automation|it services)([^a-z]|$)/i;
function privateAddress(address:string){
  if(isIP(address)===4){const [a=0,b=0]=address.split('.').map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)}
  const a=address.toLowerCase();return a==='::1'||a==='::'||a.startsWith('fc')||a.startsWith('fd')||a.startsWith('fe8')||a.startsWith('fe9')||a.startsWith('fea')||a.startsWith('feb')||a.startsWith('::ffff:127.')||a.startsWith('::ffff:10.')||a.startsWith('::ffff:192.168.');
}
async function safeFetch(start:string){
  let url=new URL(start);
  for(let redirects=0;redirects<=5;redirects++){
    if(!['http:','https:'].includes(url.protocol))throw new Error('Unsafe website protocol');
    const addresses=await lookup(url.hostname,{all:true});
    if(!addresses.length||addresses.some(x=>privateAddress(x.address)))throw new Error('Private or unresolved website address');
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'user-agent':'VYAVAS-LeadQualifier/1.0','accept':'text/html'}});
    if(response.status>=300&&response.status<400&&response.headers.get('location')){url=new URL(response.headers.get('location')!,url);continue}
    return response;
  }
  throw new Error('Too many website redirects');
}
async function limitedText(response:Response){
  if(!response.body)return'';
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  while(text.length<750000){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true})}
  await reader.cancel().catch(()=>{});return text.slice(0,750000);
}
async function inspect(domain:string){for(const protocol of ['https','http'])try{const r=await safeFetch(`${protocol}://${domain}`);if(!(r.headers.get('content-type')??'').includes('text/html')||r.status>=400)return'NO_WEBSITE';const html=await limitedText(r),text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();if(text.length<80)return'NO_WEBSITE';if(parked.some(x=>x.test(text)))return/coming soon|under construction/i.test(text)?'COMING_SOON':'PARKED';return'LIVE'}catch{}return'NO_WEBSITE'}
const countryCase=`CASE WHEN LOWER(TRIM(COALESCE(country,''))) IN ('us','usa','united states','united states of america') THEN 'USA' WHEN LOWER(TRIM(COALESCE(country,''))) IN ('ae','uae','united arab emirates') THEN 'UAE' WHEN LOWER(TRIM(COALESCE(country,''))) IN ('ca','can','canada') THEN 'Canada' WHEN LOWER(TRIM(COALESCE(country,''))) IN ('au','aus','australia') THEN 'Australia' WHEN LOWER(TRIM(COALESCE(country,''))) IN ('in','ind','india') THEN 'India' ELSE 'Other' END`;
const concurrency = config.SCAN_CONCURRENCY;

async function qualify(lead:any){
  let qualified=false;
  try {
    if(it.test(`${lead.domain} ${lead.company??''}`)) {
      await db.execute("UPDATE leads SET status='REJECTED',website_status='ERROR',rejection_reason='IT / digital business' WHERE id=?",[lead.id]);
    } else {
      const status=await inspect(lead.domain);
      if(status==='LIVE') {
        await db.execute("UPDATE leads SET status='REJECTED',website_status='LIVE',rejection_reason='Professional website already live' WHERE id=?",[lead.id]);
      } else {
        qualified=true;
        const score=(lead.email?45:0)+(lead.phone?25:0)+(lead.email&&lead.phone?10:0)+(lead.company?8:0)+(lead.country?5:0);
        await db.execute("UPDATE leads SET status='QUALIFIED',website_status=?,lead_score=?,rejection_reason=NULL WHERE id=?",[status,Math.min(score,100),lead.id]);
      }
    }
    return {qualified,processed:true};
  } catch(error) {
    console.error(`Scan failed for ${lead.domain}`,error);
    await db.execute("UPDATE leads SET website_status='UNSCANNED' WHERE id=? AND website_status='SCANNING'",[lead.id]);
    return {qualified:false,processed:false};
  }
}

async function next(){
  const[batches]=await db.query<any[]>("SELECT * FROM processing_batches WHERE status='RUNNING' ORDER BY id LIMIT 1");
  const batch=batches[0];
  if(!batch)return false;
  const countries=typeof batch.countries==='string'?JSON.parse(batch.countries):batch.countries;
  const marks=countries.map(()=>'?').join(',');
  const scope=batch.import_job_id?' AND l.import_job_id=?':' AND j.archived_at IS NULL';
  const args=batch.import_job_id?[...countries,batch.import_job_id,concurrency]:[...countries,concurrency];
  const conn=await db.getConnection();
  let rows:any[]=[];
  try{
    await conn.beginTransaction();
    [rows]=await conn.query<any[]>(`SELECT l.id,l.domain,l.company,l.email,l.phone,l.country FROM leads l JOIN import_jobs j ON j.id=l.import_job_id WHERE l.status='PENDING' AND l.website_status='UNSCANNED' AND ${countryCase} IN (${marks})${scope} ORDER BY l.id LIMIT ? FOR UPDATE SKIP LOCKED`,args);
    if(rows.length){
      const ids=rows.map(x=>x.id), idMarks=ids.map(()=>'?').join(',');
      await conn.query(`UPDATE leads SET website_status='SCANNING' WHERE website_status='UNSCANNED' AND id IN (${idMarks})`,ids);
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error}finally{conn.release()}
  if(!rows.length){
    const scanArgs=batch.import_job_id?[...countries,batch.import_job_id]:countries;
    const[inFlight]=await db.query<any[]>(`SELECT COUNT(*) total FROM leads l JOIN import_jobs j ON j.id=l.import_job_id WHERE l.status='PENDING' AND l.website_status='SCANNING' AND ${countryCase} IN (${marks})${scope}`,scanArgs);
    if(!Number(inFlight[0]?.total))await db.execute("UPDATE processing_batches SET status='COMPLETED',total_rows=processed_rows WHERE id=? AND status='RUNNING'",[batch.id]);
    return false;
  }
  const results=await Promise.all(rows.map(qualify));
  const processed=results.filter(x=>x.processed).length;
  const qualified=results.filter(x=>x.processed&&x.qualified).length;
  if(processed) await db.execute('UPDATE processing_batches SET processed_rows=processed_rows+?,qualified_rows=qualified_rows+?,rejected_rows=rejected_rows+? WHERE id=?',[processed,qualified,processed-qualified,batch.id]);
  return true;
}
console.log(`VYAVAS website qualification worker started (${concurrency} concurrent scans)`);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{console.log(`${signal} received; finishing current scans`);stopping=true});
while(!stopping){const active=await next().catch(e=>{console.error(e);return false});if(!stopping)await new Promise(r=>setTimeout(r,active?100:3000))}
await db.end();
