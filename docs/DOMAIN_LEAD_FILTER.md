# VYAVAS Domain Lead Filter

## Phase 1 architecture

The module is available at `/domain-filter`. The browser receives an owner-selected `.xlsx`, `.xls`, or `.csv`, validates the file, detects the first worksheet headers, proposes semantic column mappings, and requires the owner to confirm those mappings before processing. Phase 1 performs deterministic normalization, privacy removal, domain and contact deduplication, invalid-record removal, business-intent scoring, location filtering, selection, and sanitized CSV/XLSX export.

The existing Domain Lead Hunter remains unchanged. Phase 1 is intentionally review-first and does not crawl websites or send outreach. Website checks, technology evidence, durable job storage, and Prospect import remain later phases.

## Processing pipeline

1. Validate extension and size (maximum 50 MB).
2. Parse the first worksheet without executing formulas or macros.
3. Auto-map domain, email, name, organization, country, state, city, phone, privacy, and creation date using normalized header aliases.
4. Normalize domains, emails, countries, phone display values, and dates.
5. Remove explicit privacy/proxy records without trying to recover protected details.
6. Reject malformed, internal, IP-address, test, and placeholder domains.
7. Deduplicate by normalized domain; flag repeated contact keys rather than multiplying exports.
8. Score agency relevance from domain readability, business/technology intent, contact quality, organization, and location evidence.
9. Filter and export the reviewed dataset. Original registration/discovery date is preserved separately from processing time.

## Security and performance

Files are treated as untrusted. Only supported extensions are accepted, macros are never executed, and exported cells beginning with `=`, `+`, `-`, or `@` are prefixed to prevent spreadsheet formula injection. Privacy-protected records are discarded from the lead dataset. Parsing and scoring yield between batches so progress remains visible. The current Cloudflare Worker memory limit makes durable server-side processing of very large Excel archives inappropriate; Phase 1 therefore processes owner-selected files locally in the module and exports the reviewed result. A production background pipeline should upload originals to R2, persist job/row metadata in D1, and process converted CSV chunks outside the request lifecycle.

## API and persistence roadmap

Phase 1 requires no new public ingestion API and does not store the uploaded source file. Phase 4 will add idempotent bulk Prospect import using normalized email, phone, domain, and company matching. Durable import history should use D1; raw uploads and generated export archives should use R2.

## UI

The workflow is Upload → Mapping → Qualified leads. Filters cover search, country, state, score, email availability, and phone availability. Results default to score 60 or higher and are sorted descending by score.

## Lead scoring

The deterministic Phase 1 score rewards readable business domains, agency/technology/e-commerce keywords, registrant organization, valid business or free-provider email, phone availability, and explicit file location. Random strings, excessive digits/hyphens, invalid data, and privacy records are removed or penalized. Phase 2 will add website status and classification evidence without changing the preserved source date.

