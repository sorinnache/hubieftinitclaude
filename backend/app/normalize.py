import re

_NON_DIGIT = re.compile(r"[^\d]")


def normalize_order_number(raw: str | None) -> str:
    if not raw:
        return ""
    return str(raw).strip().lstrip("#").strip()


def normalize_phone_ro(raw: str | None) -> str:
    """Aduce orice format românesc la forma 07XXXXXXXX. Întoarce "" dacă nu se poate."""
    if not raw:
        return ""
    digits = _NON_DIGIT.sub("", str(raw))
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("40") and len(digits) >= 11:
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 9:
        return "0" + digits
    return digits if len(digits) >= 7 else ""


def phones_match(a: str | None, b: str | None) -> bool:
    na, nb = normalize_phone_ro(a), normalize_phone_ro(b)
    return bool(na) and na == nb
