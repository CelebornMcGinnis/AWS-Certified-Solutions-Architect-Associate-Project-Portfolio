"""Lambda handler for the contact form.

Triggered by API Gateway (HTTP API) on POST /contact.
Validates the payload, then sends two emails via Amazon SES: a
notification to the site owner, and a confirmation back to the visitor.

The form is a one-field "smoke test" — visitors submit only their email
address to confirm the S3 + API Gateway + Lambda + SES chain actually
works end to end. There's no name/subject/message to collect or relay.
"""
import html
import json
import os
import re
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

ses = boto3.client("ses")

ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS")
SES_TO_ADDRESS = os.environ.get("SES_TO_ADDRESS")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

SITE_NAME = "McGinnis Architecture"
CONTACT_PAGE_PATH = "/prjContactForm.html"
LOGO_PATH = "/assets/logo.png"

# Colors matching the site's own palette (styles.css :root), so the email
# doesn't look like a totally different brand.
COLOR_TEXT = "#172033"
COLOR_MUTED = "#5f6b7a"
COLOR_ACCENT = "#3454d1"
COLOR_BG = "#f6f7fb"
COLOR_INFO_BG = "#eef3ff"


def _site_url(path):
    # ALLOWED_ORIGIN is the site's own origin (e.g. https://mcginnisarchitecture.com),
    # already required for CORS — reused here to build the logo/link URLs in
    # the emails instead of hardcoding the domain a second place.
    base = ALLOWED_ORIGIN if ALLOWED_ORIGIN and ALLOWED_ORIGIN != "*" else "https://mcginnisarchitecture.com"
    return f"{base}{path}"


def _format_timestamp():
    now = datetime.now(timezone.utc)
    return now.strftime("%B %d, %Y at %I:%M %p UTC")


def _cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }


def _respond(status_code, body):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(),
        "body": json.dumps(body),
    }


def _is_valid_email(email):
    return bool(EMAIL_RE.match(email or ""))


def _email_wrapper(inner_html):
    """Wraps email body content in a minimal full HTML document. Email
    clients render more consistently with a real <html>/<head>/<body>
    structure than with a bare fragment."""
    return (
        "<!doctype html>"
        "<html>"
        "<head>"
        '<meta charset="utf-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />'
        "</head>"
        f'<body style="margin:0; padding:24px 16px; background:{COLOR_BG};">'
        f'<div style="max-width:480px; margin:0 auto; font-family:-apple-system,'
        f'BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">'
        f"{inner_html}"
        "</div>"
        "</body>"
        "</html>"
    )


def _visitor_email_html(timestamp):
    logo_url = _site_url(LOGO_PATH)
    contact_url = _site_url(CONTACT_PAGE_PATH)
    inner = (
        f'<img src="{logo_url}" alt="{SITE_NAME}" width="160" '
        f'style="height:auto; max-width:160px; margin-bottom:28px; display:block; border:0;" />'
        f'<h1 style="font-size:20px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">Your test submission was received</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 16px;">'
        f'This confirms the contact form on '
        f'<a href="{contact_url}" style="color:{COLOR_ACCENT}; text-decoration:none;">{SITE_NAME}</a> '
        f"is working end to end &mdash; a small AWS project connecting S3, API Gateway, "
        f"Lambda, and SES.</p>"
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 24px;">'
        f"<strong>Submitted:</strong> {timestamp}</p>"
        f'<div style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; margin:0 0 28px; '
        f'padding:14px 16px; background:{COLOR_INFO_BG}; border-radius:10px;">'
        f"You're receiving this one-time email because this address was entered into the "
        f'contact form at <a href="{contact_url}" style="color:{COLOR_ACCENT};">{contact_url}</a>. '
        f"No further emails will be sent, and your address isn't stored or used for anything else."
        f"</div>"
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0;">'
        f"Thank you,<br />{SITE_NAME}</p>"
    )
    return _email_wrapper(inner)


def _visitor_email_text(timestamp):
    contact_url = _site_url(CONTACT_PAGE_PATH)
    return (
        "Your test submission was received\n\n"
        f"This confirms the contact form on {SITE_NAME} ({contact_url}) is working "
        "end to end -- a small AWS project connecting S3, API Gateway, Lambda, and SES.\n\n"
        f"Submitted: {timestamp}\n\n"
        "You're receiving this one-time email because this address was entered into "
        f"the contact form at {contact_url}. No further emails will be sent, and your "
        "address isn't stored or used for anything else.\n\n"
        f"Thank you,\n{SITE_NAME}"
    )


def _owner_email_html(email, timestamp):
    safe_email = html.escape(email)
    inner = (
        f'<h1 style="font-size:18px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 18px;">New contact form submission</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 8px;">'
        f"<strong>Email:</strong> {safe_email}</p>"
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0;">'
        f"<strong>Submitted:</strong> {timestamp}</p>"
    )
    return _email_wrapper(inner)


def _owner_email_text(email, timestamp):
    return f"New contact form submission\n\nEmail: {email}\nSubmitted: {timestamp}"


def lambda_handler(event, context):
    # API Gateway HTTP API sends OPTIONS preflight only if CORS isn't handled
    # at the API level. The included template configures CORS on the API, but
    # this stays as a safe fallback if that's ever changed.
    http_method = (event.get("requestContext", {}).get("http", {}) or {}).get("method")
    if http_method == "OPTIONS":
        return _respond(204, {})

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _respond(400, {"ok": False, "error": "Invalid request body."})

    email = payload.get("email")
    consent = payload.get("consent")
    website = payload.get("website")  # honeypot

    # Honeypot field: bots tend to fill every input. Pretend success and stop.
    if website:
        return _respond(200, {"ok": True})

    if not (email and consent):
        return _respond(400, {"ok": False, "error": "Please fill in all required fields."})

    if not _is_valid_email(email):
        return _respond(400, {"ok": False, "error": "Please provide a valid email address."})

    if not SES_FROM_ADDRESS or not SES_TO_ADDRESS:
        print("Missing SES_FROM_ADDRESS or SES_TO_ADDRESS environment variable.")
        return _respond(500, {"ok": False, "error": "Something went wrong. Please try again later."})

    timestamp = _format_timestamp()

    # Notification to the site owner — this one must succeed for the
    # submission to count as successful.
    try:
        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [SES_TO_ADDRESS]},
            ReplyToAddresses=[email],
            Message={
                "Subject": {"Data": "Site contact form — new smoke test submission"},
                "Body": {
                    "Html": {"Data": _owner_email_html(email, timestamp)},
                    "Text": {"Data": _owner_email_text(email, timestamp)},
                },
            },
        )
    except ClientError as err:
        print(f"SES notification send failed: {err}")
        return _respond(502, {"ok": False, "error": "Couldn't send your message. Please try again later."})

    # Confirmation back to the visitor — best effort. In SES sandbox mode
    # this only succeeds if the visitor's address happens to already be a
    # verified identity; that's expected until production access is
    # requested, so a failure here is logged but doesn't fail the request
    # (the owner notification above already succeeded, which is what
    # actually matters for the smoke test).
    try:
        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [email]},
            Message={
                "Subject": {"Data": "You tested the site contact form"},
                "Body": {
                    "Html": {"Data": _visitor_email_html(timestamp)},
                    "Text": {"Data": _visitor_email_text(timestamp)},
                },
            },
        )
    except ClientError as err:
        print(
            "SES confirmation-to-visitor send failed (expected in SES sandbox "
            f"mode unless the visitor's address is a verified identity): {err}"
        )

    return _respond(200, {"ok": True})
