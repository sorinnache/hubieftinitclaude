import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";

export const cx = (...a) => a.filter(Boolean).join(" ");

export function Button({ variant = "primary", size = "md", loading, className, children, ...p }) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-600 shadow-sm",
    dark: "bg-ink text-white hover:bg-slate-800 shadow-sm",
    outline: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50",
  }[variant];
  const s = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed", v, s, className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand outline-none";

export function Input({ className, ...p }) {
  return <input {...p} className={cx(inputCls, "h-10", className)} />;
}
export function Textarea({ className, ...p }) {
  return <textarea {...p} className={cx(inputCls, className)} />;
}
export function Select({ className, children, ...p }) {
  return (
    <select {...p} className={cx(inputCls, "h-10 pr-8", className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      {label && <span className="block text-sm font-medium text-slate-700">{label}</span>}
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ className, children, title, actions, ...p }) {
  return (
    <section {...p} className={cx("rounded-xl bg-white ring-1 ring-slate-200 shadow-sm print-break", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <div className="flex items-center gap-2 no-print">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status, className }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", className)}
      style={{ color: status.color, backgroundColor: `${status.color}14`, boxShadow: `inset 0 0 0 1px ${status.color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
      {status.name}
    </span>
  );
}

export function Pill({ className, children }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", className)}>{children}</span>;
}

export function Spinner({ className }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-slate-400", className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-slate-300" />}
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={cx("max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl flex flex-col", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Închide">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- notificări ----------
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((type, text) => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, type, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), type === "error" ? 6000 : 3500);
  }, []);
  const api = { success: (t) => push("success", t), error: (t) => push("error", t) };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ring-1",
              t.type === "error" ? "bg-white text-red-700 ring-red-200" : "bg-ink text-white ring-slate-800",
            )}
          >
            {t.type === "error" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
