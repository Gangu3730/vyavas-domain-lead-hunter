'use client';
/* eslint-disable jsx-a11y/label-has-associated-control -- Base UI checkbox is wrapped by the visible label. */
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Globe2,
  LoaderCircle,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
type Field =
  | 'domain'
  | 'email'
  | 'name'
  | 'organization'
  | 'country'
  | 'state'
  | 'city'
  | 'phone'
  | 'privacy'
  | 'createdDate';
type Mapping = Record<Field, string>;
type Row = Record<string, unknown>;
type WS =
  | 'UNSCANNED'
  | 'SCANNING'
  | 'LIVE'
  | 'PARKED'
  | 'COMING_SOON'
  | 'NO_WEBSITE'
  | 'ERROR';
type Lead = {
  id: number;
  domain: string;
  email: string;
  emailType: string;
  name: string;
  company: string;
  country: string;
  state: string;
  city: string;
  phone: string;
  createdDate: string;
  score: number;
  category: string;
  type: string;
  duplicateContact: boolean;
  websiteStatus: WS;
  itExcluded: boolean;
};
type Summary = {
  total: number;
  privacy: number;
  duplicates: number;
  invalid: number;
  qualified: number;
  liveRejected: number;
  itRejected: number;
  noContact: number;
};
const fields: Field[] = [
  'domain',
  'email',
  'name',
  'organization',
  'country',
  'state',
  'city',
  'phone',
  'privacy',
  'createdDate',
];
const labels: Record<Field, string> = {
  domain: 'Domain',
  email: 'Email',
  name: 'Contact name',
  organization: 'Organization',
  country: 'Country',
  state: 'State / region',
  city: 'City',
  phone: 'Phone',
  privacy: 'Privacy flag',
  createdDate: 'Created / discovery date',
};
const aliases: Record<Field, string[]> = {
  domain: ['domain', 'domainname', 'domain_name', 'website', 'url'],
  email: ['email', 'emailaddress', 'registrantemail', 'registrant_email'],
  name: ['name', 'registrantname', 'registrant_name'],
  organization: [
    'organization',
    'company',
    'registrantcompany',
    'registrant_company',
  ],
  country: [
    'country',
    'countrycode',
    'registrantcountry',
    'registrant_country',
  ],
  state: ['state', 'region', 'province', 'registrantstate', 'registrant_state'],
  city: ['city', 'registrantcity', 'registrant_city'],
  phone: ['phone', 'telephone', 'registrantphone', 'registrant_phone'],
  privacy: ['privacy', 'proxy', 'redacted', 'whoisprivacy'],
  createdDate: [
    'createddate',
    'created_date',
    'creationdate',
    'registrationdate',
    'discoverydate',
    'create_date',
  ],
};
const freeMail = [
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'yahoo.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
];
const privacyWords = [
  'redacted for privacy',
  'withheld for privacy',
  'domains by proxy',
  'contact privacy',
  'whois privacy',
  'privacy service',
  'data protected',
  'identity protection',
  'private registration',
];
const itWords = [
  'software',
  'technology',
  'technologies',
  'tech',
  'digital',
  'agency',
  'web',
  'website',
  'developer',
  'development',
  'hosting',
  'cloud',
  'saas',
  'automation',
  'marketing agency',
  'it solutions',
  'it services',
  'app development',
];
const autoCountries = [
  'United States',
  'United Arab Emirates',
  'Canada',
  'Australia',
  'India',
];
const emptySummary: Summary = {
  total: 0,
  privacy: 0,
  duplicates: 0,
  invalid: 0,
  qualified: 0,
  liveRejected: 0,
  itRejected: 0,
  noContact: 0,
};
const clean = (v: unknown) =>
  v == null
    ? ''
    : v instanceof Date
      ? v.toISOString()
      : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? String(v).trim()
        : '';
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const safeCell = (v: unknown) => {
  const s = clean(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
};
const normalizeDomain = (v: unknown) =>
  clean(v)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/\.$/, '');
const normalizeCountry = (v: unknown) => {
  const s = clean(v),
    k = s.toLowerCase().replaceAll('.', '');
  if (['us', 'usa', 'united states', 'united states of america'].includes(k))
    return 'United States';
  if (['uae', 'ae', 'united arab emirates'].includes(k))
    return 'United Arab Emirates';
  if (['ca', 'can', 'canada'].includes(k)) return 'Canada';
  if (['au', 'aus', 'australia'].includes(k)) return 'Australia';
  if (['in', 'ind', 'india'].includes(k)) return 'India';
  return s;
};
const validDomain = (d: string) =>
  /^(?=.{4,253}$)(?!.*\.\.)(?!\d+\.\d+\.\d+\.\d+$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
    d,
  );
const validEmail = (e: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function autoMap(headers: string[]): Mapping {
  return Object.fromEntries(
    fields.map((f) => [
      f,
      headers.find((h) => aliases[f].includes(key(h))) ??
        headers.find((h) => aliases[f].some((a) => key(h).includes(key(a)))) ??
        '',
    ]),
  ) as Mapping;
}
function isIt(domain: string, company: string) {
  const text = `${domain.split('.')[0].replace(/[-_]/g, ' ')} ${company}`;
  return itWords.some((w) =>
    new RegExp(`(^|[^a-z])${w.replaceAll(' ', '\\s+')}([^a-z]|$)`, 'i').test(
      text,
    ),
  );
}
function classify(domain: string, company: string) {
  if (isIt(domain, company)) return 'IT / DIGITAL — EXCLUDED';
  const t = `${domain} ${company}`.toLowerCase();
  if (/real.?estate|realty|property/.test(t)) return 'REAL ESTATE';
  if (/clinic|health|dental|hospital/.test(t)) return 'HEALTHCARE';
  if (/restaurant|cafe|food|hotel/.test(t)) return 'HOSPITALITY';
  if (/shop|store|commerce|retail/.test(t)) return 'RETAIL / E-COMMERCE';
  return 'NON-IT BUSINESS';
}
function score(
  domain: string,
  email: string,
  company: string,
  phone: string,
  country: string,
) {
  let n = 0;
  const base = domain.split('.')[0],
    host = email.split('@')[1] ?? '';
  if (email) n += freeMail.includes(host) ? 45 : 30;
  if (phone) n += 25;
  if (email && phone) n += 10;
  if (company) n += 8;
  if (country) n += 5;
  if (base.length >= 5 && base.length <= 24) n += 5;
  if (!/\d{4,}/.test(base)) n += 4;
  if ((base.match(/-/g) || []).length <= 1) n += 3;
  return Math.min(100, n);
}
const accepted = (x: Lead) =>
  ['PARKED', 'COMING_SOON', 'NO_WEBSITE'].includes(x.websiteStatus) &&
  !x.itExcluded &&
  Boolean(x.email || x.phone);
function parseCsv(text: string) {
  const grid: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(Boolean)) grid.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some(Boolean)) grid.push(row);
  const headers = grid.shift() ?? [];
  return {
    headers,
    rows: grid.map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])),
    ),
  };
}
export function DomainLeadFilter() {
  const stopScan = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Mapping>(autoMap([]));
  const [stage, setStage] = useState<'upload' | 'mapping' | 'results'>(
    'upload',
  );
  const [progress, setProgress] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [query, setQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('all');
  const [focusCountries, setFocusCountries] = useState<Set<string>>(
    new Set(autoCountries),
  );
  const [minScore, setMinScore] = useState('60');
  const [emailOnly, setEmailOnly] = useState(false);
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  async function choose(f?: File) {
    if (!f) return;
    setError('');
    if (!/\.(xlsx|xls|csv)$/i.test(f.name) || f.size > 50 * 1024 * 1024) {
      setError('Choose an Excel/CSV file up to 50 MB.');
      return;
    }
    try {
      let parsed: { headers: string[]; rows: Row[] };
      if (f.name.toLowerCase().endsWith('.csv'))
        parsed = parseCsv(await f.text());
      else {
        const ExcelJS = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('Workbook has no worksheet');
        const hs = (ws.getRow(1).values as unknown[]).slice(1).map(clean),
          rs: Row[] = [];
        ws.eachRow((r, n) => {
          if (n === 1) return;
          const values = (r.values as unknown[]).slice(1);
          rs.push(
            Object.fromEntries(
              hs.map((h, i) => [
                h,
                values[i] instanceof Object &&
                values[i] &&
                'text' in (values[i] as object)
                  ? clean((values[i] as { text?: unknown }).text)
                  : values[i],
              ]),
            ),
          );
        });
        parsed = { headers: hs, rows: rs };
      }
      setFile(f);
      setHeaders(parsed.headers);
      setRaw(parsed.rows);
      setMapping(autoMap(parsed.headers));
      setStage('mapping');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  }
  async function process() {
    if (!mapping.domain) {
      setError('Map the Domain column before continuing.');
      return;
    }
    setProgress(1);
    const out: Lead[] = [],
      seen = new Set<string>();
    const s = { ...emptySummary, total: raw.length };
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i],
        domain = normalizeDomain(r[mapping.domain]),
        email = clean(r[mapping.email]).toLowerCase(),
        name = clean(r[mapping.name]),
        company = clean(r[mapping.organization]),
        phone = clean(r[mapping.phone]),
        country = normalizeCountry(r[mapping.country]),
        state = clean(r[mapping.state]),
        city = clean(r[mapping.city]),
        createdDate = clean(r[mapping.createdDate]).slice(0, 10),
        privateText = [r[mapping.privacy], name, company, email]
          .map(clean)
          .join(' ')
          .toLowerCase();
      if (
        privacyWords.some((w) => privateText.includes(w)) ||
        /^(true|yes|1)$/i.test(clean(r[mapping.privacy]))
      ) {
        s.privacy++;
        continue;
      }
      if (!validDomain(domain) || !validEmail(email)) {
        s.invalid++;
        continue;
      }
      if (seen.has(domain)) {
        s.duplicates++;
        continue;
      }
      seen.add(domain);
      const itExcluded = isIt(domain, company),
        n = score(domain, email, company, phone, country);
      if (itExcluded) s.itRejected++;
      if (!email && !phone) s.noContact++;
      out.push({
        id: i + 1,
        domain,
        email,
        emailType: email
          ? freeMail.includes(email.split('@')[1] ?? '')
            ? 'FREE_PROVIDER'
            : 'BUSINESS_DOMAIN'
          : 'NONE',
        name,
        company,
        country,
        state,
        city,
        phone,
        createdDate,
        score: n,
        category:
          n >= 90
            ? 'HOT'
            : n >= 75
              ? 'HIGH'
              : n >= 60
                ? 'MEDIUM'
                : n >= 40
                  ? 'LOW'
                  : 'REJECT',
        type: classify(domain, company),
        duplicateContact: false,
        websiteStatus: 'UNSCANNED',
        itExcluded,
      });
      if (i % 2000 === 0) {
        setProgress(Math.round((i / raw.length) * 100));
        await new Promise(requestAnimationFrame);
      }
    }
    const sorted = out.sort((a, b) => b.score - a.score);
    setSummary(s);
    setLeads(sorted);
    setProgress(100);
    setStage('results');
    const automatic = sorted.filter(
      (x) => autoCountries.includes(x.country) && !x.itExcluded && (x.email || x.phone),
    );
    if (automatic.length) void scanWebsites(automatic, true);
  }
  const candidates = useMemo(
    () =>
      leads.filter(
        (x) =>
          x.websiteStatus === 'UNSCANNED' &&
          !x.itExcluded &&
          (x.email || x.phone),
      ),
    [leads],
  );
  const automaticWaiting = useMemo(
    () => candidates.filter((x) => autoCountries.includes(x.country)).length,
    [candidates],
  );
  const otherCandidates = useMemo(
    () => candidates.filter((x) => !autoCountries.includes(x.country)),
    [candidates],
  );
  const countries = useMemo(
    () => [...new Set(leads.map((x) => x.country).filter(Boolean))].sort(),
    [leads],
  );
  const filtered = useMemo(
    () =>
      leads.filter(
        (x) =>
          accepted(x) &&
          x.score >= Number(minScore) &&
          (focusCountries.size === 0 || focusCountries.has(x.country)) &&
          (countryFilter === 'all' || x.country === countryFilter) &&
          (!emailOnly || !!x.email) &&
          (!phoneOnly || !!x.phone) &&
          `${x.domain} ${x.company} ${x.email} ${x.city}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [leads, minScore, focusCountries, countryFilter, emailOnly, phoneOnly, query],
  );
  async function scanWebsites(source?: Lead[], automatic = false) {
    const pool = source ?? (selected.size ? leads.filter((x) => selected.has(x.id)) : otherCandidates);
    const eligible = pool
      .filter(
        (x) =>
          x.websiteStatus === 'UNSCANNED' &&
          !x.itExcluded &&
          (x.email || x.phone),
      );
    const batch = automatic ? eligible : eligible.slice(0, 100);
    if (!batch.length) {
      setError('Select unscanned contactable records first.');
      return;
    }
    setScanning(true);
    stopScan.current = false;
    setError('');
    setScanProgress({ done: 0, total: batch.length });
    let done = 0;
    const queue = [...batch];
    const worker = async () => {
      while (queue.length) {
        if (stopScan.current) break;
        const lead = queue.shift();
        if (!lead) break;
        setLeads((p) =>
          p.map((x) =>
            x.id === lead.id ? { ...x, websiteStatus: 'SCANNING' } : x,
          ),
        );
        let websiteStatus: WS = 'ERROR';
        try {
          const r = await fetch('/api/domain-filter/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: lead.domain }),
          });
          const d = (await r.json()) as { websiteStatus?: WS };
          if (r.ok && d.websiteStatus) websiteStatus = d.websiteStatus;
        } catch {}
        setLeads((p) =>
          p.map((x) => (x.id === lead.id ? { ...x, websiteStatus } : x)),
        );
        setScanProgress({ done: ++done, total: batch.length });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(5, batch.length) }, worker),
    );
    setLeads((p) => {
      setSummary((s) => ({
        ...s,
        qualified: p.filter(accepted).length,
        liveRejected: p.filter((x) => x.websiteStatus === 'LIVE').length,
      }));
      return p;
    });
    setScanning(false);
  }
  function toggle(id: number) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function exportCsv() {
    const data = selected.size
        ? filtered.filter((x) => selected.has(x.id))
        : filtered,
      cols = [
        'domain',
        'websiteStatus',
        'company',
        'name',
        'email',
        'emailType',
        'phone',
        'country',
        'state',
        'city',
        'type',
        'score',
        'category',
        'createdDate',
      ];
    const csv = [
      cols.join(','),
      ...data.map((r) =>
        cols
          .map((c) => `"${safeCell(r[c as keyof Lead]).replaceAll('"', '""')}"`)
          .join(','),
      ),
    ].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'vyavas-qualified-domain-leads.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function exportExcel() {
    const data = selected.size
      ? filtered.filter((x) => selected.has(x.id))
      : filtered;
    const ExcelJS = await import('exceljs'),
      wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet('Qualified Leads');
    ws.columns = [
      ['Domain', 'domain'],
      ['Website Status', 'websiteStatus'],
      ['Company', 'company'],
      ['Contact', 'name'],
      ['Email', 'email'],
      ['Email Type', 'emailType'],
      ['Phone', 'phone'],
      ['Country', 'country'],
      ['State', 'state'],
      ['City', 'city'],
      ['Business Type', 'type'],
      ['Lead Score', 'score'],
      ['Category', 'category'],
      ['Discovery Date', 'createdDate'],
    ].map(([header, key]) => ({ header, key, width: 20 }));
    data.forEach((r) =>
      ws.addRow(
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])),
      ),
    );
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B1D32' },
    };
    const bytes = await wb.xlsx.writeBuffer(),
      a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = 'vyavas-qualified-domain-leads.xlsx';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#142033]">
      <header className="bg-[#0b1d32] text-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-5">
          <div>
            <Link
              href="/"
              className="mb-2 inline-flex items-center gap-2 text-sm text-slate-400"
            >
              <ArrowLeft className="size-4" />
              Domain Lead Hunter
            </Link>
            <h1 className="text-2xl font-bold">No-Website Lead Filter</h1>
            <p className="text-sm text-slate-400">
              Live website reject · IT business reject · free email first
            </p>
          </div>
          <div className="rounded-xl border border-white/10 px-4 py-3 text-sm">
            <ShieldCheck className="mr-2 inline size-4 text-emerald-400" />
            Privacy records removed
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] p-5 sm:p-8">
        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {stage === 'upload' && (
          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void choose(e.dataTransfer.files[0]);
            }}
            className="mx-auto mt-10 max-w-3xl rounded-3xl border-2 border-dashed bg-white p-12 text-center"
          >
            <Upload className="mx-auto size-10 text-emerald-600" />
            <h2 className="mt-5 text-2xl font-bold">Upload domain file</h2>
            <p className="mt-2 text-slate-500">
              Excel या CSV drag करें। Maximum 50 MB.
            </p>
            <input
              ref={input}
              hidden
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button
              onClick={() => input.current?.click()}
              className="mt-6 bg-[#0b1d32]"
            >
              <FileSpreadsheet className="mr-2 size-4" />
              Choose file
            </Button>
          </section>
        )}
        {stage === 'mapping' && (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <section className="rounded-2xl border bg-white p-6">
              <h2 className="text-xl font-bold">Confirm column mapping</h2>
              <p className="text-sm text-slate-500">
                {headers.length} columns · {raw.length.toLocaleString()} rows ·{' '}
                {file?.name}
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <label key={f} className="space-y-2 text-sm font-semibold">
                    <span>
                      {labels[f]}
                      {f === 'domain' && ' *'}
                    </span>
                    <Select
                      value={mapping[f] || 'none'}
                      onValueChange={(v) =>
                        setMapping((m) => ({
                          ...m,
                          [f]: v === 'none' ? '' : v,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not mapped</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ))}
              </div>
              <Button
                onClick={() => void process()}
                className="mt-7 bg-[#0b1d32]"
              >
                Continue & process
              </Button>
              {progress > 0 && (
                <div className="mt-6">
                  <Progress value={progress} />
                  <p className="mt-2 text-sm">Processing {progress}%</p>
                </div>
              )}
            </section>
            <aside className="rounded-2xl border bg-white p-5">
              <h3 className="font-bold">Hard gates</h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                <li>Live professional website → Reject</li>
                <li>IT / software / digital agency → Reject</li>
                <li>No email and no phone → Reject</li>
                <li>Free email → Highest priority</li>
              </ul>
            </aside>
          </div>
        )}
        {stage === 'results' && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {[
                ['Uploaded', summary.total],
                ['Privacy removed', summary.privacy],
                ['IT rejected', summary.itRejected],
                ['No contact', summary.noContact],
                ['Live rejected', summary.liveRejected],
                ['Qualified', summary.qualified],
              ].map(([l, v]) => (
                <div
                  key={String(l)}
                  className="rounded-2xl border bg-white p-4"
                >
                  <div className="text-sm text-slate-500">{l}</div>
                  <div className="mt-2 text-2xl font-bold">
                    {Number(v).toLocaleString()}
                  </div>
                </div>
              ))}
            </section>
            <section className="mt-6 rounded-2xl border bg-white">
              <div className="border-b bg-emerald-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-emerald-950">Automatic country workflow</h3>
                    <p className="mt-1 text-sm text-emerald-800">USA, UAE, Canada, Australia and India start scanning automatically after upload.</p>
                  </div>
                  <Badge className="bg-emerald-700 text-white">{automaticWaiting.toLocaleString()} priority records waiting</Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {autoCountries.map((country) => <label key={country} className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium"><Checkbox checked={focusCountries.has(country)} onCheckedChange={(checked)=>setFocusCountries(current=>{const next=new Set(current);if(checked)next.add(country);else next.delete(country);return next})}/>{country}</label>)}
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium"><Checkbox checked={focusCountries.size===0} onCheckedChange={(checked)=>{if(checked)setFocusCountries(new Set())}}/>Other / all countries</label>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-b p-5">
                <div className="relative min-w-56 flex-1">
                  <Search className="absolute left-3 top-3 size-4 text-slate-400" />
                  <Input
                    className="pl-9"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search qualified leads"
                  />
                </div>
                <Select
                  value={countryFilter}
                  onValueChange={(v) => v && setCountryFilter(v)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All countries</SelectItem>
                    {countries.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={minScore}
                  onValueChange={(v) => v && setMinScore(v)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['40', '60', '75', '90'].map((v) => (
                      <SelectItem key={v} value={v}>
                        Score ≥ {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex gap-2 text-sm">
                  <Checkbox
                    checked={emailOnly}
                    onCheckedChange={(v) => setEmailOnly(Boolean(v))}
                  />
                  Email
                </label>
                <label className="flex gap-2 text-sm">
                  <Checkbox
                    checked={phoneOnly}
                    onCheckedChange={(v) => setPhoneOnly(Boolean(v))}
                  />
                  Phone
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                <span className="text-sm text-slate-500">
                  {filtered.length.toLocaleString()} qualified ·{' '}
                  {otherCandidates.length.toLocaleString()} other-country records waiting for manual check
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={scanning || !otherCandidates.length}
                    onClick={() => void scanWebsites()}
                  >
                    {scanning ? (
                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Globe2 className="mr-2 size-4" />
                    )}
                    {scanning
                      ? `${scanProgress.done}/${scanProgress.total}`
                      : 'Check other countries: next 100'}
                  </Button>
                  {scanning && <Button variant="destructive" onClick={()=>{stopScan.current=true}}>Stop automatic scan</Button>}
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSelected(
                        new Set(otherCandidates.slice(0, 100).map((x) => x.id)),
                      )
                    }
                  >
                    Select other-country 100
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!filtered.length}
                    onClick={exportCsv}
                  >
                    <Download className="mr-2 size-4" />
                    CSV
                  </Button>
                  <Button
                    disabled={!filtered.length}
                    onClick={() => void exportExcel()}
                    className="bg-[#0b1d32]"
                  >
                    <Download className="mr-2 size-4" />
                    Excel
                  </Button>
                </div>
              </div>
              <div className="border-b bg-amber-50 p-3 text-sm text-amber-800">
                Unscanned domains are not leads. Only no-website, parked, and
                coming-soon records appear below.
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead>Domain / company</TableHead>
                      <TableHead>Website gate</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Business type</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 100).map((x) => (
                      <TableRow key={x.id}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(x.id)}
                            onCheckedChange={() => toggle(x.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <b>{x.domain}</b>
                          <div className="text-xs text-slate-400">
                            {x.company || 'No company'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-emerald-100 text-emerald-700">
                            {x.websiteStatus.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {x.email || 'No email'}
                          <div className="text-xs text-slate-400">
                            {x.phone || x.emailType}
                          </div>
                        </TableCell>
                        <TableCell>
                          {[x.city, x.state, x.country]
                            .filter(Boolean)
                            .join(', ') || 'Unknown'}
                        </TableCell>
                        <TableCell>{x.type}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              x.emailType === 'FREE_PROVIDER'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-amber-100 text-amber-700'
                            }
                          >
                            {x.score} · {x.category}
                          </Badge>
                          <div className="text-xs text-slate-400">
                            {x.emailType === 'FREE_PROVIDER'
                              ? 'Free email priority'
                              : 'Custom email / phone'}
                          </div>
                        </TableCell>
                        <TableCell>{x.createdDate || 'Unknown'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between border-t p-4 text-sm text-slate-500">
                <span>
                  Showing first {Math.min(100, filtered.length)} qualified rows.
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStage('upload');
                    setRaw([]);
                    setLeads([]);
                    setSummary(emptySummary);
                  }}
                >
                  <XCircle className="mr-2 size-4" />
                  New file
                </Button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
