'use client';
/* eslint-disable jsx-a11y/label-has-associated-control -- labels wrap Base UI controls */
/* eslint-disable react/EffectSetState -- session storage hydrates the client-owned campaign draft */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  Pause,
  Play,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
type Recipient = {
  domain: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  country: string;
};
const defaultHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto"><p>Hi {{first_name}},</p><p>I noticed that <strong>{{company}}</strong> recently registered <strong>{{domain}}</strong>, but a complete website is not live yet.</p><p>We can help you launch a professional website for your business.</p><p>Would you like to see a quick proposal?</p><p>Regards,<br>VYAVAS Team</p><p style="font-size:12px;color:#64748b">If you do not want further emails, reply with “unsubscribe”.</p></div>`;
const replaceVars = (html: string, r?: Recipient) =>
  html
    .replaceAll('{{first_name}}', r?.firstName || 'there')
    .replaceAll('{{last_name}}', r?.lastName || '')
    .replaceAll('{{company}}', r?.company || 'your business')
    .replaceAll('{{domain}}', r?.domain || 'your domain')
    .replaceAll('{{country}}', r?.country || '');
export function SuperAdmin() {
  const [recipients, setRecipients] = useState<Recipient[]>([]),
    [provider, setProvider] = useState<'hostinger' | 'gmail'>('hostinger'),
    [subject, setSubject] = useState('Website idea for {{domain}}'),
    [html, setHtml] = useState(defaultHtml),
    [minDelay, setMinDelay] = useState(45),
    [maxDelay, setMaxDelay] = useState(120),
    [dailyLimit, setDailyLimit] = useState(200),
    [hourlyLimit, setHourlyLimit] = useState(30),
    [tracking, setTracking] = useState(false),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    try {
      const data = JSON.parse(
        sessionStorage.getItem('vyavas_campaign_recipients') || '[]',
      ) as Recipient[];
      queueMicrotask(() => setRecipients(Array.isArray(data) ? data : []));
    } catch {
      queueMicrotask(() => setRecipients([]));
    }
  }, []);
  const valid = useMemo(
    () => recipients.filter((r) => /^\S+@\S+\.\S+$/.test(r.email)),
    [recipients],
  );
  const sample = valid[0];
  const preset =
    provider === 'hostinger'
      ? { host: 'smtp.hostinger.com', port: '465', auth: 'Mailbox password' }
      : { host: 'smtp.gmail.com', port: '465', auth: 'Google App Password' };
  const cards: { Icon: LucideIcon; label: string; value: string | number }[] = [
    { Icon: Users, label: 'Recipients', value: valid.length },
    {
      Icon: Mail,
      label: 'Email provider',
      value: provider === 'gmail' ? 'Gmail' : 'Hostinger',
    },
    { Icon: Clock3, label: 'Random delay', value: `${minDelay}–${maxDelay}s` },
    { Icon: CheckCircle2, label: 'Daily cap', value: dailyLimit },
  ];
  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <header className="bg-[#0b1d32] text-white">
        <div className="mx-auto flex max-w-[1450px] items-center justify-between px-6 py-5">
          <div>
            <Link
              href="/domain-filter"
              className="inline-flex items-center gap-2 text-sm text-slate-400"
            >
              <ArrowLeft className="size-4" />
              Lead Filter
            </Link>
            <h1 className="mt-1 text-2xl font-bold">VYAVAS Super Admin</h1>
          </div>
          <Badge className="bg-emerald-500/20 text-emerald-200">
            <ShieldCheck className="mr-2 size-4" />
            Owner-only workspace
          </Badge>
        </div>
      </header>
      <main className="mx-auto max-w-[1450px] p-6">
        <section className="mb-6 grid gap-4 sm:grid-cols-4">
          {cards.map(({ Icon, label, value }) => (
            <div
              key={String(label)}
              className="rounded-2xl border bg-white p-4"
            >
              <Icon className="size-5 text-sky-600" />
              <div className="mt-3 text-sm text-slate-500">{label}</div>
              <div className="mt-1 text-xl font-bold">{String(value)}</div>
            </div>
          ))}
        </section>
        <Tabs defaultValue="email">
          <TabsList className="mb-5 h-11 bg-white p-1 shadow-sm">
            <TabsTrigger value="email" className="px-5">
              <Mail />
              Bulk Email
            </TabsTrigger>
            <TabsTrigger value="smtp" className="px-5">
              <Server />
              SMTP Setup
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="px-5">
              <MessageCircle />
              WhatsApp
            </TabsTrigger>
          </TabsList>
          <TabsContent value="email">
            <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
              <section className="rounded-2xl border bg-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">Email campaign</h2>
                    <p className="text-sm text-slate-500">
                      Filtered qualified leads are loaded automatically.
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {valid.length.toLocaleString()} valid emails
                  </Badge>
                </div>
                <label className="mt-6 block text-sm font-semibold">
                  Subject
                  <Input
                    className="mt-2"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label className="mt-5 block text-sm font-semibold">
                  HTML email template
                  <Textarea
                    className="mt-2 min-h-80 font-mono text-sm"
                    value={html}
                    onChange={(e) => setHtml(e.target.value)}
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {[
                    '{{first_name}}',
                    '{{last_name}}',
                    '{{company}}',
                    '{{domain}}',
                    '{{country}}',
                  ].map((v) => (
                    <button
                      key={v}
                      onClick={() => setHtml((h) => h + v)}
                      className="rounded-md bg-slate-100 px-2 py-1 font-mono"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Minimum delay (seconds)
                    <Input
                      type="number"
                      min={30}
                      value={minDelay}
                      onChange={(e) =>
                        setMinDelay(Math.max(30, Number(e.target.value)))
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Maximum delay (seconds)
                    <Input
                      type="number"
                      min={minDelay}
                      value={maxDelay}
                      onChange={(e) =>
                        setMaxDelay(Math.max(minDelay, Number(e.target.value)))
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Hourly limit
                    <Input
                      type="number"
                      min={1}
                      value={hourlyLimit}
                      onChange={(e) =>
                        setHourlyLimit(Math.max(1, Number(e.target.value)))
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Daily limit
                    <Input
                      type="number"
                      min={1}
                      value={dailyLimit}
                      onChange={(e) =>
                        setDailyLimit(Math.max(1, Number(e.target.value)))
                      }
                    />
                  </label>
                </div>
                <div className="mt-5 flex items-center justify-between rounded-xl border bg-slate-50 p-4">
                  <div>
                    <div className="font-semibold">Open/click tracking</div>
                    <div className="text-xs text-slate-500">
                      Off by default for privacy and deliverability.
                    </div>
                  </div>
                  <Switch checked={tracking} onCheckedChange={setTracking} />
                </div>
                <div className="mt-6 flex gap-3">
                  <Button
                    disabled={!valid.length}
                    onClick={() => setPaused(!paused)}
                    className="bg-[#0b1d32]"
                  >
                    {paused ? (
                      <Play className="mr-2 size-4" />
                    ) : (
                      <Pause className="mr-2 size-4" />
                    )}
                    {paused ? 'Resume draft' : 'Pause draft'}
                  </Button>
                  <Button variant="outline" disabled>
                    Start sending after server SMTP setup
                  </Button>
                </div>
              </section>
              <aside className="rounded-2xl border bg-white p-6">
                <h3 className="font-bold">Live preview</h3>
                <div className="mt-2 text-sm text-slate-500">
                  Subject: {replaceVars(subject, sample)}
                </div>
                <iframe
                  title="Email HTML preview"
                  sandbox=""
                  className="mt-4 h-[480px] w-full rounded-xl border bg-white"
                  srcDoc={replaceVars(html, sample)}
                />
                <p className="mt-4 text-xs text-slate-500">
                  Sample: {sample?.email || 'No recipient selected'}
                </p>
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="smtp">
            <section className="max-w-3xl rounded-2xl border bg-white p-6">
              <h2 className="text-xl font-bold">SMTP server configuration</h2>
              <p className="mt-1 text-sm text-slate-500">
                These values are deployment settings. Passwords must be stored
                as server secrets, never in campaign data.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button
                  variant={provider === 'hostinger' ? 'default' : 'outline'}
                  onClick={() => setProvider('hostinger')}
                >
                  Hostinger
                </Button>
                <Button
                  variant={provider === 'gmail' ? 'default' : 'outline'}
                  onClick={() => setProvider('gmail')}
                >
                  Gmail
                </Button>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  SMTP host
                  <Input className="mt-2" value={preset.host} readOnly />
                </label>
                <label className="text-sm font-semibold">
                  Port
                  <Input className="mt-2" value={preset.port} readOnly />
                </label>
                <label className="text-sm font-semibold">
                  Username / sender email
                  <Input
                    className="mt-2"
                    placeholder="Add on your server"
                    readOnly
                  />
                </label>
                <label className="text-sm font-semibold">
                  Authentication
                  <Input className="mt-2" value={preset.auth} readOnly />
                </label>
              </div>
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Actual SMTP connection activates after deployment to your
                Node.js server. Gmail requires 2-Step Verification and an App
                Password.
              </div>
            </section>
          </TabsContent>
          <TabsContent value="whatsapp">
            <section className="max-w-3xl rounded-2xl border bg-white p-8">
              <MessageCircle className="size-9 text-emerald-600" />
              <h2 className="mt-4 text-xl font-bold">
                Meta WhatsApp campaigns
              </h2>
              <p className="mt-2 text-slate-600">
                The campaign workspace is reserved for Meta Cloud API. Later you
                can add Phone Number ID, Business Account ID, access token and
                approved templates.
              </p>
              <div className="mt-6 rounded-xl border bg-slate-50 p-4 text-sm">
                Bulk sending stays disabled until Meta credentials and an
                approved message template are connected.
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
