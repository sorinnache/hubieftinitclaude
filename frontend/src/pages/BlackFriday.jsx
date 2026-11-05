import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, X, Package, Truck, ShoppingBag, Trophy, MapPin, Search, Check } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx, Button, Input, Modal, useToast } from "../components/ui";

const lei = (v, d = 0) => `${Number(v || 0).toLocaleString("ro-RO", { minimumFractionDigits: d, maximumFractionDigits: d })} lei`;
const num = (v) => Math.round(Number(v || 0)).toLocaleString("ro-RO");
const hm = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const pad = (n) => String(n).padStart(2, "0");

function useCount(target, ms = 1100) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const a = from.current, b = target, t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line
  return v;
}

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <div className="text-right">
      <div className="bf-num text-5xl font-black tracking-tight text-white 2xl:text-6xl">{t.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Bucharest" })}</div>
      <div className="text-base capitalize text-white/50 2xl:text-lg">{t.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" })}</div>
    </div>
  );
}

function Countdown({ end, start }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const e = new Date(end).getTime(), s = new Date(start).getTime();
  const before = now < s;
  const left = Math.max(0, Math.round(((before ? s : e) - now) / 1000));
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
  const Cell = ({ v, l }) => (
    <div className="flex flex-col items-center">
      <div className="bf-num rounded-2xl bg-white/[.07] px-4 py-2 text-5xl font-black text-white ring-1 ring-white/10 2xl:px-5 2xl:text-6xl">{pad(v)}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[.2em] text-white/45">{l}</div>
    </div>
  );
  return (
    <div className="flex flex-col items-center">
      <div className="mb-2 text-sm font-bold uppercase tracking-[.3em] text-red-300/80 2xl:text-base">
        {left === 0 && !before ? "Campania s-a încheiat" : before ? "Campania începe în" : "Oferta se încheie în"}
      </div>
      <div className="flex items-start gap-2 2xl:gap-3">
        <Cell v={d} l="zile" /><span className="bf-num pt-2 text-4xl font-black text-white/30">:</span>
        <Cell v={h} l="ore" /><span className="bf-num pt-2 text-4xl font-black text-white/30">:</span>
        <Cell v={m} l="min" /><span className="bf-num pt-2 text-4xl font-black text-white/30">:</span>
        <Cell v={sec} l="sec" />
      </div>
    </div>
  );
}

function Big({ icon: Icon, label, value, accent, pop, sub }) {
  const v = useCount(value);
  return (
    <div className={cx("bf-card relative flex flex-col items-center justify-center overflow-hidden px-6 py-8 2xl:py-10", accent && "bf-card-accent")}>
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[.25em] text-white/55 2xl:text-base">
        <Icon className="h-5 w-5" /> {label}
      </div>
      <div key={pop} className={cx("bf-num bf-pop mt-2 font-black leading-none text-white", "text-[7rem] 2xl:text-[9rem]", accent && "text-red-400")}>{num(v)}</div>
      {sub && <div className="mt-2 text-base text-white/45 2xl:text-lg">{sub}</div>}
    </div>
  );
}

const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-800", "bg-orange-700 text-orange-50"];

function TopOrders({ rows }) {
  return (
    <div className="bf-card flex flex-col p-6 2xl:p-8">
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[.25em] text-white/55 2xl:text-base"><Trophy className="h-5 w-5 text-amber-400" /> Top 3 cele mai mari comenzi</div>
      <div className="mt-4 flex flex-1 flex-col justify-center gap-3">
        {rows.length === 0 && <div className="py-10 text-center text-white/30">Încă nicio comandă.</div>}
        {rows.map((o, i) => (
          <div key={o.name} className={cx("bf-new flex items-center gap-4 rounded-2xl bg-white/[.05] px-5 py-4 ring-1 ring-white/10", i === 0 && "bg-amber-400/10 ring-amber-400/30")}>
            <div className={cx("bf-num flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-black", MEDAL[i])}>{i + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-2xl font-bold text-white 2xl:text-3xl">{o.initials}</div>
              <div className="flex items-center gap-1 truncate text-sm text-white/50 2xl:text-base"><MapPin className="h-4 w-4" /> {o.city}{o.county ? `, ${o.county}` : ""} · {o.items} produse · {o.name}</div>
            </div>
            <div className="bf-num shrink-0 text-3xl font-black text-emerald-400 2xl:text-4xl">{lei(o.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopProducts({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.qty));
  return (
    <div className="bf-card flex flex-col p-6 2xl:p-8">
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[.25em] text-white/55 2xl:text-base"><Package className="h-5 w-5 text-red-400" /> Top 5 produse comandate</div>
      <div className="mt-4 flex flex-1 flex-col justify-center gap-2.5">
        {rows.length === 0 && <div className="py-10 text-center text-white/30">Încă niciun produs.</div>}
        {rows.map((p, i) => (
          <div key={p.variant_id} className="flex items-center gap-4">
            <div className="bf-num w-7 text-right text-lg font-black text-white/35">{i + 1}</div>
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/90 2xl:h-16 2xl:w-16">
              {p.image ? <img src={p.image} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-slate-400"><Package className="h-6 w-6" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold text-white 2xl:text-xl">{p.name}</div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-1000" style={{ width: `${(p.qty / max) * 100}%` }} />
              </div>
            </div>
            <div className="bf-num shrink-0 text-right">
              <div className="text-3xl font-black text-white 2xl:text-4xl">{num(p.qty)}</div>
              <div className="-mt-1 text-xs uppercase tracking-wider text-white/40">buc · {p.orders} com.</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsModal({ open, onClose, settings, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [form, setForm] = useState({ start: "", end: "", subtitle: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ start: settings.start, end: settings.end, subtitle: settings.subtitle || "" });
    api("/blackfriday/products").then((r) => { setRows(r.products); setExcluded(new Set(r.excluded)); }).catch((e) => toast.error(e.message));
  }, [open]); // eslint-disable-line
  useEffect(() => {
    if (!open || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => api(`/blackfriday/catalog?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.products)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const toggle = (vid) => setExcluded((s) => { const n = new Set(s); n.has(vid) ? n.delete(vid) : n.add(vid); return n; });
  const addFromCatalog = (p) => {
    if (!rows.some((r) => r.variant_id === p.variant_id)) setRows((r) => [{ ...p, qty: 0 }, ...r]);
    setExcluded((s) => new Set(s).add(p.variant_id));
    setQ(""); setFound([]);
  };
  const save = async () => {
    setSaving(true);
    try {
      const s = await api("/blackfriday/settings", { method: "PUT", body: { ...form, excluded: [...excluded] } });
      toast.success("Setările au fost salvate.");
      onSaved(s); onClose();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Setări ecran Black Friday" wide
      footer={<><Button variant="secondary" onClick={onClose}>Renunță</Button><Button loading={saving} onClick={save}>Salvează</Button></>}>
      <div className="text-slate-900">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm"><div className="mb-1 text-xs font-medium text-slate-500">Început (ora României)</div><Input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
        <label className="text-sm"><div className="mb-1 text-xs font-medium text-slate-500">Sfârșit (ora României)</div><Input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
        <label className="text-sm"><div className="mb-1 text-xs font-medium text-slate-500">Subtitlu</div><Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} placeholder="Reduceri până la 60%" /></label>
      </div>
      <div className="mt-5 text-sm font-semibold">Produse excluse din „Produse comandate” și din top</div>
      <div className="mb-2 text-xs text-slate-500">Bifează produsele care nu se numără (ex. extra garanție, livrare prioritară). Lista conține produsele apărute în comenzile din perioadă; caută mai jos ca să adaugi altele.</div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input className="pl-9" placeholder="Caută în toate produsele din Shopify…" value={q} onChange={(e) => setQ(e.target.value)} />
        {found.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {found.map((p) => (
              <button key={p.variant_id} onClick={() => addFromCatalog(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="truncate">{p.name}</span><span className="ml-2 shrink-0 text-xs text-slate-400">{p.sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 max-h-[40vh] divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
        {rows.length === 0 && <div className="p-4 text-center text-sm text-slate-400">Nu există încă produse în comenzile din perioadă.</div>}
        {rows.map((p) => (
          <label key={p.variant_id} className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50", excluded.has(p.variant_id) && "bg-red-50")}>
            <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded border", excluded.has(p.variant_id) ? "border-red-500 bg-red-500 text-white" : "border-slate-300 bg-white")}>
              {excluded.has(p.variant_id) && <Check className="h-3.5 w-3.5" />}
            </span>
            <input type="checkbox" className="hidden" checked={excluded.has(p.variant_id)} onChange={() => toggle(p.variant_id)} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-xs text-slate-400">{p.sku}</span>
            <span className="w-16 shrink-0 text-right text-xs tabular text-slate-500">{p.qty} buc</span>
          </label>
        ))}
      </div>
      </div>
    </Modal>
  );
}

export default function BlackFriday() {
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [pop, setPop] = useState(0);
  const [open, setOpen] = useState(false);
  const prev = useRef(null);
  const load = async () => {
    try {
      const r = await api("/blackfriday");
      if (prev.current !== null && r.orders > prev.current) setPop((p) => p + 1);
      prev.current = r.orders;
      setD(r); setErr("");
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape" && !open) exit(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }); // eslint-disable-line
  const exit = () => { if (document.fullscreenElement) document.exitFullscreen?.(); nav("/"); };
  const full = () => document.documentElement.requestFullscreen?.().catch(() => {});
  const s = d?.settings || {};
  const maxDay = useMemo(() => Math.max(1, ...((d?.days || []).map((x) => x.orders))), [d]);

  if (!d) return <div className="bf-bg flex min-h-screen items-center justify-center text-white/50">{err || "Se încarcă…"}</div>;
  return (
    <div className="bf-bg flex h-screen min-h-screen flex-col overflow-hidden px-8 py-6 text-white 2xl:px-12 2xl:py-8">
      {/* antet */}
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-4">
            <div className="bf-title text-6xl font-black uppercase tracking-tight 2xl:text-7xl">{s.title || "BLACK FRIDAY"}</div>
            <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-xs font-black uppercase tracking-[.25em] text-white"><span className="bf-live h-2 w-2 rounded-full bg-white" /> Live</span>
          </div>
          <div className="mt-1 text-xl font-semibold text-red-300 2xl:text-2xl">{s.subtitle}<span className="text-white/35"> · {new Date(d.start).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "Europe/Bucharest" })} – {new Date(d.end).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "Europe/Bucharest" })}</span></div>
        </div>
        <Countdown end={d.end} start={d.start} />
        <div className="flex items-center gap-5">
          <Clock />
          <div className="flex flex-col gap-2">
            {isAdmin && <button onClick={() => setOpen(true)} title="Setări" className="rounded-full bg-white/10 p-2.5 text-white/70 hover:bg-white/20"><Settings className="h-5 w-5" /></button>}
            <button onClick={exit} title="Ieși (Esc)" className="rounded-full bg-white/10 p-2.5 text-white/70 hover:bg-white/20"><X className="h-5 w-5" /></button>
          </div>
        </div>
      </div>

      {/* contoare */}
      <div className="mt-6 grid grid-cols-3 gap-6 2xl:mt-8">
        <Big icon={ShoppingBag} label="Comenzi plasate" value={d.orders} accent pop={pop} sub={d.last_order_at ? `ultima comandă la ${hm(d.last_order_at)}` : null} />
        <Big icon={Truck} label="Comenzi expediate" value={d.shipped} sub={d.orders ? `${Math.round((d.shipped / d.orders) * 100)}% din comenzi` : null} />
        <Big icon={Package} label="Produse comandate" value={d.units} sub={d.orders ? `${(d.units / d.orders).toFixed(1)} produse / comandă` : null} />
      </div>

      {/* top */}
      <div className="mt-6 grid min-h-0 flex-1 grid-cols-2 gap-6">
        <TopOrders rows={d.top_orders} />
        <TopProducts rows={d.top_products} />
      </div>

      {/* subsol */}
      <div className="mt-4 flex items-center justify-between text-sm text-white/40">
        <div className="flex items-center gap-3">
          {d.days.map((x) => (
            <div key={x.day} className="flex items-center gap-1.5">
              <span className="bf-num">{x.day}</span>
              <span className="h-2 rounded-full bg-red-500/70" style={{ width: `${8 + (x.orders / maxDay) * 80}px` }} />
              <span className="bf-num font-semibold text-white/70">{x.orders}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          {err && <span className="text-rose-400">Eroare: {err}</span>}
          {d.last_error && <span className="text-rose-400">Shopify: {d.last_error}</span>}
          <span>{d.cancelled > 0 ? `${d.cancelled} anulate · ` : ""}sincronizat {d.last_sync ? hm(d.last_sync) : "—"}</span>
          {!document.fullscreenElement && <button onClick={full} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/70 hover:bg-white/20">Ecran complet</button>}
        </div>
      </div>
      <SettingsModal open={open} onClose={() => setOpen(false)} settings={s} onSaved={() => load()} />
    </div>
  );
}
