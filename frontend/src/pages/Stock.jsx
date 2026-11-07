import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, RefreshCw, Package, AlertTriangle, Boxes, ClipboardList, Plus, Trash2, Layers, X, Coins, ExternalLink, Download, FileSpreadsheet, Truck, Copy, Pencil, ChevronDown, ChevronRight, CheckCircle2, ScanLine, Undo2 } from "lucide-react";
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
  { id: "refuzate", label: "Colete refuzate" },
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
      {tab === "refuzate" && <RefusedTab />}
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
                            {r.is_bundle && <Pill className="ml-1 bg-violet-50 text-violet-700 ring-violet-200"><Layers className="mr-1 h-3 w-3" />{r.surprise ? "Produs surpriză" : "Pachet"}</Pill>}
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

          {!d.is_bundle && d.cost !== undefined && <CostBox d={d} />}

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

          {(d.surprise || !d.is_bundle) && <SurpriseBox d={d} vid={vid} onSaved={() => { load(); onChanged(); }} />}

          {!d.surprise && <div className="rounded-xl ring-1 ring-slate-200 p-4">
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
          </div>}

          {!d.is_bundle && <AlternatesBox d={d} vid={vid} onSaved={() => { load(); onChanged(); }} />}

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

function SurpriseBox({ d, vid, onSaved }) {
  const toast = useToast();
  const comp = (d.bundle_components || [])[0];
  const initial = d.surprise && comp ? [comp, ...(comp.alternates || [])].map((x) => ({ ...x })) : [];
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList(initial); }, [d]); // eslint-disable-line
  const dirty = JSON.stringify(list.map((a) => a.variant_id)) !== JSON.stringify(initial.map((a) => a.variant_id));
  const put = async (body, msg) => {
    setBusy(true);
    try { await api(`/stock/items/${vid}/surprise`, { method: "PUT", body }); toast.success(msg); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const move = (k, dir) => { const l = [...list]; const j = k + dir; if (j < 0 || j >= l.length) return; [l[k], l[j]] = [l[j], l[k]]; setList(l); };
  return (
    <div className="rounded-xl p-4 ring-1 ring-amber-200 bg-amber-50/30">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-amber-600" checked={!!d.surprise} disabled={busy} onChange={(e) => {
          const on = e.target.checked;
          if (on && d.on_hand && !window.confirm(`Produsul are ${d.on_hand} buc în depozit. Produsul surpriză nu are stoc propriu, așa că soldul devine 0. Continui?`)) return;
          if (!on && !window.confirm("Nu mai e produs surpriză? Lista de produse se șterge.")) return;
          put({ enabled: on, products: [] }, on ? "Marcat ca produs surpriză — adaugă produsele" : "Nu mai e produs surpriză");
        }} />
        <span><strong>🎁 Produs surpriză</strong>
          <span className="block text-xs text-slate-500">Alegi până la 5 produse, în ordinea priorității. La fiecare AWB se scade din produsul 1; când el ajunge la 0, din produsul 2, și tot așa. Nu se numără la inventar.</span></span>
      </label>
      {d.surprise && (
        <div className="mt-3">
          {list.length === 0 && <p className="mb-2 text-xs font-medium text-amber-700">Adaugă produsele care se pun în colet ca surpriză.</p>}
          {list.map((a, k) => (
            <div key={a.variant_id} className="mb-2 flex items-center gap-3 rounded-lg bg-white p-2 ring-1 ring-slate-200">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white">{k + 1}</span>
              <Thumb src={a.image} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium">{productName(a)}</div>
                <div className="text-xs text-slate-500">{a.sku || "fără SKU"} · în depozit <strong className={a.on_hand > 0 ? "text-emerald-700" : "text-red-600"}>{a.on_hand ?? 0}</strong></div>
              </div>
              <div className="flex shrink-0 flex-col">
                <button disabled={k === 0} onClick={() => move(k, -1)} className="rounded px-1 text-slate-400 hover:text-slate-800 disabled:opacity-30"><ChevronDown className="h-4 w-4 rotate-180" /></button>
                <button disabled={k === list.length - 1} onClick={() => move(k, 1)} className="rounded px-1 text-slate-400 hover:text-slate-800 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
              </div>
              <button onClick={() => setList(list.filter((_, j) => j !== k))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {list.length < 5 && (adding ? (
            <div className="flex items-center gap-2">
              <div className="flex-1"><ProductPicker placeholder="Caută produsul pus ca surpriză…" exclude={[vid, ...list.map((a) => a.variant_id)]}
                onPick={(r) => { setList([...list, { variant_id: r.variant_id, product_title: r.product_title, variant_title: r.variant_title, sku: r.sku, image: r.image, on_hand: r.on_hand }]); setAdding(false); }} /></div>
              <button onClick={() => setAdding(false)} className="rounded p-1.5 text-slate-400 hover:bg-slate-200"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"><Plus className="h-3.5 w-3.5" /> Adaugă produs ({list.length}/5)</button>
          ))}
          {dirty && <div className="mt-3 flex justify-end"><Button size="sm" loading={busy} onClick={() => put({ enabled: true, products: list.map((a) => a.variant_id) }, "Produsele surpriză au fost salvate")}>Salvează ordinea</Button></div>}
        </div>
      )}
    </div>
  );
}

function AlternatesBox({ d, vid, onSaved }) {
  const toast = useToast();
  const [list, setList] = useState((d.alternates || []).map((a) => ({ ...a })));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList((d.alternates || []).map((a) => ({ ...a }))); }, [d]);
  const dirty = JSON.stringify(list.map((a) => a.variant_id)) !== JSON.stringify((d.alternates || []).map((a) => a.variant_id));
  const save = async () => {
    setBusy(true);
    try { await api(`/stock/items/${vid}/alternates`, { method: "PUT", body: { alternates: list.map((a) => a.variant_id) } }); toast.success("Înlocuitori salvați"); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl p-4 ring-1 ring-slate-200">
      <div className="mb-1 text-sm font-semibold">Produse înlocuitoare</div>
      <p className="mb-3 text-xs text-slate-500">Produse identice, cu alt SKU. Dacă acest produs e la 0, la AWB se scade automat din primul înlocuitor care are stoc (și rezervarea merge tot acolo). Dacă depozitul trimite altul, corectezi din „Istoric mișcări” cu „S-a trimis alt produs”.</p>
      {d.alternate_for?.length > 0 && <p className="mb-3 text-xs font-medium text-fuchsia-700">Acest produs este înlocuitor pentru: {d.alternate_for.map((x) => x.title).join(", ")}</p>}
      {list.map((a, k) => (
        <div key={a.variant_id} className="mb-2 flex items-center gap-3 rounded-lg bg-slate-50 p-2">
          <span className="shrink-0 rounded bg-fuchsia-50 px-1.5 py-0.5 text-xs font-semibold text-fuchsia-700">Înlocuitor {list.length > 1 ? k + 1 : ""}</span>
          <Thumb src={a.image} />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-medium">{productName(a)}</div>
            <div className="text-xs text-slate-500">{a.sku || "fără SKU"} · în depozit {a.on_hand}</div>
          </div>
          <button onClick={() => setList(list.filter((_, j) => j !== k))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      {adding ? (
        <div className="flex items-center gap-2">
          <div className="flex-1"><ProductPicker placeholder="Caută produsul identic (alt SKU)…" exclude={[vid, ...list.map((a) => a.variant_id)]}
            onPick={(r) => { setList([...list, { variant_id: r.variant_id, product_title: r.product_title, variant_title: r.variant_title, sku: r.sku, image: r.image, on_hand: r.on_hand }]); setAdding(false); }} /></div>
          <button onClick={() => setAdding(false)} className="rounded p-1.5 text-slate-400 hover:bg-slate-200"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs font-medium text-fuchsia-700 hover:underline"><Plus className="h-3.5 w-3.5" /> Adaugă înlocuitor</button>
      )}
      {dirty && <div className="mt-3 flex justify-end"><Button size="sm" onClick={save} loading={busy}>Salvează înlocuitorii</Button></div>}
    </div>
  );
}

function MovementRow({ m, showProduct, onChanged }) {
  const t = TYPES[m.type] || { label: m.type, cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  const [swap, setSwap] = useState(false);
  const canSwap = m.swappable;
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
          <p className="text-slate-600">Comanda <strong>{m.ref}</strong>{d.bundle && <> · pachetul <strong>{d.bundle}</strong></>}. Sistemul a scăzut <strong>{-m.delta} × {d.current}</strong>. Alege produsul care a plecat de fapt:</p>
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
  const last = hist.find((h) => h.status === "done" && (h.scope || "full") === "full");
  const lastCheck = hist.find((h) => h.status === "done" && h.scope === "check");
  return (
    <>
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-slate-600">
          <div className="text-base font-semibold text-slate-900">Inventar complet pe telefon</div>
          <div className="mt-1">Ia telefonul în depozit. Fiecare produs apare pe tot ecranul, pe rând; scrii cantitatea găsită și apeși „Salvează” — apare următorul. Nu se poate sări peste niciun produs, iar inventarul se finalizează doar când toate sunt numărate.</div>
          {sess && <div className="mt-2 font-medium text-brand">{sess.scope === "new" ? "Inventar produse noi" : sess.scope === "check" ? "Verificare stoc" : "Inventar"} în desfășurare: {sess.done} din {sess.total} produse numărate (pornit de {sess.started_by} la {fmtDateTime(sess.started_at)})</div>}
          {!sess && last && <div className="mt-2 text-xs text-slate-500">Ultimul inventar complet: {fmtDateTime(last.finished_at)} de {last.finished_by} · {last.summary?.products} produse, {last.summary?.changed} cu diferențe</div>}
        </div>
        <Button size="lg" disabled={sess === undefined} onClick={() => nav("/stocuri/inventar")}>
          <ClipboardList className="h-5 w-5" /> {sess ? "Continuă inventarul" : "Fă inventarul"}
        </Button>
      </div>
    </Card>
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-slate-600">
          <div className="text-base font-semibold text-slate-900">Verificare stocuri (renumărare)</div>
          <div className="mt-1">Pe telefon, în depozit: pentru fiecare produs care a avut mișcări de stoc în ultimele 15 zile apare întrebarea „Sunt X bucăți în stoc?”. Apeși „Da” sau scrii cantitatea corectă. Diferențele se corectează automat.</div>
          {lastCheck && <div className="mt-2 text-xs text-slate-500">Ultima verificare: {fmtDateTime(lastCheck.finished_at)} de {lastCheck.finished_by} · {lastCheck.summary?.products} produse, {lastCheck.summary?.changed} cu diferențe</div>}
        </div>
        <Button size="lg" variant="outline" disabled={sess === undefined} onClick={() => nav(sess ? "/stocuri/inventar" : "/stocuri/inventar?verificare=1")}>
          <CheckCircle2 className="h-5 w-5" /> {sess?.scope === "check" ? "Continuă verificarea" : "VERIFICARE STOCURI"}
        </Button>
      </div>
    </Card>
    </>
  );
}

const leiC = (v) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`);

function CostBox({ d }) {
  const [open, setOpen] = useState(false);
  const h = d.cost_history || [];
  const diff = d.cost && d.shopify_cost && Math.abs(d.cost - d.shopify_cost) >= 0.005;
  return (
    <div className="rounded-xl p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Cost de achiziție (fără TVA)</div>
          <div className="mt-0.5 text-xs text-slate-500">Cost mediu ponderat: se recalculează la fiecare intrare de marfă. Profitul folosește costul valabil la data comenzii.</div>
        </div>
        <div className="flex gap-3 text-right">
          <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-500">Cost mediu actual</div><div className="text-lg font-bold tabular">{leiC(d.cost)}</div></div>
          <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-slate-500">Preț obișnuit (Shopify)</div><div className="text-lg font-bold tabular text-slate-600">{leiC(d.shopify_cost)}</div></div>
        </div>
      </div>
      {diff && <div className="mt-2 text-xs text-amber-700">Costul mediu diferă de cel din Shopify pentru că ai primit marfă la alt preț. E normal — Shopify rămâne prețul obișnuit de la furnizor.</div>}
      {h.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen(!open)} className="text-xs font-medium text-brand hover:underline">{open ? "Ascunde" : "Vezi"} istoricul costului ({h.length})</button>
          {open && (
            <div className="mt-2 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-100">
              {h.map((x, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">{x.source === "intrare" ? `Intrare ${x.qty} buc × ${leiC(x.price)}${x.manual_price ? "" : " (preț obișnuit)"}` : "Cost modificat în Shopify"}</div>
                    <div className="text-slate-500">{fmtDateTime(x.at)}{x.source === "intrare" ? ` · stoc înainte ${x.stock_before} buc la ${leiC(x.prev)}` : ""}{x.actor ? ` · ${x.actor}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-right"><div className="text-[11px] text-slate-400">cost nou</div><div className="font-bold tabular">{leiC(x.cost)}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Receipts() {
  const toast = useToast();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
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
      await api("/stock/receipts", { method: "POST", body: { ...form, items: lines.map((l) => ({ variant_id: l.variant_id, qty: Number(l.qty), ...(isAdmin && Number(String(l.price || "").replace(",", ".")) > 0 ? { unit_cost: Number(String(l.price).replace(",", ".")) } : {}) })) } });
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
                <Input type="number" min={1} className="w-24 text-right" value={l.qty} autoFocus={i === lines.length - 1} placeholder="buc"
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                {isAdmin && !l.is_bundle && (
                  <div className="relative">
                    <Input inputMode="decimal" className="w-32 pr-9 text-right" value={l.price || ""} placeholder="preț obișnuit"
                      title="Preț de achiziție / buc, FĂRĂ TVA. Lasă gol dacă e prețul obișnuit (costul din Shopify)."
                      onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, price: e.target.value.replace(/[^\d.,]/g, "") } : x)))} />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">lei</span>
                  </div>
                )}
                <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
              </div>
            ))}
            <ProductPicker exclude={lines.map((l) => l.variant_id)} placeholder="Caută și adaugă produs…"
              onPick={(r) => setLines([...lines, { ...r, qty: "", price: "" }])} />
            {isAdmin && lines.length > 0 && <div className="mt-1 text-xs text-slate-500">Preț de achiziție / buc <strong>fără TVA</strong> — completează doar dacă diferă de prețul obișnuit (costul din Shopify). Costul produsului se recalculează automat ca medie ponderată.</div>}
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
  const [edit, setEdit] = useState(null);
  const [mode, setMode] = useState("need"); // need = doar ce trebuie comandat · all = toate produsele
  const [sel, setSel] = useState("all"); // furnizorul filtrat
  const [q, setQ] = useState("");
  const load = () => api("/stock/suppliers").then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const view = useMemo(() => {
    if (!d) return null;
    const s = q.trim().toLowerCase();
    const match = (r) => !s || `${r.product_title} ${r.variant_title} ${r.sku}`.toLowerCase().includes(s);
    const keep = (r) => (mode === "all" || r.to_order > 0) && match(r);
    const groups = [
      ...(d.unassigned.length ? [{ id: "__none", name: "Fără furnizor", unassigned: true, items: d.unassigned }] : []),
      ...d.suppliers,
    ].map((g) => ({ ...g, rows: g.items.filter(keep), need: g.items.reduce((a, r) => a + r.to_order, 0), needLines: g.items.filter((r) => r.to_order > 0).length,
      short: g.items.reduce((a, r) => a + r.short_now, 0) }));
    groups.sort((a, b) => ((b.unassigned ? 1 : 0) - (a.unassigned ? 1 : 0)) || (b.need - a.need) || a.name.localeCompare(b.name));
    const all = groups.flatMap((g) => g.items);
    return {
      groups,
      totals: {
        units: all.reduce((a, r) => a + r.to_order, 0),
        lines: all.filter((r) => r.to_order > 0).length,
        shortUnits: all.reduce((a, r) => a + r.short_now, 0),
        shortLines: all.filter((r) => r.short_now > 0).length,
        suppliers: groups.filter((g) => !g.unassigned && g.need > 0).length,
        unassigned: (groups.find((g) => g.unassigned)?.needLines) || 0,
      },
    };
  }, [d, mode, q]);
  if (!d) return <PageLoader />;
  const shown = view.groups.filter((g) => (sel === "all" || g.id === sel) && (g.rows.length || (!q && mode === "all" && !g.unassigned)));

  return (
    <div>
      {/* 1. Rezumat: ce contează la o privire */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <NeedKpi label="De comandat" value={view.totals.units} unit="buc" sub={`${view.totals.lines} ${view.totals.lines === 1 ? "produs" : "produse"}`} tone="brand" />
        <NeedKpi label="Lipsă acum" value={view.totals.shortUnits} unit="buc" sub={`${view.totals.shortLines} produse cu comenzi fără stoc`} tone={view.totals.shortUnits ? "red" : "ok"} />
        <NeedKpi label="Furnizori de contactat" value={view.totals.suppliers} sub={`din ${d.suppliers.length} furnizori`} />
        <NeedKpi label="Fără furnizor" value={view.totals.unassigned} sub="produse de comandat nealocate" tone={view.totals.unassigned ? "amber" : "ok"} />
      </div>

      {/* 2. Filtre */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
            {[["need", "Doar de comandat"], ["all", "Toate produsele"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={cx("h-8 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors", mode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută produs sau SKU…" className="pl-9" aria-label="Caută produs" />
          </div>
          <Button variant="outline" onClick={() => setEdit({ name: "", contact: "", phone: "", email: "", notes: "" })}><Plus className="h-4 w-4" /> Furnizor nou</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <SupplierChip active={sel === "all"} onClick={() => setSel("all")} label="Toți furnizorii" n={view.totals.units} />
          {view.groups.map((g) => (
            <SupplierChip key={g.id} active={sel === g.id} onClick={() => setSel(sel === g.id ? "all" : g.id)} label={g.name} n={g.need} warn={g.unassigned} />
          ))}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          <strong>De comandat</strong> = rezervat + estimare {d.window_days} zile − în depozit. Estimarea repetă ce s-a comandat în ultimele {d.window_days} zile.
        </div>
      </Card>

      {/* 3. Liste pe furnizori */}
      {shown.length === 0 ? (
        <Card><Empty icon={CheckCircle2} title={mode === "need" ? "Nimic de comandat acum" : "Niciun produs"}>{mode === "need" ? "Stocul acoperă comenzile rezervate și estimarea pe următoarele zile." : "Adaugă furnizori și produsele lor."}</Empty></Card>
      ) : shown.map((g) => (
        <SupplierCard key={g.id} g={g} suppliers={d.suppliers} days={d.window_days} mode={mode} onEdit={() => setEdit(g)} onChanged={load} />
      ))}
      {edit && <SupplierModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function NeedKpi({ label, value, unit, sub, tone }) {
  const c = { brand: "text-brand", red: "text-red-600", amber: "text-amber-600", ok: "text-emerald-600" }[tone] || "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 text-3xl font-bold tabular", c)}>{value}{unit && <span className="ml-1 text-base font-semibold text-slate-400">{unit}</span>}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </Card>
  );
}

function SupplierChip({ active, onClick, label, n, warn }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-inset transition-colors",
        active ? "bg-slate-900 text-white ring-slate-900" : warn ? "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50")}>
      <span className="max-w-[180px] truncate">{label}</span>
      <span className={cx("rounded-full px-1.5 text-xs font-semibold tabular", active ? "bg-white/20" : n > 0 ? "bg-brand/10 text-brand" : "bg-slate-100 text-slate-400")}>{n}</span>
    </button>
  );
}

function SupplierCard({ g, suppliers, days, mode, onEdit, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(g.need > 0 || mode === "all");
  const [adding, setAdding] = useState(false);
  const copy = async () => {
    const lines = g.items.filter((r) => r.to_order > 0).map((r) => `${r.to_order} buc — ${productName(r)}${r.sku ? ` (${r.sku})` : ""}`);
    if (!lines.length) { toast.error("Nu e nimic de comandat de la acest furnizor"); return; }
    const txt = `Comandă ${g.name}:\n` + lines.join("\n");
    try { await navigator.clipboard.writeText(txt); toast.success("Lista de comandă a fost copiată"); }
    catch { window.prompt("Copiază lista:", txt); }
  };
  const addProduct = async (r) => {
    try { await api(`/stock/suppliers/${g.id}/products`, { method: "PUT", body: { add: [r.variant_id] } }); onChanged(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <Card className={cx("mb-3 overflow-hidden", g.unassigned && "ring-amber-200")}>
      <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", g.unassigned ? "bg-amber-50" : "bg-white", open && "border-b border-slate-100")}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-[200px] flex-1 cursor-pointer items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
          {g.unassigned && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
          <div className="min-w-0">
            <div className="truncate font-semibold">{g.name}</div>
            <div className="truncate text-xs text-slate-500">
              {g.unassigned ? "Alege furnizorul din coloana Furnizor" : [g.contact, g.phone].filter(Boolean).join(" · ") || `${g.products} produse`}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {g.short > 0 && <span className="whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">Lipsă {g.short}</span>}
          {g.need > 0
            ? <span className="whitespace-nowrap rounded-full bg-brand px-3 py-1 text-sm font-bold text-white tabular">{g.need} buc · {g.needLines} {g.needLines === 1 ? "produs" : "produse"}</span>
            : <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">Nimic de comandat</span>}
          {!g.unassigned && <>
            <Button size="sm" variant="outline" onClick={copy} disabled={!g.need}><Copy className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Copiază comanda</span><span className="sm:hidden">Copiază</span></Button>
            <button onClick={onEdit} aria-label={`Editează ${g.name}`} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
          </>}
        </div>
      </div>
      {open && (
        <>
          {g.rows.length > 0 ? <NeedTable rows={g.rows} days={days} suppliers={suppliers} onChanged={onChanged} groupId={g.unassigned ? null : g.id} />
            : <div className="px-4 py-3 text-sm text-slate-500">{g.items.length ? "Nimic de comandat acum." : "Niciun produs adăugat încă."}</div>}
          {!g.unassigned && (
            <div className="border-t border-slate-100 px-4 py-2.5">
              {adding ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1"><ProductPicker placeholder="Caută produsul pe care îl iei de la acest furnizor…" exclude={g.items.map((r) => r.variant_id)} onPick={addProduct} /></div>
                  <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Gata</Button>
                </div>
              ) : (
                <button onClick={() => setAdding(true)} className="inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-brand hover:underline"><Plus className="h-4 w-4" /> Adaugă produse la {g.name}</button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function NeedTable({ rows, days, suppliers = [], onChanged, groupId }) {
  const toast = useToast();
  const assign = async (r, sid) => {
    try {
      await api("/stock/suppliers/assign", { method: "PUT", body: { variant_id: r.variant_id, supplier_id: sid || null } });
      const name = suppliers.find((x) => x.id === sid)?.name;
      toast.success(name ? `Mutat la ${name}` : "Produsul nu mai are furnizor");
      onChanged?.();
    } catch (e) { toast.error(e.message); }
  };
  const sel = (r, cls) => (
    <select value={r.supplier_id || ""} onChange={(e) => assign(r, e.target.value)} aria-label={`Furnizor pentru ${r.product_title}`}
      className={cx("h-9 cursor-pointer rounded-lg border-0 px-2 text-sm ring-1 ring-inset outline-none focus:ring-2 focus:ring-brand", cls, r.supplier_id ? "bg-white text-slate-700 ring-slate-200" : "bg-amber-50 text-amber-800 ring-amber-300")}>
      <option value="">— fără furnizor —</option>
      {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );
  return (
    <>
    {/* telefon: carduri */}
    <div className="divide-y divide-slate-100 md:hidden">
      {rows.map((r) => (
        <div key={r.variant_id} className="px-4 py-3">
          <div className="flex items-start gap-3">
            <Thumb src={r.image} />
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-medium">{r.product_title}</div>
              <div className="text-xs text-slate-500">{[r.variant_title, r.sku].filter(Boolean).join(" · ")}</div>
              <div className="mt-1 text-xs text-slate-600">stoc <strong className={r.on_hand <= 0 ? "text-red-600" : ""}>{r.on_hand}</strong> · rezervat <strong className="text-amber-600">{r.reserved}</strong> · {r.per_day}/zi
                {r.short_now > 0 && <span className="ml-1 font-semibold text-red-700">· lipsă {r.short_now}</span>}</div>
            </div>
            {r.to_order > 0
              ? <span className={cx("shrink-0 rounded-lg px-2.5 py-1 text-lg font-bold tabular", r.short_now > 0 ? "bg-red-600 text-white" : "bg-brand/10 text-brand")}>{r.to_order}</span>
              : <span className="shrink-0 text-slate-300">—</span>}
          </div>
          <div className="mt-2">{sel(r, "w-full")}</div>
        </div>
      ))}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2">Produs</th>
            <th className="w-28 whitespace-nowrap px-3 py-2 text-center">De comandat</th>
            <th className="hidden whitespace-nowrap px-3 py-2 text-right md:table-cell">Stoc / Rezervat</th>
            <th className="hidden whitespace-nowrap px-3 py-2 text-right lg:table-cell">Ritm vânzare</th>
            <th className="px-3 py-2">Furnizor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.variant_id} className="hover:bg-slate-50/70">
              <td className="px-4 py-2">
                <div className="flex items-center gap-3">
                  <Thumb src={r.image} />
                  <div className="min-w-0">
                    <div className="line-clamp-1 font-medium" title={r.product_title}>{r.product_title}</div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      <span>{[r.variant_title, r.sku].filter(Boolean).join(" · ")}{r.status === "DRAFT" && " · Draft"}</span>
                      {r.short_now > 0 && <span className="rounded bg-red-50 px-1.5 font-semibold text-red-700 ring-1 ring-inset ring-red-200">lipsă acum {r.short_now}</span>}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-center">
                {r.to_order > 0
                  ? <span className={cx("inline-flex min-w-[3rem] justify-center rounded-lg px-2 py-1 text-lg font-bold tabular", r.short_now > 0 ? "bg-red-600 text-white" : "bg-brand/10 text-brand")}>{r.to_order}</span>
                  : <span className="text-slate-300">—</span>}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular md:table-cell">
                <span className={cx(r.on_hand <= 0 ? "font-semibold text-red-600" : "text-slate-800")}>{r.on_hand}</span>
                <span className="text-slate-300"> / </span><span className="text-amber-600">{r.reserved}</span>
              </td>
              <td className="hidden whitespace-nowrap px-3 py-2 text-right text-slate-600 tabular lg:table-cell" title={`${r.sold_window} buc comandate în ultimele ${days} zile`}>
                {r.per_day}<span className="text-xs text-slate-400">/zi</span>
              </td>
              <td className="px-3 py-2">{sel(r, "w-40")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
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


function RefusedTab() {
  const toast = useToast();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [d, setD] = useState(null);
  const load = () => api("/stock/refused?days=30").then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const undo = async (r) => {
    if (!window.confirm(`Anulezi recepția pentru ${r.order_name}? Produsele (${r.units} buc) se scad înapoi din stoc.`)) return;
    try { await api(`/stock/refused/${r.id}/undo`, { method: "POST" }); toast.success("Recepție anulată"); load(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <button onClick={() => nav("/stocuri/refuzate")}
        className="mb-4 flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand px-6 py-6 text-xl font-bold text-white shadow-lg shadow-brand/25 transition-colors hover:bg-brand-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 sm:py-7 sm:text-2xl">
        <ScanLine className="h-8 w-8" /> SCANEAZĂ COLETE REFUZATE
      </button>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Azi</div>
          <div className="mt-1 text-3xl font-bold tabular">{d ? d.today_parcels : "—"}<span className="ml-1 text-base font-semibold text-slate-400">colete</span></div>
          <div className="text-sm text-slate-500">{d ? d.today_units : "—"} produse readăugate în stoc</div>
          {d && <RefusedTotals items={d.items} />}
        </Card>
        <Card className="p-5">{d ? <RefusedChart items={d.items} /> : <PageLoader />}</Card>
      </div>
      {!d ? <PageLoader /> : d.items.length === 0 ? <Card><Empty icon={ScanLine} title="Niciun colet refuzat recepționat în ultimele 30 de zile" /></Card> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Data</th><th className="px-4 py-3">Comanda / AWB</th><th className="px-4 py-3">Produse readăugate</th><th className="px-4 py-3">Cine</th><th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.items.map((r) => (
                  <tr key={r.id} className={cx(r.undone && "opacity-50")}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmtDateTime(r.created_at)}</td>
                    <td className="px-4 py-2.5"><div className="font-semibold">{r.order_name}</div><div className="font-mono text-xs text-slate-500">{r.awb}</div>{r.customer && <div className="text-xs text-slate-400">{r.customer}{r.city ? `, ${r.city}` : ""}</div>}</td>
                    <td className="px-4 py-2.5">{r.lines.map((l) => <div key={l.movement_id}><strong className="text-emerald-700">+{l.qty}</strong> {l.title}</div>)}{r.undone && <div className="text-xs font-medium text-red-600">anulată de {r.undone_by}</div>}</td>
                    <td className="px-4 py-2.5 text-slate-500">{r.by}</td>
                    <td className="px-2">{isAdmin && !r.undone && <button title="Anulează (scanat din greșeală)" onClick={() => undo(r)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Undo2 className="h-4 w-4" /></button>}</td>
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


const dayKey = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });

function refusedDays(items) {
  const days = [];
  const now = new Date();
  for (let k = 29; k >= 0; k--) {
    const dt = new Date(now.getTime() - k * 86400000);
    days.push({ key: dayKey(dt.toISOString()), date: dt, parcels: 0, units: 0 });
  }
  const map = Object.fromEntries(days.map((x) => [x.key, x]));
  for (const r of items) {
    if (r.undone) continue; // scanările anulate nu se numără
    const x = map[dayKey(r.created_at)];
    if (x) { x.parcels += 1; x.units += r.units || 0; }
  }
  return days;
}

function RefusedTotals({ items }) {
  const days = refusedDays(items);
  const total = days.reduce((a, x) => a + x.parcels, 0);
  const units = days.reduce((a, x) => a + x.units, 0);
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Ultimele 30 de zile</div>
      <div className="mt-1 text-2xl font-bold tabular">{total}<span className="ml-1 text-sm font-semibold text-slate-400">colete</span></div>
      <div className="text-sm text-slate-500">{units} produse · media {(total / 30).toFixed(1)}/zi</div>
    </div>
  );
}

function RefusedChart({ items }) {
  const [h, setH] = useState(null);
  const days = refusedDays(items);
  const max = Math.max(1, ...days.map((x) => x.parcels));
  const fmt = (dt, o) => dt.toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", ...o });
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">Colete refuzate recepționate pe zi</div>
        <div className="text-xs text-slate-500">ultimele 30 de zile · fără scanările anulate</div>
      </div>
      <div className="relative flex h-44 items-end gap-[3px]" onMouseLeave={() => setH(null)}>
        {[0.5, 1].map((g) => <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${g * 100}%` }} />)}
        {days.map((x, i) => (
          <div key={x.key} onMouseEnter={() => setH(i)} className="relative flex h-full flex-1 cursor-default items-end">
            <div className={cx("w-full rounded-t transition-colors", i === days.length - 1 ? "bg-brand" : h === i ? "bg-brand/80" : "bg-brand/40")}
              style={{ height: `${(x.parcels / max) * 100}%`, minHeight: x.parcels ? 3 : 0 }} />
            {h === i && (
              <div className={cx("pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-lg ring-1 ring-slate-200",
                i > 24 ? "right-0" : i < 5 ? "left-0" : "left-1/2 -translate-x-1/2")}>
                <div className="font-semibold capitalize text-slate-900">{fmt(x.date, { weekday: "long", day: "numeric", month: "long" })}</div>
                <div><strong>{x.parcels}</strong> colete · {x.units} produse readăugate</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular text-slate-400">
        <span>{fmt(days[0].date, { day: "numeric", month: "short" })}</span>
        <span>{fmt(days[14].date, { day: "numeric", month: "short" })}</span>
        <span className="font-semibold text-slate-600">azi</span>
      </div>
    </div>
  );
}
