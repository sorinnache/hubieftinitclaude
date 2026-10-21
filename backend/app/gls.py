"""MyGLS România: chemare curier la client (Pick&Ship), urmărire, etichetă, anulare."""
import base64
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from . import config

log = logging.getLogger("gls")


class GlsError(Exception):
    pass


# cod GLS -> (status intern, descriere RO)
GLS_CODES: dict[int, tuple[str, str]] = {
    1: ("picked_up", "Coletul a fost preluat de GLS"),
    2: ("in_transit", "Coletul a plecat din centrul de sortare"),
    3: ("at_hub", "Coletul a ajuns la centrul de sortare"),
    4: ("out_for_delivery", "Colet în livrare astăzi"),
    5: ("delivered", "Colet livrat"),
    6: ("at_hub", "Coletul este în depozitul GLS"),
    7: ("at_hub", "Coletul este în depozitul GLS"),
    8: ("at_hub", "Coletul este în depozit"),
    9: ("out_for_delivery", "Programat pentru o nouă livrare"),
    11: ("failed", "Destinatarul este în concediu"),
    12: ("failed", "Destinatar absent"),
    13: ("at_hub", "Eroare de sortare la depozit"),
    14: ("failed", "Recepție închisă"),
    15: ("failed", "Nelivrat — lipsă timp"),
    17: ("failed", "Destinatarul a refuzat coletul"),
    18: ("failed", "Adresă incompletă"),
    20: ("failed", "Adresă greșită sau incompletă"),
    21: ("in_transit", "Redirecționat (eroare sortare)"),
    22: ("in_transit", "Coletul a plecat de la depou spre sortare"),
    23: ("failed", "Coletul a fost returnat expeditorului"),
    25: ("in_transit", "Redirecționat"),
    26: ("at_hub", "Coletul a ajuns la centrul de sortare"),
    27: ("at_hub", "Coletul a ajuns la centrul de sortare"),
    28: ("lost", "Casat"),
    30: ("damaged", "Avariat la intrare"),
    31: ("damaged", "Colet complet avariat"),
    32: ("out_for_delivery", "Va fi livrat seara"),
    40: ("failed", "Coletul a fost returnat expeditorului"),
    41: ("in_transit", "Redirecționat"),
    42: ("lost", "Casat la cererea expeditorului"),
    43: ("lost", "Coletul nu poate fi localizat"),
    47: ("in_transit", "Coletul a plecat din centrul de sortare"),
    51: ("created", "AWB creat — nepreluat încă de GLS"),
    52: ("created", "Date colet înregistrate"),
    53: ("in_transit", "Tranzit depou"),
    54: ("delivered", "Livrat la parcel box"),
    55: ("delivered", "Livrat la ParcelShop"),
    58: ("delivered", "Livrat la vecin"),
    80: ("in_transit", "Coletul a fost redirecționat"),
    83: ("created", "Date ridicare introduse"),
    84: ("created", "Etichetă ridicare generată"),
    85: ("out_for_pickup", "Șofer alocat pentru ridicare"),
    86: ("at_hub", "Coletul a ajuns la centrul de sortare"),
    87: ("cancelled", "Ridicare anulată — fără marfă"),
    88: ("cancelled", "Ridicare anulată — marfa nepregătită"),
    89: ("cancelled", "Ridicare anulată — client neinformat"),
    90: ("cancelled", "Ridicare anulată — marfa expediată altfel"),
    91: ("cancelled", "Pick&Ship anulat"),
    92: ("delivered", "Colet livrat"),
    93: ("delivered", "Semnătură confirmată"),
    403: ("damaged", "Colet deteriorat"),
}

STATUS_LABELS = {
    "created": "Curier chemat — neridicat încă",
    "out_for_pickup": "Curier în drum spre client",
    "picked_up": "Ridicat de la client",
    "in_transit": "În tranzit",
    "at_hub": "În depozitul GLS",
    "out_for_delivery": "În livrare către depozitul nostru",
    "delivered": "Ajuns în depozitul nostru",
    "cancelled": "Anulat",
    "failed": "Problemă la livrare",
    "lost": "Pierdut",
    "damaged": "Avariat",
}
FINAL = {"delivered", "cancelled", "lost", "damaged"}


def code_info(code) -> tuple[str, str]:
    try:
        c = int(code)
    except (TypeError, ValueError):
        return "created", ""
    return GLS_CODES.get(c, ("in_transit", f"Cod GLS {c}"))


def configured() -> bool:
    return bool(config.GLS_USERNAME and config.GLS_PASSWORD and config.GLS_CLIENT_NUMBER)


def _auth() -> dict:
    return {
        "Username": config.GLS_USERNAME,
        "Password": list(hashlib.sha512(config.GLS_PASSWORD.encode()).digest()),
        "ClientNumberList": [int(config.GLS_CLIENT_NUMBER)],
        "WebshopEngine": "ieftinit-hub",
    }


async def _post(method: str, payload: dict) -> dict:
    if not configured():
        raise GlsError("GLS nu este configurat (GLS_USERNAME / GLS_PASSWORD / GLS_CLIENT_NUMBER)")
    url = f"https://api.mygls.{config.GLS_COUNTRY}/ParcelService.svc/json/{method}"
    async with httpx.AsyncClient(timeout=40) as cli:
        r = await cli.post(url, json={**_auth(), **payload})
    if r.status_code >= 400:
        raise GlsError(f"MyGLS {method} HTTP {r.status_code}: {r.text[:200]}")
    try:
        return r.json()
    except Exception as e:  # noqa: BLE001
        raise GlsError(f"MyGLS {method}: răspuns invalid") from e


def _first_error(data: dict, key: str) -> Optional[str]:
    errs = data.get(key) or []
    if errs:
        e = errs[0] or {}
        return e.get("ErrorDescription") or f"Cod eroare {e.get('ErrorCode')}"
    return None


def _ms(d: datetime) -> str:
    return f"/Date({int(d.timestamp() * 1000)})/"


def _parse_date(raw) -> Optional[str]:
    if isinstance(raw, str) and raw.startswith("/Date("):
        try:
            inner = raw[6:-2]
            ms = int(inner.split("+")[0].split("-")[0] if not inner.startswith("-") else inner)
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
        except (ValueError, IndexError):
            return None
    return raw if isinstance(raw, str) else None


def next_business_day() -> datetime:
    d = datetime.now(timezone.utc) + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.replace(hour=9, minute=0, second=0, microsecond=0)


def _addr(a: dict) -> dict:
    return {
        "Name": (a.get("name") or a.get("contact_name") or "")[:40],
        "Street": a.get("street") or "",
        "HouseNumber": a.get("house_number") or "",
        "City": a.get("city") or "",
        "ZipCode": a.get("zip_code") or "",
        "CountryIsoCode": a.get("country") or "RO",
        "ContactName": (a.get("contact_name") or a.get("name") or "")[:40],
        "ContactPhone": a.get("contact_phone") or "",
        "ContactEmail": a.get("contact_email") or "",
    }


def _pdf(labels) -> Optional[bytes]:
    try:
        if isinstance(labels, list) and labels:
            b = bytes(labels)
        elif isinstance(labels, str) and labels:
            b = base64.b64decode(labels)
        else:
            return None
        return b if b[:4] == b"%PDF" else None
    except (ValueError, TypeError):
        return None


async def create_pickup(*, pickup: dict, delivery: dict, reference: str, parcel_count: int = 1,
                        content: str = "Retur online", pickup_date: Optional[datetime] = None) -> dict:
    """Pick&Ship (PSS): GLS trimite curierul la client și aduce coletul la depozitul nostru."""
    parcel = {
        "ClientNumber": int(config.GLS_CLIENT_NUMBER),
        "ClientReference": reference[:30],
        "CODAmount": 0,
        "CODReference": "",
        "Content": content[:30],
        "Count": max(1, int(parcel_count)),
        "DeliveryAddress": _addr(delivery),
        "PickupAddress": _addr(pickup),
        "PickupDate": _ms(pickup_date or next_business_day()),
        "ServiceList": [{"Code": "PSS"}],
    }
    data = await _post("PrintLabels", {
        "ParcelList": [parcel], "TypeOfPrinter": "A4_2x2", "PrintPosition": 1, "ShowPrintDialog": False,
    })
    err = _first_error(data, "PrintLabelsErrorList")
    if err:
        raise GlsError(err)
    info = (data.get("PrintLabelsInfoList") or [{}])[0] or {}
    awb = info.get("ParcelNumber") or info.get("ParcelNumberStr")
    if not awb:
        raise GlsError("GLS nu a întors număr de AWB")
    return {"awb": str(awb), "parcel_id": str(info.get("ParcelId") or ""), "label_pdf": _pdf(data.get("Labels"))}


async def tracking(awb: str) -> dict:
    data = await _post("GetParcelStatuses", {"ParcelNumber": str(awb), "ReturnPOD": False, "LanguageIsoCode": "RO"})
    err = _first_error(data, "GetParcelStatusErrors")
    if err:
        raise GlsError(err)
    events = []
    for s in data.get("ParcelStatusList") or []:
        st, desc = code_info(s.get("StatusCode"))
        events.append({
            "code": int(s.get("StatusCode") or 0),
            "status": st,
            "description": desc or s.get("StatusDescription") or "",
            "depot": s.get("DepotCity"),
            "info": s.get("StatusInfo"),
            "at": _parse_date(s.get("StatusDate")),
        })
    events.sort(key=lambda e: e["at"] or "")
    last = events[-1] if events else None
    return {
        "events": events,
        "status": last["status"] if last else "created",
        "status_code": last["code"] if last else None,
        "status_description": last["description"] if last else None,
        "last_event_at": last["at"] if last else None,
    }


async def label_pdf(awb: str, parcel_id: Optional[str]) -> bytes:
    attempts = []
    if parcel_id and str(parcel_id).isdigit():
        attempts.append(("GetPrintedLabels", {"ParcelIdList": [int(parcel_id)]}))
    attempts.append(("PrintLabels", {"ParcelNumberList": [str(awb)]}))
    last = None
    for method, body in attempts:
        try:
            data = await _post(method, {**body, "PrintPosition": 1, "ShowPrintDialog": False, "TypeOfPrinter": "A4_2x2"})
        except GlsError as e:
            last = str(e)
            continue
        err = _first_error(data, f"{method}ErrorList")
        if err:
            last = err
            continue
        pdf = _pdf(data.get("Labels"))
        if pdf:
            return pdf
    raise GlsError(last or "GLS nu a întors eticheta")


async def cancel(parcel_id: Optional[str]) -> None:
    if not parcel_id or not str(parcel_id).isdigit():
        raise GlsError("AWB-ul nu are ParcelId GLS (a fost atașat manual) — anulează-l din MyGLS")
    data = await _post("DeleteLabels", {"ParcelIdList": [int(parcel_id)]})
    err = _first_error(data, "DeleteLabelsErrorList")
    if err:
        raise GlsError(err)


async def ping() -> None:
    now = datetime.now(timezone.utc)
    data = await _post("GetParcelList", {"PrintDateFrom": _ms(now - timedelta(days=1)), "PrintDateTo": _ms(now),
                                          "PickupDateFrom": None, "PickupDateTo": None})
    err = _first_error(data, "GetParcelListErrors")
    if err:
        raise GlsError(err)


def tracking_url(awb: str) -> str:
    return f"https://gls-group.com/RO/ro/urmarire-colet/?match={awb}"
