import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, List, LayoutGrid, Inbox, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { fmtAgo, fmtDateTime, PRIORITIES, PRIORITY_COLORS, RETURN_TYPES, SHIP_STATUS, daysSince } from "../lib/format";
import { Button, Card, Empty, Input, PageLoader, Pill, Select, StatusBadge, cx, useToast } from "../components/ui";

const CONF = {
  return: { title: "Toate retururile", module: "Retururi", base: "/retururi", api: "/returns", num: "return_number", publicUrl: "/retur" },
  service: { title: "Cereri service & schimb", module: "Service", base: "/service", api: "/service", num: "service_number", publicUrl: "/service/public" },
};

function load(key, def) {
  try { return localStorage.getItem(key) || def; } catch { return def; }
}
function save(key, v) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

export default function CaseList({ kind }) {
  const c = CONF[kind];
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [problemTypes, setProblemTypes] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [view, setView] = useState(() => load(`view-${kind}`, "list"));
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setItems(null); setStatus(""); setType(""); setQ(""); setPriority(""); setOpenOnly(false);
    setView(load(`view-${kind}`, "list"));
    api(`${c.api}/statuses`).then(setStatuses).catch(() => {});
    if (kind === "service") api("/service-problem-types").then(setProblemTypes).catch(() => {});
  }, [kind]); // eslint-disable-line

  const fetchItems = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status_id", status);
    if (type) p.set("type", type);
    if (priority) p.set("priority", priority);
    if (openOnly) p.set("open_only", "true");
    try {
      setItems(await api(`${c.api}?${p}`));
    } catch (e) {
      toast.error(e.message);
      setItems([]);
    }
  }, [c.api, q, status, type, priority, openOnly]); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(fetchItems, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchItems, q]);

  useEffect(() => {
    const t = setInterval(fetchItems, 60000);
    return () => clearInterval(t);
  }, [fetchItems]);

  const setViewSaved = (v) => { setView(v); save(`view-${kind}`, v); };

  const moveTo = async (itemId, statusId) => {
    const it = items.find((i) => i.id === itemId);
    if (!it || it.status_id === statusId) return;
    const st = statuses.find((s) => s.id === statusId);
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, status_id: statusId, status: st } : x)));
    try {
      await api(`${c.api}/${itemId}`, { method: "PATCH", body: { status_id: statusId } });
      toast.success(`${it[c.num]} → ${st?.name}`);
    } catch (e) {
      toast.error(e.message);
      fetchItems();
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Modul · {c.module}</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{c.title}</h1>
          <div className="mt-1 text-sm text-slate-500">{items ? `${items.length} rezultate` : "Se încarcă…"}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-white p-1 ring-1 ring-slate-200">
            <button onClick={() => setViewSaved("list")} className={cx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", view === "list" ? "bg-slate-100 font-medium" : "text-slate-500")}>
              <List className="h-4 w-4" /> Listă
            </button>
            <button onClick={() => setViewSaved("kanban")} className={cx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", view === "kanban" ? "bg-slate-100 font-medium" : "text-slate-500")}>
              <LayoutGrid className="h-4 w-4" /> Kanban
            </button>
          </div>
          <Button variant="outline" size="md" onClick={async () => { setRefreshing(true); await fetchItems(); setRefreshing(false); }} title="Reîncarcă">
            <RefreshCw className={cx("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
          <a href={c.publicUrl} target="_blank" rel="noreferrer" className="hidden sm:block">
            <Button variant="outline"><ExternalLink className="h-4 w-4" /> Formular public</Button>
          </a>
        </div>
      </div>

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută după număr, comandă, client, telefon, email, AWB, produs…" className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="md:w-44">
            <option value="">Toate statusurile</option>
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="md:w-44">
            {kind === "return" ? (
              <>
                <option value="">Toate tipurile</option>
                {Object.entries(RETURN_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </>
            ) : (
              <>
                <option value="">Toate problemele</option>
                {problemTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </>
            )}
          </Select>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="md:w-40">
            <option value="">Toate prioritățile</option>
            {Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-300">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-brand" />
            Doar deschise
          </label>
        </div>
      </Card>

      {items === null ? (
        <PageLoader />
      ) : view === "kanban" ? (
        <Kanban kind={kind} items={items} statuses={statuses} onMove={moveTo} />
      ) : items.length === 0 ? (
        <Card><Empty icon={Inbox} title="Nicio cerere găsită">Schimbă filtrele sau căutarea.</Empty></Card>
      ) : (
        <ListView kind={kind} items={items} onOpen={(id) => nav(`${c.base}/${id}`)} />
      )}
    </div>
  );
}

function AgeCell({ iso, terminal }) {
  const d = daysSince(iso);
  return (
    <span className={cx("tabular text-xs", !terminal && d >= 10 ? "font-semibold text-red-600" : !terminal && d >= 7 ? "text-amber-600" : "text-slate-500")} title={fmtDateTime(iso)}>
      {fmtAgo(iso)}
    </span>
  );
}

function ShipCell({ s }) {
  if (!s) return <span className="text-slate-400">Fără AWB</span>;
  const m = SHIP_STATUS[s.status] || { label: s.status_description || s.status, cls: "bg-slate-50 text-slate-600 ring-slate-200" };
  return (
    <div className="leading-tight">
      <div className="font-mono text-xs">{s.awb}</div>
      <Pill className={cx("mt-1", m.cls)}>{m.label}</Pill>
    </div>
  );
}

function productsCount(it) {
  return (it.items || []).reduce((a, b) => a + (Number(b.quantity) || 1), 0);
}

function ListView({ kind, items, onOpen }) {
  const c = CONF[kind];
  return (
    <>
      {/* telefon */}
      <div className="space-y-2 md:hidden">
        {items.map((it) => (
          <Link key={it.id} to={`${c.base}/${it.id}`} className="block rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold">{it[c.num]}</span>
              <StatusBadge status={it.status} />
            </div>
            <div className="mt-2 text-sm font-medium">{it.customer_name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              #{it.order_number} · {it.phone} · {kind === "return" ? RETURN_TYPES[it.return_type] : it.problem_type?.name || it.problem_type_name}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              {kind === "return" ? <ShipCell s={it.shipment} /> : <span className="text-slate-500">{productsCount(it)} produse</span>}
              <AgeCell iso={it.created_at} terminal={it.status?.is_terminal} />
            </div>
          </Link>
        ))}
      </div>
      {/* desktop */}
      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">{kind === "return" ? "Retur" : "Cerere"}</th>
                <th className="px-4 py-3">Comandă</th>
                <th className="px-4 py-3">Client</th>
                {kind === "service" && <th className="px-4 py-3">Problemă</th>}
                <th className="px-4 py-3">Produse</th>
                <th className="px-4 py-3">Status</th>
                {kind === "return" && <th className="px-4 py-3">Colet</th>}
                {kind === "return" && <th className="px-4 py-3">Tip</th>}
                <th className="px-4 py-3">Prioritate</th>
                <th className="px-4 py-3 text-right">Creat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.id} onClick={() => onOpen(it.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold">{it[c.num]}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">#{it.order_number}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{it.customer_name}</div>
                    <div className="font-mono text-xs text-slate-500">{it.phone || "—"}</div>
                  </td>
                  {kind === "service" && <td className="px-4 py-3 text-slate-600">{it.problem_type?.name || it.problem_type_name || "—"}</td>}
                  <td className="max-w-[220px] px-4 py-3 text-slate-600">
                    <div className="truncate" title={(it.items || []).map((i) => i.title).join(", ")}>
                      {productsCount(it)} × {(it.items || [])[0]?.title}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={it.status} /></td>
                  {kind === "return" && <td className="px-4 py-3"><ShipCell s={it.shipment} /></td>}
                  {kind === "return" && <td className="whitespace-nowrap px-4 py-3">{RETURN_TYPES[it.return_type] || it.return_type}</td>}
                  <td className={cx("whitespace-nowrap px-4 py-3 font-medium", PRIORITY_COLORS[it.priority])}>{PRIORITIES[it.priority] || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs"><AgeCell iso={it.created_at} terminal={it.status?.is_terminal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Kanban({ kind, items, statuses, onMove }) {
  const c = CONF[kind];
  const [over, setOver] = useState(null);
  const groups = useMemo(() => {
    const g = Object.fromEntries(statuses.map((s) => [s.id, []]));
    items.forEach((it) => (g[it.status_id] ||= []).push(it));
    return g;
  }, [items, statuses]);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex gap-3">
        {statuses.map((s) => (
          <div
            key={s.id}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); onMove(e.dataTransfer.getData("text/plain"), s.id); }}
            className={cx("flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70 p-2 ring-1 ring-slate-200", over === s.id && "ring-2 ring-brand")}
          >
            <div className="flex items-center justify-between px-2 py-2">
              <StatusBadge status={s} />
              <span className="text-xs font-semibold text-slate-500 tabular">{(groups[s.id] || []).length}</span>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {(groups[s.id] || []).map((it) => (
                <Link
                  key={it.id}
                  to={`${c.base}/${it.id}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", it.id)}
                  className="block rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 hover:ring-slate-300"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold">{it[c.num]}</span>
                    <AgeCell iso={it.created_at} terminal={s.is_terminal} />
                  </div>
                  <div className="mt-1.5 text-sm font-medium">{it.customer_name}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{(it.items || [])[0]?.title}</div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500">#{it.order_number}</span>
                    <span className="text-slate-500">{kind === "return" ? RETURN_TYPES[it.return_type] : it.problem_type?.name}</span>
                  </div>
                  {kind === "return" && it.shipment && <div className="mt-2"><ShipCell s={it.shipment} /></div>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
