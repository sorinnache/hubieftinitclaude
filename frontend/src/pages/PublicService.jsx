import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { customerName, SLOTS, WHEN_STARTED } from "../lib/format";
import { cx } from "../components/ui";
import {
  ErrorBox, F, FileUploader, NavButtons, OrderLookup, ProductPicker, PublicShell, StepCard, Success, areaCls, fieldCls, useEmbed,
} from "../components/PublicShell";

const STEPS = ["Comandă", "Produse", "Problema", "Poze", "Ridicare"];

function YesNo({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={cx("h-10 flex-1 rounded-lg text-sm ring-1", value === v ? "bg-brand-50 font-medium text-brand ring-2 ring-brand" : "ring-slate-300")}>
          {v ? "Da" : "Nu"}
        </button>
      ))}
    </div>
  );
}

export default function PublicService() {
  const embed = useEmbed();
  const [step, setStep] = useState(0);
  const [order, setOrder] = useState(null);
  const [identity, setIdentity] = useState("");
  const [sel, setSel] = useState({});
  const [types, setTypes] = useState([]);
  const [files, setFiles] = useState([]);
  const [f, setF] = useState({
    customer_name: "", phone: "", email: "", problem_type_id: "", defect_description: "", when_started: "",
    product_used: null, visual_damage: null, notes: "", accepted_terms: false,
  });
  const [p, setP] = useState({ address1: "", city: "", county: "", zip: "", contact_name: "", contact_phone: "", preferred_slot: "anytime" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => { api("/public/service/problem-types").then(setTypes).catch(() => {}); }, []);

  const count = Object.values(sel).reduce((a, b) => a + (b.qty || 0), 0);
  const can = [
    false,
    count > 0,
    f.problem_type_id && f.defect_description.trim() && f.customer_name.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.trim(),
    true,
    p.address1.trim() && p.city.trim() && p.zip.trim() && p.contact_name.trim() && p.contact_phone.trim() && f.accepted_terms,
  ][step];

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await api("/public/service", {
        method: "POST",
        body: {
          order_number: order.order_number, identity, ...f, when_started: f.when_started || null, pickup: p,
          items: Object.entries(sel).filter(([, v]) => v.qty > 0).map(([id, v]) => ({ line_item_id: id, quantity: v.qty })),
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

  if (done) return <PublicShell title="Formular service" steps={STEPS} step={5} embed={embed} done><Success number={done.service_number} email={f.email} kind="service" embed={embed} /></PublicShell>;

  return (
    <PublicShell title="Formular service & schimb" steps={STEPS} step={step} embed={embed}
      actions={step > 0 && <NavButtons step={step} setStep={setStep} canNext={!!can} last={step === 4} busy={busy} onNext={step === 4 ? submit : undefined}
        nextLabel={step === 3 && files.length === 0 ? "Continuă fără poze" : undefined} />}>
      {step === 0 && (
        <OrderLookup intro="Pentru service sau schimb de produs, introdu numărul comenzii și telefonul cu care ai comandat."
          onFound={(o, id) => {
            const name = customerName(o);
            const s = o.shipping_address || {};
            setOrder(o); setIdentity(id); setSel({});
            setF((x) => ({ ...x, customer_name: x.customer_name || name, email: x.email || o.email || "", phone: x.phone || id }));
            setP((x) => ({
              ...x,
              address1: x.address1 || [s.address1, s.address2].filter(Boolean).join(", "),
              city: x.city || s.city || "", county: x.county || s.province || "", zip: x.zip || s.zip || "",
              contact_name: x.contact_name || name || s.name || "", contact_phone: x.contact_phone || id,
            }));
            setStep(1);
          }} />
      )}
      {step === 1 && order && (
        <StepCard title="Pentru ce produs ceri service?" subtitle={`Comanda ${order.name}. Alege produsul cu problema.`}>
          <ProductPicker order={order} selected={sel} setSelected={setSel} />
        </StepCard>
      )}
      {step === 2 && (
        <StepCard title="Spune-ne ce s-a întâmplat" subtitle="Cu cât ne dai mai multe detalii, cu atât rezolvăm mai repede.">
          <div className="space-y-4">
            <F label="Tipul problemei *">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {types.map((t) => (
                  <button key={t.id} type="button" onClick={() => setF({ ...f, problem_type_id: t.id })}
                    className={cx("rounded-lg px-3 py-2.5 text-left text-sm ring-1", f.problem_type_id === t.id ? "bg-brand-50 font-medium text-brand ring-2 ring-brand" : "ring-slate-300 hover:bg-slate-50")}>
                    {t.name}
                  </button>
                ))}
              </div>
            </F>
            <F label="Descrie problema *"><textarea className={areaCls} rows={3} value={f.defect_description} onChange={(e) => setF({ ...f, defect_description: e.target.value })} placeholder="ex: Aparatul se oprește după 2 minute de funcționare" /></F>
            <F label="Când a apărut problema?">
              <select className={fieldCls} value={f.when_started} onChange={(e) => setF({ ...f, when_started: e.target.value })}>
                <option value="">Alege</option>
                {Object.entries(WHEN_STARTED).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </F>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <F label="Produsul a fost folosit?"><YesNo value={f.product_used} onChange={(v) => setF({ ...f, product_used: v })} /></F>
              <F label="Are deteriorări vizibile?"><YesNo value={f.visual_damage} onChange={(v) => setF({ ...f, visual_damage: v })} /></F>
            </div>
            <F label="Alte observații"><textarea className={areaCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></F>
            <div className="border-t border-slate-100 pt-4 text-sm font-semibold">Datele tale de contact</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <F label="Nume complet *"><input className={fieldCls} value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} /></F>
              <F label="Telefon *"><input className={fieldCls} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></F>
              <F label="Email *" className="sm:col-span-2"><input className={fieldCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></F>
            </div>
          </div>
        </StepCard>
      )}
      {step === 3 && (
        <StepCard title="Poze și video" subtitle="Un video scurt în care se vede problema ne ajută enorm să o rezolvăm rapid.">
          <FileUploader endpoint="/public/service/upload" files={files} setFiles={setFiles} big />
        </StepCard>
      )}
      {step === 4 && (
        <StepCard title="De unde ridicăm produsul?" subtitle="Am completat adresa din comandă. Verifică și corectează dacă e nevoie.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <F label="Adresă (stradă, număr, bloc, apartament) *" className="sm:col-span-2"><input className={fieldCls} value={p.address1} onChange={(e) => setP({ ...p, address1: e.target.value })} /></F>
            <F label="Localitate *"><input className={fieldCls} value={p.city} onChange={(e) => setP({ ...p, city: e.target.value })} /></F>
            <F label="Județ"><input className={fieldCls} value={p.county} onChange={(e) => setP({ ...p, county: e.target.value })} /></F>
            <F label="Cod poștal *"><input className={fieldCls} inputMode="numeric" value={p.zip} onChange={(e) => setP({ ...p, zip: e.target.value })} /></F>
            <F label="Interval preferat">
              <select className={fieldCls} value={p.preferred_slot} onChange={(e) => setP({ ...p, preferred_slot: e.target.value })}>
                {Object.entries(SLOTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </F>
            <F label="Persoană de contact *"><input className={fieldCls} value={p.contact_name} onChange={(e) => setP({ ...p, contact_name: e.target.value })} /></F>
            <F label="Telefon contact *"><input className={fieldCls} inputMode="tel" value={p.contact_phone} onChange={(e) => setP({ ...p, contact_phone: e.target.value })} /></F>
          </div>
          <label className="mt-5 flex cursor-pointer items-start gap-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={f.accepted_terms} onChange={(e) => setF({ ...f, accepted_terms: e.target.checked })} />
            <span className="text-xs leading-relaxed text-slate-600">
              Sunt de acord cu termenii de garanție și service IEFTINIT.RO și înțeleg că diagnosticarea poate dura câteva zile lucrătoare.
            </span>
          </label>
          <ErrorBox>{err}</ErrorBox>
        </StepCard>
      )}
    </PublicShell>
  );
}
