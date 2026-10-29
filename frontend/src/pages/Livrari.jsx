import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Settings2, Download, Search, AlertTriangle, PackageX, PackageCheck, Truck, Clock, Wallet, Ban, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtAgo, fmtDate, glsTrackUrl, money } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Select, Spinner, cx, useToast } from "../components/ui";

const LUNI = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Noi", "Dec"];
const LUNI_LUNG = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const monthLabel = (p) => { const [y, m] = p.split("-"); return `${LUNI_LUNG[Number(m) - 1]} ${y}`; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")));
const pct = (v) => (v === null || v === undefined ? "—" : `${v.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%`);
const int = (v) => Number(v || 0).toLocaleString("ro-RO");

function presets() {
  const t = new Date();
  const first = new Date(t.getFullYear(), t.getMonth(), 1);
  const prevFirst = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const prevLast = new Date(t.getFullYear(), t.getMonth(), 0);
  const back = (n) => { const d = new Date(t); d.setDate(d.getDate() - n); return d; };
  return [
    { k: "luna", label: `${LUNI_LUNG[t.getMonth()]} (luna curentă)`, from: iso(first), to: iso(t) },
    { k: "luna-trecuta", label: LUNI_LUNG[prevFirst.getMonth()], from: iso(prevFirst), to: iso(prevLast) },
    { k: "30", label: "Ultimele 30 de zile", from: iso(back(29)), to: iso(t) },
    { k: "90", label: "Ultimele 90 de zile", from: iso(back(89)), to: iso(t) },
  ];
}

// culoarea ratei de livrare față de media perioadei
function rateCls(rate, avg) {
  if (rate === null || rate === undefined || avg === null || avg === undefined) return "text-slate-400";
  if (rate < avg - 5) return "text-red-600 font-semibold";
  if (rate < avg - 2) return "text-amber-600 font-semibold";
  if (rate > avg + 2) return "text-emerald-700 font-semibold";
  return "text-slate-700";
}

export default function Livrari() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const P = useMemo(presets, []);
  const [range, setRange] = useState({ k: "30", from: P[2].from, to: P[2].to });
  const [d, setD] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([api(`/livrari/summary?frm=${range.from}&to=${range.to}`), api("/livrari/trend?months=12")]);
      setD(s); setTrend(t);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, range.from, range.to]); // eslint-disable-line
  const st = d?.status;
  useEffect(() => {
    if (!st?.tracking_running && !st?.orders_backfill_running) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [st?.tracking_running, st?.orders_backfill_running]); // eslint-disable-line

  if (!isAdmin) return <Card className="p-6 text-sm text-slate-500">Modulul Analiza livrări este disponibil doar pentru administratori.</Card>;
  if (!d) return <PageLoader />;
  const T = d.totals;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Modul · Livrări · doar admin</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Analiza livrărilor</h1>
          <div className="mt-1 text-sm text-slate-500">
            Comenzi expediate în interval, după data primului colet · {int(st.tracked_awbs)} AWB-uri verificate în GLS
            {st.tracking_last_run && ` · ultima verificare ${fmtAgo(st.tracking_last_run)}`}
          </div>
        </div>
        <div className="flex gap-2">
          <TrackBtn status={st} onDone={load} />
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /> Costuri</Button>
        </div>
      </div>

      <StatusBanners st={st} />

      <Card className="mb-5 flex flex-wrap items-center gap-2 p-3">
        {P.map((p) => (
          <button key={p.k} onClick={() => setRange({ k: p.k, from: p.from, to: p.to })}
            className={cx("rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset",
              range.k === p.k ? "bg-brand-50 text-brand ring-brand/30" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}>
            {p.label}
          </button>
        ))}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Input type="date" className="h-9 w-full min-w-0 sm:w-40" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ k: "custom", from: e.target.value, to: range.to })} />
          <span className="text-slate-400">–</span>
          <Input type="date" className="h-9 w-full min-w-0 sm:w-40" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ k: "custom", from: range.from, to: e.target.value })} />
          {loading && <Spinner className="h-4 w-4" />}
        </div>
      </Card>

      <div className={cx("transition-opacity", loading && "opacity-60")}>
        <Kpis T={T} days={d.settings.stale_days} />
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <LossCard T={T} costs={d.costs} />
          <ReasonsCard reasons={d.reasons} total={T.returned + T.lost} />
        </div>
        <Insights d={d} />
        <ProductsTable rows={d.products} avg={T.rate} />
        <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
          <GroupTable title="Rata de livrare pe județe" keyName="county" colLabel="Județ" rows={d.counties} avg={T.rate} />
          <GroupTable title="Rata de livrare după valoarea comenzii" keyName="bucket" colLabel="Valoare comandă" rows={d.buckets} avg={T.rate} noSearch />
        </div>
        <RepeatCustomers rows={d.repeat_customers} />
        <RefusedList rows={d.refused} store={d.shop_store} range={range} />
        {d.stale.length > 0 && <StaleList rows={d.stale} store={d.shop_store} days={d.settings.stale_days} />}
      </div>
      {trend && <TrendTable months={trend.months} />}
      {settingsOpen && <SettingsModal d={d} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />}
    </div>
  );
}

function StatusBanners({ st }) {
  return (
    <>
      {!st.orders_have_awbs && (
        <div className="mb-4 rounded-xl bg-sky-50 px-5 py-3 text-sm text-sky-800 ring-1 ring-sky-200">
          <RefreshCw className={cx("mr-2 inline h-4 w-4", st.orders_backfill_running && "animate-spin")} />
          Se aduc din Shopify AWB-urile, județele și valorile inițiale ale comenzilor
          {st.orders_backfill_running ? ` (${int(st.orders_backfill_count)} comenzi până acum)` : " — pornește automat în câteva minute"}.
          Până atunci cifrele sunt incomplete.
        </div>
      )}
      {!st.gls_configured && (
        <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          GLS nu este configurat, așa că refuzurile se văd doar dacă sunt marcate în Shopify. Configurează GLS din Setări → Integrări.
        </div>
      )}
      {st.tracking_running && (
        <div className="mb-4 rounded-xl bg-sky-50 px-5 py-3 text-sm text-sky-800 ring-1 ring-sky-200">
          <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
          Se verifică AWB-urile în GLS: {int(st.tracking_done)} din {int(st.tracking_total)}. Cifrele se actualizează singure.
        </div>
      )}
      {st.tracking_error && !st.tracking_running && (
        <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">Ultima verificare GLS a dat eroare: {st.tracking_error}</div>
      )}
    </>
  );
}

function TrackBtn({ status, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" loading={busy} disabled={status.tracking_running || !status.gls_configured} onClick={async () => {
      setBusy(true);
      try { await api("/livrari/track", { method: "POST" }); toast.success("Verificarea AWB-urilor a pornit"); setTimeout(onDone, 3000); }
      catch (e) { toast.error(e.message); } finally { setBusy(false); }
    }}><RefreshCw className="h-4 w-4" /> Verifică AWB-urile în GLS</Button>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = "slate" }) {
  const tones = { slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-600", amber: "bg-amber-50 text-amber-700", brand: "bg-brand-50 text-brand" };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className={cx("flex h-7 w-7 items-center justify-center rounded-lg", tones[tone])}><Icon className="h-4 w-4" /></span>{label}
      </div>
      <div className="mt-2 whitespace-nowrap text-xl font-bold tabular tracking-tight 2xl:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

function Kpis({ T, days }) {
  const pending = T.in_progress + T.stale;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={Truck} label="Comenzi expediate" value={int(T.orders)} sub={`${int(T.parcels)} colete`} />
      <Kpi icon={PackageCheck} label="Rată de livrare" value={pct(T.rate)} tone="green" sub={`${int(T.delivered)} livrate din ${int(T.delivered + T.returned + T.lost)} finalizate`} />
      <Kpi icon={PackageX} label="Refuzate / returnate" value={int(T.returned + T.lost)} tone="red" sub={`${pct(T.refusal_rate)} din comenzile finalizate`} />
      <Kpi icon={Clock} label="În curs" value={int(pending)} tone="amber" sub={T.stale ? `${int(T.stale)} fără status de peste ${days} de zile` : "încă pe drum"} />
      <Kpi icon={Wallet} label="Bani pierduți pe refuzuri" value={money(T.loss)} tone="brand" sub={`${money(T.avg_loss)} / comandă refuzată, fără TVA`} />
      <Kpi icon={Ban} label="Valoare comenzi refuzate" value={money(T.value_returned)} sub="vânzări (cu TVA) care nu s-au încasat" />
    </div>
  );
}

function LossCard({ T, costs }) {
  const P = T.loss_parts || {};
  const items = [
    { k: "courier", label: "Curier (transport dus)", sub: `${money(costs.ship)} / colet` },
    { k: "return", label: "Curier retur", sub: costs.return ? `${money(costs.return)} / colet` : "0 — returul e gratuit în contract" },
    { k: "packing", label: "Coletare / ambalare", sub: `${money(costs.pack)} / colet` },
    { k: "ads", label: "Reclamă cheltuită pe comandă (CPA)", sub: costs.include_ads ? "reclame ÷ comenzi plasate în luna comenzii (din modulul Profit)" : "dezactivat în Costuri" },
  ];
  const max = Math.max(1, ...items.map((i) => P[i.k] || 0));
  return (
    <Card title="Unde se duc banii pe comenzile refuzate">
      <div className="space-y-3 px-5 py-4 text-sm">
        {items.map((i) => (
          <div key={i.k}>
            <div className="flex items-baseline justify-between gap-3">
              <div>{i.label}<div className="text-xs text-slate-500">{i.sub}</div></div>
              <div className="whitespace-nowrap font-semibold tabular">{money(P[i.k] || 0)}</div>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${((P[i.k] || 0) / max) * 100}%` }} /></div>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t border-slate-100 pt-3 font-semibold">
          <div>Total pierdut (fără TVA)</div><div className="tabular">{money(T.loss)}</div>
        </div>
        {costs.include_ads && Object.keys(costs.cpa || {}).length === 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">Nu ai introdus reclamele în modulul Profit, așa că costul reclamei per comandă e 0.</div>
        )}
        {!costs.ship && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">Costul curierului per colet nu e setat. Apasă „Costuri”.</div>}
      </div>
    </Card>
  );
}

function ReasonsCard({ reasons, total }) {
  return (
    <Card title="Motivele refuzurilor (din GLS)">
      <div className="space-y-3 px-5 py-4 text-sm">
        {reasons.length === 0 && <div className="py-6 text-center text-slate-500">Nicio comandă refuzată în interval.</div>}
        {reasons.map((r) => (
          <div key={r.reason}>
            <div className="flex justify-between gap-3"><span>{r.reason}</span><span className="tabular text-slate-600">{int(r.count)} · {pct(total ? (r.count / total) * 100 : 0)}</span></div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-red-400" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Insights({ d }) {
  const avg = d.totals.rate;
  const worstProducts = d.products.filter((p) => p.orders >= 10 && p.rate !== null && avg !== null && p.rate < avg - 5).slice(0, 5);
  const worstCounties = d.counties.filter((c) => c.orders >= 15 && c.rate !== null && avg !== null && c.rate < avg - 5).slice(0, 5);
  if (!worstProducts.length && !worstCounties.length) return null;
  return (
    <Card className="mt-5 border-l-4 border-l-red-400 p-5">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-red-500" /> Unde pierzi cei mai mulți bani</div>
      <div className="mt-3 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        {worstProducts.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Produse cu livrare sub medie ({pct(avg)})</div>
            <ul className="space-y-1">{worstProducts.map((p) => (
              <li key={p.title} className="flex justify-between gap-3"><span className="truncate">{p.title}</span><span className="whitespace-nowrap tabular"><span className="text-red-600">{pct(p.rate)}</span> · {money(p.loss)}</span></li>
            ))}</ul>
          </div>
        )}
        {worstCounties.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Județe cu livrare sub medie</div>
            <ul className="space-y-1">{worstCounties.map((c) => (
              <li key={c.county} className="flex justify-between gap-3"><span>{c.county}</span><span className="whitespace-nowrap tabular"><span className="text-red-600">{pct(c.rate)}</span> · {money(c.loss)}</span></li>
            ))}</ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Th({ children, right, onClick, active }) {
  return (
    <th onClick={onClick} className={cx("whitespace-nowrap px-4 py-3", right && "text-right", onClick && "cursor-pointer select-none hover:text-slate-800", active && "text-slate-900")}>
      {children}{active && " ↓"}
    </th>
  );
}

const SORTS = {
  loss: (a, b) => b.loss - a.loss,
  refusal: (a, b) => (b.refusal_rate ?? -1) - (a.refusal_rate ?? -1),
  orders: (a, b) => b.orders - a.orders,
  rate: (a, b) => (a.rate ?? 101) - (b.rate ?? 101),
};

function StatRow({ r, avg, name }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="max-w-[340px] truncate px-4 py-2.5 font-medium" title={name}>{name}</td>
      <td className="px-4 py-2.5 text-right tabular">{int(r.orders)}</td>
      <td className="px-4 py-2.5 text-right tabular text-emerald-700">{int(r.delivered)}</td>
      <td className="px-4 py-2.5 text-right tabular text-red-600">{int(r.returned + r.lost)}</td>
      <td className="px-4 py-2.5 text-right tabular text-slate-500">{int(r.in_progress + r.stale)}</td>
      <td className={cx("px-4 py-2.5 text-right tabular", rateCls(r.rate, avg))}>{pct(r.rate)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{money(r.loss)}</td>
    </tr>
  );
}

function ProductsTable({ rows, avg }) {
  const [q, setQ] = useState("");
  const [min, setMin] = useState("5");
  const [sort, setSort] = useState("loss");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.orders >= Number(min) && (!s || r.title.toLowerCase().includes(s))).sort(SORTS[sort]);
  }, [rows, q, min, sort]);
  const shown = all ? list : list.slice(0, 25);
  return (
    <Card className="mt-5 overflow-hidden" title="Rata de livrare pe produse"
      actions={<span className="text-xs font-normal text-slate-500">pierderea unei comenzi cu mai multe produse se împarte între ele</span>}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-9 pl-9" placeholder="Caută produs" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-44">
          <Select className="h-9" value={min} onChange={(e) => setMin(e.target.value)}>
            {["1", "5", "10", "20", "50"].map((v) => <option key={v} value={v}>minim {v} comenzi</option>)}
          </Select>
        </div>
        <span className="text-xs text-slate-500 sm:ml-auto">{list.length} produse · roșu = livrare cu peste 5 puncte sub medie ({pct(avg)})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Th>Produs</Th>
              <Th right onClick={() => setSort("orders")} active={sort === "orders"}>Comenzi</Th>
              <Th right>Livrate</Th>
              <Th right onClick={() => setSort("refusal")} active={sort === "refusal"}>Refuzate</Th>
              <Th right>În curs</Th>
              <Th right onClick={() => setSort("rate")} active={sort === "rate"}>Rată livrare</Th>
              <Th right onClick={() => setSort("loss")} active={sort === "loss"}>Bani pierduți</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => <StatRow key={r.title} r={r} avg={avg} name={r.title} />)}
            {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Niciun produs pentru filtrele alese.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 25 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-center">
          <button className="text-sm font-medium text-brand hover:underline" onClick={() => setAll(!all)}>{all ? "Arată mai puține" : `Arată toate cele ${list.length} produse`}</button>
        </div>
      )}
    </Card>
  );
}

function GroupTable({ title, keyName, colLabel, rows, avg, noSearch }) {
  const [sort, setSort] = useState(noSearch ? null : "loss");
  const [all, setAll] = useState(false);
  const list = useMemo(() => (sort ? [...rows].sort(SORTS[sort]) : rows), [rows, sort]);
  const shown = all || noSearch ? list : list.slice(0, 15);
  return (
    <Card className="overflow-hidden" title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Th>{colLabel}</Th>
              <Th right onClick={noSearch ? undefined : () => setSort("orders")} active={sort === "orders"}>Comenzi</Th>
              <Th right>Livrate</Th>
              <Th right onClick={noSearch ? undefined : () => setSort("refusal")} active={sort === "refusal"}>Refuzate</Th>
              <Th right>În curs</Th>
              <Th right onClick={noSearch ? undefined : () => setSort("rate")} active={sort === "rate"}>Rată</Th>
              <Th right onClick={noSearch ? undefined : () => setSort("loss")} active={sort === "loss"}>Pierdut</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => <StatRow key={r[keyName]} r={r} avg={avg} name={r[keyName]} />)}
          </tbody>
        </table>
      </div>
      {!noSearch && list.length > 15 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-center">
          <button className="text-sm font-medium text-brand hover:underline" onClick={() => setAll(!all)}>{all ? "Arată mai puține" : `Arată toate (${list.length})`}</button>
        </div>
      )}
    </Card>
  );
}

function RepeatCustomers({ rows }) {
  if (!rows.length) return null;
  return (
    <Card className="mt-5 overflow-hidden" title={`Clienți care au refuzat de cel puțin 2 ori (${rows.length})`}
      actions={<span className="text-xs font-normal text-slate-500">după numărul de telefon · candidați pentru confirmare telefonică sau plată în avans</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Th>Client</Th><Th>Telefon</Th><Th>Județ</Th><Th right>Comenzi</Th><Th right>Livrate</Th><Th right>Refuzate</Th><Th right>Pierdut</Th><Th>Comenzi refuzate</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.phone} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{r.customer || "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular">{r.phone}</td>
                <td className="px-4 py-2.5">{r.county}</td>
                <td className="px-4 py-2.5 text-right tabular">{r.orders}</td>
                <td className="px-4 py-2.5 text-right tabular text-emerald-700">{r.delivered}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular text-red-600">{r.returned}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{money(r.loss)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{r.last.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const orderUrl = (store, id) => (store && id ? `https://admin.shopify.com/store/${store}/orders/${id}` : null);
const prodText = (p) => Object.entries(p || {}).map(([t, q]) => (q > 1 ? `${q} × ${t}` : t)).join(", ");

function csv(rows, range) {
  const head = ["Comanda", "Data expedierii", "Client", "Telefon", "Judet", "Localitate", "Valoare (lei)", "Produse", "Motiv", "AWB", "Colete", "Pierdere (lei, fara TVA)"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.name, fmtDate(r.ship_at), r.customer, r.phone, r.county, r.city, r.value.toFixed(2).replace(".", ","),
    prodText(r.products), r.reason || "", r.awbs.join(" "), r.parcels, r.loss.toFixed(2).replace(".", ",")].map(esc).join(";"));
  const blob = new Blob(["﻿" + [head.map(esc).join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `comenzi-refuzate_${range.from}_${range.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function OrderRows({ rows, store, showLoss = true }) {
  return rows.map((r) => (
    <tr key={r.order_id} className="hover:bg-slate-50">
      <td className="whitespace-nowrap px-4 py-2.5 font-medium">
        {orderUrl(store, r.order_id)
          ? <a href={orderUrl(store, r.order_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">{r.name}<ExternalLink className="h-3 w-3" /></a>
          : r.name}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 tabular text-slate-500">{fmtDate(r.ship_at)}</td>
      <td className="px-4 py-2.5">{r.customer}<div className="text-xs text-slate-500">{[r.city, r.county].filter(Boolean).join(", ")}</div></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{money(r.value)}</td>
      <td className="max-w-[280px] px-4 py-2.5 text-xs text-slate-600">{prodText(r.products)}</td>
      <td className="px-4 py-2.5 text-xs">{r.reason || "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
        {r.awbs.map((a) => <a key={a} href={glsTrackUrl(a)} target="_blank" rel="noreferrer" className="block text-brand hover:underline">{a}</a>)}
      </td>
      {showLoss && <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{money(r.loss)}</td>}
    </tr>
  ));
}

function RefusedList({ rows, store, range }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.name, r.customer, r.phone, r.county, r.city, prodText(r.products), r.awbs.join(" ")].join(" ").toLowerCase().includes(s));
  }, [rows, q]);
  const shown = all ? list : list.slice(0, 30);
  return (
    <Card className="mt-5 overflow-hidden" title={`Comenzi refuzate / returnate (${rows.length})`}
      actions={<Button size="sm" variant="outline" disabled={!rows.length} onClick={() => csv(list, range)}><Download className="h-3.5 w-3.5" /> Export CSV</Button>}>
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-9 pl-9" placeholder="Caută comandă, client, telefon, produs, AWB" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Th>Comanda</Th><Th>Expediată</Th><Th>Client</Th><Th right>Valoare</Th><Th>Produse</Th><Th>Motiv</Th><Th>AWB</Th><Th right>Pierdut</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <OrderRows rows={shown} store={store} />
            {shown.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Nicio comandă refuzată.</td></tr>}
          </tbody>
        </table>
      </div>
      {list.length > 30 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-center">
          <button className="text-sm font-medium text-brand hover:underline" onClick={() => setAll(!all)}>{all ? "Arată mai puține" : `Arată toate cele ${list.length}`}</button>
        </div>
      )}
    </Card>
  );
}

function StaleList({ rows, store, days }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mt-5 overflow-hidden" title={`Comenzi fără status final de peste ${days} de zile (${rows.length})`}
      actions={<Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Ascunde" : "Arată"}</Button>}>
      {open && (
        <>
          <div className="px-5 py-3 text-xs text-slate-500">Nu apar livrate în Shopify și GLS nu a raportat livrare sau retur. Merită verificate în MyGLS: pot fi colete pierdute sau rambursuri neîncasate.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <Th>Comanda</Th><Th>Expediată</Th><Th>Client</Th><Th right>Valoare</Th><Th>Produse</Th><Th>Motiv</Th><Th>AWB</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100"><OrderRows rows={rows} store={store} showLoss={false} /></tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function TrendTable({ months }) {
  if (!months.length) return null;
  return (
    <Card className="mt-5 overflow-hidden" title="Evoluție lunară (după luna expedierii)">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <Th>Luna</Th><Th right>Expediate</Th><Th right>Livrate</Th><Th right>Refuzate</Th><Th right>În curs</Th><Th>Rată livrare</Th><Th right>Bani pierduți</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {months.map((m) => (
              <tr key={m.period} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">{monthLabel(m.period)}</td>
                <td className="px-4 py-2.5 text-right tabular">{int(m.orders)}</td>
                <td className="px-4 py-2.5 text-right tabular text-emerald-700">{int(m.delivered)}</td>
                <td className="px-4 py-2.5 text-right tabular text-red-600">{int(m.returned + m.lost)}</td>
                <td className="px-4 py-2.5 text-right tabular text-slate-500">{int(m.in_progress + m.stale)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 rounded-full bg-red-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${m.rate ?? 0}%` }} /></div>
                    <span className="tabular">{pct(m.rate)}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{money(m.loss)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Rata se calculează din comenzile cu rezultat final (livrate + refuzate). Lunile recente au încă comenzi în curs.</div>
    </Card>
  );
}

function SettingsModal({ d, onClose, onSaved }) {
  const toast = useToast();
  const s = d.settings;
  const [f, setF] = useState({
    shipping_cost: s.shipping_cost ?? "", packing_cost: s.packing_cost ?? "", return_cost: s.return_cost ?? 0,
    include_ads: s.include_ads, stale_days: s.stale_days ?? 30,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api("/livrari/settings", { method: "PUT", body: {
        shipping_cost: num(f.shipping_cost), packing_cost: num(f.packing_cost), return_cost: num(f.return_cost) || 0,
        include_ads: f.include_ads, stale_days: Number(f.stale_days) || 30,
      } });
      toast.success("Costuri salvate"); onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Costul unei comenzi refuzate"
      footer={<><Button variant="outline" onClick={onClose}>Renunță</Button><Button onClick={save} loading={busy}>Salvează</Button></>}>
      <div className="space-y-4 text-sm">
        <div className="text-xs text-slate-500">Toate sumele sunt în lei, fără TVA, per colet. Câmpurile goale iau valoarea din Profit → Setări firmă.</div>
        <Field label="Curier — transport dus per colet" hint="Include taxa de combustibil, rambursul și SMS-ul (costul mediu din factura GLS).">
          <Input inputMode="decimal" value={f.shipping_cost} onChange={(e) => setF({ ...f, shipping_cost: e.target.value })} placeholder={`din Profit: ${d.costs.ship} lei`} />
        </Field>
        <Field label="Curier — retur per colet" hint="GLS nu taxează returul coletelor refuzate. Pune o valoare doar dacă se schimbă contractul.">
          <Input inputMode="decimal" value={f.return_cost} onChange={(e) => setF({ ...f, return_cost: e.target.value })} />
        </Field>
        <Field label="Coletare / ambalare per colet">
          <Input inputMode="decimal" value={f.packing_cost} onChange={(e) => setF({ ...f, packing_cost: e.target.value })} placeholder={`din Profit: ${d.costs.pack} lei`} />
        </Field>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.include_ads} onChange={(e) => setF({ ...f, include_ads: e.target.checked })} />
          <span><strong>Adaugă costul reclamei pentru comandă (CPA)</strong>
            <span className="block text-xs text-slate-500">Reclamele introduse în Profit pentru luna comenzii, împărțite la comenzile plasate în acea lună. Sunt bani cheltuiți ca să obții o comandă care nu s-a încasat.</span></span>
        </label>
        <div className="w-48">
          <Field label="Fără status după (zile)"><Input inputMode="numeric" value={f.stale_days} onChange={(e) => setF({ ...f, stale_days: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
