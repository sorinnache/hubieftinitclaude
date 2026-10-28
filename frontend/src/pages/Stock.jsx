import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, RefreshCw, Package, AlertTriangle, Boxes, ClipboardList, Plus, Trash2, Layers, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtAgo } from "../lib/format";
import { Button, Card, Empty, Field, Input, Modal, PageLoader, Pill, Select, Textarea, cx, useToast } from "../components/ui";

const TYPES = {
  inventar: { label: "Inventar", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  intrare: { label: "Intrare marfă", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  vanzare: { label: "Vânzare (AWB)", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  awb_anulat: { label: "AWB anulat", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  retur: { label: "Retur recepționat", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  refuzat: { label: "Colet refuzat", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  ajustare: { label: "Ajustare", cls: "bg-orange-50 text-orange-700 ring-orange-200" },
};

const TABS = [
  { id: "stoc", label: "Stocuri" },
  { id: "inventar", label: "Inventar" },
  { id: "intrari", label: "Intrări marfă" },
  { id: "miscari", label: "Mișcări" },
  { id: "setari", label: "Setări", admin: true },
];

export const productName = (r) => `${r.product_title || ""}${r.variant_title ? ` — ${r.variant_title}` : ""}`;

function Thumb({ src }) {
  return src ? <img src={src} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md bg-slate-100 object-cover" />
    : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300"><Package className="h-4 w-4" /></div>;
}

function Qty({ v, strong }) {
  return <span className={cx("tabular", v < 0 ? "font-semibold text-red-600" : v === 0 ? "text-slate-400" : strong && "font-semibold")}>{v}</span>;
}

export default function Stock() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id || "stoc";
  const [summary, setSummary] = useState(null);
  const nav = useNavigate();
  const loadSummary = () => api("/stock/summary").then(setSummary).catch(() => {});
  useEffect(() => { loadSummary(); }, [tab]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Modul · Stocuri</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Stocuri depozit</h1>
          {summary && (
            <div className="mt-1 text-sm text-slate-500">
              {summary.started ? `Urmărire pornită ${fmtDateTime(summary.start_at)}` : "Urmărirea pornește după primul inventar"}
              {` · rezervări din ultimele ${summary.reserve_days || 30} de zile`}
              {summary.last_order_sync && ` · comenzi sincronizate ${fmtAgo(summary.last_order_sync)}`}
            </div>
          )}
        </div>
        <SyncButton onDone={loadSummary} />
      </div>
      {summary?.last_error && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">Ultima sincronizare Shopify a dat eroare ({fmtDateTime(summary.last_error_at)}): {summary.last_error}</div>}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id })}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "stoc" && <StockList summary={summary} onChanged={loadSummary} goInventory={() => nav("/stocuri/inventar")} />}
      {tab === "inventar" && <Inventory summary={summary} onDone={loadSummary} />}
      {tab === "intrari" && <Receipts />}
      {tab === "miscari" && <Movements />}
      {tab === "setari" && <StockSettings summary={summary} onSaved={setSummary} />}
    </div>
  );
}

function SyncButton({ onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" loading={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await api("/stock/sync", { method: "POST" });
        toast.success(`Sincronizat: ${r.products?.variants ?? 0} produse, ${r.orders?.orders ?? 0} comenzi actualizate`);
        onDone?.();
      } catch (e) { toast.error(e.message); } finally { setBusy(false); }
    }}>
      <RefreshCw className="h-4 w-4" /> Sincronizează cu Shopify
    </Button>
  );
}

function useItems(view = "active") {
  const [items, setItems] = useState(null);
  const load = () => api(`/stock/items?view=${view}`).then(setItems).catch(() => setItems([]));
  useEffect(() => { setItems(null); load(); }, [view]); // eslint-disable-line
  return [items, load];
}

function StockList({ summary, onChanged, goInventory }) {
  const [view, setView] = useState("active");
  const [items, reload] = useItems(view);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    return s ? items.filter((r) => `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)) : items;
  }, [items, q]);

  return (
    <>
      {summary && !summary.started && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 px-5 py-4 ring-1 ring-brand/20">
          <div className="text-sm"><strong>Primul pas: inventarul inițial.</strong> Numără ce ai în depozit și introdu cantitățile. Din acel moment hub-ul scade automat stocul la fiecare AWB emis.</div>
          <Button onClick={goInventory}><ClipboardList className="h-4 w-4" /> Fă inventarul</Button>
        </div>
      )}
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Bucăți în depozit", summary.units_on_hand, Boxes],
            ["Bucăți rezervate", summary.units_reserved, Package],
            ["Comenzi confirmate de expediat", summary.reserving_orders, ClipboardList],
            ["Produse sub zero", summary.negative, AlertTriangle],
          ].map(([l, v, I]) => (
            <Card key={l} className="p-4">
              <div className="flex items-center gap-2 text-xs text-slate-500"><I className="h-3.5 w-3.5" /> {l}</div>
              <div className={cx("mt-1 text-2xl font-bold tabular", l === "Produse sub zero" && v > 0 && "text-red-600")}>{v}</div>
            </Card>
          ))}
        </div>
      )}
      <Card className="mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută produs sau SKU…" className="pl-9" />
          </div>
          <Select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="active">Produse active</option>
            <option value="reserved">Doar cu rezervări</option>
            <option value="negative">Disponibil sub zero</option>
            <option value="bundles">Pachete</option>
            <option value="untracked">Nu se urmăresc (garanții, servicii)</option>
            <option value="all">Toate (inclusiv draft/arhivate)</option>
          </Select>
        </div>
      </Card>
      {!rows ? <PageLoader /> : rows.length === 0 ? (
        <Card><Empty icon={Package} title="Niciun produs">Apasă „Sincronizează cu Shopify” ca să aduci lista de produse.</Empty></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Produs</th>
                  <th className="hidden px-4 py-3 md:table-cell">SKU</th>
                  <th className="px-4 py-3 text-right">În depozit</th>
                  <th className="px-4 py-3 text-right">Rezervat</th>
                  <th className="px-4 py-3 text-right">Disponibil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.variant_id} onClick={() => setOpen(r.variant_id)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb src={r.image} />
                        <div className="min-w-0">
                          <div className="line-clamp-2 font-medium">{r.product_title}</div>
                          <div className="text-xs text-slate-500">
                            {r.variant_title}
                            {r.bundle && <Pill className="ml-1 bg-violet-50 text-violet-700 ring-violet-200"><Layers className="mr-1 h-3 w-3" />Pachet</Pill>}
                            {r.status !== "ACTIVE" && <Pill className="ml-1 bg-slate-100 text-slate-500 ring-slate-200">{r.status === "DRAFT" ? "Draft" : r.status === "ARCHIVED" ? "Arhivat" : r.status}</Pill>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500 md:table-cell">{r.sku || "—"}</td>
                    {r.bundle ? (
                      <td colSpan={3} className="px-4 py-2.5 text-right text-xs text-slate-500">se pot face <strong className="text-slate-900">{r.bundle_available ?? 0}</strong> pachete din stoc</td>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-right"><Qty v={r.on_hand} /></td>
                        <td className="px-4 py-2.5 text-right">{r.reserved ? <span className="tabular text-amber-600">{r.reserved}</span> : <span className="text-slate-300">0</span>}</td>
                        <td className="px-4 py-2.5 text-right"><Qty v={r.available} strong /></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {open && <ItemModal vid={open} onClose={() => setOpen(null)} onChanged={() => { reload(); onChanged?.(); }} />}
    </>
  );
}

function ProductPicker({ onPick, exclude = [], placeholder = "Caută produsul…", allowBundles = false }) {
  const [items] = useItems("all");
  const [q, setQ] = useState("");
  const res = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!items || s.length < 2) return [];
    return items.filter((r) => !exclude.includes(r.variant_id) && (allowBundles || !r.bundle)
      && `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)).slice(0, 12);
  }, [items, q, exclude, allowBundles]);
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" />
      {res.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
          {res.map((r) => (
            <button key={r.variant_id} type="button" onClick={() => { onPick(r); setQ(""); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
              <Thumb src={r.image} />
              <div className="min-w-0 flex-1">
                <div className="truncate">{productName(r)}</div>
                <div className="text-xs text-slate-500">{r.sku || "fără SKU"} · în depozit {r.on_hand}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemModal({ vid, onClose, onChanged }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [adj, setAdj] = useState({ delta: "", reason: "" });
  const [bundle, setBundle] = useState(null);
  const load = () => api(`/stock/items/${vid}`).then((x) => { setD(x); setBundle((x.bundle_components || []).map((c) => ({ ...c }))); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [vid]); // eslint-disable-line

  const saveAdj = async () => {
    try {
      await api("/stock/adjust", { method: "POST", body: { variant_id: vid, delta: Number(adj.delta), reason: adj.reason } });
      toast.success("Stoc ajustat");
      setAdj({ delta: "", reason: "" });
      load(); onChanged();
    } catch (e) { toast.error(e.message); }
  };
  const saveBundle = async () => {
    try {
      await api(`/stock/items/${vid}/bundle`, { method: "PUT", body: { components: bundle.map((c) => ({ variant_id: c.variant_id, qty: Number(c.qty) || 1 })) } });
      toast.success(bundle.length ? "Pachet salvat" : "Produsul nu mai e pachet");
      load(); onChanged();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <Modal open onClose={onClose} wide title={d ? productName(d) : "Produs"}>
      {!d ? <PageLoader /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Thumb src={d.image} />
            <div className="text-sm text-slate-500">SKU <span className="font-mono text-slate-800">{d.sku || "—"}</span></div>
          </div>
          {!d.bundle && (
            <div className="grid grid-cols-3 gap-3">
              {[["În depozit", d.on_hand], ["Rezervat", d.reserved], ["Disponibil", d.available]].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="text-[11px] text-slate-500">{l}</div>
                  <div className={cx("text-xl font-bold tabular", v < 0 && "text-red-600")}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {d.reserved_orders?.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-semibold">Rezervat pentru comenzile confirmate</div>
              <div className="flex flex-wrap gap-1.5">
                {d.reserved_orders.map((o) => <Pill key={o.order_id + o.qty} className="bg-amber-50 text-amber-800 ring-amber-200">{o.name} · {o.qty} buc</Pill>)}
              </div>
            </div>
          )}

          {!d.bundle && (
            <div className="rounded-xl ring-1 ring-slate-200 p-4">
              <div className="mb-2 text-sm font-semibold">Ajustare manuală</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto]">
                <Input type="number" placeholder="+5 sau -2" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} />
                <Input placeholder="Motiv (ex. produs defect, lipsă la numărare)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                <Button variant="dark" disabled={!Number(adj.delta) || !adj.reason.trim()} onClick={saveAdj}>Aplică</Button>
              </div>
            </div>
          )}

          <div className="rounded-xl ring-1 ring-slate-200 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4" /> Pachet</div>
            <p className="mb-3 text-xs text-slate-500">Dacă acest produs e un pachet, adaugă componentele. La vânzare se scade stocul fiecărei componente, nu al pachetului.</p>
            {bundle?.map((c, i) => (
              <div key={c.variant_id} className="mb-2 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm">{productName(c)}</div>
                <Input type="number" min={1} className="w-20" value={c.qty} onChange={(e) => setBundle(bundle.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <button onClick={() => setBundle(bundle.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <ProductPicker placeholder="Adaugă componentă…" exclude={[vid, ...(bundle || []).map((c) => c.variant_id)]}
              onPick={(r) => setBundle([...(bundle || []), { variant_id: r.variant_id, qty: 1, product_title: r.product_title, variant_title: r.variant_title }])} />
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={saveBundle} disabled={JSON.stringify((bundle || []).map((c) => [c.variant_id, Number(c.qty)])) === JSON.stringify((d.bundle_components || []).map((c) => [c.variant_id, Number(c.qty)]))}>Salvează pachetul</Button>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-xl p-4 text-sm ring-1 ring-slate-200">
            <input type="checkbox" className="mt-0.5 accent-brand" checked={!!d.untracked} onChange={async (e) => {
              try { await api(`/stock/items/${vid}`, { method: "PATCH", body: { untracked: e.target.checked } }); load(); onChanged(); }
              catch (err) { toast.error(err.message); }
            }} />
            <span><strong>Nu urmări stocul acestui produs</strong><span className="block text-xs text-slate-500">Pentru garanții extinse, servicii, produse cadou digitale etc. Dispare din lista de stocuri și din inventar.</span></span>
          </label>

          <div>
            <div className="mb-2 text-sm font-semibold">Istoric mișcări</div>
            {d.movements.length === 0 ? <div className="text-sm text-slate-400">Nicio mișcare încă.</div> : (
              <div className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                {d.movements.map((m) => <MovementRow key={m.id} m={m} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function MovementRow({ m, showProduct }) {
  const t = TYPES[m.type] || { label: m.type, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className={cx("w-14 text-right font-semibold tabular", m.delta > 0 ? "text-emerald-600" : "text-red-600")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
      <Pill className={t.cls}>{t.label}</Pill>
      <div className="min-w-0 flex-1">
        {showProduct && <div className="truncate font-medium">{productName(m)}</div>}
        <div className="truncate text-xs text-slate-500">{[m.ref, m.note, m.via_bundle ? "din pachet" : ""].filter(Boolean).join(" · ") || "—"}</div>
      </div>
      <div className="text-right text-xs text-slate-400">
        <div>sold {m.on_hand_after}</div>
        <div>{fmtDateTime(m.created_at)} · {m.actor}</div>
      </div>
    </div>
  );
}

function Inventory({ summary, onDone }) {
  const toast = useToast();
  const [items, reload] = useItems("active");
  const [counts, setCounts] = useState({});
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const rows = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    return items.filter((r) => !r.bundle && (!s || `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)));
  }, [items, q]);
  const filled = Object.entries(counts).filter(([, v]) => v !== "" && v !== undefined);
  const save = async () => {
    if (!filled.length) return;
    if (!window.confirm(`Salvezi inventarul pentru ${filled.length} produse? Stocul acestor produse devine exact cantitatea numărată.`)) return;
    setBusy(true);
    try {
      const r = await api("/stock/inventory", { method: "POST", body: { items: filled.map(([variant_id, v]) => ({ variant_id, counted: Number(v) })), note } });
      toast.success(r.started ? "Inventar inițial salvat — urmărirea stocului a pornit" : `Inventar salvat (${r.changed} produse modificate)`);
      setCounts({}); setNote("");
      reload(); onDone?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <GuidedInventoryCard />
      <button onClick={() => setManual(!manual)} className="mb-3 text-sm font-medium text-brand hover:underline">
        {manual ? "Ascunde corecția rapidă" : "Corecție rapidă pentru câteva produse (fără inventar complet)"}
      </button>
      {manual && <>
      <Card className="mb-4 p-4 text-sm text-slate-600">
        {summary?.started
          ? "Numără produsele din depozit și scrie cantitatea găsită. Se salvează doar rândurile completate; diferențele apar în registru ca „Inventar”."
          : <><strong className="text-slate-900">Inventar inițial.</strong> Scrie cantitatea pentru fiecare produs pe care îl ai fizic. Produsele lăsate goale rămân cu stoc 0. După salvare, fiecare AWB emis scade automat stocul, iar fiecare comandă confirmată apare ca rezervare.</>}
      </Card>
      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută produs sau SKU…" className="pl-9" />
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observație (ex. Inventar 28.10, raft A)" />
        <Button onClick={save} loading={busy} disabled={!filled.length}><ClipboardList className="h-4 w-4" /> Salvează ({filled.length})</Button>
      </div>
      {!rows ? <PageLoader /> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Produs</th>
                  <th className="px-4 py-3 text-right">În sistem</th>
                  <th className="w-32 px-4 py-3 text-right">Numărat</th>
                  <th className="px-4 py-3 text-right">Diferență</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const v = counts[r.variant_id];
                  const diff = v === undefined || v === "" ? null : Number(v) - r.on_hand;
                  return (
                    <tr key={r.variant_id}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Thumb src={r.image} />
                          <div className="min-w-0">
                            <div className="line-clamp-2">{r.product_title}</div>
                            <div className="text-xs text-slate-500">{[r.variant_title, r.sku].filter(Boolean).join(" · ")}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular text-slate-500">{r.on_hand}</td>
                      <td className="px-4 py-2 text-right">
                        <Input type="number" min={0} inputMode="numeric" className="h-9 w-24 text-right" value={v ?? ""}
                          onChange={(e) => setCounts({ ...counts, [r.variant_id]: e.target.value })} />
                      </td>
                      <td className={cx("px-4 py-2 text-right tabular", diff > 0 && "text-emerald-600", diff < 0 && "text-red-600")}>{diff === null ? "" : diff > 0 ? `+${diff}` : diff}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      </>}
    </div>
  );
}

function GuidedInventoryCard() {
  const nav = useNavigate();
  const [sess, setSess] = useState(undefined);
  const [hist, setHist] = useState([]);
  useEffect(() => {
    api("/stock/inventory/session").then((r) => setSess(r.session)).catch(() => setSess(null));
    api("/stock/inventory/sessions").then(setHist).catch(() => {});
  }, []);
  const last = hist.find((h) => h.status === "done");
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-slate-600">
          <div className="text-base font-semibold text-slate-900">Inventar complet pe telefon</div>
          <div className="mt-1">Ia telefonul în depozit. Fiecare produs apare pe tot ecranul, pe rând; scrii cantitatea găsită și apeși „Salvează” — apare următorul. Nu se poate sări peste niciun produs, iar inventarul se finalizează doar când toate sunt numărate.</div>
          {sess && <div className="mt-2 font-medium text-brand">Inventar în desfășurare: {sess.done} din {sess.total} produse numărate (pornit de {sess.started_by} la {fmtDateTime(sess.started_at)})</div>}
          {!sess && last && <div className="mt-2 text-xs text-slate-500">Ultimul inventar complet: {fmtDateTime(last.finished_at)} de {last.finished_by} · {last.summary?.products} produse, {last.summary?.changed} cu diferențe</div>}
        </div>
        <Button size="lg" disabled={sess === undefined} onClick={() => nav("/stocuri/inventar")}>
          <ClipboardList className="h-5 w-5" /> {sess ? "Continuă inventarul" : "Fă inventarul"}
        </Button>
      </div>
    </Card>
  );
}

function Receipts() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ supplier: "", document: "", note: "" });
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api("/stock/receipts").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api("/stock/receipts", { method: "POST", body: { ...form, items: lines.map((l) => ({ variant_id: l.variant_id, qty: Number(l.qty) })) } });
      toast.success("Intrare înregistrată, stocul a crescut");
      setLines([]); setForm({ supplier: "", document: "", note: "" }); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const valid = lines.length && lines.every((l) => Number(l.qty) > 0);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
      <Card title="Intrare marfă nouă">
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Furnizor"><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
            <Field label="Document (factură / aviz / NIR)"><Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-slate-700">Produse primite</div>
            {lines.map((l, i) => (
              <div key={l.variant_id} className="mb-2 flex items-center gap-2">
                <Thumb src={l.image} />
                <div className="min-w-0 flex-1 truncate text-sm">{productName(l)}</div>
                <Input type="number" min={1} className="w-24 text-right" value={l.qty} autoFocus={i === lines.length - 1}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <ProductPicker exclude={lines.map((l) => l.variant_id)} placeholder="Caută și adaugă produs…"
              onPick={(r) => setLines([...lines, { ...r, qty: "" }])} />
          </div>
          <Field label="Observații"><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <div className="flex justify-end">
            <Button onClick={save} loading={busy} disabled={!valid}><Plus className="h-4 w-4" /> Înregistrează intrarea ({lines.reduce((a, l) => a + (Number(l.qty) || 0), 0)} buc)</Button>
          </div>
        </div>
      </Card>
      <Card title="Intrări recente">
        {!list ? <PageLoader /> : list.length === 0 ? <Empty title="Nicio intrare încă" /> : (
          <div className="divide-y divide-slate-100">
            {list.map((r) => (
              <div key={r.id} className="px-5 py-3 text-sm">
                <div className="font-medium">{[r.supplier, r.document].filter(Boolean).join(" · ") || "Intrare marfă"}</div>
                <div className="text-xs text-slate-500">{r.items.reduce((a, i) => a + i.qty, 0)} buc · {r.items.length} produse · {fmtDateTime(r.created_at)} · {r.created_by}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Movements() {
  const [type, setType] = useState("");
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); api(`/stock/movements?limit=500${type ? `&type=${type}` : ""}`).then(setRows).catch(() => setRows([])); }, [type]);
  return (
    <div>
      <Card className="mb-4 p-3">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="sm:w-64">
          <option value="">Toate mișcările</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Card>
      {!rows ? <PageLoader /> : rows.length === 0 ? <Card><Empty title="Nicio mișcare" /></Card> : (
        <Card className="divide-y divide-slate-100">
          {rows.map((m) => <MovementRow key={m.id} m={m} showProduct />)}
        </Card>
      )}
    </div>
  );
}

function StockSettings({ summary, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(() => { if (summary) setF({ confirm: summary.confirm_tags.join("\n"), cancel: summary.cancel_tags.join("\n"), days: summary.reserve_days || 30 }); }, [summary]);
  if (!f) return <PageLoader />;
  const split = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <Card className="max-w-2xl" title="Reguli comenzi">
      <div className="space-y-4 p-5">
        <Field label="Taguri care înseamnă „comandă confirmată” (unul pe rând)" hint="O comandă cu oricare dintre aceste taguri rezervă stoc până la emiterea AWB-ului. Literele mari/mici și diacriticele nu contează.">
          <Textarea rows={4} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <Field label="Câte zile în urmă se iau în calcul comenzile pentru rezervare" hint="Comenzile confirmate mai vechi de atât nu mai rezervă stoc (sunt considerate abandonate).">
          <Input type="number" min={1} max={365} className="w-32" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        </Field>
        <Field label="Taguri care înseamnă „comandă anulată” (unul pe rând)" hint="O comandă cu oricare dintre aceste taguri nu mai rezervă stoc, chiar dacă fusese confirmată.">
          <Textarea rows={4} value={f.cancel} onChange={(e) => setF({ ...f, cancel: e.target.value })} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={async () => {
            try { onSaved(await api("/stock/settings", { method: "PUT", body: { confirm_tags: split(f.confirm), cancel_tags: split(f.cancel), reserve_days: Number(f.days) || 30 } })); toast.success("Reguli salvate, rezervările au fost recalculate"); }
            catch (e) { toast.error(e.message); }
          }}>Salvează</Button>
        </div>
      </div>
    </Card>
  );
}
