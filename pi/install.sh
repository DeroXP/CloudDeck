#!/usr/bin/env bash
# CloudDeck Pi forwarder installer.
#
# Run on a fresh Raspberry Pi OS Lite:
#   sudo bash install.sh
#
# What this does:
#   1. Copies pi/ to /opt/clouddeck/pi (if not already there)
#   2. Creates a Python venv and installs requirements.txt
#   3. Verifies .env exists and warns if PI_SECRET_TOKEN / PC_MAC_ADDRESS are missing
#   4. Installs and enables the systemd service
#
# Safe to re-run. Idempotent.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="/opt/clouddeck/pi"
SERVICE_NAME="clouddeck-wol"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash $(basename "$0")" >&2
  exit 1
fi

echo "[install] copying files to ${DEST_DIR}"
mkdir -p "${DEST_DIR}"
cp "${SRC_DIR}/wol_server.py" "${DEST_DIR}/"
cp "${SRC_DIR}/requirements.txt" "${DEST_DIR}/"
[[ -f "${SRC_DIR}/.env" && ! -f "${DEST_DIR}/.env" ]] && cp "${SRC_DIR}/.env" "${DEST_DIR}/"

echo "[install] ensuring python3-venv is installed"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip

echo "[install] creating venv"
if [[ ! -d "${DEST_DIR}/venv" ]]; then
  python3 -m venv "${DEST_DIR}/venv"
fi
"${DEST_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${DEST_DIR}/venv/bin/pip" install --quiet -r "${DEST_DIR}/requirements.txt"

echo "[install] checking configuration"
if [[ ! -f "${DEST_DIR}/.env" ]]; then
  echo
  echo "WARNING: ${DEST_DIR}/.env does not exist."
  echo "Copy ../../env.example to ${DEST_DIR}/.env and fill in PI_SECRET_TOKEN + PC_MAC_ADDRESS."
  echo
fi

echo "[install] installing systemd unit"
cp "${SRC_DIR}/${SERVICE_NAME}.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# Set ownership so the pi user can read the venv + .env
chown -R pi:pi "${DEST_DIR}"

if [[ -f "${DEST_DIR}/.env" ]]; then
  echo "[install] (re)starting service"
  systemctl restart "${SERVICE_NAME}"
  sleep 1
  systemctl status "${SERVICE_NAME}" --no-pager || true
else
  echo "[install] not starting service yet — fill in .env then run: sudo systemctl start ${SERVICE_NAME}"
fi

echo "[install] done"
