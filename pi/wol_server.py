"""
CloudDeck Wake-on-LAN forwarder.

A small Flask app that sits on the home LAN and broadcasts a WoL magic packet
to the configured PC MAC address when Railway calls it. Authenticated by a
shared secret token to prevent random visitors from waking the PC.

Endpoints:
  POST /wake     — broadcast the magic packet (requires Bearer token)
  GET  /health   — liveness check (no auth)

Configuration is read from environment variables (load .env via systemd
EnvironmentFile or python-dotenv).
"""

from __future__ import annotations

import logging
import os
import re
import socket
import sys
from typing import Optional

from flask import Flask, jsonify, request
try:
    from wakeonlan import send_magic_packet  # type: ignore
except ImportError:
    print("Install dependencies first: pip install -r requirements.txt", file=sys.stderr)
    raise

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass  # dotenv is optional when env is provided by systemd

PI_SECRET_TOKEN: Optional[str] = os.environ.get("PI_SECRET_TOKEN")
PC_MAC_ADDRESS: Optional[str] = os.environ.get("PC_MAC_ADDRESS")
PI_PORT: int = int(os.environ.get("PI_PORT", "5000"))
WOL_BROADCAST_ADDRESS: str = os.environ.get("WOL_BROADCAST_ADDRESS", "255.255.255.255")

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("clouddeck-wol")

MAC_REGEX = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")


def _validate_config() -> None:
    missing = []
    if not PI_SECRET_TOKEN:
        missing.append("PI_SECRET_TOKEN")
    if not PC_MAC_ADDRESS:
        missing.append("PC_MAC_ADDRESS")
    if missing:
        log.error("Missing required env vars: %s", ", ".join(missing))
        sys.exit(1)
    if not MAC_REGEX.match(PC_MAC_ADDRESS or ""):
        log.error("PC_MAC_ADDRESS '%s' is not a valid MAC address", PC_MAC_ADDRESS)
        sys.exit(1)


def _auth_ok(req) -> bool:
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    return header[len("Bearer "):].strip() == PI_SECRET_TOKEN


app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "configured": bool(PI_SECRET_TOKEN and PC_MAC_ADDRESS),
            "broadcast": WOL_BROADCAST_ADDRESS,
        }
    )


@app.post("/wake")
def wake():
    if not _auth_ok(request):
        log.warning("Unauthorized /wake from %s", request.remote_addr)
        return jsonify({"error": "unauthorized"}), 401

    try:
        # Send to broadcast address, port 9 (a discard-protocol port; WoL
        # listeners snoop on it). Some routers require 7. Some require the
        # subnet broadcast (e.g., 192.168.1.255) rather than 255.255.255.255.
        send_magic_packet(
            PC_MAC_ADDRESS,
            ip_address=WOL_BROADCAST_ADDRESS,
            port=9,
        )
        # Belt-and-suspenders: also send to port 7 since some NICs prefer it.
        try:
            send_magic_packet(
                PC_MAC_ADDRESS,
                ip_address=WOL_BROADCAST_ADDRESS,
                port=7,
            )
        except Exception:
            pass

        log.info("Sent WoL magic packet to %s via %s", PC_MAC_ADDRESS, WOL_BROADCAST_ADDRESS)
        return jsonify({"ok": True, "mac": PC_MAC_ADDRESS, "broadcast": WOL_BROADCAST_ADDRESS})
    except Exception as exc:
        log.exception("Failed to send WoL packet")
        return jsonify({"error": str(exc)}), 500


def main() -> None:
    _validate_config()
    log.info(
        "CloudDeck WoL forwarder listening on :%d → MAC %s via %s",
        PI_PORT, PC_MAC_ADDRESS, WOL_BROADCAST_ADDRESS,
    )
    # Bind to 0.0.0.0 so Railway (or anything else on your network) can reach it.
    # Use waitress for production reliability; fall back to Flask's dev server.
    try:
        from waitress import serve  # type: ignore
        serve(app, host="0.0.0.0", port=PI_PORT)
    except ImportError:
        app.run(host="0.0.0.0", port=PI_PORT)


if __name__ == "__main__":
    main()
