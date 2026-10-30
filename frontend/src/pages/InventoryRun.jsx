import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { X, ChevronLeft, Minus, Plus, Package, CheckCircle2, MapPin, List } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, PageLoader, cx, useToast } from "../components/ui";

const name = (i) => [i.product_title, i.variant_title].filter(Boolean).join(" — ");

export default function InventoryRun() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const onlyNew = params.get("nou") === "1";
  const checkMode = params.get("verificare") === "1";
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [sess, setSess] = useState(undefined);
  const [idx, setIdx] = useState(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(false);
  const inputRef = useRef(null);

  const firstOpen = (s) => s.items.findIndex((i) => i.counted === null);

  useEffect(() => {
    api("/stock/inventory/session", { method: "POST", body: { scope: onlyNew ? "new" : checkMode ? "check" : "full" } })
      .then((r) => { setSess(r.session); const f = firstOpen(r.session); setIdx(f === -1 ? r.session.items.length : f); })
      .catch((e) => { toast.error(e.message); nav("/stocuri?tab=inventar"); });
  }, []); // eslint-disable-line

  const item = sess && idx !== null ? sess.items[idx] : null;
  useEffect(() => {
    setVal(item && item.counted !== null ? String(item.counted) : "");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [idx, item?.variant_id]); // eslint-disable-line

  const save = async (forced) => {
    const v = forced !== undefined ? String(forced) : val;
    if (v === "" || !/^\d+$/.test(v)) { toast.error("Scrie cantitatea găsită (0 dacă nu există niciun produs)"); inputRef.current?.focus(); return; }
    setBusy(true);
    try {
      const r = await api("/stock/inventory/session/count", { method: "POST", body: { variant_id: item.variant_id, counted: Number(v) } });
      setSess(r.session);
      // următorul produs nenumărat după cel curent; dacă nu există, primul nenumărat de la început
      const items = r.session.items;
      let next = items.findIndex((i, k) => k > idx && i.counted === null);
      if (next === -1) next = firstOpen(r.session);
      setIdx(next === -1 ? items.length : next);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const r = await api("/stock/inventory/session/finish", { method: "POST" });
      toast.success(`${sess.scope === "check" ? "Verificare finalizată" : "Inventar finalizat"}: ${r.products} produse, ${r.changed} cu diferențe`);
      nav("/stocuri?tab=stoc");
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const abandon = async () => {
    if (!window.confirm("Abandonezi inventarul? Cantitățile deja salvate rămân aplicate, dar sesiunea se închide.")) return;
    try { await api("/stock/inventory/session/abandon", { method: "POST" }); nav("/stocuri?tab=inventar"); }
    catch (e) { toast.error(e.message); }
  };

  const diffs = useMemo(() => (sess ? sess.items.filter((i) => i.counted !== null && i.counted !== i.before) : []), [sess]);

  if (sess === undefined || idx === null) return <div className="flex h-dvh items-center justify-center"><PageLoader /></div>;

  const pct = sess.total ? Math.round((sess.done / sess.total) * 100) : 0;
  const allDone = sess.done === sess.total;
  const step = (d) => setVal((v) => String(Math.max(0, (parseInt(v || "0", 10) || 0) + d)));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white">
      {/* bara de sus */}
      <div className="border-b border-slate-200 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => nav("/stocuri?tab=inventar")} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="Ieși (inventarul rămâne salvat, continui oricând)">
            <X className="h-5 w-5" />
          </button>
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{sess.scope === "new" ? "Inventar · produse noi" : sess.scope === "check" ? "Verificare stoc" : "Inventar"}</div>
            <div className="text-lg font-bold tabular">{sess.done} / {sess.total}</div>
          </div>
          <button onClick={() => setList(true)} className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" title="Lista produselor">
            <List className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {item ? (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 py-5 text-center">
            <div className="text-xs font-medium text-slate-400">Produsul {idx + 1} din {sess.total}{item.counted !== null && " · deja numărat, poți corecta"}</div>
            {item.image
              ? <img src={item.image} alt="" className="mt-3 h-44 w-44 rounded-2xl bg-slate-100 object-contain sm:h-56 sm:w-56" />
              : <div className="mt-3 flex h-44 w-44 items-center justify-center rounded-2xl bg-slate-100 text-slate-300"><Package className="h-12 w-12" /></div>}
            <div className="mt-4 text-xl font-bold leading-snug">{item.product_title}</div>
            {item.variant_title && <div className="mt-1 text-lg font-semibold text-brand">{item.variant_title}</div>}
            {item.status === "DRAFT" && <div className="mt-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">Draft — nu e activ pe site, dar poate fi în depozit</div>}
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 text-sm text-slate-500">
              {item.sku && <span className="font-mono">SKU {item.sku}</span>}
              {item.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{item.location}</span>}
            </div>
            {sess.scope === "check" && (
              <div className="mt-5 w-full max-w-sm rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-base text-slate-700">În sistem: <strong className="text-2xl text-slate-900 tabular">{item.on_hand}</strong> buc</div>
                <div className="mt-1 text-sm font-medium text-slate-600">Sunt {item.on_hand} bucăți în stoc?</div>
                <Button type="button" size="lg" className="mt-3 h-14 w-full bg-emerald-600 text-lg hover:bg-emerald-700" loading={busy} onClick={() => save(item.on_hand)}>
                  <CheckCircle2 className="h-5 w-5" /> Da, sunt {item.on_hand}
                </Button>
              </div>
            )}
            <div className="mt-6 text-sm font-medium text-slate-600">{sess.scope === "check" ? "Nu? Scrie câte sunt de fapt:" : "Câte bucăți sunt fizic în depozit?"}</div>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => step(-1)} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:bg-slate-200"><Minus className="h-7 w-7" /></button>
              <input ref={inputRef} value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric" pattern="[0-9]*" placeholder="—" autoComplete="off"
                className="h-20 w-36 rounded-2xl border-0 text-center text-5xl font-bold tabular ring-2 ring-inset ring-slate-300 outline-none focus:ring-brand" />
              <button type="button" onClick={() => step(1)} className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 active:bg-slate-200"><Plus className="h-7 w-7" /></button>
            </div>
            <div className="mt-3 max-w-xs text-xs text-slate-400">Dacă nu găsești niciun produs, scrie 0. Nu număra coletele deja ambalate cu AWB.</div>
          </div>
          <div className="flex gap-3 border-t border-slate-200 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Button type="button" variant="outline" size="lg" className="h-14 px-4" disabled={idx === 0 || busy} onClick={() => setIdx(idx - 1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button type="submit" size="lg" className="h-14 flex-1 text-lg" loading={busy} disabled={val === ""}>{sess.scope === "check" ? "Salvează cantitatea corectă" : "Salvează și continuă"}</Button>
          </div>
        </form>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 py-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <div className="mt-3 text-2xl font-bold">{sess.scope === "check" ? "Toate produsele au fost verificate" : "Toate produsele au fost numărate"}</div>
            <div className="mt-1 text-sm text-slate-500">{sess.total} produse · {diffs.length} cu diferențe față de sistem</div>
            {diffs.length > 0 && (
              <div className="mt-5 w-full max-w-md divide-y divide-slate-100 rounded-xl text-left ring-1 ring-slate-200">
                {diffs.map((i) => {
                  const d = i.counted - i.before;
                  return (
                    <button key={i.variant_id} onClick={() => setIdx(sess.items.indexOf(i))} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{name(i)}</span>
                      <span className="tabular text-slate-400">{i.before} → {i.counted}</span>
                      <span className={cx("w-12 text-right font-semibold tabular", d > 0 ? "text-emerald-600" : "text-red-600")}>{d > 0 ? `+${d}` : d}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Button size="lg" className="h-14 w-full text-lg" loading={busy} disabled={!allDone} onClick={finish}>{sess.scope === "check" ? "Finalizează verificarea" : "Finalizează inventarul"}</Button>
          </div>
        </div>
      )}

      {list && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
            <div className="font-semibold">Produse ({sess.done}/{sess.total} numărate)</div>
            <button onClick={() => setList(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
            {sess.items.map((i, k) => (
              <button key={i.variant_id} onClick={() => { setIdx(k); setList(false); }}
                className={cx("flex w-full items-center gap-3 px-4 py-3 text-left text-sm", k === idx && "bg-brand-50")}>
                <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", i.counted === null ? "bg-slate-300" : "bg-emerald-500")} />
                <span className="min-w-0 flex-1 truncate">{name(i)}</span>
                <span className="tabular font-semibold">{i.counted ?? "—"}</span>
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="border-t border-slate-200 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <button onClick={abandon} className="w-full rounded-lg py-2 text-sm text-red-600 hover:bg-red-50">Abandonează inventarul</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
