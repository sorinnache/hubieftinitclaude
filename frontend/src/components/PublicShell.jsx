import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Upload, X, Play, Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { api, fileUrl } from "../lib/api";
import { Button, cx } from "./ui";

export function useEmbed() {
  const embed = new URLSearchParams(window.location.search).get("embed") === "1";
  useEffect(() => {
    if (embed) document.documentElement.classList.add("embed");
    return () => document.documentElement.classList.remove("embed");
  }, [embed]);
  return embed;
}

/** Layout formular public: pași sus, conținut cu scroll intern, butoane mereu vizibile jos. */
export function PublicShell({ title, steps, step, embed, children, actions, done }) {
  const contentRef = useRef(null);
  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
    if (embed) {
      try { window.parent?.postMessage({ type: "ieftinit:scrollTop", step }, "*"); } catch { /* ignore */ }
    }
  }, [step, embed]);

  return (
    <div className={cx("flex flex-col text-slate-900", embed ? "h-[100dvh] bg-transparent" : "min-h-screen bg-[#f6f7f9]")}>
      {!embed && (
        <header className="shrink-0 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
            <img src="/ieftinit-logo.png" alt="IEFTINIT.RO" className="h-9 w-auto" />
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{title}</div>
          </div>
        </header>
      )}
      {!done && (
        <div className={cx("mx-auto w-full max-w-3xl shrink-0 px-4 sm:px-6", embed ? "pb-2 pt-3" : "pb-4 pt-6")}>
          <div className="flex items-center">
            {steps.map((s, i) => (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className={cx("flex flex-col items-center gap-1", i <= step ? "text-slate-900" : "text-slate-400")}>
                  <div className={cx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                    i < step ? "bg-brand text-white" : i === step ? "bg-slate-900 text-white" : "bg-slate-200")}>
                    {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <div className="hidden text-[10px] font-semibold uppercase tracking-widest sm:block">{s}</div>
                </div>
                {i < steps.length - 1 && <div className={cx("mx-2 h-px flex-1", i < step ? "bg-brand" : "bg-slate-200")} />}
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={contentRef} className={cx("min-h-0 flex-1", embed && "overflow-y-auto")}>
        <div className="mx-auto max-w-3xl px-4 pb-6 pt-2 sm:px-6">{children}</div>
      </div>
      {actions && !done && (
        <div className={cx("shrink-0 border-t border-slate-200 bg-white", !embed && "sticky bottom-0")} style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">{actions}</div>
        </div>
      )}
    </div>
  );
}

export function StepCard({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {subtitle && <p className="mb-6 mt-1.5 text-sm text-slate-500">{subtitle}</p>}
      {children}
    </div>
  );
}

export function NavButtons({ step, setStep, canNext, onNext, last, busy, nextLabel }) {
  return (
    <>
      <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0} className="h-11">
        <ArrowLeft className="h-4 w-4" /> Înapoi
      </Button>
      <Button onClick={onNext || (() => setStep(step + 1))} disabled={!canNext} loading={busy} className="h-11 px-6">
        {nextLabel || (last ? "Trimite cererea" : "Continuă")} {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
    </>
  );
}

export function ErrorBox({ children }) {
  if (!children) return null;
  return <div className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-100">{children}</div>;
}

export function OrderLookup({ onFound, intro }) {
  const [order, setOrder] = useState("");
  const [ident, setIdent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const id = ident.trim();
      const p = new URLSearchParams(id.includes("@") ? { email: id } : { phone: id });
      const data = await api(`/public/order/${encodeURIComponent(order.trim().replace(/^#/, ""))}?${p}`);
      onFound(data, id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <StepCard title="Hai să găsim comanda ta" subtitle={intro}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Număr comandă *</span>
          <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="ex: 105432" inputMode="numeric"
            className="h-12 w-full rounded-lg px-3 text-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand" />
          <span className="block text-xs text-slate-500">Îl găsești în emailul sau SMS-ul de confirmare a comenzii.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Telefonul folosit la comandă *</span>
          <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="07XX XXX XXX" inputMode="tel" autoComplete="tel"
            className="h-12 w-full rounded-lg px-3 text-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand" />
          <span className="block text-xs text-slate-500">Îl folosim ca să confirmăm că ești tu cel care a plasat comanda.</span>
        </label>
        <ErrorBox>{err}</ErrorBox>
        <Button type="submit" className="h-12 w-full text-base" loading={busy} disabled={!order.trim() || !ident.trim()}>
          Caută comanda <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </StepCard>
  );
}

export function ProductPicker({ order, selected, setSelected, withReason }) {
  const change = (li, delta) => {
    const cur = selected[li.id]?.qty || 0;
    const next = Math.max(0, Math.min(Number(li.quantity) || 1, cur + delta));
    setSelected({ ...selected, [li.id]: { ...(selected[li.id] || {}), qty: next } });
  };
  return (
    <div className="space-y-3">
      {order.line_items.map((li) => {
        const qty = selected[li.id]?.qty || 0;
        return (
          <div key={li.id} className={cx("rounded-xl p-3 ring-1", qty ? "bg-brand-50/40 ring-brand/40" : "ring-slate-200")}>
            <div className="flex items-center gap-3">
              {li.image ? <img src={li.image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover" /> : <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{li.title}</div>
                {li.variant_title && <div className="text-xs text-slate-500">{li.variant_title}</div>}
                <div className="mt-0.5 text-xs text-slate-400">Cumpărat: {li.quantity} buc.</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => change(li, -1)} disabled={!qty} className="h-9 w-9 rounded-lg text-lg ring-1 ring-slate-300 disabled:opacity-40">−</button>
                <div className="w-6 text-center font-semibold tabular">{qty}</div>
                <button type="button" onClick={() => change(li, 1)} disabled={qty >= li.quantity} className="h-9 w-9 rounded-lg text-lg ring-1 ring-slate-300 disabled:opacity-40">+</button>
              </div>
            </div>
            {withReason && qty > 0 && (
              <input value={selected[li.id]?.reason || ""} onChange={(e) => setSelected({ ...selected, [li.id]: { ...selected[li.id], reason: e.target.value } })}
                placeholder="Motivul pentru acest produs (opțional)"
                className="mt-3 h-10 w-full rounded-lg px-3 text-sm ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FileUploader({ endpoint, files, setFiles, big }) {
  const ref = useRef();
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState("");
  const uploadOne = (file) =>
    new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api${endpoint}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data?.detail || "Fișierul nu a putut fi încărcat"));
      };
      xhr.onerror = () => reject(new Error("Conexiunea s-a întrerupt. Reîncearcă."));
      xhr.send(fd);
    });
  const pick = async (e) => {
    const list = Array.from(e.target.files || []);
    setErr("");
    for (const f of list) {
      try {
        const d = await uploadOne(f);
        setFiles((cur) => [...cur, d]);
      } catch (ex) {
        setErr(`${f.name}: ${ex.message}`);
      }
    }
    setProgress(null);
    if (ref.current) ref.current.value = "";
  };
  return (
    <div>
      <input ref={ref} type="file" multiple accept="image/*,video/*" onChange={pick} className="hidden" />
      <button type="button" onClick={() => ref.current?.click()} disabled={!!progress}
        className={cx("flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-center hover:border-brand hover:bg-brand-50/30", big ? "py-10" : "py-6")}>
        {progress ? (
          <>
            <Loader2 className="mb-2 h-6 w-6 animate-spin text-brand" />
            <div className="text-sm">Se încarcă {progress.name}… {progress.pct}%</div>
          </>
        ) : (
          <>
            <Upload className="mb-2 h-6 w-6 text-slate-400" />
            <div className="text-sm font-medium text-brand">Apasă pentru a adăuga poze sau video</div>
            <div className="mt-1 text-xs text-slate-500">maxim 100 MB / fișier</div>
          </>
        )}
      </button>
      <ErrorBox>{err}</ErrorBox>
      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {files.map((f) => (
            <div key={f.id} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
              {f.content_type?.startsWith("image/") ? (
                <img src={fileUrl(f.id)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-800 text-white"><Play className="h-5 w-5" /></div>
              )}
              <button type="button" onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow" aria-label="Șterge">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Success({ number, email, kind, embed }) {
  return (
    <div className={cx("flex items-center justify-center", embed ? "p-4" : "p-6 sm:py-16")}>
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200 sm:p-10">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        </div>
        <h2 className="text-2xl font-bold">Cerere trimisă!</h2>
        <p className="mt-2 text-sm text-slate-500">
          Mulțumim! Am primit cererea ta de {kind === "return" ? "retur" : "service"} și revenim în cel mai scurt timp.
          {email && <> Confirmarea a fost trimisă la <strong>{email}</strong>.</>}
        </p>
        <div className="my-6 rounded-xl bg-slate-50 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Numărul cererii tale</div>
          <div className="mt-1 font-mono text-xl font-bold">{number}</div>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>Trimite altă cerere</Button>
      </div>
    </div>
  );
}

export const fieldCls = "h-11 w-full rounded-lg px-3 text-sm ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand";
export const areaCls = "w-full rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand";

export function F({ label, children, className }) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
