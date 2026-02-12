#!/bin/bash
# ============================================================
# SAM — DigitalOcean Droplet Provisioner
#
# Creates a droplet, runs setup, deploys .env with proxy,
# starts services, and runs tests.
#
# Requires: doctl authenticated (doctl auth init)
# Usage: bash deploy/provision.sh
# ============================================================

set -euo pipefail

DROPLET_NAME="sam-prod"
REGION="sfo3"           # San Francisco (closest to us-west-2 Supabase)
SIZE="s-4vcpu-8gb"      # 8GB RAM, 4 vCPU ($48/mo)
IMAGE="ubuntu-22-04-x64"
SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══════════════════════════════════════════════════════════"
echo "  SAM — Provisioning DigitalOcean Droplet"
echo "═══════════════════════════════════════════════════════════"

# --- Pre-flight checks ---
echo "[0/8] Pre-flight checks..."

# Check doctl
if ! doctl account get &>/dev/null; then
  echo "  ERROR: doctl not authenticated. Run: doctl auth init"
  exit 1
fi
ACCOUNT=$(doctl account get --format Email --no-header)
echo "  doctl: $ACCOUNT"

# Check .env exists
ENV_FILE="$LOCAL_DIR/config/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "  ERROR: No .env file at $ENV_FILE"
  echo "  Create it with your credentials including RESIDENTIAL_PROXY_URL"
  exit 1
fi
echo "  .env: exists"

# Check proxy config in .env
if ! grep -q "PROXY_HOST=" "$ENV_FILE"; then
  echo "  WARNING: PROXY_HOST not in .env — platforms may be blocked"
else
  echo "  proxy: configured"
fi

# --- Upload SSH key if needed ---
echo "[1/8] Checking SSH key..."
SSH_KEY_FINGERPRINT=""
if [ -f "$SSH_KEY_PATH" ]; then
  # Get first available SSH key from account (simpler approach)
  SSH_KEY_FINGERPRINT=$(doctl compute ssh-key list --format FingerPrint --no-header | head -1)
  if [ -n "$SSH_KEY_FINGERPRINT" ]; then
    echo "  Using SSH key: $SSH_KEY_FINGERPRINT"
  else
    # Try to upload if no keys exist
    KEY_NAME="sam-deploy-$(hostname)"
    RESULT=$(doctl compute ssh-key create "$KEY_NAME" --public-key "$(cat $SSH_KEY_PATH)" --format FingerPrint --no-header 2>&1 || true)
    if [ -n "$RESULT" ] && [[ ! "$RESULT" =~ "Error" ]]; then
      SSH_KEY_FINGERPRINT="$RESULT"
      echo "  SSH key uploaded: $SSH_KEY_FINGERPRINT"
    else
      echo "  WARNING: Could not upload SSH key"
    fi
  fi
else
  echo "  WARNING: No SSH key at $SSH_KEY_PATH"
fi

# --- Check if droplet already exists ---
echo "[2/8] Checking for existing droplet..."
EXISTING_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep "^$DROPLET_NAME " | awk '{print $2}' || true)
if [ -n "$EXISTING_IP" ]; then
  echo "  Droplet '$DROPLET_NAME' exists at $EXISTING_IP"
  read -p "  Delete and recreate? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    doctl compute droplet delete "$DROPLET_NAME" --force
    echo "  Deleted. Waiting 10s..."
    sleep 10
    EXISTING_IP=""
  else
    echo "  Using existing droplet"
    DROPLET_IP="$EXISTING_IP"
  fi
fi

if [ -z "${DROPLET_IP:-}" ]; then
  # --- Create droplet ---
  echo "[3/8] Creating droplet: $DROPLET_NAME ($SIZE in $REGION)..."

  SSH_KEYS_ARG=""
  if [ -n "$SSH_KEY_FINGERPRINT" ]; then
    SSH_KEYS_ARG="--ssh-keys $SSH_KEY_FINGERPRINT"
  fi

  doctl compute droplet create "$DROPLET_NAME" \
    --image "$IMAGE" \
    --size "$SIZE" \
    --region "$REGION" \
    $SSH_KEYS_ARG \
    --wait \
    --format ID,Name,PublicIPv4,Status \
    --no-header

  sleep 5
  DROPLET_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep "^$DROPLET_NAME " | awk '{print $2}')
  echo "  Created: $DROPLET_IP"
fi

# --- Wait for SSH ---
echo "[4/8] Waiting for SSH to be ready..."
for i in {1..30}; do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@"$DROPLET_IP" "echo ok" &>/dev/null; then
    echo "  SSH ready!"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 10
done

# --- Deploy code first (for setup-vps.sh to use) ---
echo "[5/8] Deploying code to droplet..."

# Create GitHub deploy key if needed
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" bash << 'EOF'
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -q
  echo "GitHub Deploy Key (add to repo Settings > Deploy keys):"
  cat /root/.ssh/id_ed25519.pub
  echo ""
  echo "After adding, press Enter to continue..."
  read
fi

# Configure git to accept github.com
if ! grep -q "github.com" /root/.ssh/known_hosts 2>/dev/null; then
  ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null
fi
EOF

# Copy the setup script and services
scp -o StrictHostKeyChecking=no "$LOCAL_DIR/deploy/setup-vps.sh" root@"$DROPLET_IP":/root/setup-vps.sh
scp -o StrictHostKeyChecking=no -r "$LOCAL_DIR/deploy/services" root@"$DROPLET_IP":/root/services-tmp

# --- Run setup ---
echo "[6/8] Running VPS setup..."
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" "bash /root/setup-vps.sh"

# --- Deploy .env ---
echo "[7/8] Deploying .env with proxy config..."
scp -o StrictHostKeyChecking=no "$ENV_FILE" root@"$DROPLET_IP":/root/ai-auto-advisor/config/.env
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" "chmod 600 /root/ai-auto-advisor/config/.env"
echo "  .env deployed"

# --- Start services and test ---
echo "[8/8] Starting services and testing..."
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" bash << 'EOF'
# Start services in order
systemctl start openclaw-gateway
sleep 2
systemctl start sam-proxy
sleep 2
systemctl start openclaw-browser
sleep 3
systemctl start sam-telegram

echo "  Services started"

# Check status
systemctl is-active --quiet openclaw-gateway && echo "  ✓ openclaw-gateway running" || echo "  ✗ openclaw-gateway failed"
systemctl is-active --quiet sam-proxy && echo "  ✓ sam-proxy running" || echo "  ✗ sam-proxy failed"
systemctl is-active --quiet openclaw-browser && echo "  ✓ openclaw-browser running" || echo "  ✗ openclaw-browser failed"
systemctl is-active --quiet sam-telegram && echo "  ✓ sam-telegram running" || echo "  ✗ sam-telegram failed"

# Test proxy through local wrapper
source /root/ai-auto-advisor/config/.env
if [ -n "${PROXY_HOST:-}" ]; then
  echo ""
  echo "  Testing proxy access to AllData..."
  sleep 2  # Let proxy stabilize
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -x "http://127.0.0.1:8888" -L --max-time 20 https://my.alldata.com 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  ✓ AllData accessible (200) through proxy"
  else
    echo "  ✗ AllData returned $HTTP_CODE — check proxy credentials"
  fi
fi

# Run E2E test
echo ""
echo "  Running E2E test..."
cd /root/ai-auto-advisor
node scripts/test-e2e.js 2>&1 | tail -15
EOF

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Provisioning Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Droplet: $DROPLET_NAME"
echo "  IP:      $DROPLET_IP"
echo "  SSH:     ssh root@$DROPLET_IP"
echo ""
echo "  Services:"
echo "    systemctl status openclaw-gateway sam-proxy openclaw-browser sam-telegram"
echo ""
echo "  Logs:"
echo "    journalctl -u sam-telegram -f"
echo "    tail -f /var/log/syslog | grep telegram"
echo ""
echo "  Test Telegram:"
echo "    Send \"2019 Honda Civic P0420\" to @hillsideautobot"
echo ""
echo "  Cost: ~\$48/mo (droplet) + ~\$5/mo (proxy) = ~\$53/mo"
echo ""

# Save IP for reference
echo "$DROPLET_IP" > "$LOCAL_DIR/.droplet-ip"
echo "  IP saved to .droplet-ip"
