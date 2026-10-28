import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Printer, RefreshCw, Phone, Mail, ExternalLink, Download, Upload, FileText, Play, MessageSquare,
  History as HistoryIcon, Pencil, ShieldCheck, Trash2, RotateCcw,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, fileUrl } from "../lib/api";
import { fmtDateTime, money, PRIORITIES } from "../lib/format";
import { Button, Card, Empty, Field, Input, Modal, Select, StatusBadge, Textarea, cx, useToast } from "./ui";

export function useUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => { api("/users").then(setUsers).catch(() => {}); }, []);
  return users;
}

export function DetailHeader({ kind, item, number, statuses, onPatch, onRefreshOrder, backTo, backLabel, onReload }) {
  const users = useUsers();
  const toast = useToast();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const [del, setDel] = useState(false);
  const [preset, setPreset] = useState("");
  const [other, setOther] = useState("");
  const reason = preset === "__other" ? other : preset;
  const [busy, setBusy] = useState(false);
  const base = kind === "return" ? "returns" : "service";
  const doDelete = async () => {
    setBusy(true);
    try {
      await api(`/${base}/${item.id}/delete`, { method: "POST", body: { reason } });
      toast.success(`${number} a fost ștearsă`);
      nav(backTo);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const doRestore = async () => {
    try { await api(`/${base}/${item.id}/restore`, { method: "POST" }); toast.success("Cerere restaurată"); onReload?.(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div className="mb-6">
      <Link to={backTo} className="no-print mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {kind === "return" ? "Cerere de retur" : "Cerere service / schimb"}
          </div>
          <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight sm:text-3xl">{number}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge status={item.status} />
            <span>· creată {fmtDateTime(item.created_at)}</span>
            {item.imported_from && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">importată din hub-ul vechi</span>}
          </div>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRefreshOrder} title="Reîncarcă datele comenzii din Shopify">
            <RefreshCw className="h-4 w-4" /> Comanda Shopify
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Printează fișa
          </Button>
          {!item.deleted && (
            <Button variant="danger" onClick={() => { setPreset(""); setOther(""); setDel(true); }}>
              <Trash2 className="h-4 w-4" /> Șterge
            </Button>
          )}
        </div>
      </div>
      {item.deleted && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
          <div>
            <strong>Cerere ștearsă</strong> de {item.deleted_by} la {fmtDateTime(item.deleted_at)}. Motiv: {item.delete_reason}
            <div className="text-xs text-red-700/80">Numărul {number} rămâne ocupat și nu se mai alocă altei cereri.</div>
          </div>
          {isAdmin && <Button size="sm" variant="outline" onClick={doRestore}><RotateCcw className="h-3.5 w-3.5" /> Restaurează</Button>}
        </div>
      )}
      <Modal open={del} onClose={() => setDel(false)} title={`Șterge ${number}`}
        footer={<><Button variant="outline" onClick={() => setDel(false)}>Renunță</Button>
          <Button variant="primary" className="bg-red-600 hover:bg-red-700" loading={busy} disabled={!reason.trim()} onClick={doDelete}><Trash2 className="h-4 w-4" /> Șterge cererea</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Cererea dispare din liste. Numărul <strong>{number}</strong> rămâne ocupat, iar istoricul complet se păstrează. Un administrator o poate restaura din filtrul „Cereri șterse”.</p>
          <Field label="Motivul ștergerii *">
            <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">Alege motivul</option>
              <option>Cerere duplicată</option>
              <option>Cerere de test</option>
              <option>Trimisă din greșeală de client</option>
              <option value="__other">Alt motiv…</option>
            </Select>
          </Field>
          {preset === "__other" && <Field label="Scrie motivul"><Input autoFocus value={other} onChange={(e) => setOther(e.target.value)} /></Field>}
        </div>
      </Modal>
      <Card className="no-print mt-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Status">
            <Select value={item.status_id || ""} onChange={(e) => onPatch({ status_id: e.target.value })}>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Prioritate">
            <Select value={item.priority || "medium"} onChange={(e) => onPatch({ priority: e.target.value })}>
              {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Responsabil">
            <Select value={item.assigned_to || ""} onChange={(e) => onPatch({ assigned_to: e.target.value || null })}>
              <option value="">— Nealocat —</option>
              {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="min-w-0 break-words">{children || <span className="text-slate-400">—</span>}</div>
    </div>
  );
}
export { Row };

export function CustomerCard({ item, onPatch }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const o = item.shopify_order || {};
  const ship = o.shipping_address || {};
  const addr = [ship.address1, ship.address2, ship.zip, ship.city, ship.province].filter(Boolean).join(", ");
  const open = () => { setF({ customer_name: item.customer_name || "", phone: item.phone || "", email: item.email || "" }); setEdit(true); };
  return (
    <Card title="Client și comandă" actions={<Button size="sm" variant="ghost" onClick={open}><Pencil className="h-3.5 w-3.5" /> Editează</Button>}>
      <div className="px-5 py-3">
        <Row label="Nume">{item.customer_name}</Row>
        <Row label="Telefon">
          {item.phone && <a href={`tel:${item.phone}`} className="inline-flex items-center gap-1.5 font-mono text-brand hover:underline"><Phone className="h-3.5 w-3.5" />{item.phone}</a>}
        </Row>
        <Row label="Email">
          {item.email && <a href={`mailto:${item.email}`} className="inline-flex items-center gap-1.5 text-brand hover:underline"><Mail className="h-3.5 w-3.5" />{item.email}</a>}
        </Row>
        <div className="my-2 border-t border-slate-100" />
        <Row label="Comandă">
          <span className="font-mono">#{item.order_number}</span>
          {item.shopify_admin_url && (
            <a href={item.shopify_admin_url} target="_blank" rel="noreferrer" className="no-print ml-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">
              Deschide în Shopify <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </Row>
        <Row label="Data comenzii">{o.created_at && fmtDateTime(o.created_at)}</Row>
        <Row label="Total comandă">{o.total_price && money(o.total_price, o.currency)}</Row>
        <Row label="Plată / livrare">{[o.financial_status, o.fulfillment_status].filter(Boolean).join(" · ")}</Row>
        <Row label="Adresă livrare">{addr}</Row>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title="Editează datele clientului"
        footer={<><Button variant="outline" onClick={() => setEdit(false)}>Renunță</Button>
          <Button onClick={async () => { await onPatch(f); setEdit(false); }}>Salvează</Button></>}>
        <div className="space-y-3">
          <Field label="Nume"><Input value={f.customer_name || ""} onChange={(e) => setF({ ...f, customer_name: e.target.value })} /></Field>
          <Field label="Telefon"><Input value={f.phone || ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">Modificarea rămâne înregistrată în istoric (valoare veche → valoare nouă).</p>
        </div>
      </Modal>
    </Card>
  );
}

export function ProductsCard({ items, showReason }) {
  return (
    <Card title={`Produse (${(items || []).reduce((a, b) => a + (Number(b.quantity) || 1), 0)})`}>
      <div className="divide-y divide-slate-100">
        {(items || []).map((li, i) => (
          <div key={i} className="flex gap-3 px-5 py-3">
            {li.image ? (
              <img src={li.image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-lg bg-slate-100" />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{li.title}</div>
              {li.variant_title && <div className="text-xs text-slate-500">{li.variant_title}</div>}
              {li.sku && <div className="font-mono text-[11px] text-slate-400">SKU {li.sku}</div>}
              {showReason && li.reason && <div className="mt-1 text-xs text-slate-600">Motiv: {li.reason}</div>}
            </div>
            <div className="shrink-0 text-right text-sm">
              <div className="font-semibold tabular">{li.quantity} ×</div>
              <div className="text-xs text-slate-500 tabular">{money(li.price)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FilesCard({ kind, id, files, onChanged }) {
  const toast = useToast();
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const upload = async (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        await api(`/${kind === "return" ? "returns" : "service"}/${id}/files`, { method: "POST", form: fd });
      }
      toast.success("Fișier adăugat");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <Card
      title={`Poze și fișiere (${files.length})`}
      actions={
        <>
          <input ref={ref} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={upload} />
          <Button size="sm" variant="ghost" loading={busy} onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" /> Adaugă</Button>
        </>
      }
    >
      {files.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-slate-400">Clientul nu a trimis poze.</div>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
          {files.map((f) => {
            const img = f.content_type?.startsWith("image/");
            const vid = f.content_type?.startsWith("video/");
            return (
              <button key={f.id} onClick={() => setView(f)} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200" title={f.original_filename}>
                {img ? (
                  <img src={fileUrl(f.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : vid ? (
                  <div className="flex h-full w-full items-center justify-center bg-slate-800 text-white"><Play className="h-6 w-6" /></div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-500"><FileText className="h-6 w-6" /></div>
                )}
                {f.source === "operator" && <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1 text-[10px] text-slate-600">operator</span>}
                {f.missing && <span className="absolute inset-x-1 bottom-1 rounded bg-red-600 px-1 text-[10px] text-white">lipsă</span>}
              </button>
            );
          })}
        </div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.original_filename || "Fișier"} wide
        footer={view && <a href={fileUrl(view.id, true)}><Button variant="outline"><Download className="h-4 w-4" /> Descarcă</Button></a>}>
        {view?.content_type?.startsWith("image/") && <img src={fileUrl(view.id)} alt="" className="mx-auto max-h-[70vh] rounded-lg" />}
        {view?.content_type?.startsWith("video/") && <video src={fileUrl(view.id)} controls autoPlay className="mx-auto max-h-[70vh] w-full rounded-lg bg-black" />}
        {view && !view.content_type?.startsWith("image/") && !view.content_type?.startsWith("video/") && (
          <a href={fileUrl(view.id)} target="_blank" rel="noreferrer" className="text-brand underline">Deschide fișierul</a>
        )}
        {view && <div className="mt-3 text-xs text-slate-500">Încărcat {fmtDateTime(view.created_at)} {view.uploaded_by ? `de ${view.uploaded_by}` : "de client"}</div>}
      </Modal>
    </Card>
  );
}

export function NotesCard({ notes, onAdd }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onAdd(text); setText(""); } finally { setBusy(false); }
  };
  return (
    <Card title={`Note interne (${notes.length})`}>
      <div className="space-y-3 px-5 py-4">
        {notes.length === 0 && <div className="text-sm text-slate-400">Nicio notă încă.</div>}
        {notes.map((n) => (
          <div key={n.id} className="rounded-lg bg-amber-50/60 px-3 py-2 ring-1 ring-amber-100">
            <div className="whitespace-pre-wrap text-sm">{n.body}</div>
            <div className="mt-1 text-[11px] text-slate-500">{n.author_name} · {fmtDateTime(n.created_at)}</div>
          </div>
        ))}
        <div className="no-print space-y-2">
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Adaugă o notă vizibilă doar echipei…" />
          <div className="flex justify-end">
            <Button size="sm" variant="dark" onClick={add} loading={busy} disabled={!text.trim()}><MessageSquare className="h-3.5 w-3.5" /> Adaugă notă</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

const fv = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Da" : "Nu";
  if (typeof v === "object") return Object.values(v).filter(Boolean).join(", ");
  return String(v);
};

export function describe(h) {
  const d = h.details || {};
  switch (h.action) {
    case "created":
      return { title: `Cerere înregistrată de client (${d.via || "formular online"})`, body: d.items ? d.items.join(" · ") : d.problem ? `Problemă: ${d.problem}` : null };
    case "status_changed":
      return { title: `Status schimbat: ${d.from || "—"} → ${d.to || "—"}` };
    case "updated":
      return {
        title: "Date modificate",
        body: Object.entries(d.fields || {}).map(([k, c]) => (c && typeof c === "object" && "to" in c ? `${k}: ${fv(c.from)} → ${fv(c.to)}` : `${k}: ${fv(c)}`)).join("\n"),
      };
    case "note_added":
      return { title: "Notă internă adăugată", body: d.text };
    case "file_added":
      return { title: `Fișier adăugat: ${d.filename || ""}` };
    case "pickup_created":
      return { title: `Curier GLS chemat la client · AWB ${d.awb}`, body: `Ridicare de la ${d.pickup_date || "—"} · ${fv(d.address && { s: d.address.street, c: d.address.city, z: d.address.zip_code })}` };
    case "pickup_failed":
      return { title: "Chemarea curierului a eșuat", body: d.error, tone: "error" };
    case "pickup_cancelled":
      return { title: `AWB ${d.awb} anulat` };
    case "manual_awb":
      return { title: `AWB atașat manual: ${d.awb}` };
    case "courier_status":
      return { title: `GLS: ${d.to || d.text || ""}`, body: d.awb ? `AWB ${d.awb}` : null, tone: "courier" };
    case "email_sent":
      return { title: `Email trimis clientului (${d.to})`, body: d.subject };
    case "order_refreshed":
      return { title: "Datele comenzii reîncărcate din Shopify" };
    case "stock_restocked":
      return { title: "Produsele au fost readăugate în stoc", body: d.skipped?.length ? `Nu s-au putut identifica: ${d.skipped.join(", ")}` : null };
    case "deleted":
      return { title: "Cerere ștearsă", body: d.reason ? `Motiv: ${d.reason}` : null, tone: "error" };
    case "restored":
      return { title: "Cerere restaurată" };
    case "legacy_event":
      return { title: d.text || "Eveniment" };
    default:
      return { title: h.action };
  }
}

export function HistoryCard({ history }) {
  const items = [...history].reverse();
  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><HistoryIcon className="h-4 w-4" /> Istoric complet ({history.length})</span>}
      actions={<span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> nu poate fi modificat</span>}
    >
      {items.length === 0 ? (
        <Empty title="Fără evenimente" />
      ) : (
        <ol className="relative space-y-4 px-5 py-4">
          {items.map((h) => {
            const t = describe(h);
            return (
              <li key={h.id} className="relative pl-6">
                <span className={cx("absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4",
                  t.tone === "error" ? "bg-red-500 ring-red-50" : t.tone === "courier" ? "bg-sky-500 ring-sky-50" : "bg-brand ring-brand-50")} />
                <div className="text-sm font-medium">{t.title}</div>
                {t.body && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{t.body}</div>}
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {fmtDateTime(h.created_at)} · {h.actor_name}{h.ip ? ` · IP ${h.ip}` : ""}{h.details?.imported ? " · importat" : ""}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export function ConsentCard({ consent }) {
  if (!consent) return null;
  return (
    <div className="text-[11px] text-slate-400">
      Termeni acceptați de client la {fmtDateTime(consent.accepted_at)}{consent.ip ? ` · IP ${consent.ip}` : ""}
    </div>
  );
}

export function PrintTitle({ title, number }) {
  return (
    <div className="hidden print:block mb-4 border-b pb-3">
      <div className="text-xs">IEFTINIT.RO · {title}</div>
      <div className="font-mono text-xl font-bold">{number}</div>
      <div className="text-xs">Fișă generată la {fmtDateTime(new Date().toISOString())}</div>
    </div>
  );
}
