import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, ChevronLeft, ChevronRight, PackageCheck, PackageOpen, Truck, Gauge, ClipboardList, AlertTriangle, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { fmtAgo } from "../lib/format";
import { Button, Card, Empty, PageLoader, cx, useToast } from "../components/ui";

const ZILE = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"];
const dayLabel = (d) => { const x = new Date(`${d}T12:00:00`); return `${ZILE[x.getDay()]}, ${x.toLocaleDateString("ro-RO", { day: "numeric", month: "long" })}`; };
const shift = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }) : "—");
const dm = (iso) => (iso ? new Date(iso).toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }) : "—");
const items = (p) => (p.items || []).map((i) => `${i.qty > 1 ? `${i.qty} × ` : ""}${i.title}`).join(" + ");

export default function Depot() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const day = params.get("zi") || "";
  const load = () => api(`/depozit${day ? `?day=${day}` : ""}`).then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { setD(null); load(); }, [day]); // eslint-disable-line
  useEffect(() => {
    if (!d?.is_today) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [d?.is_today, day]); // eslint-disable-line
  const refresh = async () => {
    setBusy(true);
    try { await api("/depozit/refresh", { method: "POST" }); await load(); toast.success("Actualizat din Shopify și GLS"); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!d) return <PageLoader />;
  const maxH = Math.max(1, ...d.per_hour.map((h) => h.count));
  const nowH = new Date().getHours();
  const pctPicked = d.emitted ? Math.round((d.picked / d.emitted) * 100) : 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Modul · Depozit</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Fluxul depozitului</h1>
          <div className="mt-1 text-sm text-slate-500">
            {d.is_today ? "Se actualizează singur la fiecare minut" : "Zi încheiată"}
            {d.last_sync && ` · comenzi din Shopify ${fmtAgo(d.last_sync)}`}{d.last_gls_check && ` · scanări GLS ${fmtAgo(d.last_gls_check)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setParams({ zi: shift(d.day, -1) })}><ChevronLeft className="h-4 w-4" /></Button>
          <input type="date" value={d.day} max={d.today} onChange={(e) => setParams(e.target.value ? { zi: e.target.value } : {})}
            className="h-9 rounded-lg border-0 px-3 text-sm font-semibold ring-1 ring-inset ring-slate-300 outline-none focus:ring-2 focus:ring-brand" />
          <Button variant="outline" size="sm" disabled={d.is_today} onClick={() => setParams(shift(d.day, 1) >= d.today ? {} : { zi: shift(d.day, 1) })}><ChevronRight className="h-4 w-4" /></Button>
          {!d.is_today && <Button variant="outline" size="sm" onClick={() => setParams({})}>Azi</Button>}
          <Button variant="outline" loading={busy} onClick={refresh}><RefreshCw className="h-4 w-4" /> Actualizează acum</Button>
        </div>
      </div>
      <div className="mb-4 text-lg font-semibold capitalize">{dayLabel(d.day)}{d.is_today && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-xs font-semibold normal-case text-emerald-700 ring-1 ring-emerald-200">azi · live</span>}</div>
      {d.last_error && <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">Ultima actualizare a dat eroare: {d.last_error}</div>}
      {!d.gls_configured && <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">GLS nu e configurat — nu se pot verifica scanările coletelor.</div>}

      {d.old_waiting.length > 0 && (
        <Card className="mb-4 overflow-hidden ring-red-200">
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4" /> {d.old_waiting.length} {d.old_waiting.length === 1 ? "colet emis în zilele anterioare nu a fost" : "colete emise în zilele anterioare nu au fost"} scanat{d.old_waiting.length === 1 ? "" : "e"} de GLS
          </div>
          <ParcelList list={d.old_waiting} showDay />
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icon={PackageOpen} label="AWB-uri emise" value={d.emitted} sub={`${d.orders} comenzi${d.cancelled ? ` · ${d.cancelled} anulate` : ""}`} />
        <Kpi icon={Truck} label="Preluate de GLS" value={d.picked} sub={d.emitted ? `${pctPicked}% scanate${d.last_pick_at ? ` · ultima ${hm(d.last_pick_at)}` : ""}` : "—"} good={d.emitted > 0 && d.picked === d.emitted} />
        <Kpi icon={PackageCheck} label="Rămase în depozit" value={d.waiting} sub="AWB emis, nescanat de GLS" warn={d.waiting > 0} />
        <Kpi icon={Gauge} label="Ritm de coletare" value={`${d.rate_per_hour}/oră`} sub={d.first_at ? `${hm(d.first_at)} – ${hm(d.last_at)}` : "niciun AWB încă"} />
        <Kpi icon={ClipboardList} label="Confirmate de expediat" value={d.backlog} sub={d.backlog_oldest ? `cea mai veche: ${d.backlog_oldest.name} (${dm(d.backlog_oldest.created_at)})` : "volum de lucru rămas"} />
      </div>

      <Card className="mb-4 p-5">
        <div className="mb-3 text-sm font-semibold">AWB-uri emise pe ore</div>
        <div className="flex h-40 items-end gap-1.5">
          {d.per_hour.map((h) => (
            <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-[11px] font-semibold tabular text-slate-600">{h.count || ""}</div>
              <div className={cx("w-full rounded-t", d.is_today && h.hour === nowH ? "bg-brand" : "bg-brand/40")} style={{ height: `${(h.count / maxH) * 100}%`, minHeight: h.count ? 4 : 0 }} />
              <div className="text-[10px] tabular text-slate-400">{h.hour}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="font-semibold">Rămase în depozit ({d.waiting})</div>
            <div className="text-xs text-slate-500">AWB emis, GLS nu l-a scanat încă</div>
          </div>
          {d.waiting_list.length ? <ParcelList list={d.waiting_list} /> : <div className="px-5 py-6 text-sm text-slate-500">{d.emitted ? "Toate coletele au fost preluate de GLS." : "Niciun AWB emis."}</div>}
        </Card>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="font-semibold">Preluate de GLS ({d.picked})</div>
            <div className="text-xs text-slate-500">scanate la depozitul curierului</div>
          </div>
          {d.picked_list.length ? <ParcelList list={d.picked_list} picked /> : <div className="px-5 py-6 text-sm text-slate-500">Niciun colet scanat încă. GLS scanează de obicei seara, la depozitul lor.</div>}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-semibold">Ce s-a coletat</div>
          {d.products.length === 0 ? <Empty title="Nimic încă" /> : (
            <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
              {d.products.map((p) => (
                <div key={p.title + p.sku} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-10 text-right font-bold tabular">{p.qty}</span>
                  <span className="min-w-0 flex-1"><span className="line-clamp-1">{p.title}</span>{p.sku && <span className="text-xs text-slate-400">{p.sku}</span>}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 font-semibold">Ultimele 14 zile</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Ziua</th><th className="px-3 py-2.5 text-right">Emise</th><th className="px-3 py-2.5 text-right">Preluate</th>
                <th className="px-3 py-2.5 text-right">Aceeași zi</th><th className="px-3 py-2.5 text-right">Rămase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.history.map((h) => (
                <tr key={h.day} onClick={() => setParams(h.day === d.today ? {} : { zi: h.day })} className={cx("cursor-pointer hover:bg-slate-50", h.day === d.day && "bg-brand-50/60")}>
                  <td className="px-4 py-2 capitalize">{dayLabel(h.day)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular">{h.emitted}</td>
                  <td className="px-3 py-2 text-right tabular">{h.picked}</td>
                  <td className="px-3 py-2 text-right tabular text-slate-500">{h.emitted ? Math.round((h.same_day / h.emitted) * 100) : 0}%</td>
                  <td className={cx("px-3 py-2 text-right tabular", h.waiting && h.day !== d.today ? "font-semibold text-red-600" : "text-slate-400")}>{h.waiting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon: I, label, value, sub, warn, good }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500"><I className="h-3.5 w-3.5" /> {label}</div>
      <div className={cx("mt-1 text-2xl font-bold tabular", warn && "text-amber-600", good && "text-emerald-600")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

function ParcelList({ list, picked, showDay }) {
  return (
    <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
      {list.map((p) => (
        <div key={p.awb} className="flex items-start gap-3 px-5 py-2.5 text-sm">
          <div className="w-14 shrink-0 text-xs tabular text-slate-500">{showDay ? dm(p.emitted_at) : hm(p.emitted_at)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="font-semibold">{p.order_name}</span>
              {p.has_awb ? <a href={`https://gls-group.com/RO/ro/urmarire-colet/?match=${p.awb}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-xs text-brand hover:underline">{p.awb} <ExternalLink className="h-3 w-3" /></a>
                : <span className="text-xs text-amber-600">fără AWB în Shopify</span>}
              <span className="text-xs text-slate-400">{[p.customer, p.city].filter(Boolean).join(" · ")}</span>
            </div>
            <div className="line-clamp-1 text-xs text-slate-500">{items(p)}</div>
          </div>
          <div className="shrink-0 text-right text-xs">
            {picked ? <><div className="font-semibold text-emerald-700">preluat {hm(p.picked_at)}</div><div className="text-slate-400">{p.picked_depot || ""}</div></>
              : <div className={cx(p.late ? "font-semibold text-red-600" : "text-amber-600")}>{p.late ? "nescanat" : "în depozit"}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
