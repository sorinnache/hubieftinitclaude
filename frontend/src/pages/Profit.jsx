import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, AlertTriangle, Plus, Trash2, TrendingUp, TrendingDown, Settings2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtAgo, money } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Select, cx, useToast } from "../components/ui";

const LUNI = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const label = (p) => { const [y, m] = p.split("-"); return `${LUNI[Number(m) - 1]} ${y}`; };
const num = (v) => (v === "" || v === null || v === undefined ? 0 : Number(String(v).replace(",", ".")) || 0);

export default function Profit() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [sum, setSum] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const load = () => api("/profit/summary").then(setSum).catch((e) => toast.error(e.message));
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]); // eslint-disable-line
  useEffect(() => {
    if (!sum?.settings?.backfill_running) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [sum?.settings?.backfill_running]); // eslint-disable-line

  if (!isAdmin) return <Card className="p-6 text-sm text-slate-500">Modulul Profit este disponibil doar pentru administratori.</Card>;
  if (!sum) return <PageLoader />;
  const s = sum.settings;
  const period = params.get("luna") || sum.months[0]?.period;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Modul · Profit · doar admin</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Profit lunar</h1>
          <div className="mt-1 text-sm text-slate-500">
            {s.vat_payer ? `Plătitor de TVA (${s.vat_rate}%)` : "Neplătitor de TVA"} ·{" "}
            {s.tax_regime === "profit" ? `impozit pe profit ${s.profit_tax_rate}%` : s.tax_regime === "micro" ? `impozit micro ${s.micro_rate}%` : "fără impozit"} ·{" "}
            {sum.orders_synced} comenzi sincronizate{s.last_sync && ` · actualizat ${fmtAgo(s.last_sync)}`}
          </div>
        </div>
        <div className="flex gap-2">
          <SyncBtn onDone={load} />
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /> Setări firmă</Button>
        </div>
      </div>
      {s.backfill_running && (
        <div className="mb-4 rounded-xl bg-sky-50 px-5 py-3 text-sm text-sky-800 ring-1 ring-sky-200">
          <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />Se aduc comenzile din Shopify începând cu {label(s.backfill_from)}: {s.backfill_count || 0} comenzi până acum. Poate dura câteva minute; cifrele se actualizează singure.
        </div>
      )}
      {s.last_error && <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">Ultima sincronizare a dat eroare: {s.last_error}</div>}
      {!s.parcel_cost && <div className="mb-4 rounded-xl bg-amber-50 px-5 py-3 text-sm text-amber-800 ring-1 ring-amber-200">Nu ai setat costul de coletare per colet. Apasă „Setări firmă”.</div>}

      <MonthPicker periods={sum.months.map((m) => m.period)} value={period} onChange={(p) => setParams({ luna: p })} />
      {period && <MonthDetail key={period} period={period} onSaved={load} />}
      <div className="mb-2 mt-8 text-sm font-semibold text-slate-700">Toate lunile</div>
      <MonthsTable months={sum.months} active={period} onPick={(p) => { setParams({ luna: p }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      {settingsOpen && <SettingsModal s={s} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />}
    </div>
  );
}

function MonthPicker({ periods, value, onChange }) {
  const i = periods.indexOf(value);
  const older = periods[i + 1], newer = periods[i - 1];
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-600"><CalendarDays className="h-4 w-4" /> Luna verificată:</div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={!older} onClick={() => onChange(older)} title="Luna anterioară"><ChevronLeft className="h-4 w-4" /></Button>
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-52 font-semibold">
          {periods.map((p) => <option key={p} value={p}>{label(p)}</option>)}
        </Select>
        <Button variant="outline" size="sm" disabled={!newer} onClick={() => onChange(newer)} title="Luna următoare"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="text-xs text-slate-500">Costurile cu reclamele le introduci în dreapta, pentru luna aleasă aici.</div>
    </Card>
  );
}

function SyncBtn({ onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" loading={busy} onClick={async () => {
      setBusy(true);
      try { await api("/profit/sync", { method: "POST" }); toast.success("Sincronizarea a pornit — cifrele se actualizează în câteva minute"); setTimeout(onDone, 4000); }
      catch (e) { toast.error(e.message); } finally { setBusy(false); }
    }}><RefreshCw className="h-4 w-4" /> Actualizează comenzile</Button>
  );
}

function MonthsTable({ months, active, onPick }) {
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Luna</th>
              <th className="px-4 py-3 text-right">Plasate</th>
              <th className="px-4 py-3 text-right">Livrate</th>
              <th className="px-4 py-3 text-right">Vânzări livrate</th>
              <th className="px-4 py-3 text-right">Colete trimise</th>
              <th className="px-4 py-3 text-right">Costuri totale</th>
              <th className="px-4 py-3 text-right">Profit net</th>
              <th className="px-4 py-3 text-right">Marjă</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {months.map((m) => (
              <tr key={m.period} onClick={() => onPick(m.period)} className={cx("cursor-pointer hover:bg-slate-50", m.period === active && "bg-brand-50/60")}>
                <td className="px-4 py-2.5 font-medium">
                  {label(m.period)}
                  {m.ads_total === 0 && <span className="ml-2 text-xs font-normal text-amber-600">reclame neintroduse</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular text-slate-500">{m.orders_placed}</td>
                <td className="px-4 py-2.5 text-right tabular">{m.orders_delivered}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{money(m.gross_sales)}</td>
                <td className="px-4 py-2.5 text-right tabular">{m.parcels}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{money(m.total_costs + m.tax)}</td>
                <td className={cx("whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular", m.net_profit < 0 ? "text-red-600" : "text-emerald-700")}>{money(m.net_profit)}</td>
                <td className="px-4 py-2.5 text-right tabular text-slate-500">{m.margin}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Line({ label: l, value, sub, neg, strong, big }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-2", strong && "font-semibold", big && "text-lg")}>
      <div className="min-w-0">
        <div>{l}</div>
        {sub && <div className="text-xs font-normal text-slate-500">{sub}</div>}
      </div>
      <div className={cx("whitespace-nowrap tabular", neg && "text-red-600")}>{neg ? "− " : ""}{money(Math.abs(value))}</div>
    </div>
  );
}

function MonthDetail({ period, onSaved }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(`/profit/month/${period}`).then((x) => {
    setD(x);
    setF({
      ads_facebook: x.inputs.ads_facebook || "", ads_google: x.inputs.ads_google || "", ads_tiktok: x.inputs.ads_tiktok || "",
      other_costs: x.inputs.other_costs || "", other_note: x.inputs.other_note || "",
      parcel_cost: x.inputs.parcel_cost ?? "",
      fixed_costs: x.inputs.fixed_costs, // null = cele implicite din setări
    });
  }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [period]); // eslint-disable-line
  const dirty = useMemo(() => d && f && JSON.stringify({
    a: num(f.ads_facebook), b: num(f.ads_google), c: num(f.ads_tiktok), o: num(f.other_costs), n: f.other_note,
    p: f.parcel_cost === "" ? null : num(f.parcel_cost), x: f.fixed_costs,
  }) !== JSON.stringify({
    a: num(d.inputs.ads_facebook), b: num(d.inputs.ads_google), c: num(d.inputs.ads_tiktok), o: num(d.inputs.other_costs), n: d.inputs.other_note || "",
    p: d.inputs.parcel_cost ?? null, x: d.inputs.fixed_costs,
  }), [d, f]);
  const save = async () => {
    setBusy(true);
    try {
      const x = await api(`/profit/month/${period}`, { method: "PUT", body: {
        ads_facebook: num(f.ads_facebook), ads_google: num(f.ads_google), ads_tiktok: num(f.ads_tiktok),
        other_costs: num(f.other_costs), other_note: f.other_note,
        parcel_cost: f.parcel_cost === "" ? null : num(f.parcel_cost),
        fixed_costs: f.fixed_costs ? f.fixed_costs.map((c) => ({ name: c.name, amount: num(c.amount) })) : null,
      } });
      setD(x); toast.success("Salvat"); onSaved?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!d || !f) return <PageLoader />;
  const k = d.vat_payer ? "" : " (cu TVA inclus, firma nu își recuperează TVA-ul)";
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-lg font-bold">{label(period)}</div>
          <div className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", d.net_profit < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
            {d.net_profit < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />} {money(d.net_profit)}
          </div>
        </div>
        <div className="divide-y divide-slate-100 px-5 py-2 text-sm">
          <Line label="Vânzări livrate (cu TVA)" value={d.gross_sales} sub={`${d.orders_delivered} livrate din ${d.orders_placed} comenzi plasate în lună (${d.orders_placed ? Math.round(d.orders_delivered / d.orders_placed * 100) : 0}%) · valoare medie ${money(d.aov)}`} />
          {d.vat_payer && <Line label={`TVA colectat`} value={d.vat_collected} neg sub="se plătește la stat" />}
          <Line label={d.vat_payer ? "Venituri fără TVA" : "Venituri"} value={d.revenue} strong />
          <Line label="Cost marfă vândută (COGS)" value={d.cogs} neg sub={`din costurile setate în Shopify, fără TVA${k}`} />
          <Line label="Coletare" value={d.courier} neg
            sub={`${d.parcels} colete trimise pentru comenzile plasate în lună (${d.shipped_orders} comenzi, inclusiv cele refuzate)${d.return_pickups ? ` + ${d.return_pickups} ridicări retur` : ""} × ${money(d.parcel_cost)}${k}`} />
          <Line label="Reclame" value={d.ads_total} neg
            sub={`Facebook ${money(d.ads.facebook)} · Google ${money(d.ads.google)} · TikTok ${money(d.ads.tiktok)}${d.roas ? ` · ROAS ${d.roas}` : ""}`} />
          <Line label="Costuri fixe lunare" value={d.fixed} neg sub={(d.fixed_list || []).map((c) => `${c.name} ${money(c.amount)}`).join(" · ") || "nesetate"} />
          {d.other > 0 && <Line label="Alte costuri" value={d.other} neg sub={d.other_note} />}
          <Line label="Profit înainte de impozit" value={d.profit_before_tax} strong neg={d.profit_before_tax < 0} />
          <Line label={d.tax_label} value={d.tax} neg />
          <Line label="Profit net rămas în firmă" value={d.net_profit} strong big neg={d.net_profit < 0} sub={`marjă netă ${d.margin}% din venituri`} />
        </div>
        {d.missing_cost.length > 0 && (
          <div className="m-5 mt-0 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
            <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Produse livrate fără COGS în Shopify — costul lor nu e inclus, deci profitul e supraestimat</div>
            <ul className="mt-2 space-y-0.5 text-xs">
              {d.missing_cost.slice(0, 15).map((m) => <li key={m.variant_id || m.title}>{m.qty} × {m.title}{m.sku ? ` (${m.sku})` : ""}</li>)}
              {d.missing_cost.length > 15 && <li>… și încă {d.missing_cost.length - 15}</li>}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-5 py-4 font-semibold">Costuri introduse pentru {label(period)}</div>
        <div className="space-y-3 px-5 py-4">
          <div className="text-xs text-slate-500">Sumele se introduc <strong>fără TVA</strong>, în lei.</div>
          <Field label="Reclame Facebook / Meta"><Input inputMode="decimal" value={f.ads_facebook} onChange={(e) => setF({ ...f, ads_facebook: e.target.value })} placeholder="0" /></Field>
          <Field label="Reclame Google"><Input inputMode="decimal" value={f.ads_google} onChange={(e) => setF({ ...f, ads_google: e.target.value })} placeholder="0" /></Field>
          <Field label="Reclame TikTok"><Input inputMode="decimal" value={f.ads_tiktok} onChange={(e) => setF({ ...f, ads_tiktok: e.target.value })} placeholder="0" /></Field>
          <Field label="Cost coletare per colet în această lună"><Input inputMode="decimal" value={f.parcel_cost} onChange={(e) => setF({ ...f, parcel_cost: e.target.value })} placeholder={`implicit din setări (${d.parcel_cost} lei)`} /></Field>
          <div>
            <div className="mb-1 flex items-center justify-between text-sm font-medium text-slate-700">
              <span>Costuri fixe în această lună</span>
              {f.fixed_costs === null
                ? <button className="text-xs font-medium text-brand hover:underline" onClick={() => setF({ ...f, fixed_costs: (d.fixed_list || []).map((c) => ({ ...c })) })}>Modifică doar pentru luna asta</button>
                : <button className="text-xs font-medium text-slate-500 hover:underline" onClick={() => setF({ ...f, fixed_costs: null })}>Revino la cele din setări</button>}
            </div>
            {f.fixed_costs === null
              ? <div className="text-xs text-slate-500">Se folosesc costurile fixe din setări: {money(d.fixed)}</div>
              : <FixedEditor list={f.fixed_costs} onChange={(l) => setF({ ...f, fixed_costs: l })} />}
          </div>
          <Field label="Alte costuri în această lună (opțional)"><Input inputMode="decimal" value={f.other_costs} onChange={(e) => setF({ ...f, other_costs: e.target.value })} placeholder="0" /></Field>
          {num(f.other_costs) > 0 && <Field label="Ce reprezintă"><Input value={f.other_note} onChange={(e) => setF({ ...f, other_note: e.target.value })} placeholder="ex. reparație, consultanță" /></Field>}
          <Button className="w-full" onClick={save} loading={busy} disabled={!dirty}>Salvează și recalculează</Button>
        </div>
      </Card>
    </div>
  );
}

function FixedEditor({ list, onChange }) {
  return (
    <div className="space-y-2">
      {list.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={c.name} placeholder="ex. Chirie depozit" onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input inputMode="decimal" className="w-28 shrink-0 text-right" value={c.amount} placeholder="lei" onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <button onClick={() => onChange(list.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <button onClick={() => onChange([...list, { name: "", amount: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" /> Adaugă cost fix</button>
    </div>
  );
}

function SettingsModal({ s, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...s, fixed_costs: (s.fixed_costs || []).map((c) => ({ ...c })) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.backfill_from !== s.backfill_from && !window.confirm(`Schimbi luna de început? Hub-ul va aduce din nou toate comenzile din Shopify începând cu ${label(f.backfill_from)} (poate dura câteva minute).`)) return;
    setBusy(true);
    try {
      await api("/profit/settings", { method: "PUT", body: {
        vat_payer: f.vat_payer, vat_rate: num(f.vat_rate), tax_regime: f.tax_regime, profit_tax_rate: num(f.profit_tax_rate),
        micro_rate: num(f.micro_rate), parcel_cost: num(f.parcel_cost), include_return_pickups: f.include_return_pickups,
        fixed_costs: f.fixed_costs.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), amount: num(c.amount) })),
        backfill_from: f.backfill_from,
      } });
      if (f.backfill_from !== s.backfill_from) await api("/profit/sync", { method: "POST" }).catch(() => {});
      toast.success("Setări salvate"); onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} wide title="Setări firmă pentru calculul profitului"
      footer={<><Button variant="outline" onClick={onClose}>Renunță</Button><Button onClick={save} loading={busy}>Salvează</Button></>}>
      <div className="space-y-5 text-sm">
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.vat_payer} onChange={(e) => setF({ ...f, vat_payer: e.target.checked })} />
            <span><strong>Firma este plătitoare de TVA</strong>
              <span className="block text-xs text-slate-500">Din vânzări se scade TVA-ul colectat. Costurile (marfă, curier, reclame) se iau fără TVA. Dacă firma nu e plătitoare, TVA-ul plătit furnizorilor se adaugă la costuri.</span></span>
          </label>
          <div className="mt-3 w-40"><Field label="Cotă TVA (%)"><Input inputMode="decimal" value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} /></Field></div>
        </div>
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <Field label="Impozitare">
            <Select value={f.tax_regime} onChange={(e) => setF({ ...f, tax_regime: e.target.value })}>
              <option value="profit">Plătitoare de impozit pe profit</option>
              <option value="micro">Microîntreprindere (impozit pe venit)</option>
              <option value="none">Fără impozit (doar pentru simulare)</option>
            </Select>
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {f.tax_regime === "profit" && <Field label="Cotă impozit pe profit (%)"><Input inputMode="decimal" value={f.profit_tax_rate} onChange={(e) => setF({ ...f, profit_tax_rate: e.target.value })} /></Field>}
            {f.tax_regime === "micro" && <Field label="Cotă impozit micro (%)"><Input inputMode="decimal" value={f.micro_rate} onChange={(e) => setF({ ...f, micro_rate: e.target.value })} /></Field>}
          </div>
          <div className="mt-2 text-xs text-slate-500">Impozitul pe profit se calculează lunar, doar pe lunile cu profit (estimare; declarația oficială o face contabilul).</div>
        </div>
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <div className="w-56"><Field label="Cost coletare per colet (lei, fără TVA)"><Input inputMode="decimal" value={f.parcel_cost} onChange={(e) => setF({ ...f, parcel_cost: e.target.value })} /></Field></div>
          <div className="mt-1 text-xs text-slate-500">Se înmulțește cu toate coletele trimise în lună (comenzi Fulfilled), inclusiv cele refuzate de clienți. Îl poți schimba pe o anumită lună din pagina lunii.</div>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.include_return_pickups} onChange={(e) => setF({ ...f, include_return_pickups: e.target.checked })} />
            <span>Adaugă și ridicările de retur chemate din hub (curier la client)</span>
          </label>
        </div>
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <div className="mb-2 font-semibold">Costuri fixe lunare (fără TVA)</div>
          <FixedEditor list={f.fixed_costs} onChange={(l) => setF({ ...f, fixed_costs: l })} />
          <div className="mt-2 text-xs text-slate-500">ex. salarii (cost total angajator), chirie depozit, contabilitate, abonamente Shopify și aplicații, telefonie.</div>
        </div>
        <div className="rounded-xl p-4 ring-1 ring-slate-200">
          <div className="w-56"><Field label="Calculează începând cu luna"><Input type="month" value={f.backfill_from} onChange={(e) => setF({ ...f, backfill_from: e.target.value })} /></Field></div>
        </div>
      </div>
    </Modal>
  );
}
