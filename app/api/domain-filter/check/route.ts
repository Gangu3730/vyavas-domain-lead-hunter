import { safeFetch } from '@/lib/domain-hunter/scanner';
import {requireApiUser} from '@/app/chatgpt-auth';

const parkedPatterns = [
  /domain (?:is )?(?:for sale|parking)/i,
  /buy this domain/i,
  /sedo domain parking/i,
  /afternic/i,
  /hugedomains/i,
  /bodis/i,
  /parkingcrew/i,
  /this domain may be for sale/i,
];
const comingSoonPatterns = [
  /coming soon/i,
  /under construction/i,
  /website (?:is )?(?:under development|coming soon)/i,
  /launching soon/i,
  /site is being (?:built|developed)/i,
];
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const unauthorized=await requireApiUser();
  if(unauthorized)return unauthorized;
  const body = (await req.json().catch(() => ({}))) as { domain?: unknown },
    domain =
      typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  if (
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain,
    )
  )
    return json({ error: 'Invalid domain' }, 400);
  try {
    let page;
    try {
      page = await safeFetch(`https://${domain}`, 8000, 750_000);
    } catch {
      page = await safeFetch(`http://${domain}`, 8000, 750_000);
    }
    const text = page.html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const websiteStatus =
      page.status >= 400 || !page.html || text.length < 80
        ? 'NO_WEBSITE'
        : parkedPatterns.some((p) => p.test(text))
          ? 'PARKED'
          : comingSoonPatterns.some((p) => p.test(text))
            ? 'COMING_SOON'
            : 'LIVE';
    return json({
      domain,
      websiteStatus,
      httpStatus: page.status,
      finalUrl: page.url,
    });
  } catch (error) {
    return json({
      domain,
      websiteStatus: 'NO_WEBSITE',
      reason:
        error instanceof Error
          ? error.message.slice(0, 160)
          : 'Website unreachable',
    });
  }
}
