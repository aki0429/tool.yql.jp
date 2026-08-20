#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/opt/rivercam-alert-recorder"
SERVICE="/etc/systemd/system/rivercam-alert-recorder.service"
if [[ $EUID -ne 0 ]]; then echo "sudo $0 で実行してください" >&2; exit 1; fi
mkdir -p "$INSTALL_DIR"
cp -a "$SOURCE_DIR"/. "$INSTALL_DIR"/
[[ -f "$INSTALL_DIR/config.json" ]] || cp "$INSTALL_DIR/config.example.json" "$INSTALL_DIR/config.json"
cat > "$SERVICE" <<'EOF'
[Unit]
Description=RiverCam Alert Recorder
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=kuroi
WorkingDirectory=/opt/rivercam-alert-recorder
ExecStart=/usr/bin/node /opt/rivercam-alert-recorder/src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
EOF
chown -R kuroi:kuroi "$INSTALL_DIR"
systemctl daemon-reload
systemctl enable --now rivercam-alert-recorder.service
systemctl --no-pager --full status rivercam-alert-recorder.service
