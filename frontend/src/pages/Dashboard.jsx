import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Maximize2, Minimize2, Package, TrendingUp, TrendingDown, MapPin, Zap, Truck, CheckCircle2, ShoppingBag } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../components/ui";

const lei = (v, d = 0) => `${Number(v || 0).toLocaleString("ro-RO", { minimumFractionDigits: d, maximumFractionDigits: d })} lei`;
const hm = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "acum";
  if (s < 3600) return `acum ${Math.floor(s / 60)} min`;
  return `acum ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};

function useCount(target, ms = 900) {
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

function Delta({ now, before, label }) {
  if (!before) return <span className="text-white/40">{label}: —</span>;
  const p = Math.round(((now - before) / before) * 100);
  const up = p >= 0;
  return (
    <span className={cx("inline-flex items-center gap-1 font-semibold", up ? "text-emerald-400" : "text-rose-400")}>
      {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{up ? "+" : ""}{p}% <span className="font-normal text-white/45">{label}</span>
    </span>
  );
}

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <div className="text-right">
      <div className="text-4xl font-bold tabular tracking-tight text-white lg:text-5xl">{t.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Bucharest" })}</div>
      <div className="text-sm capitalize text-white/50">{t.toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" })}</div>
    </div>
  );
}

function CumulativeChart({ hours, nowHour }) {
  const W = 1000, H = 260, P = 8;
  const today = [], yday = [];
  let a = 0, b = 0;
  hours.forEach((h, i) => { a += h.revenue; b += h.y_revenue; today.push(i <= nowHour ? a : null); yday.push(b); });
  const max = Math.max(1, ...yday, ...today.filter((x) => x !== null)) * 1.08;
  const x = (i) => P + (i / 23) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = (arr) => arr.map((v, i) => (v === null ? "" : `${i === 0 || arr[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");
  const tPath = path(today);
  const last = today.reduce((acc, v, i) => (v !== null ? i : acc), 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff2d7a" stopOpacity=".55" /><stop offset="100%" stopColor="#ff2d7a" stopOpacity="0" /></linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={P} x2={W - P} y1={y(max * g)} y2={y(max * g)} stroke="rgba(255,255,255,.06)" />)}
      <path d={path(yday)} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2.5" strokeDasharray="6 7" vectorEffect="non-scaling-stroke" />
      {tPath && <path d={`${tPath} L${x(last)},${H - P} L${x(0)},${H - P} Z`} fill="url(#dg)" />}
      {tPath && <path d={tPath} fill="none" stroke="#ff2d7a" strokeWidth="3.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
      {tPath && <circle cx={x(last)} cy={y(today[last])} r="7" fill="#ff2d7a" className="dash-pulse" style={{ transformOrigin: `${x(last)}px ${y(today[last])}px` }} />}
    </svg>
  );
}

export default function Dashboard({ tv = false }) {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const seen = useRef(null);
  const [fresh, setFresh] = useState(new Set());
  const [pop, setPop] = useState(0);
  const load = () => api("/dashboard/today").then((x) => {
    const ids = new Set(x.feed.map((o) => o.order_id));
    if (seen.current) {
      const n = new Set([...ids].filter((i) => !seen.current.has(i)));
      if (n.size) { setFresh(n); setPop((p) => p + 1); }
    }
    seen.current = ids;
    setD(x); setErr(null);
  }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i); }, []); // eslint-disable-line
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((t) => t + 1), 15000); return () => clearInterval(i); }, []);

  const revenue = useCount(d?.revenue || 0);
  const orders = useCount(d?.orders || 0);
  const aov = useCount(d?.aov || 0);
  const nowHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Bucharest" })).getHours();
  const maxQty = useMemo(() => Math.max(1, ...(d?.top_products || []).map((p) => p.qty)), [d]);
  const maxCounty = useMemo(() => Math.max(1, ...(d?.top_counties || []).map((p) => p.orders)), [d]);
  const maxH = useMemo(() => Math.max(1, ...(d?.hours || []).map((h) => Math.max(h.orders, h.y_orders))), [d]);

  const fullscreen = () => {
    if (tv) { if (document.fullscreenElement) document.exitFullscreen?.(); nav("/"); return; }
    nav("/ecran");
    setTimeout(() => document.documentElement.requestFullscreen?.().catch(() => {}), 100);
  };

  return (
    <div className={cx("dash-bg text-white", tv ? "min-h-dvh p-5 lg:p-8" : "rounded-3xl p-5 lg:p-8")}>
      <div className={cx("flex flex-wrap items-center justify-between gap-4", tv ? "mb-4" : "mb-6")}>
        <div className="flex items-center gap-4">
          <img src="/ieftinit-logo.png" alt="" className="h-10 w-auto rounded bg-white/90 px-2 py-1" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.25em] text-white/50">
              <span className="dash-pulse inline-block h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_12px_#f43f5e]" /> Live · vânzările de azi
            </div>
            <div className="text-2xl font-bold tracking-tight lg:text-3xl">IEFTINIT.RO</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <Clock />
          <button onClick={fullscreen} title={tv ? "Ieși din modul ecran" : "Mod ecran (TV)"} className="rounded-xl border border-white/10 p-2.5 text-white/60 hover:bg-white/10 hover:text-white">
            {tv ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {err && <div className="mb-4 rounded-xl bg-rose-500/15 px-4 py-2 text-sm text-rose-200">Nu pot încărca datele: {err}</div>}
      {!d ? <div className="py-32 text-center text-white/40">Se încarcă…</div> : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="dash-card relative overflow-hidden p-6 lg:col-span-5">
              <div className="text-sm font-medium uppercase tracking-widest text-white/50">Vânzări azi</div>
              <div key={pop} className={cx("dash-pop mt-2 font-extrabold tabular tracking-tight", tv ? "text-6xl 2xl:text-7xl" : "text-5xl lg:text-7xl")}>{lei(revenue)}</div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <Delta now={d.revenue} before={d.y_revenue_same} label="față de ieri la aceeași oră" />
              </div>
              <div className="mt-1 text-xs text-white/40">Ieri la ora asta: {lei(d.y_revenue_same)} · ieri total: {lei(d.y_revenue)}</div>
              <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[#ff2d7a]/20 blur-3xl" />
            </div>
            <div className="dash-card p-6 lg:col-span-3">
              <div className="text-sm font-medium uppercase tracking-widest text-white/50">Comenzi</div>
              <div key={`o${pop}`} className="dash-pop mt-2 text-5xl font-extrabold tabular lg:text-7xl">{Math.round(orders)}</div>
              <div className="mt-3 text-sm"><Delta now={d.orders} before={d.y_orders_same} label="vs ieri" /></div>
              <div className="mt-1 text-xs text-white/40">{d.last_hour} în ultima oră{d.cancelled ? ` · ${d.cancelled} anulate` : ""}</div>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:col-span-4">
              {[
                ["Valoare medie", lei(aov), ShoppingBag],
                ["Produse vândute", d.units, Package],
                ["Confirmate", d.confirmed, CheckCircle2],
                ["AWB emise azi", d.awb_today, Truck],
              ].map(([l, v, I]) => (
                <div key={l} className="dash-card p-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/45"><I className="h-3.5 w-3.5" /> {l}</div>
                  <div className="mt-1 text-2xl font-bold tabular lg:text-3xl">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="dash-card p-6 xl:col-span-8">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium uppercase tracking-widest text-white/50">Vânzări cumulate pe parcursul zilei</div>
                <div className="flex items-center gap-4 text-xs text-white/50">
                  <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded bg-[#ff2d7a]" /> Azi</span>
                  <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-white/40" /> Ieri</span>
                  {d.best_hour && <span className="flex items-center gap-1 text-amber-300"><Zap className="h-3.5 w-3.5" /> vârf: ora {d.best_hour.hour} ({d.best_hour.orders} comenzi)</span>}
                </div>
              </div>
              <div className={tv ? "h-44" : "h-56 lg:h-64"}><CumulativeChart hours={d.hours} nowHour={nowHour} /></div>
              <div className={cx("mt-3 flex items-end gap-1", tv ? "h-20" : "h-24")}>
                {d.hours.map((h) => (
                  <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                    <div className={cx("relative flex w-full items-end justify-center gap-[2px]", tv ? "h-12" : "h-16")}>
                      <div className="w-1/3 rounded-t bg-white/15" style={{ height: `${(h.y_orders / maxH) * 100}%` }} />
                      <div className={cx("w-1/2 rounded-t", h.hour === nowHour ? "bg-[#ff2d7a] shadow-[0_0_14px_#ff2d7a]" : "bg-[#ff2d7a]/70")} style={{ height: `${(h.orders / maxH) * 100}%` }} />
                    </div>
                    <div className={cx("text-[10px] tabular", h.hour === nowHour ? "font-bold text-white" : "text-white/35")}>{h.hour}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={cx("dash-card flex flex-col p-5 xl:col-span-4", tv ? "max-h-[440px]" : "max-h-[520px]")}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium uppercase tracking-widest text-white/50">Comenzi în timp real</div>
                {d.last_order_at && <div className="text-xs text-white/40">ultima {ago(d.last_order_at)}</div>}
              </div>
              <div className="-mx-2 min-h-0 flex-1 space-y-1.5 overflow-hidden">
                {d.feed.map((o) => (
                  <div key={o.order_id} className={cx("flex items-center gap-3 rounded-xl px-2 py-2", fresh.has(o.order_id) && "dash-new", o.cancelled && "opacity-40")}>
                    {o.image ? <img src={o.image} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-white object-cover" /> : <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10"><Package className="h-5 w-5 text-white/40" /></div>}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{o.items.join(" + ") || "—"}</div>
                      <div className="truncate text-xs text-white/45">{o.name} · {o.customer} · {o.city}{o.confirmed ? " · ✓ confirmată" : ""}{o.cancelled ? " · anulată" : ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold tabular">{lei(o.total)}</div>
                      <div className="text-[11px] tabular text-white/40">{hm(o.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
            <div className="dash-card p-5 xl:col-span-8">
              <div className="mb-4 text-sm font-medium uppercase tracking-widest text-white/50">Top produse azi</div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                {d.top_products.slice(0, tv ? 6 : 10).map((p, i) => (
                  <div key={p.variant_id} className="flex items-center gap-3">
                    <div className={cx("w-6 text-center text-lg font-extrabold tabular", i === 0 ? "text-amber-300" : i === 1 ? "text-slate-200" : i === 2 ? "text-orange-300" : "text-white/30")}>{i + 1}</div>
                    {p.image ? <img src={p.image} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-white object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-white/10" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.title}{p.variant ? ` — ${p.variant}` : ""}</div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#ff2d7a] to-[#ff8a3d] transition-all duration-1000" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                      </div>
                    </div>
                    <div className="w-14 shrink-0 text-right"><div className="text-lg font-bold tabular">{p.qty}</div><div className="text-[10px] text-white/40">buc</div></div>
                  </div>
                ))}
                {d.top_products.length === 0 && <div className="text-sm text-white/40">Încă nicio comandă azi.</div>}
              </div>
            </div>
            <div className="dash-card p-5 xl:col-span-4">
              <div className="mb-4 text-sm font-medium uppercase tracking-widest text-white/50">De unde comandă azi</div>
              <div className="space-y-2.5">
                {d.top_counties.slice(0, tv ? 5 : 8).map((c) => (
                  <div key={c.county} className="flex items-center gap-3 text-sm">
                    <MapPin className="h-4 w-4 shrink-0 text-white/30" />
                    <div className="w-28 shrink-0 truncate">{c.county}</div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-indigo-400/80 transition-all duration-1000" style={{ width: `${(c.orders / maxCounty) * 100}%` }} /></div>
                    <div className="w-8 text-right font-semibold tabular">{c.orders}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 text-center text-[11px] text-white/30">Se actualizează automat · comenzi din Shopify {d.last_sync ? ago(d.last_sync) : "—"} · valori cu TVA, comenzi neanulate</div>
        </>
      )}
    </div>
  );
}
