const TZ = "Europe/Bucharest";

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function fmtAgo(iso) {
  const d = daysSince(iso);
  if (d === null) return "—";
  if (d === 0) {
    const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
    return h <= 0 ? "acum" : `acum ${h} h`;
  }
  if (d === 1) return "ieri";
  return `acum ${d} zile`;
}

export function money(v, cur = "RON") {
  const n = Number(v);
  if (isNaN(n)) return v || "—";
  return `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === "RON" ? "lei" : cur}`;
}

export const RETURN_TYPES = { refund: "Rambursare", exchange: "Schimb", voucher: "Voucher" };
export const PRIORITIES = { low: "Scăzută", medium: "Medie", high: "Ridicată", urgent: "Urgentă" };
export const PRIORITY_COLORS = { low: "text-slate-500", medium: "text-sky-600", high: "text-amber-600", urgent: "text-red-600" };
export const WHEN_STARTED = {
  from_unboxing: "Din momentul despachetării",
  first_use: "La prima utilizare",
  few_days: "După câteva zile",
  few_weeks: "După câteva săptămâni",
  months_later: "După câteva luni",
  other: "Alt moment",
};
export const SLOTS = { morning: "Dimineața (09–13)", afternoon: "După-amiaza (13–18)", anytime: "Oricând în program" };

export const SHIP_STATUS = {
  created: { label: "Curier chemat", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  out_for_pickup: { label: "Curier în drum", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  picked_up: { label: "Ridicat", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  in_transit: { label: "În tranzit", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  at_hub: { label: "În depozit GLS", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  out_for_delivery: { label: "În livrare spre noi", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  delivered: { label: "Ajuns la depozit", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Anulat", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
  failed: { label: "Problemă", cls: "bg-red-50 text-red-700 ring-red-200" },
  lost: { label: "Pierdut", cls: "bg-red-50 text-red-700 ring-red-200" },
  damaged: { label: "Avariat", cls: "bg-red-50 text-red-700 ring-red-200" },
};

export const glsTrackUrl = (awb) => `https://gls-group.com/RO/ro/urmarire-colet/?match=${awb}`;

export function customerName(order) {
  const c = order?.customer || {};
  return `${c.first_name || ""} ${c.last_name || ""}`.trim();
}
