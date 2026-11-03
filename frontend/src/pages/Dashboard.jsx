import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Maximize2, Minimize2, Package, TrendingUp, TrendingDown, MapPin, Zap, Truck, CheckCircle2, ShoppingBag, Flame } from "lucide-react";
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

function CumulativeChart({ hours, nowHour, dark, hover, setHover }) {
  const W = 1000, H = 240, P = 8;
  const today = [], yday = [];
  let a = 0, b = 0;
  hours.forEach((h, i) => { a += h.revenue; b += h.y_revenue; today.push(i <= nowHour ? a : null); yday.push(b); });
  const max = Math.max(1, ...yday, ...today.filter((x) => x !== null)) * 1.08;
  const x = (i) => P + (i / 23) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = (arr) => arr.map((v, i) => (v === null ? "" : `${i === 0 || arr[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");
  const tPath = path(today);
  const last = today.reduce((acc, v, i) => (v !== null ? i : acc), 0);
  const grid = dark ? "rgba(255,255,255,.06)" : "#f1f5f9";
  const yc = dark ? "rgba(255,255,255,.28)" : "#94a3b8";
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * 23);
    setHover(Math.max(0, Math.min(23, i)));
  };
  const h = hover !== null ? hover : null;
  return (
    <div className="relative h-full w-full cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label="Vânzări cumulate azi față de ieri">
        <defs>
          <linearGradient id="dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#E91E63" stopOpacity={dark ? ".5" : ".22"} /><stop offset="100%" stopColor="#E91E63" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={P} x2={W - P} y1={y(max * g)} y2={y(max * g)} stroke={grid} vectorEffect="non-scaling-stroke" />)}
        <path d={path(yday)} fill="none" stroke={yc} strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        {tPath && <path d={`${tPath} L${x(last)},${H - P} L${x(0)},${H - P} Z`} fill="url(#dg)" />}
        {tPath && <path d={tPath} fill="none" stroke="#E91E63" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {h !== null && <line x1={x(h)} x2={x(h)} y1={P} y2={H - P} stroke={dark ? "rgba(255,255,255,.3)" : "#cbd5e1"} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h !== null && (
        <>
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-400 shadow" style={{ left: `${(x(h) / W) * 100}%`, top: `${(y(yday[h]) / H) * 100}%` }} />
          {today[h] !== null && <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow" style={{ left: `${(x(h) / W) * 100}%`, top: `${(y(today[h]) / H) * 100}%` }} />}
          <div className={cx("pointer-events-none absolute top-1 z-10 w-52 rounded-lg px-3 py-2 text-xs shadow-lg ring-1", dark ? "bg-slate-900/95 text-white ring-white/10" : "bg-white text-slate-700 ring-slate-200")}
            style={{ left: `calc(${(x(h) / W) * 100}% ${h > 15 ? "- 13.5rem" : "+ 0.75rem"})` }}>
            <div className={cx("mb-1 font-semibold", dark ? "text-white" : "text-slate-900")}>Până la ora {String(h + 1).padStart(2, "0")}:00</div>
            <TipRow c="bg-brand" l="Azi" v={today[h] !== null ? lei(today[h]) : "—"} sub={today[h] !== null ? `${hours.slice(0, h + 1).reduce((s2, x2) => s2 + x2.orders, 0)} comenzi` : ""} />
            <TipRow c="bg-slate-400" l="Ieri" v={lei(yday[h])} sub={`${hours.slice(0, h + 1).reduce((s2, x2) => s2 + x2.y_orders, 0)} comenzi`} />
            <div className={cx("mt-1 border-t pt-1", dark ? "border-white/10" : "border-slate-100")}>
              <TipRow l={`Doar ora ${h}`} v={`${hours[h].orders} vs ${hours[h].y_orders} com.`} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TipRow({ c, l, v, sub }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="inline-flex items-center gap-1.5">{c && <span className={cx("h-2 w-2 rounded-full", c)} />}{l}</span>
      <span className="text-right font-semibold tabular">{v}{sub && <span className="ml-1 font-normal opacity-60">· {sub}</span>}</span>
    </div>
  );
}

function Spark({ data, dark }) {
  const [h, setH] = useState(null);
  const W = 120, H = 34, P = 3;
  const max = Math.max(1, ...data);
  const x = (i) => P + (i / (data.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const li = data.length - 1;
  const label = (i) => (i === li ? "ultimele 24 h" : i === li - 1 ? "acum 1–2 zile" : `acum ${li - i}–${li - i + 1} zile`);
  return (
    <div className="relative" onMouseLeave={() => setH(null)}
      onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setH(Math.max(0, Math.min(li, Math.round(((e.clientX - r.left) / r.width) * li)))); }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full cursor-crosshair" aria-hidden="true">
        <path d={`${d} L${x(li)},${H} L${x(0)},${H} Z`} fill="#E91E63" opacity={dark ? 0.18 : 0.08} />
        <path d={d} fill="none" stroke={dark ? "rgba(255,255,255,.35)" : "#cbd5e1"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={`M${x(li - 1)},${y(data[li - 1])} L${x(li)},${y(data[li])}`} fill="none" stroke="#E91E63" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand" style={{ left: `${(x(li) / W) * 100}%`, top: `${(y(data[li]) / H) * 100}%` }} />
      {h !== null && <span className={cx("pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow", h === li ? "bg-brand" : "bg-slate-500")} style={{ left: `${(x(h) / W) * 100}%`, top: `${(y(data[h]) / H) * 100}%` }} />}
      {h !== null && (
        <div className={cx("pointer-events-none absolute -top-8 z-10 whitespace-nowrap rounded-md px-2 py-1 text-[11px] shadow ring-1", dark ? "bg-slate-900 text-white ring-white/10" : "bg-white text-slate-700 ring-slate-200")}
          style={{ left: `${(x(h) / W) * 100}%`, transform: `translateX(${h > li / 2 ? "-100%" : "0"})` }}>
          <strong>{data[h]} buc</strong> · {label(h)}
        </div>
      )}
    </div>
  );
}

const THEMES = {
  light: {
    page: "", card: "rounded-xl bg-white ring-1 ring-slate-200 shadow-sm", muted: "text-slate-500", faint: "text-slate-400",
    strong: "text-slate-900", label: "text-xs font-medium uppercase tracking-wide text-slate-500", track: "bg-slate-100",
    barY: "bg-slate-200", rowHover: "hover:bg-slate-50", divide: "divide-slate-100", border: "border-slate-100", thumb: "bg-slate-100",
    btn: "ring-1 ring-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900", up: "text-emerald-600", down: "text-red-600",
  },
  dark: {
    page: "dash-bg min-h-dvh p-5 text-white lg:p-8", card: "dash-card", muted: "text-white/55", faint: "text-white/35",
    strong: "text-white", label: "text-xs font-medium uppercase tracking-widest text-white/50", track: "bg-white/10",
    barY: "bg-white/15", rowHover: "", divide: "divide-white/5", border: "border-white/10", thumb: "bg-white/10",
    btn: "border border-white/10 text-white/60 hover:bg-white/10 hover:text-white", up: "text-emerald-400", down: "text-rose-400",
  },
};

function Delta2({ now, before, label, t }) {
  if (!before) return <span className={t.faint}>{label}: —</span>;
  const p = Math.round(((now - before) / before) * 100);
  const up = p >= 0;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className={cx("inline-flex items-center gap-0.5 font-semibold", up ? t.up : t.down)}>{up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{up ? "+" : ""}{p}%</span>
      <span className={t.muted}>{label}</span>
    </span>
  );
}

export default function Dashboard({ tv = false }) {
  const nav = useNavigate();
  const t = THEMES[tv ? "dark" : "light"];
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
  useEffect(() => { const i = setInterval(() => tick((v) => v + 1), 15000); return () => clearInterval(i); }, []);

  const [hoverH, setHoverH] = useState(null); // ora evidențiată, comună graficului și barelor
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
  const today = new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" });

  return (
    <div className={t.page}>
      {/* antet — la fel ca restul platformei */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className={cx("flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest", tv ? "text-white/50" : "text-slate-400")}>
            <span className="relative flex h-2 w-2"><span className="dash-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-500" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            Dashboard · live
          </div>
          <h1 className={cx("mt-1 text-2xl font-bold tracking-tight sm:text-3xl", t.strong)}>Vânzările de azi</h1>
          <div className={cx("mt-1 text-sm capitalize", t.muted)}>{today}{d?.last_sync ? ` · actualizat ${ago(d.last_sync)}` : ""}</div>
        </div>
        <div className="flex items-center gap-3">
          {tv && <Clock />}
          <button onClick={fullscreen} className={cx("inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors", t.btn)}>
            {tv ? <><Minimize2 className="h-4 w-4" /> Ieși din modul ecran</> : <><Maximize2 className="h-4 w-4" /> Mod ecran (TV)</>}
          </button>
        </div>
      </div>
      {err && <div className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">Nu pot încărca datele: {err}</div>}
      {!d ? <div className={cx("py-32 text-center", t.faint)}>Se încarcă…</div> : (
        <>
          {/* cifrele zilei */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={cx(t.card, "col-span-2 p-5 lg:col-span-1")}>
              <div className={t.label}>Vânzări azi</div>
              <div key={pop} className={cx("dash-pop mt-1 text-3xl font-bold tabular tracking-tight text-brand", tv && "text-5xl")}>{lei(revenue)}</div>
              <div className="mt-2"><Delta2 now={d.revenue} before={d.y_revenue_same} label="vs ieri la ora asta" t={t} /></div>
              <div className={cx("mt-0.5 text-xs", t.faint)}>ieri până la ora asta: {lei(d.y_revenue_same)}</div>
            </div>
            <div className={cx(t.card, "p-5")}>
              <div className={t.label}>Comenzi</div>
              <div key={`o${pop}`} className={cx("dash-pop mt-1 text-3xl font-bold tabular", t.strong, tv && "text-5xl")}>{Math.round(orders)}</div>
              <div className="mt-2"><Delta2 now={d.orders} before={d.y_orders_same} label="vs ieri" t={t} /></div>
              <div className={cx("mt-0.5 text-xs", t.faint)}>{d.last_hour} în ultima oră{d.cancelled ? ` · ${d.cancelled} anulate` : ""}</div>
            </div>
            <div className={cx(t.card, "p-5")}>
              <div className={t.label}>Valoare medie</div>
              <div className={cx("mt-1 text-3xl font-bold tabular", t.strong, tv && "text-5xl")}>{lei(aov)}</div>
              <div className={cx("mt-2 text-sm", t.muted)}>{d.units} produse vândute</div>
            </div>
            <div className={cx(t.card, "col-span-2 p-5 lg:col-span-1")}>
              <div className={t.label}>Procesare</div>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between"><span className={cx("inline-flex items-center gap-2 text-sm", t.muted)}><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Confirmate</span><span className={cx("text-lg font-bold tabular", t.strong)}>{d.confirmed}</span></div>
                <div className="flex items-center justify-between"><span className={cx("inline-flex items-center gap-2 text-sm", t.muted)}><Truck className="h-4 w-4 text-sky-500" /> AWB emise azi</span><span className={cx("text-lg font-bold tabular", t.strong)}>{d.awb_today}</span></div>
                {d.best_hour && <div className="flex items-center justify-between"><span className={cx("inline-flex items-center gap-2 text-sm", t.muted)}><Zap className="h-4 w-4 text-amber-500" /> Ora de vârf</span><span className={cx("text-sm font-semibold", t.strong)}>{d.best_hour.hour}:00 · {d.best_hour.orders} com.</span></div>}
              </div>
            </div>
          </div>

          {d.hot?.length > 0 && (
            <div className={cx(t.card, "mt-4")}>
              <div className={cx("flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5", t.border)}>
                <div className={cx("inline-flex items-center gap-2 text-sm font-semibold", t.strong)}><Flame className="h-4 w-4 text-orange-500" /> Produse hot</div>
                <div className={cx("text-xs", t.muted)}>vânzările din ultimele 24 h față de media zilnică din cele 7 zile dinainte</div>
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                {d.hot.slice(0, tv ? 4 : 8).map((p) => (
                  <div key={p.variant_id} className={cx("rounded-lg p-3 ring-1", tv ? "bg-white/[.03] ring-white/10" : "bg-slate-50/60 ring-slate-200")}>
                    <div className="flex items-start gap-3">
                      {p.image ? <img src={p.image} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-white object-cover ring-1 ring-slate-200" /> : <div className={cx("h-11 w-11 shrink-0 rounded-lg", t.thumb)} />}
                      <div className="min-w-0 flex-1">
                        <div className={cx("line-clamp-2 text-sm font-medium leading-snug", t.strong)} title={p.title}>{p.title}{p.variant ? ` — ${p.variant}` : ""}</div>
                      </div>
                      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular", p.growth === null ? "bg-violet-100 text-violet-700" : "bg-orange-100 text-orange-700")}>
                        {p.growth === null ? "NOU" : `+${p.growth}%`}
                      </span>
                    </div>
                    <div className="mt-2"><Spark data={p.trend} dark={tv} /></div>
                    <div className={cx("mt-1 flex items-center justify-between text-xs", t.muted)}>
                      <span><strong className={cx("text-sm tabular", t.strong)}>{p.last24}</strong> buc în 24 h</span>
                      <span>media {p.avg7}/zi</span>
                    </div>
                    {p.on_hand !== undefined && p.on_hand !== null && (
                      <div className={cx("mt-1 text-xs", p.on_hand < p.last24 * 2 ? "font-semibold text-red-600" : t.faint)}>
                        stoc {p.on_hand} buc{p.on_hand < p.last24 * 2 ? " · ajunge sub 2 zile" : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* evoluția zilei */}
            <div className={cx(t.card, "p-5 xl:col-span-2")}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className={cx("text-sm font-semibold", t.strong)}>Vânzări pe parcursul zilei</div>
                <div className={cx("flex items-center gap-4 text-xs", t.muted)}>
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-brand" /> Azi</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-slate-400" /> Ieri</span>
                </div>
              </div>
              <div className={tv ? "h-44" : "h-52"}><CumulativeChart hours={d.hours} nowHour={nowHour} dark={tv} hover={hoverH} setHover={setHoverH} /></div>
              <div className={cx("mt-3 border-t pt-3", t.border)}>
                <div className={cx("mb-1 text-xs", t.muted)}>Comenzi pe oră (azi față de ieri)</div>
                <div className="flex h-16 items-end gap-1">
                  {d.hours.map((h) => (
                    <div key={h.hour} onMouseEnter={() => setHoverH(h.hour)} onMouseLeave={() => setHoverH(null)}
                      className={cx("relative flex flex-1 cursor-default flex-col items-center gap-1 rounded transition-colors", hoverH === h.hour && (tv ? "bg-white/5" : "bg-slate-100"))}>
                      {hoverH === h.hour && (
                        <div className={cx("pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] shadow ring-1", tv ? "bg-slate-900 text-white ring-white/10" : "bg-white text-slate-700 ring-slate-200",
                          h.hour > 18 ? "right-0" : h.hour < 4 ? "left-0" : "left-1/2 -translate-x-1/2")}>
                          <strong>Ora {h.hour}</strong> · azi {h.orders} com. ({lei(h.revenue)}) · ieri {h.y_orders}
                        </div>
                      )}
                      <div className="flex h-12 w-full items-end justify-center gap-[2px]">
                        <div className={cx("w-1/3 rounded-t", t.barY)} style={{ height: `${(h.y_orders / maxH) * 100}%` }} />
                        <div className={cx("w-1/2 rounded-t", h.hour === nowHour ? "bg-brand" : "bg-brand/50")} style={{ height: `${(h.orders / maxH) * 100}%` }} />
                      </div>
                      <div className={cx("text-[10px] tabular", h.hour === nowHour ? cx("font-bold", t.strong) : t.faint)}>{h.hour}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* comenzi în timp real */}
            <div className={cx(t.card, "flex flex-col overflow-hidden", tv ? "max-h-[420px]" : "max-h-[460px]")}>
              <div className={cx("flex items-center justify-between border-b px-5 py-3.5", t.border)}>
                <div className={cx("text-sm font-semibold", t.strong)}>Comenzi în timp real</div>
                {d.last_order_at && <div className={cx("text-xs", t.faint)}>ultima {ago(d.last_order_at)}</div>}
              </div>
              <div className={cx("min-h-0 flex-1 divide-y overflow-y-auto", t.divide)}>
                {d.feed.map((o) => (
                  <div key={o.order_id} className={cx("flex items-center gap-3 px-5 py-2.5", fresh.has(o.order_id) && "dash-new", o.cancelled && "opacity-40")}>
                    {o.image ? <img src={o.image} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-cover ring-1 ring-slate-200" /> : <div className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", t.thumb)}><Package className={cx("h-4 w-4", t.faint)} /></div>}
                    <div className="min-w-0 flex-1">
                      <div className={cx("truncate text-sm font-medium", t.strong)}>{o.items.join(" + ") || "—"}</div>
                      <div className={cx("truncate text-xs", t.muted)}>{o.name} · {o.customer}{o.city ? `, ${o.city}` : ""}{o.cancelled ? " · anulată" : ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={cx("text-sm font-semibold tabular", t.strong)}>{lei(o.total)}</div>
                      <div className={cx("text-[11px] tabular", t.faint)}>{hm(o.created_at)}{o.confirmed && <CheckCircle2 className="ml-1 inline h-3 w-3 text-emerald-500" />}</div>
                    </div>
                  </div>
                ))}
                {d.feed.length === 0 && <div className={cx("px-5 py-8 text-center text-sm", t.faint)}>Nicio comandă încă azi.</div>}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className={cx(t.card, "xl:col-span-2")}>
              <div className={cx("border-b px-5 py-3.5 text-sm font-semibold", t.border, t.strong)}>Top produse azi</div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 p-5 md:grid-cols-2">
                {d.top_products.slice(0, tv ? 6 : 10).map((p, i) => (
                  <div key={p.variant_id} className="flex items-center gap-3">
                    <div className={cx("w-5 text-center text-sm font-bold tabular", i < 3 ? "text-brand" : t.faint)}>{i + 1}</div>
                    {p.image ? <img src={p.image} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-cover ring-1 ring-slate-200" /> : <div className={cx("h-10 w-10 shrink-0 rounded-lg", t.thumb)} />}
                    <div className="min-w-0 flex-1">
                      <div className={cx("truncate text-sm font-medium", t.strong)} title={p.title}>{p.title}{p.variant ? ` — ${p.variant}` : ""}</div>
                      <div className={cx("mt-1.5 h-1.5 overflow-hidden rounded-full", t.track)}>
                        <div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${(p.qty / maxQty) * 100}%` }} />
                      </div>
                    </div>
                    <div className="w-12 shrink-0 text-right"><span className={cx("text-base font-bold tabular", t.strong)}>{p.qty}</span><span className={cx("ml-0.5 text-xs", t.faint)}>buc</span></div>
                  </div>
                ))}
                {d.top_products.length === 0 && <div className={cx("text-sm", t.faint)}>Încă nicio comandă azi.</div>}
              </div>
            </div>
            <div className={t.card}>
              <div className={cx("border-b px-5 py-3.5 text-sm font-semibold", t.border, t.strong)}>Județe azi</div>
              <div className="space-y-2.5 p-5">
                {d.top_counties.slice(0, tv ? 5 : 8).map((c) => (
                  <div key={c.county} className="flex items-center gap-3 text-sm">
                    <MapPin className={cx("h-4 w-4 shrink-0", t.faint)} />
                    <div className={cx("w-28 shrink-0 truncate", t.strong)}>{c.county}</div>
                    <div className={cx("h-2 flex-1 overflow-hidden rounded-full", t.track)}><div className="h-full rounded-full bg-slate-400 transition-all duration-700" style={{ width: `${(c.orders / maxCounty) * 100}%` }} /></div>
                    <div className={cx("w-8 text-right font-semibold tabular", t.strong)}>{c.orders}</div>
                  </div>
                ))}
                {d.top_counties.length === 0 && <div className={cx("text-sm", t.faint)}>—</div>}
              </div>
            </div>
          </div>
          <div className={cx("mt-4 text-center text-xs", t.faint)}>Se actualizează automat la 20 de secunde · valori cu TVA, comenzi neanulate</div>
        </>
      )}
    </div>
  );
}
