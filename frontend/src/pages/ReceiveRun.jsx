import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Search, Minus, Plus, Package, ChevronLeft, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { Button, PageLoader, cx, useToast } from "../components/ui";

const name = (i) => [i.product_title, i.variant_title].filter(Boolean).join(" — ");
const norm = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function ReceiveRun() {
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState([]);
  const searchRef = useRef(null);
  const qtyRef = useRef(null);

  const load = () => api("/stock/items?view=active").then((r) => setItems(r.filter((x) => !x.is_bundle))).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => { if (!pick) setTimeout(() => searchRef.current?.focus(), 50); else setTimeout(() => qtyRef.current?.focus(), 50); }, [pick]);

  const res = useMemo(() => {
    if (!items) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return items.filter((r) => { const t = norm(`${r.product_title} ${r.variant_title} ${r.sku}`); return words.every((w) => t.includes(w)); }).slice(0, 40);
  }, [items, q]);

  const save = async () => {
    const n = parseInt(qty, 10);
    if (!n || n <= 0) { toast.error("Scrie câte bucăți au venit"); return; }
    setBusy(true);
    try {
      await api("/stock/receipts", { method: "POST", body: { supplier: "", document: "", note: "Intrare de pe telefon", items: [{ variant_id: pick.variant_id, qty: n }] } });
      toast.success(`+${n} buc · ${name(pick)}`);
      setDone([{ ...pick, n, at: Date.now() }, ...done]);
      setItems(items.map((x) => (x.variant_id === pick.variant_id ? { ...x, on_hand: x.on_hand + n } : x)));
      setPick(null); setQty(""); setQ("");
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const step = (d) => setQty((v) => String(Math.max(0, (parseInt(v || "0", 10) || 0) + d)));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        {pick
          ? <button onClick={() => { setPick(null); setQty(""); }} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
          : <button onClick={() => nav("/stocuri?tab=intrari")} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>}
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Intrare marfă</div>
          <div className="text-sm font-semibold">{done.length ? `${done.length} ${done.length === 1 ? "produs adăugat" : "produse adăugate"}` : "Caută produsul"}</div>
        </div>
        <div className="w-10" />
      </div>

      {!items ? <div className="flex flex-1 items-center justify-center"><PageLoader /></div> : pick ? (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 py-5 text-center">
            {pick.image
              ? <img src={pick.image} alt="" className="h-40 w-40 rounded-2xl bg-slate-100 object-contain" />
              : <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-slate-100 text-slate-300"><Package className="h-12 w-12" /></div>}
            <div className="mt-4 text-xl font-bold leading-snug">{pick.product_title}</div>
            {pick.variant_title && <div className="mt-1 text-lg font-semibold text-brand">{pick.variant_title}</div>}
            <div className="mt-1 text-sm text-slate-500">{pick.sku && <span className="font-mono">SKU {pick.sku} · </span>}în depozit acum: <strong className="text-slate-800">{pick.on_hand}</strong></div>
            <div className="mt-6 text-sm font-medium text-slate-600">Câte bucăți au venit?</div>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => step(-1)} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:bg-slate-200"><Minus className="h-7 w-7" /></button>
              <input ref={qtyRef} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} inputMode="numeric" pattern="[0-9]*" placeholder="—" autoComplete="off"
                className="h-20 w-36 rounded-2xl border-0 text-center text-5xl font-bold tabular ring-2 ring-inset ring-slate-300 outline-none focus:ring-brand" />
              <button type="button" onClick={() => step(1)} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:bg-slate-200"><Plus className="h-7 w-7" /></button>
            </div>
            {parseInt(qty, 10) > 0 && <div className="mt-3 text-sm text-slate-500">După salvare: <strong className="text-emerald-700">{pick.on_hand + parseInt(qty, 10)} buc</strong> în depozit</div>}
          </div>
          <div className="border-t border-slate-200 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Button type="submit" size="lg" className="h-14 w-full text-lg" loading={busy} disabled={!(parseInt(qty, 10) > 0)}>Salvează</Button>
          </div>
        </form>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-4 pt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută produsul (nume sau SKU)…" autoComplete="off"
                className="h-14 w-full rounded-xl border-0 pl-11 pr-10 text-base ring-2 ring-inset ring-slate-300 outline-none focus:ring-brand" />
              {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400"><X className="h-5 w-5" /></button>}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {q.trim() ? (res.length === 0 ? <div className="px-4 py-8 text-center text-sm text-slate-500">Niciun produs găsit. Încearcă alt cuvânt sau SKU-ul.</div> : res.map((r) => (
              <button key={r.variant_id} onClick={() => setPick(r)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-slate-100">
                {r.image ? <img src={r.image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300"><Package className="h-5 w-5" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium">{r.product_title}</div>
                  <div className="text-xs text-slate-500">{[r.variant_title, r.sku].filter(Boolean).join(" · ")}{r.status === "DRAFT" && " · Draft"}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-500">în depozit<div className="text-base font-semibold text-slate-800 tabular">{r.on_hand}</div></div>
              </button>
            ))) : done.length ? (
              <div className="px-2 py-2">
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Adăugate acum</div>
                {done.map((d) => (
                  <div key={d.at} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1 truncate">{name(d)}</span>
                    <span className={cx("font-semibold tabular text-emerald-700")}>+{d.n}</span>
                  </div>
                ))}
              </div>
            ) : <div className="px-6 py-10 text-center text-sm text-slate-500">Scrie numele sau SKU-ul produsului care a venit.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
