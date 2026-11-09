import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Truck, Printer, RefreshCw, ExternalLink, XCircle, Pencil, ChevronDown, ChevronUp, Repeat, Search, X, Package } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate, fmtDateTime, glsTrackUrl, money, RETURN_TYPES, SHIP_STATUS } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Pill, Select, Textarea, cx, useToast } from "../components/ui";
import {
  ConsentCard, CustomerCard, DetailHeader, FilesCard, HistoryCard, NotesCard, PrintTitle, ProductsCard, Row,
} from "../components/CaseParts";

function nextBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ReturnDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [item, setItem] = useState(null);
  const [statuses, setStatuses] = useState([]);

  const load = useCallback(async () => {
    try { setItem(await api(`/returns/${id}`)); } catch (e) { toast.error(e.message); }
  }, [id]); // eslint-disable-line

  useEffect(() => { load(); api("/returns/statuses").then(setStatuses).catch(() => {}); }, [load]);

  const patch = async (body) => {
    try {
      setItem(await api(`/returns/${id}`, { method: "PATCH", body }));
      toast.success("Salvat");
    } catch (e) { toast.error(e.message); }
  };

  if (!item) return <PageLoader />;

  return (
    <div>
      <PrintTitle title="Fișă retur" number={item.return_number} />
      <DetailHeader
        kind="return" item={item} onReload={load} number={item.return_number} statuses={statuses} onPatch={patch}
        backTo="/retururi" backLabel="Toate retururile"
        onRefreshOrder={async () => {
          try { setItem(await api(`/returns/${id}/refresh-order`, { method: "POST" })); toast.success("Comanda a fost reîncărcată din Shopify"); }
          catch (e) { toast.error(e.message); }
        }}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card title="Motivul returului">
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="whitespace-pre-wrap">{item.reason || "—"}</div>
              {item.customer_notes && (
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-slate-500">Observații client</div>
                  <div className="mt-0.5 whitespace-pre-wrap">{item.customer_notes}</div>
                </div>
              )}
              <ConsentCard consent={item.consent} />
            </div>
          </Card>
          <ProductsCard items={item.items} showReason />
          <RefundCard item={item} onPatch={patch} />
          <FilesCard kind="return" id={item.id} files={item.files || []} onChanged={load} />
          <NotesCard notes={item.notes || []} onAdd={async (body) => { await api(`/returns/${id}/notes`, { method: "POST", body: { body } }); await load(); }} />
        </div>
        <div className="space-y-5">
          <CustomerCard item={item} onPatch={patch} />
          <CourierCard item={item} onChanged={load} />
          <HistoryCard history={item.history || []} />
        </div>
      </div>
    </div>
  );
}

function RefundCard({ item, onPatch }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const open = () => {
    setF({
      return_type: item.return_type || "refund", iban: item.iban || "", bank: item.bank || "",
      refund_amount: item.refund_amount || "", refund_date: item.refund_date || "", resolution: item.resolution || "",
    });
    setEdit(true);
  };
  return (
    <Card title="Soluționare" actions={<Button size="sm" variant="ghost" onClick={open}><Pencil className="h-3.5 w-3.5" /> Editează</Button>}>
      <div className="px-5 py-3">
        <Row label="Clientul cere">{RETURN_TYPES[item.return_type] || item.return_type}</Row>
        {item.return_type === "refund" && (
          <>
            <Row label="IBAN"><span className="font-mono">{item.iban}</span></Row>
            <Row label="Bancă">{item.bank}</Row>
          </>
        )}
        <Row label="Sumă rambursată">{item.refund_amount && money(item.refund_amount)}</Row>
        <Row label="Data rambursării">{item.refund_date && fmtDate(item.refund_date)}</Row>
        <Row label="Rezoluție">{item.resolution && <span className="whitespace-pre-wrap">{item.resolution}</span>}</Row>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title="Soluționare retur"
        footer={<><Button variant="outline" onClick={() => setEdit(false)}>Renunță</Button>
          <Button onClick={async () => { await onPatch(f); setEdit(false); }}>Salvează</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tip retur" className="sm:col-span-2">
            <Select value={f.return_type} onChange={(e) => setF({ ...f, return_type: e.target.value })}>
              {Object.entries(RETURN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="IBAN" className="sm:col-span-2"><Input className="font-mono" value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} /></Field>
          <Field label="Bancă" className="sm:col-span-2"><Input value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></Field>
          <Field label="Sumă rambursată (lei)"><Input inputMode="decimal" value={f.refund_amount} onChange={(e) => setF({ ...f, refund_amount: e.target.value.replace(",", ".") })} /></Field>
          <Field label="Data rambursării"><Input type="date" value={f.refund_date} onChange={(e) => setF({ ...f, refund_date: e.target.value })} /></Field>
          <Field label="Rezoluție / observații" className="sm:col-span-2"><Textarea rows={3} value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })} placeholder="ex: Rambursat integral, produs recepționat în stare bună" /></Field>
        </div>
      </Modal>
    </Card>
  );
}

const EXCHANGE_STATUS = {
  created: "AWB creat — de predat curierului",
  out_for_pickup: "Curierul vine la depozit",
  picked_up: "Preluat din depozit",
  in_transit: "În tranzit spre client",
  at_hub: "În depozitul GLS",
  out_for_delivery: "În livrare la client",
  delivered: "Livrat clientului",
};

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function ShipPill({ s }) {
  const base = SHIP_STATUS[s.status] || { label: s.status_description || s.status, cls: "bg-slate-50 text-slate-600 ring-slate-200" };
  const m = s.kind === "exchange" && EXCHANGE_STATUS[s.status] ? { ...base, label: EXCHANGE_STATUS[s.status] } : base;
  return <Pill className={m.cls}>{m.label}</Pill>;
}

function CourierCard({ item, onChanged }) {
  const toast = useToast();
  const ships = item.shipments || [];
  const active = ships.find((s) => s.status !== "cancelled");
  const past = ships.filter((s) => s !== active);
  const [modal, setModal] = useState(false);
  const [manual, setManual] = useState(false);
  const [awb, setAwb] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState(null);
  const [showTrack, setShowTrack] = useState(false);
  const isExchange = item.return_type === "exchange";
  const [xmodal, setXmodal] = useState(false);
  const [xform, setXform] = useState(null);

  const openExchange = async () => {
    setXmodal(true);
    setXform(null);
    try {
      const a = await api(`/returns/${item.id}/pickup-address`);
      const its = (item.items || []).filter((i) => i.variant_id).map((i) => ({
        variant_id: String(i.variant_id), qty: Number(i.quantity) || 1,
        title: [i.title, i.variant_title].filter(Boolean).join(" — "), sku: i.sku || "", image: i.image || null,
      }));
      setXform({ client: a, parcel_count: 1, ship_date: todayISO(), content: "Colet schimb", items: its, deduct_stock: true, notify_customer: true });
    } catch (e) { toast.error(e.message); setXmodal(false); }
  };

  const createExchange = async () => {
    setBusy("xcreate");
    try {
      const s = await api(`/returns/${item.id}/exchange`, { method: "POST", body: { ...xform, items: xform.items.map(({ variant_id, qty, title }) => ({ variant_id, qty: Number(qty) || 1, title })) } });
      toast.success(`AWB schimb creat · ${s.awb}`);
      setXmodal(false);
      onChanged();
      window.open(`/api/shipments/${s.id}/label`, "_blank");
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const openModal = async () => {
    setModal(true);
    setForm(null);
    try {
      const a = await api(`/returns/${item.id}/pickup-address`);
      setForm({ pickup: a, parcel_count: 1, pickup_date: nextBusinessDay(), notify_customer: true });
    } catch (e) { toast.error(e.message); setModal(false); }
  };

  const create = async () => {
    setBusy("create");
    try {
      const s = await api(`/returns/${item.id}/pickup`, { method: "POST", body: form });
      toast.success(`Curier chemat · AWB ${s.awb}`);
      setModal(false);
      onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const act = async (what, fn) => {
    setBusy(what);
    try { await fn(); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(""); }
  };

  const setP = (k, v) => setForm((f) => ({ ...f, pickup: { ...f.pickup, [k]: v } }));

  return (
    <Card title={<span className="inline-flex items-center gap-2">{isExchange ? <Repeat className="h-4 w-4" /> : <Truck className="h-4 w-4" />} {isExchange ? "Curier GLS — colet la schimb" : "Curier GLS — ridicare de la client"}</span>}>
      <div className="px-5 py-4">
        {active ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">{active.kind === "exchange" ? "AWB colet la schimb" : "AWB retur"} {active.manual && "(atașat manual)"}</div>
                <div className="font-mono text-lg font-bold">{active.awb}</div>
              </div>
              <ShipPill s={active} />
            </div>
            <div className="text-xs text-slate-500">
              {active.status_description}
              {active.last_event_at && ` · ${fmtDateTime(active.last_event_at)}`}
            </div>
            {active.kind !== "exchange" && active.pickup_date && <div className="text-xs text-slate-500">Ridicare programată din {fmtDate(active.pickup_date)} · creat de {active.created_by || "—"}</div>}
            {active.kind === "exchange" && (
              <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                <div>Pleacă din depozit pe <strong>{fmtDate(active.ship_date)}</strong> · creat de {active.created_by || "—"}</div>
                {(active.items || []).length > 0 && (
                  <div>Produs trimis: {active.items.map((i) => `${i.qty} × ${i.title || i.variant_id}`).join(", ")}
                    {(active.stock_moved || []).length > 0 ? " · scăzut din stoc" : " · nescăzut din stoc"}</div>
                )}
                <div>Curierul livrează coletul nou și ridică pe loc produsul defect, pe care îl aduce la depozit (GLS ExchangeService).</div>
              </div>
            )}
            {active.sync_error && <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">Ultima actualizare GLS: {active.sync_error}</div>}
            <div className="no-print flex flex-wrap gap-2 pt-1">
              {!active.manual && (
                <a href={`/api/shipments/${active.id}/label`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline"><Printer className="h-3.5 w-3.5" /> Etichetă AWB</Button>
                </a>
              )}
              <Button size="sm" variant="outline" loading={busy === "sync"} onClick={() => act("sync", () => api(`/shipments/${active.id}/sync`, { method: "POST" }))}>
                <RefreshCw className="h-3.5 w-3.5" /> Actualizează
              </Button>
              <a href={glsTrackUrl(active.awb)} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> Site GLS</Button>
              </a>
              {!["delivered", "picked_up", "in_transit", "at_hub", "out_for_delivery"].includes(active.status) && (
                <Button size="sm" variant="danger" loading={busy === "cancel"}
                  onClick={() => window.confirm(`Anulezi AWB ${active.awb}? ${active.manual ? "" : active.kind === "exchange" ? "AWB-ul va fi anulat și la GLS, iar produsul revine în stoc." : "Ridicarea va fi anulată și la GLS."}`) &&
                    act("cancel", () => api(`/shipments/${active.id}/cancel`, { method: "POST" }))}>
                  <XCircle className="h-3.5 w-3.5" /> Anulează
                </Button>
              )}
            </div>
            {(active.tracking || []).length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <button onClick={() => setShowTrack((x) => !x)} className="no-print flex items-center gap-1 text-xs font-medium text-slate-600">
                  {showTrack ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Traseu colet ({active.tracking.length})
                </button>
                <ol className={cx("mt-2 space-y-2", !showTrack && "hidden print:block")}>
                  {[...active.tracking].reverse().map((t, i) => (
                    <li key={i} className="text-xs">
                      <div className="font-medium">{t.description}</div>
                      <div className="text-slate-400">{fmtDateTime(t.at)}{t.depot ? ` · ${t.depot}` : ""}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <div className="no-print space-y-3">
            {isExchange ? (
              <>
                <p className="text-sm text-slate-600">Clientul cere <strong>schimb</strong>: emitem noi primii AWB-ul. Pleacă produsul nou din depozit, iar curierul GLS ridică de la client produsul defect în momentul livrării.</p>
                <Button onClick={openExchange} className="w-full"><Repeat className="h-4 w-4" /> Emite AWB colet la schimb</Button>
                <button onClick={openModal} className="w-full text-center text-xs text-slate-500 hover:text-slate-800">Vrei doar să ridici produsul de la client, fără colet nou? Cheamă curierul</button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">Niciun curier chemat încă. GLS va veni la adresa clientului și va aduce coletul la depozit.</p>
                <Button onClick={openModal} className="w-full"><Truck className="h-4 w-4" /> Cheamă curierul la client</Button>
              </>
            )}
            {!manual ? (
              <button onClick={() => setManual(true)} className="w-full text-center text-xs text-slate-500 hover:text-slate-800">Ai deja un AWB creat în MyGLS? Atașează-l</button>
            ) : (
              <div className="flex gap-2">
                <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Număr AWB GLS" className="font-mono" />
                <Button variant="dark" loading={busy === "manual"} onClick={() => act("manual", async () => {
                  await api(`/returns/${item.id}/manual-awb`, { method: "POST", body: { awb } });
                  setAwb(""); setManual(false); toast.success("AWB atașat");
                })}>Atașează</Button>
              </div>
            )}
          </div>
        )}
        {past.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-1 text-xs font-medium text-slate-500">AWB-uri anulate</div>
            {past.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-mono line-through">{s.awb}</span>
                <span>{fmtDateTime(s.cancelled_at || s.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Cheamă curierul GLS la client" wide
        footer={<><Button variant="outline" onClick={() => setModal(false)}>Renunță</Button>
          <Button onClick={create} loading={busy === "create"} disabled={!form}><Truck className="h-4 w-4" /> Cheamă curierul</Button></>}>
        {!form ? <PageLoader /> : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Adresa este preluată din comanda Shopify. Verific-o și corecteaz-o dacă e nevoie.</p>
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

      <Modal open={xmodal} onClose={() => setXmodal(false)} title="AWB colet la schimb (GLS Exchange)" wide
        footer={<><Button variant="outline" onClick={() => setXmodal(false)}>Renunță</Button>
          <Button onClick={createExchange} loading={busy === "xcreate"} disabled={!xform}><Repeat className="h-4 w-4" /> Emite AWB și printează eticheta</Button></>}>
        {!xform ? <PageLoader /> : <ExchangeForm f={xform} setF={setXform} />}
      </Modal>
    </Card>
  );
}

function ExchangeForm({ f, setF }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(null);
  const setC = (k, v) => setF((x) => ({ ...x, client: { ...x.client, [k]: v } }));
  const setItems = (items) => setF((x) => ({ ...x, items }));
  useEffect(() => { if (q.trim().length >= 2 && !all) api("/stock/items?view=active").then(setAll).catch(() => setAll([])); }, [q]); // eslint-disable-line
  const norm = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const found = q.trim().length >= 2 && all
    ? all.filter((r) => norm(`${r.product_title} ${r.variant_title} ${r.sku}`).includes(norm(q.trim())) && !f.items.some((i) => i.variant_id === r.variant_id)).slice(0, 8)
    : [];
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Coletul pleacă din <strong>depozitul nostru</strong> cu curierul GLS de zi cu zi. La livrare, curierul ia de la client <strong>produsul defect</strong> și îl aduce înapoi la noi.
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold">Adresa clientului (livrare + ridicare produs defect)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nume client"><Input value={f.client.name} onChange={(e) => { setC("name", e.target.value); setC("contact_name", e.target.value); }} /></Field>
          <Field label="Telefon"><Input value={f.client.contact_phone} onChange={(e) => setC("contact_phone", e.target.value)} /></Field>
          <Field label="Stradă și număr" className="sm:col-span-2"><Input value={f.client.street} onChange={(e) => setC("street", e.target.value)} /></Field>
          <Field label="Bloc / scară / ap. (opțional)"><Input value={f.client.house_number} onChange={(e) => setC("house_number", e.target.value)} /></Field>
          <Field label="Localitate"><Input value={f.client.city} onChange={(e) => setC("city", e.target.value)} /></Field>
          <Field label="Județ"><Input value={f.client.county} onChange={(e) => setC("county", e.target.value)} /></Field>
          <Field label="Cod poștal"><Input value={f.client.zip_code} onChange={(e) => setC("zip_code", e.target.value)} /></Field>
          <Field label="Email (pentru notificare)" className="sm:col-span-2"><Input value={f.client.contact_email} onChange={(e) => setC("contact_email", e.target.value)} /></Field>
        </div>
      </div>
      <div>
        <div className="mb-1 text-sm font-semibold">Produsul trimis la schimb</div>
        <div className="mb-2 text-xs text-slate-500">Implicit, produsele din cerere. Dacă schimbi doar o componentă (ex. doar aparatul de sudură din pachet), șterge pachetul și caută produsul.</div>
        <div className="space-y-2">
          {f.items.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-sm text-slate-400">Niciun produs ales</div>}
          {f.items.map((it, i) => (
            <div key={it.variant_id} className="flex items-center gap-3 rounded-lg ring-1 ring-slate-200 px-3 py-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-50">{it.image ? <img src={it.image} alt="" className="h-full w-full object-contain" /> : <Package className="h-4 w-4 text-slate-400" />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title || it.variant_id}</div>
                {it.sku && <div className="font-mono text-[11px] text-slate-400">SKU {it.sku}</div>}
              </div>
              <Input type="number" min={1} className="w-20 text-right" value={it.qty} onChange={(e) => setItems(f.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <button onClick={() => setItems(f.items.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Caută alt produs (nume sau SKU)…" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {found.map((r) => (
                  <button key={r.variant_id} onClick={() => { setItems([...f.items, { variant_id: r.variant_id, qty: 1, title: [r.product_title, r.variant_title].filter(Boolean).join(" — "), sku: r.sku, image: r.image }]); setQ(""); }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="truncate">{[r.product_title, r.variant_title].filter(Boolean).join(" — ")}</span>
                    <span className="shrink-0 text-xs text-slate-400">în depozit {r.on_hand}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Data expedierii din depozit"><Input type="date" value={f.ship_date} onChange={(e) => setF({ ...f, ship_date: e.target.value })} /></Field>
        <Field label="Număr colete"><Input type="number" min={1} value={f.parcel_count} onChange={(e) => setF({ ...f, parcel_count: Number(e.target.value) || 1 })} /></Field>
        <Field label="Conținut (pe etichetă)"><Input value={f.content} maxLength={30} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand" checked={f.deduct_stock} onChange={(e) => setF({ ...f, deduct_stock: e.target.checked })} />
          Scade din stoc produsul trimis (revine automat în stoc dacă anulezi AWB-ul)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand" checked={f.notify_customer} onChange={(e) => setF({ ...f, notify_customer: e.target.checked })} />
          Trimite email clientului: produsul nou e pe drum, să pregătească produsul defect pentru curier
        </label>
      </div>
    </div>
  );
}
