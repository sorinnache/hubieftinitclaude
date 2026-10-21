import { useState } from "react";
import { Banknote, Repeat, Ticket } from "lucide-react";
import { api } from "../lib/api";
import { customerName } from "../lib/format";
import { cx } from "../components/ui";
import {
  ErrorBox, F, FileUploader, NavButtons, OrderLookup, ProductPicker, PublicShell, StepCard, Success, areaCls, fieldCls, useEmbed,
} from "../components/PublicShell";

const STEPS = ["Comandă", "Produse", "Detalii", "Rambursare"];
const TYPES = [
  { v: "refund", icon: Banknote, l: "Vreau banii înapoi", d: "Rambursăm suma în contul tău bancar (IBAN)" },
  { v: "exchange", icon: Repeat, l: "Vreau alt produs", d: "Înlocuim produsul cu altă mărime / culoare / model" },
  { v: "voucher", icon: Ticket, l: "Vreau un voucher", d: "Primești un voucher pentru următoarea comandă" },
];

export default function PublicReturn() {
  const embed = useEmbed();
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState(null);
  const [identity, setIdentity] = useState("");
  const [sel, setSel] = useState({});
  const [files, setFiles] = useState([]);
  const [f, setF] = useState({ customer_name: "", phone: "", email: "", reason: "", notes: "", return_type: "refund", iban: "", bank: "", accepted_terms: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  const count = Object.values(sel).reduce((a, b) => a + (b.qty || 0), 0);
  const ibanClean = f.iban.replace(/\s/g, "").toUpperCase();
  const ibanOk = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanClean);

  const can = [
    false,
    count > 0,
    f.customer_name.trim() && f.phone.trim() && /\S+@\S+\.\S+/.test(f.email) && f.reason.trim(),
    f.accepted_terms && (f.return_type !== "refund" || ibanOk),
  ][step];

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await api("/public/returns", {
        method: "POST",
        body: {
          order_number: order.order_number, identity, ...f, iban: ibanClean,
          items: Object.entries(sel).filter(([, v]) => v.qty > 0).map(([id, v]) => ({ line_item_id: id, quantity: v.qty, reason: v.reason || "" })),
          file_ids: files.map((x) => x.id),
        },
      });
      setDone(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) return <PublicShell title="Formular retur" steps={STEPS} step={4} embed={embed} done><Success number={done.return_number} email={f.email} kind="return" embed={embed} /></PublicShell>;

  return (
    <PublicShell title="Formular retur" steps={STEPS} step={step} embed={embed}
      actions={step > 0 && <NavButtons step={step} setStep={setStep} canNext={!!can} last={step === 3} busy={busy} onNext={step === 3 ? submit : undefined} />}>
      {step === 0 && (
        <OrderLookup intro="Introdu numărul comenzii și telefonul cu care ai comandat. Completăm noi restul datelor."
          onFound={(o, id) => {
            setOrder(o); setIdentity(id); setSel({});
            setF((x) => ({ ...x, customer_name: x.customer_name || customerName(o), email: x.email || o.email || "", phone: x.phone || id }));
            setStep(1);
          }} />
      )}
      {step === 1 && order && (
        <StepCard title="Ce produse returnezi?" subtitle={`Comanda ${order.name}. Alege cantitatea pentru fiecare produs.`}>
          <ProductPicker order={order} selected={sel} setSelected={setSel} withReason />
        </StepCard>
      )}
      {step === 2 && (
        <StepCard title="Datele tale și motivul" subtitle="Verifică datele de contact și spune-ne de ce returnezi.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <F label="Nume complet *"><input className={fieldCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} /></F>
            <F label="Telefon *"><input className={fieldCls} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></F>
            <F label="Email *" className="sm:col-span-2"><input className={fieldCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></F>
            <F label="Motivul returului *" className="sm:col-span-2"><textarea className={areaCls} rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="ex: Produsul a sosit deteriorat / Nu se potrivește" /></F>
            <F label="Alte observații" className="sm:col-span-2"><textarea className={areaCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></F>
            <div className="sm:col-span-2">
              <div className="mb-1.5 text-sm font-medium">Poze sau video cu produsul (recomandat)</div>
              <FileUploader endpoint="/public/upload" files={files} setFiles={setFiles} />
            </div>
          </div>
        </StepCard>
      )}
      {step === 3 && (
        <StepCard title="Ce dorești în schimb?" subtitle="Alege varianta potrivită pentru tine.">
          <div className="space-y-2">
            {TYPES.map((t) => (
              <label key={t.v} className={cx("flex cursor-pointer items-center gap-4 rounded-xl p-4 ring-1", f.return_type === t.v ? "bg-brand-50/50 ring-2 ring-brand" : "ring-slate-200 hover:bg-slate-50")}>
                <input type="radio" name="t" className="accent-brand" checked={f.return_type === t.v} onChange={() => setF({ ...f, return_type: t.v })} />
                <t.icon className="h-5 w-5 text-slate-500" />
                <div>
                  <div className="text-sm font-medium">{t.l}</div>
                  <div className="text-xs text-slate-500">{t.d}</div>
                </div>
              </label>
            ))}
          </div>
          {f.return_type === "refund" && (
            <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl bg-slate-50 p-4">
              <F label="IBAN *">
                <input className={cx(fieldCls, "font-mono")} value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} placeholder="RO49AAAA1B31007593840000" />
                {f.iban && !ibanOk && <span className="block text-xs text-red-600">IBAN-ul nu pare corect — are 24 de caractere și începe cu RO.</span>}
              </F>
              <F label="Banca"><input className={fieldCls} value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} placeholder="ex: BCR, BT, ING" /></F>
              <div className="text-xs text-slate-500">Titularul contului trebuie să fie persoana care a plasat comanda.</div>
            </div>
          )}
          <label className="mt-5 flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.accepted_terms} onChange={(e) => setF({ ...f, accepted_terms: e.target.checked })} />
            <span className="text-xs leading-relaxed text-slate-600">
              Sunt de acord cu politica de retur IEFTINIT.RO și confirm că produsul va fi returnat cu toate accesoriile primite.
            </span>
          </label>
          <ErrorBox>{err}</ErrorBox>
        </StepCard>
      )}
    </PublicShell>
  );
}
