import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings, X, Package, Truck, ShoppingCart, Trophy, MapPin, Search, Check, Maximize2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cx, Button, Input, Modal, useToast } from "../components/ui";

const TZ = "Europe/Bucharest";
const lei = (v) => `${Math.round(Number(v || 0)).toLocaleString("ro-RO")} lei`;
const num = (v) => Math.round(Number(v || 0)).toLocaleString("ro-RO");
const hms = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
const hm = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const pad = (n) => String(n).padStart(2, "0");
const todayRO = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ }); // YYYY-MM-DD

/* interpolare 600–900 ms; respectă și scăderile; fără mișcare la prefers-reduced-motion */
function useCount(target, ms = 800) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { from.current = target; setV(target); return; }
    const a = from.current, b = target, t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else { from.current = b; setV(b); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]); // eslint-disable-line
  return v;
}

function useNow(every = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), every); return () => clearInterval(i); }, [every]);
  return t;
}

function Clock({ now }) {
  const d = new Date(now);
  return (
    <div className="text-right leading-none">
      <div className="bf-num text-[2.1rem] font-bold text-bf-text">{d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ })}</div>
      <div className="mt-1 text-[1.05rem] capitalize text-bf-muted">{d.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })}</div>
    </div>
  );
}

function Countdown({ now, start, end }) {
  const s = new Date(start).getTime(), e = new Date(end).getTime() + 1000; // end = 23:59:59 → limită 00:00:00
  const before = now < s, over = now >= e;
  const left = Math.max(0, Math.floor(((before ? s : e) - now) / 1000));
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), sec = left % 60;
  const Cell = ({ v, u }) => <span className="bf-num text-[2rem] font-black text-bf-text">{pad(v)}<span className="ml-0.5 text-[1rem] font-bold text-bf-muted">{u}</span></span>;
  return (
    <div className="text-center">
      <div className="mb-1 text-[0.95rem] font-bold uppercase tracking-[.3em] text-bf-muted">{over ? "Campanie" : before ? "Începe în" : "Mai sunt"}</div>
      {over ? <div className="rounded-xl border border-bf-line bg-bf-surface px-5 py-2 text-[1.6rem] font-black uppercase text-bf-yellow">Campanie încheiată</div> : (
        <div className="flex items-center gap-2 rounded-xl border border-bf-yellow/60 bg-bf-surface px-5 py-1.5">
          <Cell v={d} u="z" /><span className="text-[1.6rem] font-black text-bf-muted">:</span>
          <Cell v={h} u="h" /><span className="text-[1.6rem] font-black text-bf-muted">:</span>
          <Cell v={m} u="m" /><span className="text-[1.6rem] font-black text-bf-muted">:</span>
          <Cell v={sec} u="s" />
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, flash, flashOnChange }) {
  const v = useCount(value);
  const [hit, setHit] = useState(0);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (flashOnChange) setHit((h) => h + 1); }, [value]); // eslint-disable-line
  const key = `${flash || 0}-${hit}`;
  return (
    <div key={key} className={cx("bf-card relative flex flex-col items-center justify-center overflow-hidden px-4 py-5 text-center", (flash || hit) && "bf-flash")}>
      <div className="flex items-center gap-3 text-[1.25rem] font-extrabold uppercase leading-tight tracking-wider text-bf-text">
        <Icon className="h-[2rem] w-[2rem] text-bf-yellow" strokeWidth={2.2} /> <span className="text-left">{label}</span>
      </div>
      <div className={cx("bf-num mt-2 text-[5.6rem] font-black leading-none text-bf-text", (flash || hit) && "bf-numpop")}>{num(v)}</div>
      <div className="mt-3 min-h-[1.4rem] text-[1.15rem] text-bf-muted">{sub || " "}</div>
      <div className="absolute inset-x-0 bottom-0 h-[0.3rem] bg-bf-yellow" />
    </div>
  );
}

function Revenue({ value, flash, label, period }) {
  const v = useCount(value);
  const txt = num(v);
  const size = txt.length > 11 ? "text-[4.6rem]" : txt.length > 8 ? "text-[5.6rem]" : "text-[6.8rem]";
  return (
    <div className={cx("bf-yellow-card relative flex flex-col justify-between overflow-hidden p-7 pr-[16rem]", flash && "bf-flash-yellow")}>
      <div className="text-[1.65rem] font-black uppercase tracking-wide text-bf-ink">{label}</div>
      <div className="flex items-end gap-3">
        <div className={cx("bf-num font-black leading-none text-bf-ink", size)}>{txt}</div>
        <div className="mb-2 text-[2.2rem] font-black text-bf-ink">lei</div>
      </div>
      <div className="text-[1.05rem] font-bold uppercase tracking-[.35em] text-bf-ink/80">{period}</div>
      <img src="/bf-mascot.png" alt="" className={cx("bf-mascot pointer-events-none absolute right-6 top-1/2 w-[14rem] -translate-y-1/2 drop-shadow-[0_12px_24px_rgba(0,0,0,.25)]", flash && "bf-mascot-cheer")} />
    </div>
  );
}

const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-800", "bg-orange-600 text-orange-50"];

function Panel({ icon: Icon, title, children }) {
  return (
    <div className="bf-card flex min-h-0 flex-col p-5">
      <div className="flex items-center gap-3 text-[1.5rem] font-black uppercase tracking-wide text-bf-text"><Icon className="h-[1.9rem] w-[1.9rem] text-bf-yellow" strokeWidth={2.2} /> {title}</div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between gap-2.5">{children}</div>
    </div>
  );
}

function TopOrders({ rows }) {
  const slots = [0, 1, 2];
  return (
    <Panel icon={Trophy} title="Top 3 cele mai mari comenzi">
      {slots.map((i) => {
        const o = rows[i];
        if (!o) return <div key={i} className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-bf-line text-[1.1rem] text-bf-muted">Încă nu există date</div>;
        return (
          <div key={o.name} className={cx("bf-row flex flex-1 items-center gap-5 rounded-2xl border border-bf-line bg-bf-surface2 px-5", i === 0 && "border-bf-yellow/50")}>
            <div className={cx("bf-num flex h-[3.4rem] w-[3.4rem] shrink-0 items-center justify-center rounded-full text-[1.7rem] font-black", MEDAL[i])}>{i + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[2rem] font-black leading-tight text-bf-text">{o.initials}</div>
              <div className="flex items-center gap-1.5 truncate text-[1.1rem] text-bf-muted"><MapPin className="h-[1.1rem] w-[1.1rem]" /> {o.city}{o.county && o.county !== o.city ? `, ${o.county}` : ""} · {o.items} produse · {o.name}</div>
            </div>
            <div className="bf-num shrink-0 text-[2.4rem] font-black text-bf-yellow">{lei(o.value)}</div>
          </div>
        );
      })}
    </Panel>
  );
}

function TopProducts({ rows }) {
  const max = rows[0]?.qty || 0;
  return (
    <Panel icon={Package} title="Top 5 produse comandate">
      {[0, 1, 2, 3, 4].map((i) => {
        const p = rows[i];
        if (!p) return <div key={i} className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-bf-line text-[1.1rem] text-bf-muted">Încă nu există date</div>;
        return (
          <div key={p.variant_id} className="bf-row flex flex-1 items-center gap-4 rounded-2xl border border-bf-line bg-bf-surface2 px-4">
            <div className="bf-num w-[1.8rem] shrink-0 text-[1.3rem] font-black text-bf-muted">{i + 1}.</div>
            <div className="h-[3.6rem] w-[3.6rem] shrink-0 overflow-hidden rounded-xl bg-white">
              {p.image ? <img src={p.image} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-slate-400"><Package className="h-6 w-6" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <div className="line-clamp-2 text-[1.3rem] font-bold leading-tight text-bf-text">{p.name}</div>
                <div className="bf-num shrink-0 text-[1.15rem] font-semibold text-bf-muted"><span className="text-[1.35rem] font-black text-bf-text">{num(p.qty)}</span> buc. · {p.orders} com.</div>
              </div>
              <div className="mt-1.5 h-[0.7rem] w-full overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-bf-yellow transition-[width] duration-700" style={{ width: max ? `${(p.qty / max) * 100}%` : 0 }} />
              </div>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

function Footer({ days, start, end, now, lastOk, status, cancelled = 0 }) {
  const today = todayRO();
  const s = new Date(start).getTime(), e = new Date(end).getTime() + 1000;
  const prog = Math.min(100, Math.max(0, ((now - s) / (e - s)) * 100));
  return (
    <div className="flex items-center justify-between gap-6 text-[1.05rem] text-bf-muted">
      <div className="flex items-center gap-2.5">
        {days.map((d) => {
          const cur = d.date === today, future = d.date > today;
          return (
            <div key={d.date} className={cx("bf-num flex items-center gap-2.5 rounded-xl border px-3.5 py-1.5", cur ? "border-bf-yellow bg-bf-yellow text-bf-ink" : "border-bf-line bg-bf-surface")}>
              <span className="text-[0.95rem] font-bold uppercase tracking-wider">{d.day.slice(0, 2)} nov</span>
              <span className={cx("text-[1.2rem] font-black", !cur && "text-bf-text")}>{future ? "—" : num(d.orders)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-[0.7rem] w-[12rem] overflow-hidden rounded-full bg-bf-surface ring-1 ring-bf-line"><div className="h-full rounded-full bg-bf-yellow" style={{ width: `${prog}%` }} /></div>
        <span className="bf-num">{Math.round(prog)}% din campanie</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className={cx("h-[0.8rem] w-[0.8rem] rounded-full", status === "live" ? "bg-bf-green bf-live" : status === "stale" ? "bg-amber-400" : "bg-rose-500")} />
        <span>{cancelled > 0 ? `${cancelled} anulate · ` : ""}{status === "live" ? "Sincronizat" : status === "stale" ? "Date întârziate" : "Reconectare"} · {lastOk ? hms(lastOk) : "—"}</span>
      </div>
    </div>
  );
}

const DEMO = {
  settings: { title: "BLACK FRIDAY", subtitle: "Reduceri până la 60%" }, start: "2026-11-06T00:00:00+02:00", end: "2026-11-10T23:59:59+02:00",
  orders: 1248, shipped: 986, units: 1836, revenue: 384920, cancelled: 12, last_order_at: new Date().toISOString(), last_sync: new Date().toISOString(), recent: [],
  top_orders: [{ name: "#114691", value: 3890, initials: "D. M.", city: "Bacău", county: "Bacău", items: 12 }, { name: "#114689", value: 3420, initials: "S. M.", city: "Focșani", county: "Vrancea", items: 9 }, { name: "#114692", value: 2970, initials: "M. D.", city: "Constanța", county: "Constanța", items: 8 }],
  top_products: [{ variant_id: "1", name: "Drujbă CAMPION 8.5 CP CMP1312R", qty: 286, orders: 240 }, { variant_id: "2", name: "MEGA PACHET · Drujbă CAMPION + accesorii", qty: 214, orders: 192 }, { variant_id: "3", name: "Invertor sudură 494A CMP1695", qty: 178, orders: 160 }, { variant_id: "4", name: "Set 9 accesorii pentru drujbă", qty: 142, orders: 128 }],
  days: [{ day: "06.11", date: "2026-11-06", orders: 1248 }, { day: "07.11", date: "2026-11-07", orders: 0 }, { day: "08.11", date: "2026-11-08", orders: 0 }, { day: "09.11", date: "2026-11-09", orders: 0 }, { day: "10.11", date: "2026-11-10", orders: 0 }],
};

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

/* scalare fluidă: 1rem = 16px la 1920×1080, 32px la 4K; pe ultra-wide se scalează după înălțime */
function useTvScale() {
  useEffect(() => {
    const html = document.documentElement, prev = html.style.fontSize;
    const fit = () => { html.style.fontSize = `${Math.max(8, Math.min(window.innerWidth / 1920, window.innerHeight / 1080) * 16)}px`; };
    fit(); window.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); html.style.fontSize = prev; };
  }, []);
}

export default function BlackFriday() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const preview = sp.get("preview") === "1";
  const { isAdmin } = useAuth();
  useTvScale();
  const now = useNow(1000);
  const [d, setD] = useState(preview ? DEMO : null);
  const [initErr, setInitErr] = useState("");
  const [lastOk, setLastOk] = useState(preview ? Date.now() : null);
  const [lastErr, setLastErr] = useState(null);
  const [open, setOpen] = useState(false);
  const [showCtl, setShowCtl] = useState(true);
  const [toast, setToast] = useState(null);
  const [flash, setFlash] = useState(0);
  const seen = useRef(null); // id-urile comenzilor văzute (celebrăm doar comenzile noi după prima încărcare)
  const lastCheer = useRef(0);
  const pending = useRef({ n: 0, v: 0 });
  const inFlight = useRef(false);
  const backoff = useRef(10000);

  const load = useCallback(async () => {
    if (inFlight.current || preview) return;
    inFlight.current = true;
    try {
      const r = await api("/blackfriday");
      setD(r); setInitErr(""); setLastOk(Date.now()); backoff.current = 10000;
      const ids = new Set((r.recent || []).map((o) => o.order_id));
      if (seen.current) {
        const fresh = (r.recent || []).filter((o) => !seen.current.has(o.order_id));
        if (fresh.length) {
          pending.current = { n: pending.current.n + fresh.length, v: pending.current.v + fresh.reduce((s, o) => s + Number(o.value || 0), 0) };
          if (Date.now() - lastCheer.current > 9000) {
            lastCheer.current = Date.now();
            const p = pending.current; pending.current = { n: 0, v: 0 };
            setFlash((f) => f + 1);
            setToast(p.v > 0 ? `${p.n > 1 ? `${p.n} comenzi noi` : "Comandă nouă"} · +${lei(p.v)}` : (p.n > 1 ? `${p.n} comenzi noi` : "Comandă nouă"));
            setTimeout(() => setToast(null), 4500);
          }
        }
        fresh.forEach((o) => seen.current.add(o.order_id));
      } else seen.current = ids;
    } catch (e) {
      if (!d) setInitErr(e.message || "Eroare la încărcare");
      setLastErr(Date.now());
      backoff.current = Math.min(60000, backoff.current * 2);
    } finally { inFlight.current = false; }
  }, [preview, d]); // eslint-disable-line

  // polling fără cereri suprapuse, cu retry progresiv
  useEffect(() => {
    if (preview) return;
    let t; let stop = false;
    const tick = async () => { await load(); if (!stop) t = setTimeout(tick, backoff.current); };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [preview]); // eslint-disable-line
  const status = preview ? "live" : lastErr && lastErr > (lastOk || 0) ? "offline" : lastOk && now - lastOk > 30000 ? "stale" : "live"; // live | stale | offline

  // controalele apar la mișcarea mouse-ului / tastatură și se ascund după 4 s
  useEffect(() => {
    let t;
    const wake = () => { setShowCtl(true); clearTimeout(t); t = setTimeout(() => setShowCtl(false), 4000); };
    wake();
    ["mousemove", "keydown", "touchstart", "focusin"].forEach((ev) => window.addEventListener(ev, wake));
    return () => { clearTimeout(t); ["mousemove", "keydown", "touchstart", "focusin"].forEach((ev) => window.removeEventListener(ev, wake)); };
  }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape" && !open && !document.fullscreenElement) nav("/"); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, nav]);

  // Wake Lock (dacă browserul permite)
  const lock = useRef(null);
  const wakeLock = async () => { try { lock.current = await navigator.wakeLock?.request?.("screen"); } catch { /* neacceptat */ } };
  useEffect(() => { wakeLock(); const h = () => document.visibilityState === "visible" && wakeLock(); document.addEventListener("visibilitychange", h); return () => { document.removeEventListener("visibilitychange", h); lock.current?.release?.(); }; }, []);
  const full = () => { document.documentElement.requestFullscreen?.().catch(() => {}); wakeLock(); };
  const exit = () => { if (document.fullscreenElement) document.exitFullscreen?.(); nav("/"); };

  if (!d) {
    return (
      <div className="bf-bg flex min-h-screen flex-col items-center justify-center gap-4 text-bf-muted">
        <img src="/bf-logo-white.png" alt="IEFTINIT.RO" className="h-[3rem] opacity-80" />
        {initErr ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-3 text-[1.2rem] text-rose-300">Nu s-au putut încărca datele: {initErr}. Reîncerc automat…</div>
          : <div className="text-[1.3rem]">Se încarcă datele campaniei…</div>}
      </div>
    );
  }
  const s = d.settings || {};
  const period = `${new Date(d.start).toLocaleDateString("ro-RO", { day: "numeric", timeZone: TZ })}–${new Date(d.end).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: TZ })}`;
  const liveOk = status === "live";
  return (
    <div className="bf-bg relative flex h-[100dvh] flex-col overflow-hidden px-[2.75rem] py-[2rem] text-bf-text">
      {/* fundal animat (energie Black Friday) */}
      <div className="bf-fx pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="bf-glow bf-glow-a" /><div className="bf-glow bf-glow-b" /><div className="bf-glow bf-glow-c" />
        {Array.from({ length: 14 }, (_, i) => <span key={i} className="bf-spark" style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 1.7) % 9}s`, animationDuration: `${9 + (i % 5) * 2}s`, width: `${0.25 + (i % 3) * 0.15}rem`, height: `${0.25 + (i % 3) * 0.15}rem` }} />)}
      </div>
      {/* antet */}
      <div className="flex items-center gap-6">
        <img src="/bf-logo-white.png" alt="IEFTINIT.RO" className="h-[3.8rem] w-auto" />
        <div className="h-[3.6rem] w-px bg-bf-line" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-4">
            <div className="text-[2.75rem] font-black uppercase leading-none tracking-tight"><span className="text-bf-text">{(s.title || "BLACK FRIDAY").split(" ")[0]}</span> <span className="text-bf-yellow">{(s.title || "BLACK FRIDAY").split(" ").slice(1).join(" ")}</span></div>
            <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.9rem] font-black uppercase tracking-[.2em]", liveOk ? "bg-bf-green text-bf-ink" : status === "stale" ? "bg-amber-400 text-bf-ink" : "bg-rose-500 text-white")}>
              <span className={cx("h-[0.6rem] w-[0.6rem] rounded-full bg-bf-ink/70", liveOk && "bf-live")} /> {liveOk ? "Live" : status === "stale" ? "Date întârziate" : "Reconectare"}
            </span>
            {preview && <span className="rounded-full border border-bf-yellow px-3 py-1 text-[0.9rem] font-black uppercase tracking-[.2em] text-bf-yellow">Date demonstrative</span>}
          </div>
          <div className="mt-1.5 text-[1.3rem] font-semibold uppercase tracking-wider text-bf-muted">{period} <span className="text-bf-line">·</span> {s.subtitle || "Reduceri până la 60%"}</div>
        </div>
        <Countdown now={now} start={d.start} end={d.end} />
        <div className="h-[3.6rem] w-px bg-bf-line" />
        <Clock now={now} />
      </div>

      {/* KPI */}
      <div className="mt-[1.5rem] grid h-[16.5rem] grid-cols-[46fr_54fr] gap-[1.5rem]">
        <Revenue value={d.revenue} flash={flash} label="Valoare totală comenzi" period={`Campanie · ${period.replace(/ \d{4}$/, "")}`} />
        <div className="grid grid-cols-3 gap-[1.5rem]">
          <Kpi icon={ShoppingCart} label={<>Comenzi<br />plasate</>} value={d.orders} flash={flash} flashOnChange sub={d.last_order_at ? `Ultima comandă · ${hm(d.last_order_at)}` : "Nicio comandă încă"} />
          <Kpi icon={Truck} label={<>Comenzi<br />expediate</>} value={d.shipped} sub={d.orders ? `${Math.round((d.shipped / d.orders) * 100)}% din comenzi` : "—"} />
          <Kpi icon={Package} label={<>Produse<br />comandate</>} value={d.units} sub={d.orders ? `${(d.units / d.orders).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} produse / comandă` : "—"} />
        </div>
      </div>

      {/* clasamente */}
      <div className="mt-[1.5rem] grid min-h-0 flex-1 grid-cols-2 gap-[1.5rem]">
        <TopOrders rows={d.top_orders || []} />
        <TopProducts rows={d.top_products || []} />
      </div>

      {/* subsol */}
      <div className="mt-[1.25rem]">
        <Footer days={d.days || []} start={d.start} end={d.end} now={now} lastOk={lastOk} status={status} cancelled={d.cancelled || 0} />
      </div>

      {/* notificare comandă nouă */}
      {toast && <div className="bf-toast absolute right-[2.75rem] top-[7.5rem] z-40 rounded-2xl bg-bf-yellow px-5 py-3 text-[1.3rem] font-black text-bf-ink shadow-2xl">{toast}</div>}

      {/* controale (apar la mișcare) */}
      <div className={cx("absolute right-[0.5rem] top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2 transition-opacity duration-300", showCtl ? "opacity-100" : "opacity-0 focus-within:opacity-100")}>
        {!document.fullscreenElement && <button onClick={full} title="Ecran complet" className="rounded-full bg-bf-surface p-2.5 text-bf-text ring-1 ring-bf-line hover:bg-bf-surface2"><Maximize2 className="h-5 w-5" /></button>}
        {isAdmin && !preview && <button onClick={() => setOpen(true)} title="Setări" className="rounded-full bg-bf-surface p-2.5 text-bf-text ring-1 ring-bf-line hover:bg-bf-surface2"><Settings className="h-5 w-5" /></button>}
        <button onClick={exit} title="Ieși" className="rounded-full bg-bf-surface p-2.5 text-bf-text ring-1 ring-bf-line hover:bg-bf-surface2"><X className="h-5 w-5" /></button>
      </div>
      <SettingsModal open={open} onClose={() => setOpen(false)} settings={s} onSaved={() => { seen.current = null; load(); }} />
    </div>
  );
}
