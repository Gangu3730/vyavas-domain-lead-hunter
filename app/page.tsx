import Link from 'next/link';
import {ArrowRight,CheckCircle2,FileSpreadsheet,Globe2,Mail,ShieldCheck,Sparkles,Target,Users,Zap} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {chatGPTSignInPath,getChatGPTUser} from '@/app/chatgpt-auth';

export const dynamic='force-dynamic';
const benefits=[
  ['Find real opportunities','Keep parked, coming-soon and no-website domains while rejecting already-built sites.',Target],
  ['Clean every dataset','Remove duplicates, registrar contacts, disposable emails and businesses you exclude.',ShieldCheck],
  ['Reach the right prospect','Approve leads with useful name, email, phone and location data before outreach.',Mail],
] as const;

export default async function Home(){
  const user=await getChatGPTUser();
  const actionHref=user?'/workspace':chatGPTSignInPath('/workspace');
  return <main className="min-h-screen bg-[#f3f7fb] text-[#142237]">
    <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-xl"><div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
      <Link href="/" className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#0b223b] text-[#50e3b2]"><Zap className="size-5"/></span><div><div className="text-lg font-black tracking-[.16em]">VYAVAS</div><div className="text-[11px] font-semibold uppercase tracking-[.18em] text-slate-400">Domain Lead Hunter</div></div></Link>
      <a href={actionHref} target={user?undefined:'_top'}><Button className="bg-[#0b223b] px-5 hover:bg-[#153b5f]">{user?'Open workspace':'Login'}<ArrowRight className="ml-2 size-4"/></Button></a>
    </div></header>
    <section className="relative overflow-hidden bg-[#091b30] text-white"><div className="absolute -right-24 -top-32 size-[34rem] rounded-full bg-[#50e3b2]/10 blur-3xl"/><div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-28">
      <div><div className="inline-flex items-center gap-2 rounded-full border border-[#50e3b2]/25 bg-[#50e3b2]/10 px-4 py-2 text-sm font-semibold text-[#79f0c8]"><Sparkles className="size-4"/>From new domain to qualified prospect</div><h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">Find businesses that have a domain—but still need a website.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">Import domain registration data, process only the countries you select, remove weak contacts and turn qualified leads into an outreach-ready pipeline.</p><div className="mt-8 flex flex-wrap items-center gap-4"><a href={actionHref} target={user?undefined:'_top'}><Button size="lg" className="h-12 bg-[#50e3b2] px-6 font-bold text-[#082036] hover:bg-[#70ebc4]">{user?'Go to workspace':'Login to VYAVAS'}<ArrowRight className="ml-2 size-5"/></Button></a><span className="text-sm text-slate-400">Secure access · Saved datasets · Role controls</span></div></div>
      <div className="rounded-3xl border border-white/10 bg-white/[.06] p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-7"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-400">Lead processing pipeline</p><h2 className="mt-1 text-xl font-bold">Today&apos;s workflow</h2></div><span className="rounded-full bg-[#50e3b2]/15 px-3 py-1 text-sm font-bold text-[#79f0c8]">Ready</span></div><div className="mt-7 space-y-3">{[[FileSpreadsheet,'Upload dataset','CSV or Excel'],[Globe2,'Process selected countries','USA · UAE · Canada · Australia · India'],[CheckCircle2,'Review qualified leads','No website + trusted personal contact'],[Users,'Move to prospects','Ready for personalized outreach']].map(([Icon,title,note],i)=><div key={title as string} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[.045] p-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#50e3b2]/12 text-[#79f0c8]"><Icon className="size-5"/></span><div className="min-w-0 flex-1"><div className="font-semibold">{title as string}</div><div className="mt-1 truncate text-sm text-slate-400">{note as string}</div></div><span className="text-sm font-black text-slate-500">0{i+1}</span></div>)}</div></div>
    </div></section>
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8"><div className="grid gap-5 md:grid-cols-3">{benefits.map(([title,copy,Icon])=><article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><span className="grid size-11 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="size-5"/></span><h2 className="mt-5 text-xl font-bold">{title}</h2><p className="mt-3 leading-7 text-slate-500">{copy}</p></article>)}</div></section>
  </main>;
}
