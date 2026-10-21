import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { describe } from "../components/CaseParts";
import { Card, Input, PageLoader, Select, useToast } from "../components/ui";

const TYPES = { "": "Toate", return: "Retururi", service: "Service", user: "Utilizatori", settings: "Setări" };

const OTHER = {
  "user.login": "Autentificare",
  "user.created": "Utilizator creat",
  "user.updated": "Utilizator modificat",
  "user.password_changed": "Parolă schimbată",
  "status.created": "Status creat",
  "status.updated": "Status modificat",
  "status.deleted": "Status șters",
  "warehouse.updated": "Adresa depozitului modificată",
  "import.done": "Import date din hub-ul vechi",
  "shopify.connected": "Shopify conectat",
  "problem_type.created": "Tip problemă adăugat",
  "problem_type.updated": "Tip problemă modificat",
};

export default function Activity() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const p = new URLSearchParams({ limit: "500" });
    if (type) p.set("resource_type", type);
    if (q.trim()) p.set("q", q.trim());
    const t = setTimeout(() => api(`/admin/activity?${p}`).then(setRows).catch((e) => toast.error(e.message)), 250);
    return () => clearTimeout(t);
  }, [type, q]); // eslint-disable-line

  return (
    <div>
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Administrare</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Registru activitate</h1>
        <p className="mt-1 text-sm text-slate-500">Toate acțiunile din platformă, cu persoana, data și IP-ul. Intrările nu pot fi modificate sau șterse.</p>
      </div>
      <Card className="mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută după persoană…" className="pl-9" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      </Card>
      {!rows ? <PageLoader /> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Cine</th>
                  <th className="px-4 py-3">Cerere</th>
                  <th className="px-4 py-3">Acțiune</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const isCase = r.resource_type === "return" || r.resource_type === "service";
                  const t = isCase ? describe(r) : { title: OTHER[r.action] || r.action };
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{fmtDateTime(r.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{r.actor_name}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        {isCase && r.resource_label ? (
                          <Link className="text-brand hover:underline" to={`/${r.resource_type === "return" ? "retururi" : "service"}/${r.resource_id}`}>{r.resource_label}</Link>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div>{t.title}</div>
                        {t.body && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{t.body}</div>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-400">{r.ip || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
