#!/bin/bash
# ============================================================
# SAM — DigitalOcean Droplet Provisioner
#
# Creates a droplet, uploads SSH key, runs setup, deploys SAM.
# Requires: doctl authenticated (doctl auth init)
#
# Usage: bash deploy/provision.sh
# ============================================================

set -euo pipefail

DROPLET_NAME="sam-prod"
REGION="sfo3"           # San Francisco (closest to us-west-2 Supabase)
SIZE="s-4vcpu-8gb"      # 8GB RAM, 4 vCPU ($48/mo)
IMAGE="ubuntu-22-04-x64"
SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"

echo "═══════════════════════════════════════════════════════════"
echo "  SAM — Provisioning DigitalOcean Droplet"
echo "═══════════════════════════════════════════════════════════"

# --- Check doctl auth ---
echo "[1/6] Checking doctl authentication..."
if ! doctl account get &>/dev/null; then
  echo "  ERROR: doctl not authenticated. Run: doctl auth init"
  exit 1
fi
ACCOUNT=$(doctl account get --format Email --no-header)
echo "  Authenticated as: $ACCOUNT"

# --- Upload SSH key if needed ---
echo "[2/6] Checking SSH key..."
SSH_KEY_FINGERPRINT=""
if [ -f "$SSH_KEY_PATH" ]; then
  KEY_NAME="sam-deploy-$(hostname)"
  # Check if key already exists
  EXISTING=$(doctl compute ssh-key list --format FingerPrint,Name --no-header | grep "$KEY_NAME" | awk '{print $1}' || true)
  if [ -n "$EXISTING" ]; then
    SSH_KEY_FINGERPRINT="$EXISTING"
    echo "  SSH key already on DO: $SSH_KEY_FINGERPRINT"
  else
    RESULT=$(doctl compute ssh-key create "$KEY_NAME" --public-key "$(cat $SSH_KEY_PATH)" --format FingerPrint --no-header 2>&1)
    SSH_KEY_FINGERPRINT="$RESULT"
    echo "  SSH key uploaded: $SSH_KEY_FINGERPRINT"
  fi
else
  echo "  WARNING: No SSH key at $SSH_KEY_PATH"
  echo "  Droplet will use password auth (check email)"
fi

# --- Check if droplet already exists ---
echo "[3/6] Checking for existing droplet..."
EXISTING_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep "^$DROPLET_NAME " | awk '{print $2}' || true)
if [ -n "$EXISTING_IP" ]; then
  echo "  Droplet '$DROPLET_NAME' already exists at $EXISTING_IP"
  echo "  To recreate, run: doctl compute droplet delete $DROPLET_NAME --force"
  DROPLET_IP="$EXISTING_IP"
else
  # --- Create droplet ---
  echo "[4/6] Creating droplet: $DROPLET_NAME ($SIZE in $REGION)..."

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

  # Get the IP
  sleep 5
  DROPLET_IP=$(doctl compute droplet list --format Name,PublicIPv4 --no-header | grep "^$DROPLET_NAME " | awk '{print $2}')
  echo "  Droplet created: $DROPLET_IP"
fi

echo ""
echo "[5/6] Waiting for SSH to be ready..."
for i in {1..30}; do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@"$DROPLET_IP" "echo ok" &>/dev/null; then
    echo "  SSH ready!"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 10
done

# --- Run setup ---
echo "[6/6] Running setup on droplet..."
scp -o StrictHostKeyChecking=no deploy/setup-vps.sh root@"$DROPLET_IP":/root/setup-vps.sh
ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" "bash /root/setup-vps.sh"

# --- Copy .env if exists locally ---
ENV_FILE="config/.env"
if [ -f "$ENV_FILE" ]; then
  echo ""
  echo "  Copying .env to droplet..."
  scp -o StrictHostKeyChecking=no "$ENV_FILE" root@"$DROPLET_IP":/home/sam/ai-auto-advisor/config/.env
  ssh -o StrictHostKeyChecking=no root@"$DROPLET_IP" "chown sam:sam /home/sam/ai-auto-advisor/config/.env && chmod 600 /home/sam/ai-auto-advisor/config/.env"
  echo "  .env deployed (permissions: 600)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Provisioning Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Droplet: $DROPLET_NAME"
echo "  IP:      $DROPLET_IP"
echo "  SSH:     ssh root@$DROPLET_IP"
echo ""
echo "  Run E2E test:"
echo "    ssh root@$DROPLET_IP 'cd /home/sam/ai-auto-advisor && su sam -c \"node scripts/test-e2e.js\"'"
echo ""
echo "  Monthly cost: ~\$48/mo (s-4vcpu-8gb)"
echo ""
