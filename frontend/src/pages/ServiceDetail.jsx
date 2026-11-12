import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Pencil, MapPin, Truck, ExternalLink, Printer, RefreshCw, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime, glsTrackUrl, SHIP_STATUS, SLOTS, WHEN_STARTED } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Pill, Select, Textarea, useToast } from "../components/ui";
import {
  ConsentCard, CustomerCard, DetailHeader, FilesCard, HistoryCard, NotesCard, PrintTitle, ProductsCard, Row,
} from "../components/CaseParts";

const yesNo = (v) => (v === true ? "Da" : v === false ? "Nu" : "—");

export default function ServiceDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [item, setItem] = useState(null);
  const [statuses, setStatuses] = useState([]);

  const load = useCallback(async () => {
    try { setItem(await api(`/service/${id}`)); } catch (e) { toast.error(e.message); }
  }, [id]); // eslint-disable-line

  useEffect(() => { load(); api("/service/statuses").then(setStatuses).catch(() => {}); }, [load]);

  const patch = async (body) => {
    try {
      setItem(await api(`/service/${id}`, { method: "PATCH", body }));
      toast.success("Salvat");
    } catch (e) { toast.error(e.message); }
  };

  if (!item) return <PageLoader />;

  return (
    <div>
      <PrintTitle title="Fișă service" number={item.service_number} />
      <DetailHeader
        kind="service" item={item} onReload={load} number={item.service_number} statuses={statuses} onPatch={patch}
        backTo="/service" backLabel="Toate cererile de service"
        onRefreshOrder={async () => {
          try { setItem(await api(`/service/${id}/refresh-order`, { method: "POST" })); toast.success("Comanda a fost reîncărcată din Shopify"); }
          catch (e) { toast.error(e.message); }
        }}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card title="Problema raportată">
            <div className="px-5 py-3">
              <Row label="Tip problemă"><span className="font-medium">{item.problem_type?.name || item.problem_type_name}</span></Row>
              <Row label="Descriere"><span className="whitespace-pre-wrap">{item.defect_description}</span></Row>
              <Row label="Când a apărut">{WHEN_STARTED[item.when_started] || item.when_started}</Row>
              <Row label="Produs utilizat">{yesNo(item.product_used)}</Row>
              <Row label="Deteriorare vizibilă">{yesNo(item.visual_damage)}</Row>
              <Row label="Observații">{item.customer_notes && <span className="whitespace-pre-wrap">{item.customer_notes}</span>}</Row>
              <div className="pt-2"><ConsentCard consent={item.consent} /></div>
            </div>
          </Card>
          <ProductsCard items={item.items} />
          <TechCard item={item} onPatch={patch} />
          <FilesCard kind="service" id={item.id} files={item.files || []} onChanged={load} />
          <NotesCard notes={item.notes || []} onAdd={async (body) => { await api(`/service/${id}/notes`, { method: "POST", body: { body } }); await load(); }} />
        </div>
        <div className="space-y-5">
          <CustomerCard item={item} onPatch={patch} />
          <PickupCard item={item} onPatch={patch} onChanged={load} />
          <HistoryCard history={item.history || []} />
        </div>
      </div>
    </div>
  );
}

function TechCard({ item, onPatch }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  return (
    <Card title="Diagnostic și rezoluție"
      actions={<Button size="sm" variant="ghost" onClick={() => { setF({ technician_notes: item.technician_notes || "", resolution: item.resolution || "" }); setEdit(true); }}><Pencil className="h-3.5 w-3.5" /> Editează</Button>}>
      <div className="px-5 py-3">
        <Row label="Note tehnician">{item.technician_notes && <span className="whitespace-pre-wrap">{item.technician_notes}</span>}</Row>
        <Row label="Rezoluție">{item.resolution && <span className="whitespace-pre-wrap">{item.resolution}</span>}</Row>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title="Diagnostic și rezoluție"
        footer={<><Button variant="outline" onClick={() => setEdit(false)}>Renunță</Button>
          <Button onClick={async () => { await onPatch(f); setEdit(false); }}>Salvează</Button></>}>
        <div className="space-y-3">
          <Field label="Note tehnician / diagnostic"><Textarea rows={4} value={f.technician_notes} onChange={(e) => setF({ ...f, technician_notes: e.target.value })} /></Field>
          <Field label="Rezoluție"><Textarea rows={3} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} placeholder="ex: Reparat sub garanție / Înlocuit cu produs nou / Respins — urme de lovire" /></Field>
        </div>
      </Modal>
    </Card>
  );
}

function nextBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function PickupCard({ item, onPatch, onChanged }) {
  const p = item.pickup || {};
  const toast = useToast();
  const active = (item.shipments || []).find((s) => s.status !== "cancelled");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const openModal = async () => {
    setModal(true); setForm(null);
    try {
      const a = await api(`/service/${item.id}/pickup-address`);
      setForm({ pickup: a, parcel_count: 1, pickup_date: nextBusinessDay(), notify_customer: true });
    } catch (e) { toast.error(e.message); setModal(false); }
  };
  const create = async () => {
    setBusy("create");
    try {
      const s = await api(`/service/${item.id}/pickup`, { method: "POST", body: form });
      toast.success(`Curier chemat · AWB ${s.awb}`);
      setModal(false); onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };
  const act = async (what, fn) => {
    setBusy(what);
    try { await fn(); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };
  const setP = (k, v) => setForm((x) => ({ ...x, pickup: { ...x.pickup, [k]: v } }));
  const st = active && (SHIP_STATUS[active.status] || { label: active.status_description || active.status, cls: "bg-slate-50 text-slate-600 ring-slate-200" });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const [aw, setAw] = useState(false);
  const [a, setA] = useState({});
  return (
    <Card title={<span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" /> Ridicare și AWB-uri</span>}
      actions={<Button size="sm" variant="ghost" onClick={() => { setF({ ...p }); setEdit(true); }}><Pencil className="h-3.5 w-3.5" /> Adresă</Button>}>
      <div className="px-5 py-3">
        <Row label="Adresă">{[p.address1, p.city, p.county, p.zip].filter(Boolean).join(", ")}</Row>
        <Row label="Contact">{[p.contact_name, p.contact_phone].filter(Boolean).join(" · ")}</Row>
        <Row label="Interval preferat">{SLOTS[p.preferred_slot] || p.preferred_slot}</Row>
        <div className="my-2 border-t border-slate-100" />
        {active ? (
          <div className="mb-2 space-y-2 rounded-lg bg-slate-50 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">Curier GLS chemat la client · AWB</div>
                <div className="font-mono text-lg font-bold">{active.awb}</div>
              </div>
              <Pill className={st.cls}>{st.label}</Pill>
            </div>
            <div className="text-xs text-slate-500">
              {active.status_description}{active.last_event_at && ` · ${fmtDateTime(active.last_event_at)}`}
              {active.pickup_date && <div>Ridicare programată din {fmtDate(active.pickup_date)} · creat de {active.created_by || "—"}</div>}
            </div>
            {active.sync_error && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">Ultima actualizare GLS: {active.sync_error}</div>}
            <div className="no-print flex flex-wrap gap-2">
              <a href={`/api/shipments/${active.id}/label`} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Printer className="h-3.5 w-3.5" /> Etichetă AWB</Button></a>
              <Button size="sm" variant="outline" loading={busy === "sync"} onClick={() => act("sync", () => api(`/shipments/${active.id}/sync`, { method: "POST" }))}><RefreshCw className="h-3.5 w-3.5" /> Actualizează</Button>
              {!["delivered", "picked_up", "in_transit", "at_hub", "out_for_delivery"].includes(active.status) && (
                <Button size="sm" variant="danger" loading={busy === "cancel"}
                  onClick={() => window.confirm(`Anulezi AWB ${active.awb}? Ridicarea va fi anulată și la GLS.`) && act("cancel", () => api(`/shipments/${active.id}/cancel`, { method: "POST" }))}>
                  <XCircle className="h-3.5 w-3.5" /> Anulează
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="no-print mb-2 space-y-2">
            <p className="text-sm text-slate-600">Niciun curier chemat încă. GLS vine la adresa clientului, ridică produsul defect și îl aduce la depozit.</p>
            <Button onClick={openModal} className="w-full"><Truck className="h-4 w-4" /> Cheamă curierul la client</Button>
          </div>
        )}
        <Row label="AWB ridicare">{item.awb_inbound && <AwbLink awb={item.awb_inbound} />}</Row>
        <Row label="AWB trimitere">{item.awb_outbound && <AwbLink awb={item.awb_outbound} />}</Row>
        <div className="no-print pt-2">
          <Button size="sm" variant="outline" onClick={() => { setA({ awb_inbound: item.awb_inbound || "", awb_outbound: item.awb_outbound || "" }); setAw(true); }}>
            <Truck className="h-3.5 w-3.5" /> Notează AWB-uri
          </Button>
        </div>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title="Adresă ridicare"
        footer={<><Button variant="outline" onClick={() => setEdit(false)}>Renunță</Button>
          <Button onClick={async () => { await onPatch({ pickup: f }); setEdit(false); }}>Salvează</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Adresă" className="sm:col-span-2"><Input value={f.address1 || ""} onChange={(e) => setF({ ...f, address1: e.target.value })} /></Field>
          <Field label="Localitate"><Input value={f.city || ""} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Județ"><Input value={f.county || ""} onChange={(e) => setF({ ...f, county: e.target.value })} /></Field>
          <Field label="Cod poștal"><Input value={f.zip || ""} onChange={(e) => setF({ ...f, zip: e.target.value })} /></Field>
          <Field label="Interval">
            <Select value={f.preferred_slot || "anytime"} onChange={(e) => setF({ ...f, preferred_slot: e.target.value })}>
              {Object.entries(SLOTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Nume contact"><Input value={f.contact_name || ""} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="Telefon contact"><Input value={f.contact_phone || ""} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={modal} onClose={() => setModal(false)} title="Cheamă curierul GLS la client" wide
        footer={<><Button variant="outline" onClick={() => setModal(false)}>Renunță</Button>
          <Button onClick={create} loading={busy === "create"} disabled={!form}><Truck className="h-4 w-4" /> Cheamă curierul</Button></>}>
        {!form ? <PageLoader /> : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Adresa este cea completată de client în formularul de service. Verific-o și corecteaz-o dacă e nevoie.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nume client"><Input value={form.pickup.name} onChange={(e) => { setP("name", e.target.value); setP("contact_name", e.target.value); }} /></Field>
              <Field label="Telefon"><Input value={form.pickup.contact_phone} onChange={(e) => setP("contact_phone", e.target.value)} /></Field>
              <Field label="Stradă și număr" className="sm:col-span-2"><Input value={form.pickup.street} onChange={(e) => setP("street", e.target.value)} /></Field>
              <Field label="Bloc / scară / ap. (opțional)"><Input value={form.pickup.house_number} onChange={(e) => setP("house_number", e.target.value)} /></Field>
              <Field label="Localitate"><Input value={form.pickup.city} onChange={(e) => setP("city", e.target.value)} /></Field>
              <Field label="Județ"><Input value={form.pickup.county} onChange={(e) => setP("county", e.target.value)} /></Field>
              <Field label="Cod poștal"><Input value={form.pickup.zip_code} onChange={(e) => setP("zip_code", e.target.value)} /></Field>
              <Field label="Email (pentru notificare GLS)" className="sm:col-span-2"><Input value={form.pickup.contact_email} onChange={(e) => setP("contact_email", e.target.value)} /></Field>
              <Field label="Număr colete"><Input type="number" min={1} value={form.parcel_count} onChange={(e) => setForm({ ...form, parcel_count: Number(e.target.value) || 1 })} /></Field>
              <Field label="Data ridicării"><Input type="date" value={form.pickup_date} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-brand" checked={form.notify_customer} onChange={(e) => setForm({ ...form, notify_customer: e.target.checked })} />
              Trimite email clientului cu AWB-ul și data ridicării
            </label>
          </div>
        )}
      </Modal>
      <Modal open={aw} onClose={() => setAw(false)} title="AWB-uri service"
        footer={<><Button variant="outline" onClick={() => setAw(false)}>Renunță</Button>
          <Button onClick={async () => { await onPatch(a); setAw(false); }}>Salvează</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">AWB-urile pentru service se creează din MyGLS. Notează-le aici ca să rămână în istoricul cererii.</p>
          <Field label="AWB ridicare de la client"><Input className="font-mono" value={a.awb_inbound} onChange={(e) => setA({ ...a, awb_inbound: e.target.value })} /></Field>
          <Field label="AWB trimitere produs către client"><Input className="font-mono" value={a.awb_outbound} onChange={(e) => setA({ ...a, awb_outbound: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

function AwbLink({ awb }) {
  const numeric = /^\d{8,}$/.test(awb);
  return (
    <span className="font-mono">
      {awb}
      {numeric && (
        <a href={glsTrackUrl(awb)} target="_blank" rel="noreferrer" className="no-print ml-2 inline-flex items-center gap-1 font-sans text-xs text-brand hover:underline">
          urmărește <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}
