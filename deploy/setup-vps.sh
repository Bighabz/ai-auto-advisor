#!/bin/bash
# ============================================================
# SAM VPS Setup Script — Fresh Ubuntu 22.04 Droplet
# Installs: Node 22, Chrome (deb), OpenClaw, systemd services
# Usage: scp deploy/setup-vps.sh root@<ip>:~ && ssh root@<ip> bash setup-vps.sh
# ============================================================

set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  SAM — VPS Setup (Ubuntu 22.04 + Residential Proxy)"
echo "═══════════════════════════════════════════════════════════"

# --- 1. System Updates ---
echo "[1/8] Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade -y -qq
apt-get install -y -qq curl git build-essential unzip jq gnupg ca-certificates

# --- 2. Node.js 22 LTS ---
echo "[2/8] Installing Node.js 22 LTS..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v)  NPM: $(npm -v)"

# --- 3. Google Chrome (deb, NOT Snap/Chromium) ---
echo "[3/8] Installing Google Chrome stable..."
if ! command -v google-chrome-stable &> /dev/null; then
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb || apt-get -f install -y -qq
  rm /tmp/chrome.deb
fi
echo "  Chrome: $(google-chrome-stable --version 2>/dev/null || echo 'installed')"

# --- 4. OpenClaw ---
echo "[4/8] Installing OpenClaw..."
if ! command -v openclaw &> /dev/null; then
  curl -fsSL https://openclaw.ai/install.sh | bash
fi
echo "  OpenClaw: $(openclaw --version 2>/dev/null | head -1 || echo 'installed')"

# --- 5. Clone/Update SAM Repository ---
echo "[5/8] Setting up SAM repository..."
SAM_DIR="/root/ai-auto-advisor"
if [ -d "$SAM_DIR/.git" ]; then
  echo "  Repo exists — pulling latest..."
  cd "$SAM_DIR" && git pull
else
  echo "  Cloning from GitHub..."
  cd /root
  git clone git@github.com:Bighabz/ai-auto-advisor.git || git clone https://github.com/Bighabz/ai-auto-advisor.git
fi

cd "$SAM_DIR"
echo "  Installing npm dependencies..."
npm install --production 2>&1 | tail -5
echo "  Dependencies installed"

# --- 6. OpenClaw Configuration ---
echo "[6/8] Configuring OpenClaw..."
mkdir -p /root/.openclaw/browser/openclaw/user-data

# Setup OpenClaw in local mode (skip if already configured)
if [ ! -f /root/.openclaw/openclaw.json ]; then
  openclaw onboard --mode local --non-interactive --accept-risk --auth-choice skip \
    --skip-channels --skip-skills --skip-ui --skip-health --workspace "$SAM_DIR" 2>/dev/null || true
fi
echo "  OpenClaw configured"

# --- 7. Install Systemd Services ---
echo "[7/8] Installing systemd services..."
cp "$SAM_DIR/deploy/services/openclaw-gateway.service" /etc/systemd/system/
cp "$SAM_DIR/deploy/services/sam-proxy.service" /etc/systemd/system/
cp "$SAM_DIR/deploy/services/openclaw-browser.service" /etc/systemd/system/
cp "$SAM_DIR/deploy/services/sam-telegram.service" /etc/systemd/system/

systemctl daemon-reload
systemctl enable openclaw-gateway sam-proxy openclaw-browser sam-telegram
echo "  Services installed: openclaw-gateway, sam-proxy, openclaw-browser, sam-telegram"

# --- 8. Firewall ---
echo "[8/8] Configuring firewall..."
ufw allow 22/tcp   # SSH
ufw --force enable
echo "  Firewall: SSH(22) only — Telegram uses outbound polling"

# --- Done ---
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  VPS Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Services installed (not yet started):"
echo "    - openclaw-gateway"
echo "    - sam-proxy (local proxy auth wrapper)"
echo "    - openclaw-browser (Chrome via proxy)"
echo "    - sam-telegram"
echo ""
echo "  Next steps:"
echo "  1. Deploy .env with PROXY_* credentials:"
echo "     scp config/.env root@\$(hostname -I | awk '{print \$1}'):$SAM_DIR/config/.env"
echo ""
echo "  2. Start services:"
echo "     systemctl start openclaw-gateway sam-proxy openclaw-browser sam-telegram"
echo ""
echo "  3. Check status:"
echo "     systemctl status openclaw-gateway sam-proxy openclaw-browser sam-telegram"
echo ""
echo "  4. Test proxy works:"
echo "     curl -x http://127.0.0.1:8888 -L https://my.alldata.com"
echo ""
echo "  5. Test E2E:"
echo "     cd $SAM_DIR && node scripts/test-e2e.js"
echo ""
