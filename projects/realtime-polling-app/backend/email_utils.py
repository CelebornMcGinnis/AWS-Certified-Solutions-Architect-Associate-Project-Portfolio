"""Shared email-sending helpers for the Live Poll Lambda functions.

Both on_connect.py and vote_handler.py send best-effort notification
emails via SES when something happens on the poll. Unlike the contact
form, there's no visitor email address to send a confirmation to here —
voters are anonymous — so these are owner-only notifications.

Email failures are always logged and swallowed here. A failed
notification email must never break the actual WebSocket connection or
vote it's reporting on.
"""
import html
import logging
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ses = boto3.client("ses")

SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS")
SES_TO_ADDRESS = os.environ.get("SES_TO_ADDRESS")
SITE_BASE_URL = os.environ.get("SITE_BASE_URL", "https://mcginnisarchitecture.com")

SITE_NAME = "McGinnis Architecture"
POLL_PAGE_PATH = "/project/polling/project2.html"
LOGO_PATH = "/assets/logo.png"

# Matches styles.css :root, plus the poll's own option colors, so these
# emails don't look like a different brand than the rest of the site.
COLOR_TEXT = "#172033"
COLOR_MUTED = "#5f6b7a"
COLOR_ACCENT = "#3454d1"
COLOR_BG = "#f6f7fb"
COLOR_INFO_BG = "#eef3ff"
COLOR_BORDER = "#d9dee8"

# Keep in sync with OPTIONS in project/polling/script.js and VALID_OPTIONS
# in vote_handler.py.
OPTION_LABELS = {
    "fury-road": "Mad Max: Fury Road",
    "matrix": "The Matrix",
    "mission": "The Mission",
    "la-la-land": "La La Land",
    "jurassic-park": "Jurassic Park",
}

OPTION_COLORS = {
    "fury-road": "#3454d1",
    "matrix": "#6c3fd1",
    "mission": "#2f8fbf",
    "la-la-land": "#17633a",
    "jurassic-park": "#263fa0",
}


def site_url(path):
    return f"{SITE_BASE_URL}{path}"


def format_timestamp():
    now = datetime.now(timezone.utc)
    return now.strftime("%B %d, %Y at %I:%M %p UTC")


def email_wrapper(inner_html):
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


def logo_block():
    logo_url = site_url(LOGO_PATH)
    return (
        f'<img src="{logo_url}" alt="{SITE_NAME}" width="160" '
        f'style="height:auto; max-width:160px; margin-bottom:28px; display:block; border:0;" />'
    )


def send_notification(subject, html_body, text_body):
    """Best-effort SES send. Never raises — a failed notification email
    must not break the WebSocket connection or vote it's reporting on."""
    if not SES_FROM_ADDRESS or not SES_TO_ADDRESS:
        logger.warning("Skipping email: SES_FROM_ADDRESS or SES_TO_ADDRESS not set.")
        return

    try:
        ses.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [SES_TO_ADDRESS]},
            Message={
                "Subject": {"Data": subject},
                "Body": {
                    "Html": {"Data": html_body},
                    "Text": {"Data": text_body},
                },
            },
        )
    except ClientError as err:
        logger.warning("Notification email failed to send: %s", err)


# ---------------------------------------------------------------------------
# $connect notification
# ---------------------------------------------------------------------------

def connect_email(connection_id, active_connections, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    safe_connection_id = html.escape(connection_id)
    inner = (
        f"{logo_block()}"
        f'<h1 style="font-size:20px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">New Live Poll connection</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 16px;">'
        f'Someone just connected to the '
        f'<a href="{poll_url}" style="color:{COLOR_ACCENT}; text-decoration:none;">Live Poll</a> '
        f"WebSocket.</p>"
        f'<table role="presentation" style="width:100%; border-collapse:collapse; margin:0 0 24px; '
        f'font-size:14px; color:{COLOR_TEXT};">'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Connected</td>'
        f'<td style="padding:6px 0; text-align:right;">{timestamp}</td></tr>'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Connection ID</td>'
        f'<td style="padding:6px 0; text-align:right; font-family:monospace; font-size:12px;">{safe_connection_id}</td></tr>'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Active connections</td>'
        f'<td style="padding:6px 0; text-align:right;">{active_connections}</td></tr>'
        f"</table>"
        f'<div style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; padding:14px 16px; '
        f'background:{COLOR_INFO_BG}; border-radius:10px;">'
        f"This is an automated notification from the Live Poll demo &mdash; no action needed."
        f"</div>"
    )
    return email_wrapper(inner)


def connect_email_text(connection_id, active_connections, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    return (
        "New Live Poll connection\n\n"
        f"Someone just connected to the Live Poll WebSocket ({poll_url}).\n\n"
        f"Connected: {timestamp}\n"
        f"Connection ID: {connection_id}\n"
        f"Active connections: {active_connections}\n"
    )


# ---------------------------------------------------------------------------
# Vote notification (includes the current tallies table)
# ---------------------------------------------------------------------------

def _tallies_table_html(tallies, voted_option):
    total = sum(tallies.values()) or 1
    rows = []
    # Deliberate, stable order matching the poll's own option order —
    # dict iteration order over `tallies` isn't guaranteed to match it.
    for option_id in OPTION_LABELS:
        count = tallies.get(option_id, 0)
        pct = round((count / total) * 100)
        label = html.escape(OPTION_LABELS[option_id])
        color = OPTION_COLORS.get(option_id, COLOR_ACCENT)
        is_voted_row = option_id == voted_option
        row_bg = COLOR_INFO_BG if is_voted_row else "transparent"
        marker = (
            f'<span style="display:inline-block; width:10px; height:10px; '
            f'border-radius:50%; background:{color}; margin-right:8px; vertical-align:middle;"></span>'
        )
        rows.append(
            f'<tr style="background:{row_bg};">'
            f'<td style="padding:8px 10px; font-size:14px; color:{COLOR_TEXT}; '
            f'border-bottom:1px solid {COLOR_BORDER};">{marker}{label}'
            f'{" &larr; this vote" if is_voted_row else ""}</td>'
            f'<td style="padding:8px 10px; font-size:14px; color:{COLOR_TEXT}; text-align:right; '
            f'border-bottom:1px solid {COLOR_BORDER};">{count}</td>'
            f'<td style="padding:8px 10px; font-size:14px; color:{COLOR_MUTED}; text-align:right; '
            f'border-bottom:1px solid {COLOR_BORDER}; width:52px;">{pct}%</td>'
            f"</tr>"
        )
    return (
        '<table role="presentation" style="width:100%; border-collapse:collapse; margin:0 0 24px;">'
        "<tr>"
        f'<th style="padding:0 10px 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; '
        f'color:{COLOR_MUTED}; text-align:left; border-bottom:1px solid {COLOR_BORDER};">Option</th>'
        f'<th style="padding:0 10px 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; '
        f'color:{COLOR_MUTED}; text-align:right; border-bottom:1px solid {COLOR_BORDER};">Votes</th>'
        f'<th style="padding:0 10px 8px; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; '
        f'color:{COLOR_MUTED}; text-align:right; border-bottom:1px solid {COLOR_BORDER};">Share</th>'
        "</tr>"
        f"{''.join(rows)}"
        "</table>"
    )


def _tallies_table_text(tallies, voted_option):
    total = sum(tallies.values()) or 1
    lines = []
    for option_id in OPTION_LABELS:
        count = tallies.get(option_id, 0)
        pct = round((count / total) * 100)
        marker = " <- this vote" if option_id == voted_option else ""
        lines.append(f"  {OPTION_LABELS[option_id]}: {count} ({pct}%){marker}")
    return "\n".join(lines)


def vote_email(option, changed, previous_option, voter_id, tallies, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    option_label = html.escape(OPTION_LABELS.get(option, option))
    safe_voter_id = html.escape(voter_id)

    if changed and previous_option:
        prev_label = html.escape(OPTION_LABELS.get(previous_option, previous_option))
        action_line = f"changed their vote from <strong>{prev_label}</strong> to <strong>{option_label}</strong>"
    else:
        action_line = f"voted for <strong>{option_label}</strong>"

    inner = (
        f"{logo_block()}"
        f'<h1 style="font-size:20px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">New Live Poll vote</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 8px;">'
        f'Someone on the '
        f'<a href="{poll_url}" style="color:{COLOR_ACCENT}; text-decoration:none;">Live Poll</a> '
        f"{action_line}.</p>"
        f'<p style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; margin:0 0 4px;">'
        f"<strong>Voted:</strong> {timestamp}</p>"
        f'<p style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; margin:0 0 24px;">'
        f"<strong>Voter ID:</strong> "
        f'<span style="font-family:monospace;">{safe_voter_id}</span></p>'
        f'<p style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; '
        f'color:{COLOR_MUTED}; margin:0 0 10px;">Current results</p>'
        f"{_tallies_table_html(tallies, option)}"
        f'<div style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; padding:14px 16px; '
        f'background:{COLOR_INFO_BG}; border-radius:10px;">'
        f"This is an automated notification from the Live Poll demo &mdash; no action needed."
        f"</div>"
    )
    return email_wrapper(inner)


def vote_email_text(option, changed, previous_option, voter_id, tallies, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    option_label = OPTION_LABELS.get(option, option)

    if changed and previous_option:
        prev_label = OPTION_LABELS.get(previous_option, previous_option)
        action_line = f"changed their vote from {prev_label} to {option_label}"
    else:
        action_line = f"voted for {option_label}"

    return (
        "New Live Poll vote\n\n"
        f"Someone on the Live Poll ({poll_url}) {action_line}.\n\n"
        f"Voted: {timestamp}\n"
        f"Voter ID: {voter_id}\n\n"
        "Current results:\n"
        f"{_tallies_table_text(tallies, option)}\n"
    )


# ---------------------------------------------------------------------------
# $disconnect notification (a stats snapshot, not tied to one vote)
# ---------------------------------------------------------------------------

def disconnect_email(connection_id, remaining_connections, tallies, last_option, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    safe_connection_id = html.escape(connection_id)

    if last_option:
        selection_label = html.escape(OPTION_LABELS.get(last_option, last_option))
        selection_line = (
            f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 16px;">'
            f"Their selection: <strong>{selection_label}</strong></p>"
        )
    else:
        selection_line = (
            f'<p style="font-size:15px; line-height:1.6; color:{COLOR_MUTED}; margin:0 0 16px;">'
            f"They connected but didn&rsquo;t cast a vote this session.</p>"
        )

    inner = (
        f"{logo_block()}"
        f'<h1 style="font-size:20px; font-weight:700; letter-spacing:-0.02em; '
        f'color:{COLOR_TEXT}; margin:0 0 16px;">Live Poll connection closed</h1>'
        f'<p style="font-size:15px; line-height:1.6; color:{COLOR_TEXT}; margin:0 0 8px;">'
        f'A visitor disconnected from the '
        f'<a href="{poll_url}" style="color:{COLOR_ACCENT}; text-decoration:none;">Live Poll</a>.</p>'
        f"{selection_line}"
        f'<table role="presentation" style="width:100%; border-collapse:collapse; margin:0 0 20px; '
        f'font-size:14px; color:{COLOR_TEXT};">'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Disconnected</td>'
        f'<td style="padding:6px 0; text-align:right;">{timestamp}</td></tr>'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Connection ID</td>'
        f'<td style="padding:6px 0; text-align:right; font-family:monospace; font-size:12px;">{safe_connection_id}</td></tr>'
        f'<tr><td style="padding:6px 0; color:{COLOR_MUTED};">Remaining connections</td>'
        f'<td style="padding:6px 0; text-align:right;">{remaining_connections}</td></tr>'
        f"</table>"
        f'<p style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; '
        f'color:{COLOR_MUTED}; margin:0 0 10px;">Current results</p>'
        f"{_tallies_table_html(tallies, last_option)}"
        f'<div style="font-size:13px; line-height:1.6; color:{COLOR_MUTED}; padding:14px 16px; '
        f'background:{COLOR_INFO_BG}; border-radius:10px;">'
        f"This is an automated notification from the Live Poll demo &mdash; no action needed."
        f"</div>"
    )
    return email_wrapper(inner)


def disconnect_email_text(connection_id, remaining_connections, tallies, last_option, timestamp):
    poll_url = site_url(POLL_PAGE_PATH)
    selection_line = (
        f"Their selection: {OPTION_LABELS.get(last_option, last_option)}\n"
        if last_option
        else "They connected but didn't cast a vote this session.\n"
    )
    return (
        "Live Poll connection closed\n\n"
        f"A visitor disconnected from the Live Poll ({poll_url}).\n"
        f"{selection_line}\n"
        f"Disconnected: {timestamp}\n"
        f"Connection ID: {connection_id}\n"
        f"Remaining connections: {remaining_connections}\n\n"
        "Current results:\n"
        f"{_tallies_table_text(tallies, last_option)}\n"
    )
