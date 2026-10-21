"""Emailuri către clienți prin Resend. Nu blochează niciodată fluxul dacă emailul eșuează."""
import asyncio
import html
import logging

from . import config

log = logging.getLogger("email")


async def send(to: str, subject: str, body_html: str) -> bool:
    if not config.RESEND_API_KEY or not to:
        log.info("Email sărit (fără RESEND_API_KEY sau destinatar): %s", subject)
        return False
    import resend
    resend.api_key = config.RESEND_API_KEY
    params = {"from": config.SENDER_EMAIL, "to": [to], "subject": subject, "html": body_html}
    if config.REPLY_TO:
        params["reply_to"] = config.REPLY_TO
    try:
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("Email eșuat către %s: %s", to, e)
        return False


def _layout(title: str, inner: str) -> str:
    return f"""<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:24px;margin:0">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td style="padding:28px 32px 12px;border-bottom:3px solid #E91E63">
<div style="font-weight:800;font-size:18px;color:#0f172a">IEFTINIT.RO</div>
<h1 style="margin:8px 0 0;font-size:20px;color:#0f172a">{title}</h1></td></tr>
<tr><td style="padding:24px 32px;color:#334155;font-size:14px;line-height:1.6">{inner}</td></tr>
<tr><td style="padding:14px 32px;background:#fafafa;font-size:12px;color:#71717a;text-align:center;border-radius:0 0 12px 12px">IEFTINIT.RO · Echipa Suport Clienți</td></tr>
</table></body></html>"""


def _box(label: str, value: str, extra: str = "") -> str:
    return (f'<div style="background:#fdf2f8;border-left:4px solid #E91E63;padding:14px;margin:16px 0;border-radius:4px">'
            f'<div style="font-size:11px;color:#6b7280;letter-spacing:1px;text-transform:uppercase">{label}</div>'
            f'<div style="font-family:monospace;font-size:20px;font-weight:700;color:#111827">{value}</div>{extra}</div>')


def return_received(number: str, name: str, order: str) -> tuple[str, str]:
    n = html.escape(name or "")
    return (f"Confirmare cerere de retur · {number}", _layout("Cererea ta de retur a fost înregistrată", f"""
<p>Salut {n},</p>
<p>Am primit cererea ta de retur pentru comanda <strong>#{html.escape(order)}</strong>. O analizăm și revenim în cel mai scurt timp.</p>
{_box("Număr cerere retur", number)}
<p>Păstrează acest număr pentru orice întrebare legată de retur.</p>"""))


def service_received(number: str, name: str, order: str, problem: str) -> tuple[str, str]:
    n = html.escape(name or "")
    return (f"Confirmare cerere service · {number}", _layout("Cererea ta de service a fost înregistrată", f"""
<p>Salut {n},</p>
<p>Am primit cererea ta de service pentru comanda <strong>#{html.escape(order)}</strong>. Revenim cu detalii în cel mai scurt timp.</p>
{_box("Număr cerere service", number, f'<div style="font-size:12px;color:#6b7280;margin-top:6px">Problemă: <strong>{html.escape(problem or "")}</strong></div>')}
<p>Păstrează acest număr pentru orice întrebare legată de cerere.</p>"""))


def pickup_scheduled(number: str, name: str, awb: str, pickup_date: str) -> tuple[str, str]:
    n = html.escape(name or "")
    return (f"Retur {number} — curierul GLS vine să ridice coletul", _layout("Am chemat curierul pentru returul tău", f"""
<p>Salut {n},</p>
<p>Am aprobat cererea de retur <strong>{number}</strong>. Curierul <strong>GLS</strong> va veni să ridice coletul de la adresa ta
începând cu data de <strong>{html.escape(pickup_date)}</strong>.</p>
{_box("AWB retur GLS", awb)}
<p><strong>Te rugăm să ai coletul pregătit:</strong></p>
<ul><li>produsul ambalat corespunzător, cu toate accesoriile primite;</li>
<li>nu este nevoie să printezi nimic — curierul aduce eticheta.</li></ul>
<p>Poți urmări coletul aici: <a href="https://gls-group.com/RO/ro/urmarire-colet/?match={awb}">urmărire AWB {awb}</a></p>"""))
