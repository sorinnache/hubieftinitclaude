import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { RotateCcw, Wrench, History, Settings, LogOut, Menu, X, ExternalLink, Boxes, TrendingUp, Truck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { cx } from "./ui";

function NavItem({ to, icon: Icon, children, count }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive ? "bg-brand-50 text-brand ring-1 ring-inset ring-brand/30" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{children}</span>
      {count > 0 && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-white tabular">{count}</span>}
    </NavLink>
  );
}

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ return: 0, service: 0 });
  const loc = useLocation();

  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    const load = async () => {
      try {
        const [r, s] = await Promise.all([api("/returns/stats"), api("/service/stats")]);
        const isNew = (x) => x.by_status.find((b) => b.status.is_default)?.count || 0;
        setCounts({ return: isNew(r), service: isNew(s) });
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [loc.pathname]);

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <img src="/ieftinit-logo.png" alt="IEFTINIT.RO" className="h-8 w-auto" />
        <div className="leading-tight">
          <div className="text-sm font-bold">Control Hub</div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">ieftinit.ro</div>
        </div>
      </div>
      <div className="flex-1 space-y-1 px-3 py-2">
        <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Module</div>
        <NavItem to="/retururi" icon={RotateCcw} count={counts.return}>Retururi</NavItem>
        <NavItem to="/service" icon={Wrench} count={counts.service}>Service & schimb</NavItem>
        <NavItem to="/stocuri" icon={Boxes}>Stocuri</NavItem>
        {isAdmin && <NavItem to="/profit" icon={TrendingUp}>Profit</NavItem>}
        {isAdmin && <NavItem to="/livrari" icon={Truck}>Analiza livrări</NavItem>}
        <div className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Administrare</div>
        {isAdmin && <NavItem to="/istoric" icon={History}>Registru activitate</NavItem>}
        <NavItem to="/setari" icon={Settings}>Setări</NavItem>
        <div className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Formulare clienți</div>
        <a href="/retur" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          <ExternalLink className="h-4 w-4" /> Formular retur
        </a>
        <a href="/service/public" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          <ExternalLink className="h-4 w-4" /> Formular service
        </a>
      </div>
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand">
            {(user?.name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{user?.name}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{user?.role === "admin" ? "Administrator" : "Operator"}</div>
          </div>
          <button onClick={logout} title="Ieșire" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">{nav}</aside>
      <header className="app-header sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Meniu">
          <Menu className="h-5 w-5" />
        </button>
        <img src="/ieftinit-logo.png" alt="IEFTINIT.RO" className="h-6 w-auto" />
        <span className="text-sm font-semibold">Control Hub</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-slate-400" aria-label="Închide">
              <X className="h-5 w-5" />
            </button>
            {nav}
          </div>
        </div>
      )}
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
