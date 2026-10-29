import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, RefreshCw, Package, AlertTriangle, Boxes, ClipboardList, Plus, Trash2, Layers, X, Coins, ExternalLink, Download, FileSpreadsheet, Truck, Copy, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime, fmtAgo, money } from "../lib/format";
import SaftStocks from "./SaftStocks";
import { Button, Card, Empty, Field, Input, Modal, PageLoader, Pill, Select, Textarea, cx, useToast } from "../components/ui";

const TYPES = {
  inventar: { label: "Inventar", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  intrare: { label: "Intrare marfă", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  vanzare: { label: "Vânzare (AWB)", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  awb_anulat: { label: "AWB anulat", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  retur: { label: "Retur recepționat", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  refuzat: { label: "Colet refuzat", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  ajustare: { label: "Ajustare", cls: "bg-orange-50 text-orange-700 ring-orange-200" },
  inlocuire: { label: "Înlocuire în pachet", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
};

const bundleSig = (list) => JSON.stringify((list || []).map((c) => [c.variant_id, Number(c.qty), (c.alternates || []).map((a) => a.variant_id)]));

const TABS = [
  { id: "stoc", label: "Stocuri" },
  { id: "inventar", label: "Inventar" },
  { id: "valoare", label: "Valoare stoc" },
  { id: "istoric", label: "Istoric stocuri" },
  { id: "intrari", label: "Intrări marfă" },
  { id: "furnizori", label: "Necesar furnizori" },
  { id: "miscari", label: "Mișcări" },
  { id: "saft", label: "SAF-T ANAF", admin: true },
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
  const [refresh, setRefresh] = useState(0); // după sincronizare reîncărcăm și lista din tab-ul deschis
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
        <SyncButton onDone={() => { loadSummary(); setRefresh((n) => n + 1); }} />
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
      <div key={refresh}>
      {tab === "stoc" && <StockList summary={summary} onChanged={loadSummary} goInventory={() => nav("/stocuri/inventar")} />}
      {tab === "inventar" && <Inventory summary={summary} onDone={loadSummary} />}
      {tab === "valoare" && <StockValue />}
      {tab === "istoric" && <StockHistory />}
      {tab === "intrari" && <Receipts />}
      {tab === "furnizori" && <SupplierNeeds />}
      {tab === "miscari" && <Movements />}
      {tab === "saft" && <SaftStocks />}
      {tab === "setari" && <StockSettings summary={summary} onSaved={setSummary} />}
      </div>
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
  const toast = useToast();
  const [view, setView] = useState("active");
  const [items, reload] = useItems(view);
  const toggleBundle = async (r, on) => {
    if (on && r.on_hand && !window.confirm(`„${productName(r)}” are ${r.on_hand} buc în depozit. Un pachet nu are stoc propriu, așa că soldul lui devine 0 (stocul se ține pe componente). Continui?`)) return;
    if (!on && r.bundle?.length && !window.confirm("Debifezi pachetul? Componentele setate pentru el se șterg.")) return;
    try {
      await api(`/stock/items/${r.variant_id}`, { method: "PATCH", body: { is_bundle: on } });
      toast.success(on ? "Marcat ca pachet — nu mai apare la inventar" : "Nu mai e pachet");
      reload(); onChanged?.();
    } catch (e) { toast.error(e.message); }
  };
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    return s ? items.filter((r) => `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)) : items;
  }, [items, q]);

  return (
    <>
      {summary?.started && summary.never_counted > 0 && <NewProductsBanner n={summary.never_counted} onShow={() => setView("never_counted")} />}
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
            ["Produse cu necesar (lipsă)", summary.negative, AlertTriangle],
          ].map(([l, v, I]) => (
            <Card key={l} className="p-4">
              <div className="flex items-center gap-2 text-xs text-slate-500"><I className="h-3.5 w-3.5" /> {l}</div>
              <div className={cx("mt-1 text-2xl font-bold tabular", l.startsWith("Produse cu necesar") && v > 0 && "text-red-600")}>{v}</div>
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
            <option value="active">Produse active + draft</option>
            <option value="reserved">Doar cu rezervări</option>
            <option value="negative">Cu necesar (rezervat peste stoc)</option>
            <option value="products">Doar produse (fără pachete)</option>
            <option value="never_counted">Fără stoc introdus niciodată (produse noi)</option>
            <option value="bundles">Doar pachete</option>
            <option value="bundles_todo">Pachete fără componente setate</option>
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
                  <th className="w-16 px-3 py-3 text-center" title="Bifează produsele care sunt pachete">Pachet</th>
                  <th className="px-4 py-3">Produs</th>
                  <th className="hidden px-4 py-3 md:table-cell">SKU</th>
                  <th className="px-4 py-3 text-right">În depozit</th>
                  <th className="px-4 py-3 text-right">Rezervat</th>
                  <th className="px-4 py-3 text-right">Disponibil</th>
                  <th className="px-4 py-3 text-right" title="Câte bucăți lipsesc ca să acoperi comenzile rezervate">Necesar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.variant_id} onClick={() => setOpen(r.variant_id)} className={cx("cursor-pointer hover:bg-slate-50", r.is_bundle && "bg-violet-50/40")}>
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-5 w-5 cursor-pointer accent-violet-600" checked={!!r.is_bundle}
                        onChange={(e) => toggleBundle(r, e.target.checked)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb src={r.image} />
                        <div className="min-w-0">
                          <div className="line-clamp-2 font-medium">{r.product_title}</div>
                          <div className="text-xs text-slate-500">
                            {r.variant_title}
                            {r.is_bundle && <Pill className="ml-1 bg-violet-50 text-violet-700 ring-violet-200"><Layers className="mr-1 h-3 w-3" />Pachet</Pill>}
                            {summary?.started && r.never_counted && !r.is_bundle && <Pill className="ml-1 bg-amber-50 text-amber-700 ring-amber-200">Stoc neintrodus</Pill>}
                            {r.status !== "ACTIVE" && <Pill className="ml-1 bg-slate-100 text-slate-500 ring-slate-200">{r.status === "DRAFT" ? "Draft" : r.status === "ARCHIVED" ? "Arhivat" : r.status}</Pill>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500 md:table-cell">{r.sku || "—"}</td>
                    {r.is_bundle ? (
                      <td colSpan={4} className="px-4 py-2.5 text-right text-xs text-slate-500">
                        {r.bundle?.length
                          ? <>se pot face <strong className="text-slate-900">{Math.max(0, r.bundle_available ?? 0)}</strong> pachete din stoc</>
                          : <span className="font-medium text-amber-600">componente nesetate — click ca să le adaugi</span>}
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-right"><Qty v={r.on_hand} /></td>
                        <td className="px-4 py-2.5 text-right">{r.reserved ? <span className="tabular text-amber-600">{r.reserved}</span> : <span className="text-slate-300">0</span>}</td>
                        <td className="px-4 py-2.5 text-right"><Qty v={r.available} strong /></td>
                        <td className={cx("px-4 py-2.5 text-right tabular", r.need > 0 ? "font-bold text-red-600" : "text-slate-300")}>{r.need}</td>
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
    return items.filter((r) => !exclude.includes(r.variant_id) && (allowBundles || !r.is_bundle)
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
      await api(`/stock/items/${vid}/bundle`, { method: "PUT", body: { components: bundle.map((c) => ({ variant_id: c.variant_id, qty: Number(c.qty) || 1, alternates: (c.alternates || []).map((a) => a.variant_id) })) } });
      toast.success("Componente salvate");
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
          {!d.is_bundle && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["În depozit", d.on_hand], ["Rezervat", d.reserved], ["Disponibil", d.available], ["Necesar", d.need]].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="text-[11px] text-slate-500">{l}</div>
                  <div className={cx("text-xl font-bold tabular", (v < 0 || (l === "Necesar" && v > 0)) && "text-red-600")}>{v}</div>
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

          {!d.is_bundle && (
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
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={!!d.is_bundle} onChange={async (e) => {
                const on = e.target.checked;
                if (on && d.on_hand && !window.confirm(`Produsul are ${d.on_hand} buc în depozit. Un pachet nu are stoc propriu, așa că soldul devine 0. Continui?`)) return;
                if (!on && d.bundle_components?.length && !window.confirm("Debifezi pachetul? Componentele setate se șterg.")) return;
                try { await api(`/stock/items/${vid}`, { method: "PATCH", body: { is_bundle: on } }); load(); onChanged(); }
                catch (err) { toast.error(err.message); }
              }} />
              <span><strong className="inline-flex items-center gap-1"><Layers className="h-4 w-4" /> Acest produs este pachet</strong>
                <span className="block text-xs text-slate-500">Pachetele nu se numără la inventar. La vânzare se scade stocul fiecărei componente, nu al pachetului. Dacă o componentă are înlocuitor și ea e la 0, se scade automat din înlocuitor.</span></span>
            </label>
            {d.is_bundle && <div className="mt-3">
            {!bundle?.length && <p className="mb-2 text-xs font-medium text-amber-600">Adaugă produsele pe care le conține pachetul, cu cantitatea fiecăruia.</p>}
            {bundle?.map((c, i) => (
              <ComponentRow key={c.variant_id} c={c} bundleVid={vid} allIds={bundle.flatMap((x) => [x.variant_id, ...(x.alternates || []).map((a) => a.variant_id)])}
                onChange={(nc) => setBundle(bundle.map((x, j) => (j === i ? nc : x)))}
                onRemove={() => setBundle(bundle.filter((_, j) => j !== i))} />
            ))}
            <ProductPicker placeholder="Adaugă componentă…" exclude={[vid, ...(bundle || []).flatMap((c) => [c.variant_id, ...(c.alternates || []).map((a) => a.variant_id)])]}
              onPick={(r) => setBundle([...(bundle || []), { variant_id: r.variant_id, qty: 1, product_title: r.product_title, variant_title: r.variant_title, sku: r.sku, image: r.image, alternates: [] }])} />
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={saveBundle} disabled={bundleSig(bundle) === bundleSig(d.bundle_components)}>Salvează componentele</Button>
            </div>
            </div>}
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
                {d.movements.map((m) => <MovementRow key={m.id} m={m} onChanged={() => { load(); onChanged(); }} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function MovementRow({ m, showProduct, onChanged }) {
  const t = TYPES[m.type] || { label: m.type, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  const [swap, setSwap] = useState(false);
  const canSwap = m.type === "vanzare" && m.bundle_variant_id && m.delta < 0 && !m.swapped_to;
  const info = [m.ref, m.note, m.component_of_title && `înlocuitor pentru ${m.component_of_title}`,
    m.via_bundle && (m.bundle_title ? `din pachetul ${m.bundle_title}` : "din pachet"),
    m.swapped_to && "înlocuit ulterior"].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className={cx("w-14 text-right font-semibold tabular", m.delta > 0 ? "text-emerald-600" : "text-red-600")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
      <Pill className={t.cls}>{t.label}</Pill>
      <div className="min-w-0 flex-1">
        {showProduct && <div className="truncate font-medium">{productName(m)}</div>}
        <div className={cx("line-clamp-3 text-xs", m.shortfall ? "font-medium text-amber-700" : "text-slate-500")}>{info || "—"}</div>
      </div>
      {canSwap && onChanged && (
        <Button size="sm" variant="outline" onClick={() => setSwap(true)} title="Depozitul a trimis alt produs echivalent">S-a trimis alt produs</Button>
      )}
      <div className="text-right text-xs text-slate-400">
        <div>sold {m.on_hand_after}</div>
        <div>{fmtDateTime(m.created_at)} · {m.actor}</div>
      </div>
      {swap && <SwapModal m={m} onClose={() => setSwap(false)} onDone={() => { setSwap(false); onChanged?.(); }} />}
    </div>
  );
}

function SwapModal({ m, onClose, onDone }) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { api(`/stock/movements/${m.id}/swap-options`).then(setD).catch((e) => { toast.error(e.message); onClose(); }); }, []); // eslint-disable-line
  const pick = async (vid) => {
    setBusy(vid);
    try {
      await api(`/stock/movements/${m.id}/swap`, { method: "POST", body: { variant_id: vid } });
      toast.success("Corectat: stocul a revenit pe produsul scăzut inițial și s-a scăzut din cel trimis");
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title="Ce produs s-a trimis efectiv?">
      {!d ? <PageLoader /> : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Comanda <strong>{m.ref}</strong> · pachetul <strong>{d.bundle}</strong>. Sistemul a scăzut <strong>{-m.delta} × {d.current}</strong>. Alege produsul care a plecat de fapt:</p>
          {d.options.length === 0 ? <div className="text-slate-500">Componenta nu are înlocuitori setați.</div> : d.options.map((o) => (
            <button key={o.variant_id} disabled={!!busy} onClick={() => pick(o.variant_id)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
              <Thumb src={o.image} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 font-medium">{o.title}</div>
                <div className="text-xs text-slate-500">{o.sku || "fără SKU"} · în depozit {o.on_hand}{o.primary && " · produsul principal"}</div>
              </div>
              {busy === o.variant_id && <RefreshCw className="h-4 w-4 animate-spin" />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ComponentRow({ c, bundleVid, allIds, onChange, onRemove }) {
  const [adding, setAdding] = useState(false);
  const alts = c.alternates || [];
  return (
    <div className="mb-2 rounded-lg bg-slate-50 p-2">
      <div className="flex items-center gap-3">
        <Thumb src={c.image} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium">{productName(c)}</div>
          <div className="text-xs text-slate-500">{c.sku || "fără SKU"}{c.on_hand !== undefined && ` · în depozit ${c.on_hand}`}</div>
        </div>
        <Input type="number" min={1} className="w-20 shrink-0 text-right" value={c.qty} onChange={(e) => onChange({ ...c, qty: e.target.value })} />
        <span className="shrink-0 text-xs text-slate-500">buc</span>
        <button onClick={onRemove} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>
      <div className="ml-[52px] mt-2 space-y-1.5">
        {alts.map((a, k) => (
          <div key={a.variant_id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs ring-1 ring-slate-200">
            <span className="shrink-0 rounded bg-fuchsia-50 px-1.5 py-0.5 font-semibold text-fuchsia-700">Înlocuitor {alts.length > 1 ? k + 1 : ""}</span>
            <span className="min-w-0 flex-1 truncate">{productName(a)} <span className="text-slate-400">· {a.sku || "fără SKU"}{a.on_hand !== undefined && ` · în depozit ${a.on_hand}`}</span></span>
            <button onClick={() => onChange({ ...c, alternates: alts.filter((_, j) => j !== k) })} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {adding ? (
          <div className="flex items-center gap-2">
            <div className="flex-1"><ProductPicker placeholder="Caută produsul înlocuitor…" exclude={[bundleVid, ...allIds]}
              onPick={(r) => { onChange({ ...c, alternates: [...alts, { variant_id: r.variant_id, product_title: r.product_title, variant_title: r.variant_title, sku: r.sku, image: r.image, on_hand: r.on_hand }] }); setAdding(false); }} /></div>
            <button onClick={() => setAdding(false)} className="rounded p-1.5 text-slate-400 hover:bg-slate-200"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-fuchsia-700 hover:underline">
            <Plus className="h-3.5 w-3.5" /> Înlocuitor (dacă nu avem produsul, trimitem altul echivalent)
          </button>
        )}
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
    return items.filter((r) => !r.is_bundle && (!s || `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)));
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
      {summary?.started && summary.never_counted > 0 && <NewProductsBanner n={summary.never_counted} />}
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

function NewProductsBanner({ n, onShow }) {
  const nav = useNavigate();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200">
      <div className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div><strong>{n === 1 ? "1 produs nou nu are" : `${n} produse noi nu au`} stoc introdus niciodată.</strong> Au apărut în Shopify după inventar. Numără-le în depozit ca stocul să fie corect.</div>
      </div>
      <div className="flex gap-2">
        {onShow && <Button variant="outline" onClick={onShow}>Vezi produsele</Button>}
        <Button onClick={() => nav("/stocuri/inventar?nou=1")}><ClipboardList className="h-4 w-4" /> REIA INVENTAR</Button>
      </div>
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
  const last = hist.find((h) => h.status === "done" && h.scope !== "new");
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-slate-600">
          <div className="text-base font-semibold text-slate-900">Inventar complet pe telefon</div>
          <div className="mt-1">Ia telefonul în depozit. Fiecare produs apare pe tot ecranul, pe rând; scrii cantitatea găsită și apeși „Salvează” — apare următorul. Nu se poate sări peste niciun produs, iar inventarul se finalizează doar când toate sunt numărate.</div>
          {sess && <div className="mt-2 font-medium text-brand">{sess.scope === "new" ? "Inventar produse noi" : "Inventar"} în desfășurare: {sess.done} din {sess.total} produse numărate (pornit de {sess.started_by} la {fmtDateTime(sess.started_at)})</div>}
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
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ supplier: "", supplier_cui: "", document: "", note: "" });
  const [sups, setSups] = useState([]);
  useEffect(() => { api("/stock/suppliers").then((x) => setSups(x.suppliers || [])).catch(() => {}); }, []);
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api("/stock/receipts").then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api("/stock/receipts", { method: "POST", body: { ...form, items: lines.map((l) => ({ variant_id: l.variant_id, qty: Number(l.qty) })) } });
      toast.success("Intrare înregistrată, stocul a crescut");
      setLines([]); setForm({ supplier: "", supplier_cui: "", document: "", note: "" }); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const valid = lines.length && lines.every((l) => Number(l.qty) > 0);
  return (
    <>
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-slate-600">
          <div className="text-base font-semibold text-slate-900">Intrare marfă pe telefon</div>
          <div className="mt-1">Când vine marfa: cauți produsul, apeși pe el, scrii câte bucăți au venit și salvezi. Atât.</div>
        </div>
        <Button size="lg" onClick={() => nav("/stocuri/intrare")}><Plus className="h-5 w-5" /> Adaugă marfă</Button>
      </div>
    </Card>
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
      <Card title="Intrare marfă nouă">
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Furnizor">
              <Input list="furnizori-list" value={form.supplier} onChange={(e) => {
                const v = e.target.value; const m = sups.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
                setForm({ ...form, supplier: v, supplier_cui: m?.cui ? m.cui : form.supplier_cui });
              }} />
              <datalist id="furnizori-list">{sups.map((x) => <option key={x.id} value={x.name} />)}</datalist>
            </Field>
            <Field label="CUI furnizor"><Input value={form.supplier_cui} onChange={(e) => setForm({ ...form, supplier_cui: e.target.value })} placeholder="ex. 14399840" /></Field>
            <Field label="Nr. factură furnizor"><Input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
          </div>
          <div className="-mt-2 text-xs text-slate-500">CUI-ul și numărul facturii sunt necesare pentru declarația SAF-T de stocuri.</div>
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
    </>
  );
}

function Movements() {
  const [type, setType] = useState("");
  const [rows, setRows] = useState(null);
  const load = () => api(`/stock/movements?limit=500${type ? `&type=${type}` : ""}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { setRows(null); load(); }, [type]); // eslint-disable-line
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
          {rows.map((m) => <MovementRow key={m.id} m={m} showProduct onChanged={load} />)}
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


function StockValue() {
  const [d, setD] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);
  const load = () => api("/stock/value").then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return s ? d.rows.filter((r) => `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s)) : d.rows;
  }, [d, q]);
  if (err) return <Card className="p-5 text-sm text-red-600">{err}</Card>;
  if (!d) return <PageLoader />;
  const miss = d.missing_cost_in_stock;
  return (
    <div>
      {d.cost_error && (
        <div className="mb-4 rounded-xl bg-red-50 px-5 py-4 text-sm text-red-800 ring-1 ring-red-200">
          <strong>Hub-ul nu poate citi costurile (COGS) din Shopify.</strong> Aplicația Shopify a hub-ului nu are acces la costul produselor. Eroare: {d.cost_error}
        </div>
      )}
      {miss.length > 0 ? (
        <div className="mb-4 rounded-xl bg-red-50 px-5 py-4 ring-1 ring-red-200">
          <div className="flex items-center gap-2 font-semibold text-red-800"><AlertTriangle className="h-5 w-5" /> {miss.length} {miss.length === 1 ? "produs aflat" : "produse aflate"} în depozit fără COGS setat în Shopify ({d.missing_cost_units} buc)</div>
          <p className="mt-1 text-sm text-red-700">Valoarea stocului de mai jos nu le include. Setează în Shopify „Cost per item” (cost de achiziție fără TVA), apoi apasă „Sincronizează cu Shopify”.</p>
          <div className="mt-3 divide-y divide-red-100 overflow-hidden rounded-lg bg-white ring-1 ring-red-200">
            {miss.map((r) => (
              <div key={r.variant_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Thumb src={r.image} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{productName(r)}</div>
                  <div className="text-xs text-slate-500">{r.sku || "fără SKU"}{r.status === "DRAFT" && " · Draft"}</div>
                </div>
                <span className="whitespace-nowrap tabular font-semibold">{r.on_hand} buc</span>
                {r.admin_url && <a href={r.admin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-brand hover:bg-brand-50">Setează COGS <ExternalLink className="h-3 w-3" /></a>}
              </div>
            ))}
          </div>
        </div>
      ) : d.products_in_stock > 0 && !d.cost_error && (
        <div className="mb-4 rounded-xl bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">Toate produsele din depozit au COGS setat în Shopify.</div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Valoare stoc (fără TVA)", money(d.value), true],
          [`Valoare stoc (cu TVA ${Math.round(d.vat_rate * 100)}%)`, money(d.value_vat)],
          ["Bucăți în depozit", d.units],
          ["Produse cu stoc", d.products_in_stock],
        ].map(([l, v, big]) => (
          <Card key={l} className="p-4">
            <div className="flex items-center gap-2 text-xs text-slate-500"><Coins className="h-3.5 w-3.5" /> {l}</div>
            <div className={cx("mt-1 font-bold tabular", big ? "text-2xl text-brand" : "text-2xl")}>{v}</div>
          </Card>
        ))}
      </div>
      <div className="mb-3 text-xs text-slate-500">
        Cost = „Cost per item” (COGS) din Shopify, fără TVA. Costurile se actualizează din Shopify în fiecare oră sau la „Sincronizează cu Shopify”
        {d.last_product_sync && ` · ultima actualizare ${fmtAgo(d.last_product_sync)}`}.
        {d.missing_cost_no_stock > 0 && ` Alte ${d.missing_cost_no_stock} produse fără COGS nu au stoc acum.`}
        {!d.started && " Valoarea va fi reală după primul inventar."}
      </div>
      <Card className="mb-3 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută produs sau SKU…" className="pl-9" />
        </div>
      </Card>
      {rows.length === 0 ? <Card><Empty icon={Coins} title="Niciun produs în depozit">După inventar, aici vezi valoarea fiecărui produs din stoc.</Empty></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Produs</th>
                  <th className="px-4 py-3 text-right">În depozit</th>
                  <th className="px-4 py-3 text-right">Cost / buc</th>
                  <th className="px-4 py-3 text-right">Valoare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.variant_id} className={cx(r.cost === null && "bg-red-50/50")}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Thumb src={r.image} />
                        <div className="min-w-0">
                          <div className="line-clamp-2 font-medium">{r.product_title}</div>
                          <div className="text-xs text-slate-500">{[r.variant_title, r.sku].filter(Boolean).join(" · ")}{r.status === "DRAFT" && " · Draft"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{r.on_hand}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{r.cost === null ? <span className="font-semibold text-red-600">lipsă COGS</span> : money(r.cost)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{r.value === null ? "—" : money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}


function StockHistory() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api("/stock/snapshots").then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const manual = async () => {
    if (!window.confirm("Generezi acum o situație a stocului? Va apărea în listă marcată „manuală”. Situația automată de final de lună se face oricum.")) return;
    setBusy(true);
    try { await api("/stock/snapshots", { method: "POST" }); toast.success("Situație generată"); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  if (!d) return <PageLoader />;
  const KIND = {
    auto: ["Automată · final de lună", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
    late: ["Automată · cu întârziere", "bg-amber-50 text-amber-700 ring-amber-200"],
    manual: ["Manuală", "bg-slate-100 text-slate-600 ring-slate-200"],
  };
  return (
    <div>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 text-sm text-slate-600">
            <div className="text-base font-semibold text-slate-900">Situația lunară a stocului pentru contabil</div>
            <div className="mt-1">În ultima zi a fiecărei luni, la ora 23:55, hub-ul salvează automat stocul de marfă: produs, cantitate, preț de achiziție fără TVA și valoare. Fiecare situație se descarcă ca fișier Excel, gata de trimis contabilului.</div>
            <div className="mt-2 font-medium text-slate-800">
              {d.started ? `Următoarea situație automată: ${fmtDateTime(d.next_run)}` : "Situațiile automate pornesc după primul inventar."}
            </div>
          </div>
          {isAdmin && <Button variant="outline" loading={busy} onClick={manual}><FileSpreadsheet className="h-4 w-4" /> Generează acum</Button>}
        </div>
      </Card>
      {d.items.length === 0 ? (
        <Card><Empty icon={FileSpreadsheet} title="Nicio situație încă">Prima situație se generează automat în ultima zi a lunii.</Empty></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Luna</th>
                  <th className="px-4 py-3">Generată</th>
                  <th className="px-4 py-3 text-right">Produse</th>
                  <th className="px-4 py-3 text-right">Bucăți</th>
                  <th className="px-4 py-3 text-right">Valoare fără TVA</th>
                  <th className="px-4 py-3 text-right">Fișier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.items.map((r) => {
                  const k = KIND[r.kind] || KIND.manual;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold capitalize">{r.label}</div>
                        <Pill className={cx("mt-1", k[1])}>{k[0]}</Pill>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{fmtDateTime(r.as_of)}</div>
                        <div className="text-xs text-slate-400">{r.created_by}</div>
                        {r.missing_cost > 0 && <div className="mt-1 text-xs font-medium text-red-600">{r.missing_cost} produse fără preț de achiziție</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular">{r.products}</td>
                      <td className="px-4 py-3 text-right tabular">{r.units}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular">{money(r.value)}</td>
                      <td className="px-4 py-3 text-right">
                        <a href={`/api/stock/snapshots/${r.id}/xlsx`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
                          <Download className="h-3.5 w-3.5" /> Excel
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}


function SupplierNeeds() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null); // {id?, name, ...}
  const [onlyNeeded, setOnlyNeeded] = useState(false);
  const load = () => api("/stock/suppliers").then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  if (!d) return <PageLoader />;
  const totalOrder = d.suppliers.reduce((a, s) => a + s.to_order, 0) + d.unassigned.reduce((a, r) => a + r.to_order, 0);
  return (
    <div>
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 text-sm text-slate-600">
            <div className="text-base font-semibold text-slate-900">Ce trebuie comandat de la furnizori</div>
            <div className="mt-1"><strong>Lipsă acum</strong> = rezervat − în depozit. <strong>Estimare {d.window_days} zile</strong> = câte bucăți s-au comandat în ultimele {d.window_days} zile (comenzi neanulate), proiectat pe următoarele {d.window_days} zile. <strong>De comandat</strong> = rezervat + estimare − în depozit.</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={onlyNeeded} onChange={(e) => setOnlyNeeded(e.target.checked)} /> Doar ce trebuie comandat</label>
            <Button onClick={() => setEdit({ name: "", contact: "", phone: "", email: "", notes: "" })}><Plus className="h-4 w-4" /> Furnizor nou</Button>
          </div>
        </div>
        {totalOrder > 0 && <div className="mt-3 text-sm font-medium text-slate-800">Total de comandat acum (cu estimarea pe {d.window_days} zile): <span className="text-brand">{totalOrder} buc</span></div>}
      </Card>
      {d.unassigned.length > 0 && (
        <Card className="mb-4 overflow-hidden ring-amber-200">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Produse de comandat care nu au furnizor setat ({d.unassigned.length})</div>
          <NeedTable rows={d.unassigned} days={d.window_days} />
        </Card>
      )}
      {d.suppliers.length === 0 ? (
        <Card><Empty icon={Truck} title="Niciun furnizor încă">Apasă „Furnizor nou”, apoi adaugă produsele pe care le iei de la el.</Empty></Card>
      ) : d.suppliers.map((s) => (
        <SupplierCard key={s.id} s={s} days={d.window_days} onlyNeeded={onlyNeeded} onEdit={() => setEdit(s)} onChanged={load} />
      ))}
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function SupplierCard({ s, days, onlyNeeded, onEdit, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const rows = onlyNeeded ? s.items.filter((r) => r.to_order > 0) : s.items;
  const copy = async () => {
    const lines = s.items.filter((r) => r.to_order > 0).map((r) => `${r.to_order} buc — ${productName(r)}${r.sku ? ` (${r.sku})` : ""}`);
    if (!lines.length) { toast.error("Nu e nimic de comandat de la acest furnizor"); return; }
    const txt = `Comandă ${s.name}:\n` + lines.join("\n");
    try { await navigator.clipboard.writeText(txt); toast.success("Lista de comandă a fost copiată"); }
    catch { window.prompt("Copiază lista:", txt); }
  };
  const addProduct = async (r) => {
    try { await api(`/stock/suppliers/${s.id}/products`, { method: "PUT", body: { add: [r.variant_id] } }); onChanged(); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async (r) => {
    try { await api(`/stock/suppliers/${s.id}/products`, { method: "PUT", body: { remove: [r.variant_id] } }); onChanged(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{s.name}</div>
            <div className="text-xs text-slate-500">{[s.contact, s.phone, s.email].filter(Boolean).join(" · ") || "fără date de contact"} · {s.products} produse</div>
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {s.to_order > 0
            ? <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand">De comandat: {s.to_order} buc ({s.lines_to_order} produse)</span>
            : <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">Nimic de comandat</span>}
          <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copiază comanda</Button>
          <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      {open && (
        <>
          {rows.length > 0 ? <NeedTable rows={rows} days={days} onRemove={remove} /> : <div className="px-5 py-4 text-sm text-slate-500">{s.items.length ? "Nimic de comandat acum." : "Niciun produs adăugat încă."}</div>}
          <div className="border-t border-slate-100 px-5 py-3">
            {adding ? (
              <div className="flex items-center gap-2">
                <div className="flex-1"><ProductPicker placeholder="Caută produsul pe care îl iei de la acest furnizor…" exclude={s.items.map((r) => r.variant_id)} onPick={addProduct} /></div>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Gata</Button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><Plus className="h-4 w-4" /> Adaugă produse la {s.name}</button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function NeedTable({ rows, days, onRemove }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5">Produs</th>
            <th className="px-3 py-2.5 text-right">În depozit</th>
            <th className="px-3 py-2.5 text-right">Rezervat</th>
            <th className="px-3 py-2.5 text-right">Lipsă acum</th>
            <th className="px-3 py-2.5 text-right">Comandat ultimele {days} zile</th>
            <th className="px-3 py-2.5 text-right">Estimare {days} zile</th>
            <th className="px-3 py-2.5 text-right">De comandat</th>
            {onRemove && <th className="w-10" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.variant_id} className={cx(r.to_order > 0 && "bg-brand-50/30")}>
              <td className="px-4 py-2">
                <div className="flex items-center gap-3">
                  <Thumb src={r.image} />
                  <div className="min-w-0">
                    <div className="line-clamp-2 font-medium">{r.product_title}</div>
                    <div className="text-xs text-slate-500">{[r.variant_title, r.sku].filter(Boolean).join(" · ")}{r.status === "DRAFT" && " · Draft"}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-right"><Qty v={r.on_hand} /></td>
              <td className="px-3 py-2 text-right tabular">{r.reserved || <span className="text-slate-300">0</span>}</td>
              <td className={cx("px-3 py-2 text-right tabular", r.short_now > 0 ? "font-semibold text-red-600" : "text-slate-300")}>{r.short_now}</td>
              <td className="px-3 py-2 text-right tabular text-slate-600">{r.sold_window}<div className="text-[11px] text-slate-400">{r.per_day}/zi</div></td>
              <td className="px-3 py-2 text-right tabular text-slate-600">{r.forecast}</td>
              <td className={cx("px-3 py-2 text-right text-base tabular", r.to_order > 0 ? "font-bold text-brand" : "text-slate-300")}>{r.to_order}</td>
              {onRemove && <td className="px-2"><button title="Scoate de la acest furnizor" onClick={() => onRemove(r)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SupplierModal({ s, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: s.name || "", cui: s.cui || "", contact: s.contact || "", phone: s.phone || "", email: s.email || "", notes: s.notes || "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(s.id ? `/stock/suppliers/${s.id}` : "/stock/suppliers", { method: s.id ? "PATCH" : "POST", body: f });
      toast.success("Furnizor salvat"); onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(`Ștergi furnizorul „${s.name}”? Produsele lui rămân în stocuri, doar fără furnizor.`)) return;
    try { await api(`/stock/suppliers/${s.id}`, { method: "DELETE" }); toast.success("Furnizor șters"); onSaved(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} title={s.id ? `Furnizor: ${s.name}` : "Furnizor nou"}
      footer={<>{s.id && <Button variant="ghost" className="mr-auto text-red-600" onClick={del}><Trash2 className="h-4 w-4" /> Șterge</Button>}
        <Button variant="outline" onClick={onClose}>Renunță</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>Salvează</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <Field label="Nume furnizor"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="CUI"><Input value={f.cui} onChange={(e) => setF({ ...f, cui: e.target.value })} placeholder="ex. 14399840" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Persoană de contact"><Input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
          <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Email"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Observații"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="ex. termen livrare 2 zile, comandă minimă" /></Field>
      </div>
    </Modal>
  );
}
