import { useEffect, useMemo, useState } from "react";
import { Download, FileCode2, AlertTriangle, CheckCircle2, Settings2, Save } from "lucide-react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { Button, Card, Field, Input, Modal, PageLoader, Spinner, cx, useToast } from "../components/ui";

const LUNI = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const int = (v) => Number(v || 0).toLocaleString("ro-RO");

function periods() {
  const t = new Date();
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const a = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    out.push({ k: iso(a), label: `${LUNI[a.getMonth()]} ${a.getFullYear()}`, from: iso(a), to: iso(b) });
  }
  const q = Math.floor(t.getMonth() / 3);
  for (let i = 1; i <= 4; i++) {
    const a = new Date(t.getFullYear(), (q - i) * 3, 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 3, 0);
    out.push({ k: `T${iso(a)}`, label: `Trimestrul ${Math.floor(a.getMonth() / 3) + 1} ${a.getFullYear()}`, from: iso(a), to: iso(b) });
  }
  return out;
}

export default function SaftStocks() {
  const toast = useToast();
  const P = useMemo(periods, []);
  const [range, setRange] = useState({ from: P[0].from, to: P[0].to });
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setD(await api(`/saft/stocks/preview?frm=${range.from}&to=${range.to}`)); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [range.from, range.to]); // eslint-disable-line

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/saft/stocks.xml?frm=${range.from}&to=${range.to}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Eroare ${res.status}`);
      const blob = await res.blob();
      const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "D406_Stocuri.xml";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
      toast.success("Fișierul XML a fost descărcat");
    } catch (e) { toast.error(e.message); } finally { setDownloading(false); }
  };

  const pick = P.find((p) => p.from === range.from && p.to === range.to)?.k || "custom";
  const errors = d?.warnings.filter((w) => w.level === "error").length || 0;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl text-sm text-slate-600">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900"><FileCode2 className="h-5 w-5 text-brand" /> SAF-T (D406) — declarația de stocuri</div>
            <p className="mt-1">Generează fișierul XML cu stocurile și mișcările de marfă, în formatul cerut de ANAF (schema SAF-T v2.4.9). Se depune <strong>doar la cererea ANAF</strong>, pe lună sau trimestru, cum scrie în solicitare. Contabila îl verifică și îl depune.</p>
          </div>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /> Date firmă</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Perioada" className="w-full sm:w-64">
            <select value={pick} onChange={(e) => { const p = P.find((x) => x.k === e.target.value); if (p) setRange({ from: p.from, to: p.to }); }}
              className="h-10 w-full rounded-lg border-0 bg-white px-3 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand">
              <optgroup label="Lunar">{P.filter((p) => !p.k.startsWith("T")).map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}</optgroup>
              <optgroup label="Trimestrial">{P.filter((p) => p.k.startsWith("T")).map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}</optgroup>
              {pick === "custom" && <option value="custom">Altă perioadă</option>}
            </select>
          </Field>
          <Field label="De la"><Input type="date" className="w-40" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Până la"><Input type="date" className="w-40" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
          <Button onClick={download} loading={downloading} disabled={!d || loading} className="sm:ml-auto">
            <Download className="h-4 w-4" /> Descarcă XML pentru ANAF
          </Button>
        </div>
      </Card>

      {!d ? <PageLoader /> : (
        <div className={cx("space-y-5 transition-opacity", loading && "opacity-60")}>
          {d.warnings.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-5 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-4 w-4" /> Datele sunt complete pentru această perioadă.
            </div>
          ) : d.warnings.map((w, i) => (
            <div key={i} className={cx("flex items-start gap-2 rounded-xl px-5 py-3 text-sm ring-1",
              w.level === "error" ? "bg-red-50 text-red-800 ring-red-200" : "bg-amber-50 text-amber-800 ring-amber-200")}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.text}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Produse raportate" value={int(d.totals.products)} />
            <Stat label="Documente / linii de mișcare" value={`${int(d.totals.documents)} / ${int(d.totals.lines)}`} />
            <Stat label="Stoc la început (fără TVA)" value={money(d.totals.open_value)} sub={`cont ${d.settings.stock_account}`} />
            <Stat label="Stoc la sfârșit (fără TVA)" value={money(d.totals.close_value)} sub={`intrate ${int(d.totals.received)} buc · ieșite ${int(d.totals.issued)} buc`} />
          </div>

          <Card title="Mișcări pe tipuri (nomenclatorul ANAF)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Cod</th><th className="px-4 py-3">Tip mișcare</th><th className="px-4 py-3 text-right">Documente</th>
                    <th className="px-4 py-3 text-right">Bucăți</th><th className="px-4 py-3 text-right">Valoare (fără TVA)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.totals.by_code.map((c) => (
                    <tr key={c.code}>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.code}</td><td className="px-4 py-2.5">{c.label}</td>
                      <td className="px-4 py-2.5 text-right tabular">{int(c.documents)}</td><td className="px-4 py-2.5 text-right tabular">{int(c.units)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular">{money(c.value)}</td>
                    </tr>
                  ))}
                  {d.totals.by_code.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Nicio mișcare de stoc în perioadă.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {d.missing_receipts.length > 0 && <ReceiptFixes rows={d.missing_receipts} onSaved={load} />}

          {d.missing_cost.length > 0 && (
            <Card title={`Produse fără cost de achiziție (${d.missing_cost.length})`}
              actions={<span className="text-xs font-normal text-slate-500">completează costul în Shopify → produs → „Cost per item”, apoi Sincronizează</span>}>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
                {d.missing_cost.map((m) => <li key={m.variant_id} className="px-5 py-2">{m.title}{m.sku && <span className="text-slate-400"> · {m.sku}</span>}</li>)}
              </ul>
            </Card>
          )}

          {d.negatives.length > 0 && (
            <Card title={`Produse cu stoc negativ în perioadă (${d.negatives.length})`}>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
                {d.negatives.map((m, i) => <li key={i} className="flex justify-between gap-3 px-5 py-2"><span>{m.title}</span><span className="whitespace-nowrap tabular text-slate-500">început {m.open_q} · sfârșit {m.close_q}</span></li>)}
              </ul>
            </Card>
          )}

          <Card className="p-5 text-xs leading-relaxed text-slate-500">
            <div className="mb-1 text-sm font-semibold text-slate-700">Cum e construit fișierul</div>
            Intrările de marfă → cod 10 (Achiziție), cu CUI-ul furnizorului și numărul facturii. Vânzările (AWB emis) → cod 30, pe numărul comenzii.
            Retururile, coletele refuzate și AWB-urile anulate → cod 40 (Retur produse vândute). Inventarul și ajustările → cod 110 (plus) sau 120 (minus).
            Clienții persoane fizice apar cu codul 04 + numărul comenzii, cum prevede ANAF pentru comerțul online. Valoarea este cantitatea × costul
            de achiziție fără TVA din Shopify (cost mediu ponderat), iar soldul contului {d.settings.stock_account} = valoarea stocului din hub.
            Gestiune: {d.settings.warehouse_id}, unitate de măsură H87 (bucată), cod NC 0 (nu e obligatoriu pentru vânzări interne).
          </Card>
        </div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 whitespace-nowrap text-xl font-bold tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}

function ReceiptFixes({ rows, onSaved }) {
  return (
    <Card title={`Intrări de marfă de completat (${rows.length})`}
      actions={<span className="text-xs font-normal text-slate-500">ANAF cere CUI-ul furnizorului și numărul facturii la fiecare intrare</span>}>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => <ReceiptRow key={r.id} r={r} onSaved={onSaved} />)}
      </div>
    </Card>
  );
}

function ReceiptRow({ r, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ supplier: r.supplier, supplier_cui: r.supplier_cui, document: r.document });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(`/saft/receipts/${r.id}`, { method: "PATCH", body: f }); toast.success("Intrare completată"); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 items-end gap-3 px-5 py-3 text-sm md:grid-cols-[150px_1fr_160px_160px_auto]">
      <div>
        <div className="font-medium">{r.date}</div>
        <div className="text-xs text-slate-500">{int(r.units)} buc · <span className="text-red-600">{r.problem}</span></div>
      </div>
      <Field label="Furnizor"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="ex. Furnizor SRL" /></Field>
      <Field label="CUI furnizor"><Input value={f.supplier_cui} onChange={(e) => setF({ ...f, supplier_cui: e.target.value })} placeholder="ex. 14399840" /></Field>
      <Field label="Nr. factură"><Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} placeholder="ex. FF 1234" /></Field>
      <Button size="md" onClick={save} loading={busy} disabled={!f.supplier_cui.trim() || !f.document.trim()}><Save className="h-4 w-4" /> Salvează</Button>
    </div>
  );
}

const FIELDS = [
  ["name", "Denumire firmă"], ["cui", "CUI (fără RO)"], ["street", "Stradă"], ["number", "Număr"], ["city", "Localitate"],
  ["postal_code", "Cod poștal"], ["region", "Cod județ ANAF (ex. RO-B)"], ["iban", "IBAN"],
  ["contact_first_name", "Prenume administrator"], ["contact_last_name", "Nume administrator"], ["contact_title", "Funcție"],
  ["phone", "Telefon"], ["email", "Email"], ["stock_account", "Cont de stoc"], ["warehouse_id", "Cod gestiune (ca în Saga)"],
  ["product_type", "Tip produs"],
];

function SettingsModal({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/saft/settings").then(setF).catch((e) => toast.error(e.message)); }, []); // eslint-disable-line
  const save = async () => {
    setBusy(true);
    try { await api("/saft/settings", { method: "PUT", body: Object.fromEntries(FIELDS.map(([k]) => [k, f[k] || ""])) }); toast.success("Date salvate"); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} wide title="Datele firmei din fișierul SAF-T"
      footer={<><Button variant="outline" onClick={onClose}>Renunță</Button><Button onClick={save} loading={busy} disabled={!f}>Salvează</Button></>}>
      {!f ? <Spinner /> : (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">Preluate din ultima declarație D406 generată din Saga. Codul de gestiune trebuie să fie același cu cel din Saga.</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label]) => <Field key={k} label={label}><Input value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
          </div>
        </div>
      )}
    </Modal>
  );
}
