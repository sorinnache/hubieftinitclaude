import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, ArrowUp, ArrowDown, Trash2, Plus, Upload, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Select, StatusBadge, cx, useToast } from "../components/ui";

const TABS = [
  { id: "integrari", label: "Integrări", admin: true },
  { id: "depozit", label: "Curier GLS", admin: true },
  { id: "statusuri-retur", label: "Statusuri retur", admin: true },
  { id: "statusuri-service", label: "Statusuri service", admin: true },
  { id: "probleme", label: "Tipuri probleme", admin: true },
  { id: "utilizatori", label: "Utilizatori", admin: true },
  { id: "import", label: "Import date", admin: true },
  { id: "cont", label: "Contul meu", admin: false },
];

export default function Settings() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id || tabs[0].id;
  const toast = useToast();

  useEffect(() => {
    if (params.get("shopify") === "ok") toast.success("Shopify a fost conectat");
  }, []); // eslint-disable-line

  return (
    <div>
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Administrare</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Setări</h1>
      </div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setParams({ tab: t.id })}
            className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "integrari" && <Integrations />}
      {tab === "depozit" && <Warehouse />}
      {tab === "statusuri-retur" && <Statuses api="/returns/statuses" />}
      {tab === "statusuri-service" && <Statuses api="/service/statuses" />}
      {tab === "probleme" && <ProblemTypes />}
      {tab === "utilizatori" && <Users />}
      {tab === "import" && <Import />}
      {tab === "cont" && <Account />}
    </div>
  );
}

function Check({ ok, children, sub }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{children}</div>
        {sub && <div className="mt-0.5 break-words text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

function Integrations() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const load = () => { setD(null); api("/admin/integrations").then(setD).catch((e) => toast.error(e.message)); };
  useEffect(load, []); // eslint-disable-line
  if (!d) return <PageLoader />;
  return (
    <div className="max-w-2xl space-y-4">
      <Card title="Starea conexiunilor" actions={<Button size="sm" variant="ghost" onClick={load}>Verifică din nou</Button>}>
        <div className="divide-y divide-slate-100">
          <Check ok={d.shopify.connected} sub={d.shopify.connected ? `${d.shopify.shop_name} (${d.shopify.shop}) · ${d.shopify.method}` : d.shopify.error}>
            Shopify — preluare comenzi
          </Check>
          <Check ok={d.gls.ok} sub={d.gls.ok ? `Client GLS ${d.gls.client_number}` : d.gls.error || "Lipsesc GLS_USERNAME / GLS_PASSWORD / GLS_CLIENT_NUMBER"}>
            GLS — chemare curier
          </Check>
          <Check ok={d.warehouse_set} sub={d.warehouse_set ? "Setată" : "Completează adresa în tab-ul Curier GLS"}>Adresa depozitului (destinația retururilor)</Check>
          <Check ok={d.email.configured} sub={d.email.configured ? `Expeditor: ${d.email.sender}` : "Lipsește RESEND_API_KEY"}>Email către clienți</Check>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        {!d.shopify.connected && (
          <Button variant="outline" onClick={async () => {
            try { const { url } = await api("/shopify/install"); window.location.href = url; } catch (e) { toast.error(e.message); }
          }}>Conectează Shopify (instalare aplicație)</Button>
        )}
        {d.email.configured && (
          <Button variant="outline" onClick={async () => {
            try { const r = await api("/admin/test-email", { method: "POST" }); toast.success(`Email de test trimis la ${r.to}`); } catch (e) { toast.error(e.message); }
          }}>Trimite-mi un email de test</Button>
        )}
      </div>
    </div>
  );
}

function Warehouse() {
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(() => { api("/settings/warehouse").then((a) => setF({ country: "RO", ...a })).catch((e) => toast.error(e.message)); }, []); // eslint-disable-line
  if (!f) return <PageLoader />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Adresa depozitului — aici aduce GLS retururile" className="max-w-2xl">
      <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <Field label="Nume (pe etichetă)"><Input value={f.name || ""} onChange={set("name")} /></Field>
        <Field label="Persoană de contact"><Input value={f.contact_name || ""} onChange={set("contact_name")} /></Field>
        <Field label="Telefon"><Input value={f.contact_phone || ""} onChange={set("contact_phone")} /></Field>
        <Field label="Email"><Input value={f.contact_email || ""} onChange={set("contact_email")} /></Field>
        <Field label="Stradă" className="sm:col-span-2"><Input value={f.street || ""} onChange={set("street")} /></Field>
        <Field label="Număr"><Input value={f.house_number || ""} onChange={set("house_number")} /></Field>
        <Field label="Localitate"><Input value={f.city || ""} onChange={set("city")} /></Field>
        <Field label="Județ"><Input value={f.county || ""} onChange={set("county")} /></Field>
        <Field label="Cod poștal"><Input value={f.zip_code || ""} onChange={set("zip_code")} /></Field>
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <Button onClick={async () => { try { await api("/settings/warehouse", { method: "PUT", body: f }); toast.success("Adresa a fost salvată"); } catch (e) { toast.error(e.message); } }}>Salvează</Button>
      </div>
    </Card>
  );
}

function Statuses({ api: path }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [add, setAdd] = useState({ name: "", color: "#64748b", is_terminal: false });
  const load = () => api(path).then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => { setRows(null); load(); }, [path]); // eslint-disable-line
  const run = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); load(); } catch (e) { toast.error(e.message); } };
  const move = (i, dir) => {
    const ids = rows.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => api(`${path}/reorder`, { method: "POST", body: { order: ids } }));
  };
  if (!rows) return <PageLoader />;
  return (
    <Card className="max-w-3xl" title="Statusuri (ordinea apare și în Kanban)">
      <div className="divide-y divide-slate-100">
        {rows.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <input type="color" value={s.color} onChange={(e) => run(() => api(`${path}/${s.id}`, { method: "PATCH", body: { color: e.target.value } }))} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" />
            <input defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && run(() => api(`${path}/${s.id}`, { method: "PATCH", body: { name: e.target.value.trim() } }), "Redenumit")}
              className="min-w-[160px] flex-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand" />
            <StatusBadge status={s} />
            <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Cererile cu acest status sunt considerate închise">
              <input type="checkbox" className="accent-brand" checked={!!s.is_terminal} onChange={(e) => run(() => api(`${path}/${s.id}`, { method: "PATCH", body: { is_terminal: e.target.checked } }))} /> Final
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Statusul primit automat de cererile noi">
              <input type="radio" className="accent-brand" checked={!!s.is_default} onChange={() => run(() => api(`${path}/${s.id}`, { method: "PATCH", body: { is_default: true } }))} /> Implicit
            </label>
            <div className="flex">
              <button onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ArrowUp className="h-4 w-4" /></button>
              <button onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100"><ArrowDown className="h-4 w-4" /></button>
              <button onClick={() => window.confirm(`Ștergi statusul „${s.name}”?`) && run(() => api(`${path}/${s.id}`, { method: "DELETE" }), "Șters")} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
        <Field label="Status nou" className="flex-1"><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="ex: Așteaptă răspuns client" /></Field>
        <input type="color" value={add.color} onChange={(e) => setAdd({ ...add, color: e.target.value })} className="mb-1 h-8 w-8 rounded" />
        <Button disabled={!add.name.trim()} onClick={() => run(async () => { await api(path, { method: "POST", body: add }); setAdd({ name: "", color: "#64748b", is_terminal: false }); }, "Status adăugat")}><Plus className="h-4 w-4" /> Adaugă</Button>
      </div>
    </Card>
  );
}

function ProblemTypes() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [name, setName] = useState("");
  const load = () => api("/service-problem-types").then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const run = async (fn, msg) => { try { await fn(); if (msg) toast.success(msg); load(); } catch (e) { toast.error(e.message); } };
  if (!rows) return <PageLoader />;
  return (
    <Card className="max-w-2xl" title="Tipuri de probleme (apar în formularul de service)">
      <div className="divide-y divide-slate-100">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-5 py-2.5">
            <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && run(() => api(`/service-problem-types/${p.id}`, { method: "PATCH", body: { name: e.target.value.trim() } }), "Salvat")}
              className={cx("flex-1 rounded-md px-2 py-1 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand", !p.active && "text-slate-400 line-through")} />
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" className="accent-brand" checked={p.active} onChange={(e) => run(() => api(`/service-problem-types/${p.id}`, { method: "PATCH", body: { active: e.target.checked } }))} /> Activ
            </label>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-3 border-t border-slate-100 bg-slate-50 px-5 py-3">
        <Field label="Tip nou" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button disabled={!name.trim()} onClick={() => run(async () => { await api("/service-problem-types", { method: "POST", body: { name } }); setName(""); }, "Adăugat")}><Plus className="h-4 w-4" /> Adaugă</Button>
      </div>
    </Card>
  );
}

function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(null);
  const load = () => api("/users").then(setRows).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line
  const save = async () => {
    try {
      if (modal.id) {
        const body = { name: modal.name, role: modal.role, active: modal.active };
        if (modal.password) body.password = modal.password;
        await api(`/users/${modal.id}`, { method: "PATCH", body });
      } else {
        await api("/users", { method: "POST", body: modal });
      }
      toast.success("Salvat");
      setModal(null);
      load();
    } catch (e) { toast.error(e.message); }
  };
  if (!rows) return <PageLoader />;
  return (
    <Card className="max-w-3xl" title="Utilizatori" actions={<Button size="sm" onClick={() => setModal({ name: "", email: "", role: "operator", password: "" })}><Plus className="h-3.5 w-3.5" /> Utilizator nou</Button>}>
      <div className="divide-y divide-slate-100">
        {rows.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className={cx("font-medium", !u.active && "text-slate-400 line-through")}>{u.name} {u.id === me.id && <span className="text-xs text-slate-400">(tu)</span>}</div>
              <div className="text-xs text-slate-500">{u.email} · ultima autentificare {fmtDateTime(u.last_login_at)}</div>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{u.role === "admin" ? "Administrator" : "Operator"}</span>
            <Button size="sm" variant="ghost" onClick={() => setModal({ ...u, password: "" })}>Editează</Button>
          </div>
        ))}
      </div>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? "Editează utilizator" : "Utilizator nou"}
        footer={<><Button variant="outline" onClick={() => setModal(null)}>Renunță</Button><Button onClick={save}>Salvează</Button></>}>
        {modal && (
          <div className="space-y-3">
            <Field label="Nume"><Input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></Field>
            {!modal.id && <Field label="Email"><Input type="email" value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></Field>}
            <Field label="Rol" hint="Operatorii lucrează cu retururi și service. Administratorii pot schimba și setările.">
              <Select value={modal.role} onChange={(e) => setModal({ ...modal, role: e.target.value })}>
                <option value="operator">Operator</option>
                <option value="admin">Administrator</option>
              </Select>
            </Field>
            <Field label={modal.id ? "Parolă nouă (lasă gol ca să rămână aceeași)" : "Parolă (minim 8 caractere)"}>
              <Input type="text" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
            </Field>
            {modal.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand" checked={modal.active !== false} onChange={(e) => setModal({ ...modal, active: e.target.checked })} /> Cont activ
              </label>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Import() {
  const toast = useToast();
  const ref = useRef();
  const [st, setSt] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [pct, setPct] = useState(null);
  const load = () => api("/admin/import/status").then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (st?.state !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [st?.state]);

  const upload = (file) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("overwrite", overwrite ? "true" : "false");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/import");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setPct(null);
      if (xhr.status >= 200 && xhr.status < 300) { toast.success("Fișier încărcat, importul a pornit"); setTimeout(load, 800); }
      else { try { toast.error(JSON.parse(xhr.responseText).detail); } catch { toast.error(`Eroare ${xhr.status}`); } }
    };
    xhr.onerror = () => { setPct(null); toast.error("Încărcarea a eșuat. Verifică internetul și reîncearcă."); };
    xhr.send(fd);
  };

  const s = st?.stats || {};
  return (
    <div className="max-w-2xl space-y-4">
      <Card title="Import din hub-ul vechi (Emergent)">
        <div className="space-y-4 p-5 text-sm">
          <p className="text-slate-600">Încarcă fișierul <span className="font-mono">hub_retururi_service_….json</span> obținut cu scriptul de export. Se importă retururile, cererile de service, pozele, notele, istoricul și AWB-urile.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 accent-brand" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Suprascrie cererile care există deja cu datele din fișier <span className="block text-xs text-slate-500">Bifează doar la ultimul import, înainte de mutarea domeniului, dacă ai schimbat statusuri în hub-ul vechi între timp.</span></span>
          </label>
          <input ref={ref} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          <Button onClick={() => ref.current?.click()} disabled={pct !== null || st?.state === "running"}>
            <Upload className="h-4 w-4" /> Alege fișierul și importă
          </Button>
          {pct !== null && (
            <div>
              <div className="mb-1 text-xs text-slate-500">Se încarcă fișierul… {pct}%</div>
              <div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
            </div>
          )}
        </div>
      </Card>
      {st && st.state !== "none" && (
        <Card title="Ultimul import">
          <div className="space-y-2 p-5 text-sm">
            <div className="flex items-center gap-2">
              {st.state === "running" && <span className="text-amber-600">Se importă… {st.message}</span>}
              {st.state === "done" && <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Import finalizat · {fmtDateTime(st.finished_at)}</span>}
              {st.state === "error" && <span className="inline-flex items-center gap-1.5 text-red-600"><AlertTriangle className="h-4 w-4" /> Eroare: {st.error}</span>}
            </div>
            {st.stats && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Retururi", s.returns], ["Service", s.service], ["Fișiere", s.files], ["AWB-uri", s.shipments], ["Intrări istoric", s.history], ["Note", s.notes], ["Existau deja", s.skipped], ["Fișiere lipsă", s.missing_files]].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-500">{l}</div>
                    <div className="text-lg font-semibold tabular">{v ?? 0}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Account() {
  const toast = useToast();
  const { user } = useAuth();
  const [f, setF] = useState({ current_password: "", new_password: "" });
  return (
    <Card className="max-w-md" title="Schimbă parola">
      <div className="space-y-3 p-5">
        <div className="text-sm text-slate-600">{user.name} · {user.email}</div>
        <Field label="Parola actuală"><Input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label="Parola nouă (minim 8 caractere)"><Input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
        <Button onClick={async () => {
          try { await api("/auth/change-password", { method: "POST", body: f }); toast.success("Parola a fost schimbată"); setF({ current_password: "", new_password: "" }); }
          catch (e) { toast.error(e.message); }
        }}>Schimbă parola</Button>
      </div>
    </Card>
  );
}
