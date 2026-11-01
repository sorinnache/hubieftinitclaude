import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ScanLine, CheckCircle2, AlertTriangle, Package, Keyboard } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../components/ui";

let ctx;
function beep(ok) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = ok ? [[880, 0], [1320, 0.09]] : [[220, 0], [180, 0.18]];
    tones.forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = ok ? "sine" : "square";
      g.gain.setValueAtTime(0.18, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + (ok ? 0.12 : 0.3));
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + (ok ? 0.13 : 0.32));
    });
  } catch { /* fără sunet */ }
}
const hm = (iso) => new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });

export default function RefusedRun() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null); // {ok, data|error}
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({ today_parcels: 0, today_units: 0 });
  const ref = useRef(null);

  const load = () => api("/stock/refused?days=1").then((r) => { setList(r.items); setStats(r); }).catch(() => {});
  useEffect(() => { load(); }, []);
  // scannerul „tastează” codul și apasă Enter — ținem mereu cursorul în câmp
  useEffect(() => {
    const f = () => ref.current?.focus();
    f();
    const i = setInterval(() => { if (document.activeElement !== ref.current && !busy) f(); }, 800);
    return () => clearInterval(i);
  }, [busy]);

  const submit = async (e) => {
    e?.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setCode("");
    try {
      const r = await api("/stock/refused/scan", { method: "POST", body: { code: c } });
      beep(true); setLast({ ok: true, data: r }); load();
    } catch (err) {
      beep(false); setLast({ ok: false, code: c, error: err.message });
    } finally { setBusy(false); setTimeout(() => ref.current?.focus(), 30); }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50" onClick={() => ref.current?.focus()}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={() => nav("/stocuri?tab=refuzate")} className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        <div className="text-center">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Recepție colete refuzate</div>
          <div className="text-sm font-semibold">Azi: {stats.today_parcels} colete · {stats.today_units} produse readăugate în stoc</div>
        </div>
        <div className="w-10" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-5 py-6">
        <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600"><ScanLine className="h-5 w-5 text-brand" /> Scanează codul de bare de pe AWB</div>
          <input ref={ref} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus inputMode="none"
            placeholder={busy ? "Se procesează…" : "Așteaptă scanarea…"}
            className="h-16 w-full rounded-xl border-0 px-4 font-mono text-2xl tracking-wider ring-2 ring-inset ring-brand/50 outline-none focus:ring-brand" />
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Keyboard className="h-3.5 w-3.5" /> Poți scrie și manual numărul AWB și apăsa Enter.</div>
        </form>

        {last && (last.ok ? (
          <div key={last.data.id} className="mt-5 rounded-2xl bg-emerald-50 p-5 ring-2 ring-emerald-300">
            <div className="flex items-center gap-2 text-lg font-bold text-emerald-800"><CheckCircle2 className="h-6 w-6" /> {last.data.order_name} — readăugat în stoc</div>
            <div className="mt-0.5 text-sm text-emerald-700">AWB {last.data.awb}{last.data.customer && ` · ${last.data.customer}`}{last.data.city && `, ${last.data.city}`}</div>
            <div className="mt-3 space-y-2">
              {last.data.lines.map((l) => (
                <div key={l.movement_id} className="flex items-center gap-3 rounded-xl bg-white p-2.5 ring-1 ring-emerald-200">
                  {l.image ? <img src={l.image} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100"><Package className="h-5 w-5 text-slate-300" /></div>}
                  <div className="min-w-0 flex-1"><div className="line-clamp-2 text-sm font-medium">{l.title}</div><div className="text-xs text-slate-500">{l.sku} · acum în depozit: {l.on_hand_after}</div></div>
                  <div className="text-2xl font-extrabold text-emerald-700">+{l.qty}</div>
                </div>
              ))}
              {last.data.lines.length === 0 && <div className="text-sm text-emerald-800">Comanda nu avea produse cu stoc urmărit.</div>}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl bg-red-50 p-5 ring-2 ring-red-300">
            <div className="flex items-center gap-2 text-lg font-bold text-red-800"><AlertTriangle className="h-6 w-6" /> Nu s-a adăugat nimic în stoc</div>
            <div className="mt-1 font-mono text-sm text-red-700">Cod scanat: {last.code}</div>
            <div className="mt-2 text-sm text-red-800">{last.error}</div>
          </div>
        ))}

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Recepționate azi</div>
          {list.length === 0 ? <div className="text-sm text-slate-400">Niciun colet scanat azi.</div> : list.map((r) => (
            <div key={r.id} className={cx("mb-1.5 flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200", r.undone && "opacity-40 line-through")}>
              <span className="w-12 text-xs tabular text-slate-400">{hm(r.created_at)}</span>
              <span className="font-semibold">{r.order_name}</span>
              <span className="font-mono text-xs text-slate-500">{r.awb}</span>
              <span className="min-w-0 flex-1 truncate text-slate-600">{r.lines.map((l) => `+${l.qty} ${l.title}`).join(", ")}</span>
              <span className="text-xs text-slate-400">{r.by}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
