"""SAF-T (D406) — declarația de STOCURI depusă la cererea ANAF (HeaderComment „C”).

Structura urmează schema oficială Ro_SAFT_Schema_v249_2025.xsd și registrul RO_SAFT_SchemaDefCod (ANAF):
  * MasterFiles: contul de stoc (371) cu soldurile, UOMTable (H87 = bucată), MovementTypeTable (coduri din
    „Nomenclator stocuri”), Products, PhysicalStock (stoc inițial/final pe produs), restul secțiunilor goale.
  * SourceDocuments → MovementOfGoods: fiecare mișcare de stoc din hub, grupată pe document.

Corespondența mișcărilor din hub cu nomenclatorul ANAF:
  intrare → 10 Achiziție · vanzare → 30 Vânzare · retur / colet refuzat / AWB anulat → 40 Retur produse vândute
  inventar / ajustare → 110 Plus de inventar sau 120 Minus de inventar · înlocuire în pachet → 30 sau 40.
Valoarea = cantitate × costul de achiziție fără TVA din Shopify (CMP).
"""
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from . import audit
from .auth import require_admin
from .db import get_db, now_iso

router = APIRouter(prefix="/saft", tags=["SAF-T"])
TZ = ZoneInfo("Europe/Bucharest")
NS = "mfp:anaf:dgti:d406:declaratie:v1"

MOVEMENT_TYPES = {
    "10": "Achiziție", "20": "Producție", "30": "Vânzare", "40": "Retur produse vândute",
    "50": "Retur produse achiziționate", "60": "Reduceri comerciale primite", "70": "Consum",
    "80": "Transfer intern", "90": "Cheltuieli ulterioare incluse în valoarea de intrare",
    "100": "Diferențe de preț pozitive", "101": "Diferențe de preț negative", "110": "Plus de inventar",
    "120": "Minus de inventar", "130": "Ajustări pentru deprecierea stocurilor",
    "140": "Reluări de ajustări pentru deprecierea stocurilor", "150": "Bunuri acordate cu titlu gratuit",
    "160": "Bunuri degradate", "170": "Bunuri expirate", "180": "Alte tranzacții",
}
RECEIVED = {"10", "40", "110"}

# datele firmei — preluate din declarația D406 depusă din Saga (le poți schimba din Setări SAF-T)
DEFAULTS = {
    "cui": "47802450", "name": "IEFTINIT SRL", "street": "INTRAREA GHEORGHE SIMIONESCU", "number": "19",
    "city": "BUCURESTI SECTOR 1", "postal_code": "014155", "region": "RO-B", "contact_first_name": "MIHAITA SORIN",
    "contact_last_name": "BITU", "contact_title": "ADMINISTRATOR", "phone": "0731128424",
    "email": "bitumihai@gmail.com", "iban": "RO09BTRLRONCRT0669706701",
    "stock_account": "371", "warehouse_id": "DEPOZIT", "product_type": "Marfa",
}


def _digits(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def cui_valid(cui: str) -> bool:
    """Cifra de control a CUI-ului (algoritmul ANAF, cheia 753217532)."""
    d = _digits(cui)
    if not 2 <= len(d) <= 10:
        return False
    body, ctrl = d[:-1].rjust(9, "0"), int(d[-1])
    s = sum(int(a) * int(b) for a, b in zip(body, "753217532")) * 10 % 11
    return (0 if s == 10 else s) == ctrl


async def get_settings() -> dict:
    doc = await get_db().settings.find_one({"key": "saft"}, {"_id": 0}) or {}
    return {**DEFAULTS, **{k: v for k, v in doc.items() if k != "key" and v not in (None, "")}}


def _bounds(frm: str, to: str) -> tuple[date, date, str, str]:
    try:
        d1, d2 = date.fromisoformat(frm), date.fromisoformat(to)
    except ValueError:
        raise HTTPException(400, "Perioadă invalidă (AAAA-LL-ZZ)")
    if d2 < d1:
        raise HTTPException(400, "Data de final este înaintea celei de început")
    z = lambda d: datetime(d.year, d.month, d.day, tzinfo=TZ).astimezone(timezone.utc).isoformat()  # noqa: E731
    return d1, d2, z(d1), z(d2 + timedelta(days=1))


def _local_day(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).date().isoformat()


def _m2(x: float) -> str:
    return f"{round(x + 0, 2):.2f}"


def _q(x: float) -> str:
    return f"{x:.2f}" if x != int(x) else str(int(x))


# ------------------------------------------------------------------ calcul
async def build(frm: str, to: str) -> dict:
    d1, d2, a, b = _bounds(frm, to)
    db = get_db()
    s = await get_settings()
    variants = {v["variant_id"]: v async for v in db.stock_variants.find({}, {"_id": 0})}
    first = await db.stock_movements.find_one({}, {"_id": 0, "created_at": 1}, sort=[("created_at", 1)])

    # sold la începutul și la sfârșitul perioadei = stocul de acum minus mișcările de după
    after_a, after_b, moves = {}, {}, []
    async for m in db.stock_movements.find({"created_at": {"$gte": a}}, {"_id": 0}).sort("created_at", 1):
        vid, dl = m["variant_id"], int(m.get("delta") or 0)
        after_a[vid] = after_a.get(vid, 0) + dl
        if m["created_at"] >= b:
            after_b[vid] = after_b.get(vid, 0) + dl
        elif dl:
            moves.append(m)

    receipts = {r["id"]: r async for r in db.stock_receipts.find(
        {"id": {"$in": list({m.get("ref_id") for m in moves if m.get("ref_kind") == "receipt"})}}, {"_id": 0})}
    returns = {r["id"]: r async for r in db.returns.find(
        {"id": {"$in": list({m.get("ref_id") for m in moves if m.get("ref_kind") == "return"})}},
        {"_id": 0, "id": 1, "return_number": 1, "order_number": 1})}
    suppliers = {(x.get("name") or "").strip().lower(): x async for x in db.stock_suppliers.find({}, {"_id": 0})}

    warnings: list[dict] = []
    code_used = {}

    def pcode(vid: str) -> str:
        if vid not in code_used:
            v = variants.get(vid) or {}
            sku = (v.get("sku") or "").strip()
            code_used[vid] = sku[:70] if sku and sum(1 for x in variants.values() if (x.get("sku") or "").strip() == sku) == 1 \
                else f"V{vid}"[:70]
        return code_used[vid]

    def cost(vid: str) -> float:
        c = (variants.get(vid) or {}).get("cost")
        return float(c) if c is not None and float(c) > 0 else 0.0

    # ---- mișcări grupate pe document
    groups: dict[tuple, dict] = {}
    missing_receipts = {}
    for m in moves:
        t, dl, vid = m["type"], int(m["delta"]), m["variant_id"]
        day = _local_day(m["created_at"])
        cust, supp, doc_type, doc_no, comment = "0", "0", "", "", ""
        if t == "intrare":
            code = "10" if dl > 0 else "50"
            r = receipts.get(m.get("ref_id")) or {}
            cui = _digits(r.get("supplier_cui")) or _digits((suppliers.get((r.get("supplier") or "").strip().lower()) or {}).get("cui"))
            if not cui or not cui_valid(cui) or not (r.get("document") or "").strip():
                missing_receipts[m.get("ref_id") or m["id"]] = {
                    "id": r.get("id") or m.get("ref_id"), "date": day, "supplier": r.get("supplier") or "",
                    "supplier_cui": r.get("supplier_cui") or "", "document": r.get("document") or "",
                    "units": sum(i["qty"] for i in r.get("items") or []) or abs(dl),
                    "problem": "lipsește CUI-ul furnizorului" if not cui else
                               "CUI furnizor invalid" if not cui_valid(cui) else "lipsește numărul facturii"}
            supp = f"00{cui}" if cui else "0"
            doc_type, doc_no = "Factura furnizor", (r.get("document") or "").strip() or "FARA NUMAR"
            key = (code, "r", m.get("ref_id"), day)
            ref = f"NIR-{(r.get('document') or m.get('ref_id') or '')}"
        elif t in ("vanzare", "awb_anulat", "refuzat", "inlocuire") or (t == "retur" and m.get("ref_kind") != "return"):
            code = "30" if dl < 0 else "40"
            order = _digits(m.get("ref")) or _digits(m.get("order_id"))
            cust = f"04{order}" if order else "0"
            doc_type, doc_no = "Comanda", m.get("ref") or order
            comment = {"awb_anulat": "AWB anulat - marfa nu a plecat", "refuzat": "Colet refuzat - reintrat in stoc",
                       "inlocuire": "Inlocuire produs in pachet"}.get(t, "")
            key = (code, "o", order or m.get("ref"), day)
            ref = f"{'VZ' if code == '30' else 'RT'}-{doc_no}"
        elif t == "retur":
            code = "40" if dl > 0 else "30"
            rr = returns.get(m.get("ref_id")) or {}
            order = _digits(rr.get("order_number"))
            cust = f"04{order}" if order else "0"
            doc_type, doc_no = "Retur client", rr.get("return_number") or m.get("ref") or ""
            comment = f"Retur la comanda #{order}" if order else ""
            key = (code, "ret", m.get("ref_id"), day)
            ref = f"RET-{doc_no}"
        else:  # inventar, ajustare
            code = "110" if dl > 0 else "120"
            doc_type = "Inventar" if t == "inventar" else "Proces verbal"
            doc_no = f"{'INV' if t == 'inventar' else 'AJ'}-{day}"
            comment = (m.get("note") or "")[:256]
            key = (code, t, day, "")
            ref = f"{'INV' if t == 'inventar' else 'AJ'}-{day}-{code}"
        g = groups.setdefault(key, {"code": code, "date": day, "ref": ref[:35], "doc_type": doc_type[:18],
                                    "doc_no": str(doc_no)[:35], "lines": {}, "time": m["created_at"]})
        ln = g["lines"].setdefault(vid, {"vid": vid, "qty": 0, "cust": cust, "supp": supp, "comment": comment})
        ln["qty"] += abs(dl)

    # referințele trebuie să fie unice
    seen: dict[str, int] = {}
    stock_moves = sorted(groups.values(), key=lambda g: (g["time"], g["ref"]))
    for g in stock_moves:
        n = seen.get(g["ref"], 0)
        seen[g["ref"]] = n + 1
        if n:
            g["ref"] = f"{g['ref'][:31]}-{n + 1}"

    # ---- stocuri pe produs
    moved_vids = {vid for g in stock_moves for vid in g["lines"]}
    involved = set(after_a) | {vid for vid, v in variants.items() if int(v.get("on_hand") or 0)}
    entries, missing_cost = [], []
    for vid in sorted(involved, key=lambda x: (variants.get(x, {}).get("product_title") or "", x)):
        v = variants.get(vid) or {}
        moved = vid in moved_vids
        if (v.get("bundle") or v.get("untracked")) and not moved:
            continue
        now_q = int(v.get("on_hand") or 0)
        q_open, q_close = now_q - after_a.get(vid, 0), now_q - after_b.get(vid, 0)
        if not q_open and not q_close and not moved:
            continue
        c = cost(vid)
        if not c:
            missing_cost.append({"variant_id": vid, "title": _title(v), "sku": v.get("sku") or ""})
        entries.append({"vid": vid, "code": pcode(vid), "title": _title(v), "sku": v.get("sku") or "", "cost": c,
                        "open_q": q_open, "close_q": q_close, "open_v": q_open * c, "close_v": q_close * c})
    negatives = [e for e in entries if e["open_q"] < 0 or e["close_q"] < 0]

    if first and first["created_at"] > a:
        warnings.append({"level": "warn", "text": f"Hub-ul urmărește stocul abia din {_local_day(first['created_at'])}. "
                                                  "Pentru zilele de dinainte nu există mișcări, deci stocul inițial al perioadei poate fi incomplet."})
    if missing_receipts:
        warnings.append({"level": "error", "text": f"{len(missing_receipts)} intrări de marfă nu au CUI-ul furnizorului sau "
                                                   "numărul facturii. Completează-le mai jos înainte de a trimite fișierul."})
    if missing_cost:
        warnings.append({"level": "error", "text": f"{len(missing_cost)} produse nu au cost de achiziție în Shopify, "
                                                   "deci apar cu valoare 0."})
    if negatives:
        warnings.append({"level": "warn", "text": f"{len(negatives)} produse au stoc negativ la începutul sau la sfârșitul "
                                                  "perioadei (mișcări înregistrate înainte de inventar)."})
    tot_in = sum(l["qty"] for g in stock_moves if g["code"] in RECEIVED for l in g["lines"].values())
    tot_out = sum(l["qty"] for g in stock_moves if g["code"] not in RECEIVED for l in g["lines"].values())
    by_code = {}
    for g in stock_moves:
        bc = by_code.setdefault(g["code"], {"code": g["code"], "label": MOVEMENT_TYPES[g["code"]], "documents": 0,
                                            "units": 0, "value": 0.0})
        bc["documents"] += 1
        for l in g["lines"].values():
            bc["units"] += l["qty"]
            bc["value"] += l["qty"] * cost(l["vid"])
    return {
        "from": d1.isoformat(), "to": d2.isoformat(), "settings": s, "entries": entries, "moves": stock_moves,
        "cost": cost, "warnings": warnings, "missing_receipts": list(missing_receipts.values()),
        "missing_cost": missing_cost, "negatives": negatives[:200],
        "totals": {"products": len(entries), "documents": len(stock_moves),
                   "lines": sum(len(g["lines"]) for g in stock_moves), "received": tot_in, "issued": tot_out,
                   "open_value": round(sum(e["open_v"] for e in entries), 2),
                   "close_value": round(sum(e["close_v"] for e in entries), 2),
                   "by_code": sorted(({**x, "value": round(x["value"], 2)} for x in by_code.values()),
                                     key=lambda x: int(x["code"]))},
    }


def _title(v: dict) -> str:
    t = v.get("product_title") or "(fără nume)"
    vt = v.get("variant_title") or ""
    return f"{t} - {vt}" if vt and vt.lower() not in ("default title", "default") else t


# ------------------------------------------------------------------ XML
def _el(tag: str, val) -> str:
    return f"<nsSAFT:{tag}>{escape(str(val))}</nsSAFT:{tag}>"


def to_xml(d: dict) -> str:
    s, cost = d["settings"], d["cost"]
    cui = _digits(s["cui"])
    own = f"00{cui}"
    acc = s["stock_account"]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<nsSAFT:AuditFile xmlns:nsSAFT="{NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
           "<nsSAFT:Header>",
           _el("AuditFileVersion", "2.0"), _el("AuditFileCountry", "RO"), _el("AuditFileRegion", s["region"]),
           _el("AuditFileDateCreated", date.today().isoformat()), _el("SoftwareCompanyName", s["name"]),
           _el("SoftwareID", "Control Hub IEFTINIT"), _el("SoftwareVersion", "1.0"),
           "<nsSAFT:Company>", _el("RegistrationNumber", f"RO{cui}"), _el("Name", s["name"]),
           "<nsSAFT:Address>", _el("StreetName", s["street"]), _el("Number", s["number"]), _el("City", s["city"]),
           _el("PostalCode", s["postal_code"]), _el("Region", s["region"]), _el("Country", "RO"),
           _el("AddressType", "PostalAddress"), "</nsSAFT:Address>",
           "<nsSAFT:Contact><nsSAFT:ContactPerson>", _el("FirstName", s["contact_first_name"]),
           _el("LastName", s["contact_last_name"]), _el("OtherTitles", s["contact_title"]), "</nsSAFT:ContactPerson>",
           _el("Telephone", s["phone"]), _el("Email", s["email"]), "</nsSAFT:Contact>",
           "<nsSAFT:TaxRegistration>", _el("TaxRegistrationNumber", cui), _el("TaxType", "100010"),
           _el("TaxNumber", cui), _el("TaxAuthority", "ANAF"), "</nsSAFT:TaxRegistration>",
           "<nsSAFT:BankAccount>", _el("IBANNumber", s["iban"]), "</nsSAFT:BankAccount>", "</nsSAFT:Company>",
           _el("DefaultCurrencyCode", "RON"),
           "<nsSAFT:SelectionCriteria>", _el("SelectionStartDate", d["from"]), _el("SelectionEndDate", d["to"]),
           "</nsSAFT:SelectionCriteria>",
           _el("HeaderComment", "C"), _el("SegmentIndex", "1"), _el("TotalSegmentsInsequence", "1"),
           _el("TaxAccountingBasis", "A"), "</nsSAFT:Header>",
           "<nsSAFT:MasterFiles>",
           "<nsSAFT:GeneralLedgerAccounts><nsSAFT:Account>", _el("AccountID", acc), _el("AccountDescription", "MARFURI"),
           _el("StandardAccountID", acc[:3]), _el("AccountType", "Activ"),
           _el("OpeningDebitBalance", _m2(d["totals"]["open_value"])),
           _el("ClosingDebitBalance", _m2(d["totals"]["close_value"])),
           "</nsSAFT:Account></nsSAFT:GeneralLedgerAccounts>",
           "<nsSAFT:Customers/>", "<nsSAFT:Suppliers/>", "<nsSAFT:TaxTable/>",
           "<nsSAFT:UOMTable><nsSAFT:UOMTableEntry>", _el("UnitOfMeasure", "H87"), _el("Description", "bucată"),
           "</nsSAFT:UOMTableEntry></nsSAFT:UOMTable>",
           "<nsSAFT:AnalysisTypeTable/>", "<nsSAFT:MovementTypeTable>"]
    for code in sorted({g["code"] for g in d["moves"]}, key=int):
        out += ["<nsSAFT:MovementTypeTableEntry>", _el("MovementType", code), _el("Description", MOVEMENT_TYPES[code]),
                "</nsSAFT:MovementTypeTableEntry>"]
    out.append("</nsSAFT:MovementTypeTable><nsSAFT:Products>")
    for e in d["entries"]:
        out += ["<nsSAFT:Product>", _el("ProductCode", e["code"]), _el("GoodsServicesID", "01"),
                _el("Description", e["title"][:256]), _el("ProductCommodityCode", "0"), _el("ValuationMethod", "CMP"),
                _el("UOMBase", "H87"), _el("UOMStandard", "H87"), _el("UOMToUOMBaseConversionFactor", "1"),
                "</nsSAFT:Product>"]
    out.append("</nsSAFT:Products>")
    if d["entries"]:
        out.append("<nsSAFT:PhysicalStock>")
        for e in d["entries"]:
            out += ["<nsSAFT:PhysicalStockEntry>", _el("WarehouseID", s["warehouse_id"][:35]),
                    _el("ProductCode", e["code"]), _el("ProductType", s["product_type"][:18]),
                    _el("StockAccountCommodityCode", "0"), _el("OwnerID", own), _el("UOMPhysicalStock", "H87"),
                    _el("UOMToUOMBaseConversionFactor", "1"), _el("UnitPrice", _m2(e["cost"])),
                    _el("OpeningStockQuantity", _q(e["open_q"])), _el("OpeningStockValue", _m2(e["open_v"])),
                    _el("ClosingStockQuantity", _q(e["close_q"])), _el("ClosingStockValue", _m2(e["close_v"])),
                    "<nsSAFT:StockCharacteristics>", _el("StockCharacteristic", "0"),
                    _el("StockCharacteristicValue", "0"), "</nsSAFT:StockCharacteristics>",
                    "</nsSAFT:PhysicalStockEntry>"]
        out.append("</nsSAFT:PhysicalStock>")
    out += ["<nsSAFT:Owners/>", "<nsSAFT:Assets/>", "</nsSAFT:MasterFiles>",
            "<nsSAFT:GeneralLedgerEntries/>",
            "<nsSAFT:SourceDocuments>", "<nsSAFT:SalesInvoices/>", "<nsSAFT:PurchaseInvoices/>", "<nsSAFT:Payments/>",
            "<nsSAFT:MovementOfGoods>", _el("NumberOfMovementLines", d["totals"]["lines"]),
            _el("TotalQuantityReceived", _q(d["totals"]["received"])),
            _el("TotalQuantityIssued", _q(d["totals"]["issued"]))]
    codes = {e["vid"]: e["code"] for e in d["entries"]}
    for g in d["moves"]:
        out += ["<nsSAFT:StockMovement>", _el("MovementReference", g["ref"]), _el("MovementDate", g["date"]),
                _el("MovementPostingDate", g["date"]), _el("MovementType", g["code"]),
                "<nsSAFT:DocumentReference>", _el("DocumentType", g["doc_type"]), _el("DocumentNumber", g["doc_no"] or "-"),
                "</nsSAFT:DocumentReference>"]
        for i, l in enumerate(g["lines"].values(), 1):
            out += ["<nsSAFT:StockMovementLine>", _el("LineNumber", i), _el("AccountID", acc),
                    _el("CustomerID", l["cust"][:35]), _el("SupplierID", l["supp"][:35]),
                    _el("ProductCode", codes.get(l["vid"]) or f"V{l['vid']}"[:70]), _el("Quantity", _q(l["qty"])),
                    _el("UnitOfMeasure", "H87"), _el("UOMToUOMPhysicalStockConversionFactor", "1"),
                    _el("BookValue", _m2(l["qty"] * cost(l["vid"]))), _el("MovementSubType", g["code"])]
            if l["comment"]:
                out.append(_el("MovementComments", l["comment"][:256]))
            out.append("</nsSAFT:StockMovementLine>")
        out.append("</nsSAFT:StockMovement>")
    out += ["</nsSAFT:MovementOfGoods>", "</nsSAFT:SourceDocuments>", "</nsSAFT:AuditFile>"]
    return "\n".join(out)


# ------------------------------------------------------------------ API
@router.get("/stocks/preview")
async def preview(frm: str, to: str, _: dict = Depends(require_admin)):
    d = await build(frm, to)
    return {k: d[k] for k in ("from", "to", "settings", "warnings", "missing_receipts", "missing_cost", "totals")} | {
        "negatives": [{k: e[k] for k in ("title", "sku", "open_q", "close_q")} for e in d["negatives"]]}


@router.get("/stocks.xml")
async def export_xml(frm: str, to: str, request: Request, user: dict = Depends(require_admin)):
    d = await build(frm, to)
    xml = to_xml(d)
    await audit.log(resource_type="saft", resource_id=f"{frm}_{to}", action="saft.stocks_export", actor=user,
                    details={"from": frm, "to": to, **{k: d["totals"][k] for k in ("products", "documents", "lines")}},
                    ip=audit.client_ip(request))
    name = f"D406_{_digits(d['settings']['cui'])}_{d['to']}_Stocuri.xml"
    return Response(xml.encode("utf-8"), media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


class SaftSettings(BaseModel):
    cui: str
    name: str
    street: str
    number: str = ""
    city: str
    postal_code: str = ""
    region: str = "RO-B"
    contact_first_name: str
    contact_last_name: str
    contact_title: str = ""
    phone: str
    email: str = ""
    iban: str
    stock_account: str = "371"
    warehouse_id: str = "DEPOZIT"
    product_type: str = "Marfa"


@router.get("/settings")
async def read_settings(_: dict = Depends(require_admin)):
    return await get_settings()


@router.put("/settings")
async def save_settings(body: SaftSettings, request: Request, user: dict = Depends(require_admin)):
    data = body.model_dump()
    data["cui"] = _digits(data["cui"])
    if not cui_valid(data["cui"]):
        raise HTTPException(400, "CUI-ul firmei nu este valid")
    await get_db().settings.update_one({"key": "saft"}, {"$set": {**data, "updated_at": now_iso()}}, upsert=True)
    await audit.log(resource_type="settings", resource_id="saft", action="saft.settings", actor=user, details=data,
                    ip=audit.client_ip(request))
    return await get_settings()


class ReceiptFix(BaseModel):
    supplier: str = ""
    supplier_cui: str = ""
    document: str = ""


@router.patch("/receipts/{rid}")
async def fix_receipt(rid: str, body: ReceiptFix, request: Request, user: dict = Depends(require_admin)):
    db = get_db()
    r = await db.stock_receipts.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Intrare inexistentă")
    cui = _digits(body.supplier_cui)
    if cui and not cui_valid(cui):
        raise HTTPException(400, f"CUI-ul {body.supplier_cui} nu este valid (cifra de control nu se potrivește)")
    upd = {"supplier": body.supplier.strip(), "supplier_cui": cui, "document": body.document.strip()}
    await db.stock_receipts.update_one({"id": rid}, {"$set": upd})
    ref = " · ".join(x for x in [upd["supplier"], upd["document"]] if x) or "Intrare marfă"
    await db.stock_movements.update_many({"ref_kind": "receipt", "ref_id": rid}, {"$set": {"ref": ref}})
    await audit.log(resource_type="stock", resource_id=rid, action="stock.receipt_fix", actor=user,
                    details={"from": {k: r.get(k) for k in upd}, "to": upd}, ip=audit.client_ip(request))
    return {"ok": True}
