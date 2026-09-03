# VYAVAS Domain Lead Hunter

## Scope and stack

This repository began empty, so the module is implemented as a standalone VYAVAS foundation using React 19, Vinext, TypeScript, Cloudflare Workers, D1/SQLite, Drizzle migrations and server-rendered API routes. The UI is an evidence-first operational dashboard. Existing CRM integration is represented by the `prospects` table and duplicate-safe mapping service; in a future merge, that adapter should target VYAVAS's canonical Prospect service.

Phase 1 implements Smet discovery, cheap filters, deterministic classification, public contact/location extraction, technology fingerprints, lead scoring, evidence, server-side pagination, details, settings, and duplicate-safe Prospect creation. It deliberately does not claim registry location, use private WHOIS data, bypass access controls, or send outreach.

## Architecture and data flow

```text
Scheduled/manual import
  -> DomainDiscoveryProvider (SmetDomainProvider)
  -> idempotent Domain + DomainDiscoveryEvent persistence
  -> cheap TLD/junk/keyword filter + discovery score
  -> qualified website-check jobs only
  -> SSRF-protected HTTP fetch with redirects, timeout and size ceiling
  -> deterministic public business/contact/location/technology extraction
  -> evidence records
  -> lead score (0–100) and qualification
  -> owner review
  -> duplicate-safe Prospect adapter
```

The discovery provider interface exposes `getTodayDomains`, `getDomainsForDate`, and `getRecentDomains`. `SmetDomainProvider` uses the documented public JSON feed. `WhoIsProviderAdapter` is only an interface seam: no endpoint or credential is invented.

For a production Node deployment, queue names are `domain-import`, `domain-filter`, `domain-website-check`, `domain-enrichment`, `domain-classification`, and `domain-lead-scoring`, backed by Redis/BullMQ. Every job ID should be derived from `source:source_date:normalized_domain:stage`, and processors must be upserts. This hosted Worker build exposes the same stage boundaries through idempotent APIs because raw Redis sockets and BullMQ are not compatible with the Cloudflare runtime. A queue adapter can replace that transport without changing domain logic.

## Database changes

- `domains`: discovery, filter, website, classification, public contacts, location confidence, score, and lifecycle state. Uniqueness is `(normalized_domain, source_date, source)`.
- `domain_discovery_events`: immutable provider observations, unique by domain/source/date.
- `domain_evidence`: value, confidence, public source URL and a bounded snippet.
- `technology_detections`: public fingerprint and confidence.
- `domain_hunter_settings`: editable filters and operational limits.
- `prospects`: standalone CRM target with unique-domain and email/phone/company duplicate checks.

Indexes cover the documented pagination and filter paths: date, TLD, website status, classification, location, lead score, lifecycle status, and creation time. The browser requests 50 records per page by default.

## API design

- `GET /api/domain-hunter/domains` — paginated filters (`page`, `limit`, `date`, `tld`, `country`, `city`, `classification`, `websiteStatus`, `status`, `minScore`, `q`).
- `GET /api/domain-hunter/domains/:id` — domain, technology and evidence detail.
- `POST /api/domain-hunter/import` — manual Smet import; accepts optional ISO `date` and bounded `limit`.
- `POST /api/domain-hunter/scan/:id` — protected public website scan and enrichment.
- `POST /api/domain-hunter/intelligence/:id` — public RDAP registration events plus Google DNS MX/SPF capability evidence. MX confirms mail capability, never an actual mailbox.
- `POST /api/domain-hunter/qualify/:id` — idempotent qualification entry point.
- `POST /api/domain-hunter/add-to-prospect/:id` — duplicate-safe CRM mapping.
- `GET /api/domain-hunter/stats` — database-derived daily dashboard totals.
- `GET|PATCH /api/domain-hunter/settings` — validated owner settings.

Daily scheduling should call the import endpoint, then enqueue only `QUEUED` records. Provider failures return 503 without deleting or changing prior data.

## Filtering and scoring

Cheap filtering runs before network activity. It rejects excluded TLDs, blocked adult/gambling terms and likely generated strings. Preferred TLD, business/IT/Shopify keywords, readability, length and absence of suspicious patterns form a discovery score. The threshold defaults to 30.

Lead scoring is independent: IT/software/agency +25; Shopify/e-commerce opportunity +20; active site +15; public business email +10; public phone +10; clear company identity +10; strong Delhi/NCR evidence +5; LinkedIn company presence +5. Parked, personal, suspicious and unavailable sites carry documented negative weights. Scores are clamped to 0–100.

Delhi/NCR requires the public page text to explicitly name Delhi, New Delhi, Gurgaon/Gurugram, Noida, Faridabad or Ghaziabad. `.in` and `+91` may support India only and never Delhi. Every location retains source and confidence; UI copy says “newly detected domain” and explicitly disclaims registration location.

## Scanning and security model

Only HTTP(S) is allowed. The crawler blocks localhost, internal names, loopback, private/link-local IPv4, private IPv6, and cloud metadata hosts before the first request and again at each redirect. Redirects are capped, request timeout defaults to 10 seconds, page bytes to 2 MB, and crawl scope to the documented public page set. JavaScript is never executed. Scripts/styles are removed before text extraction and raw HTML is not stored.

The scanner uses public HTML, headers, script URLs and metadata only. It does not authenticate, defeat CAPTCHA, bypass paywalls/privacy controls, or use hidden WHOIS. External content is untrusted and never interpolated as SQL. D1 prepared statements are used throughout. Credentials remain server-side.

## Implementation plan

1. Apply and verify the generated Drizzle migration.
2. Connect hosted scheduling/queue adapter; for Node infrastructure, use Redis/BullMQ with concurrency `DOMAIN_SCAN_CONCURRENCY=10`, two exponential-backoff retries and deterministic job IDs.
3. Import Smet in bounded batches, record events, and enqueue only domains above threshold.
4. Expand the crawler from homepage to robots-permitted `/about`, `/contact`, `/company`, `/services`, `/solutions`, `/privacy`, and `/terms`, capped at 10 pages.
5. Replace the standalone Prospect adapter when integrating into an existing VYAVAS repository.
6. Add daily digest/notifications after the underlying VYAVAS notification channel exists; never auto-message discovered contacts.

## Operational notes

Retention jobs may delete unqualified discovery records after 30/90/180/365 days but must preserve qualified leads and Prospects. Concurrency, timeouts, maximum pages, size, scoring thresholds, TLDs, keywords, retention, scan time and notifications belong in settings. Provider outages must surface as recoverable errors while existing results remain usable.
