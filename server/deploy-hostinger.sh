#!/usr/bin/env bash
# ==============================================================================
# NEXA POS 100-Year Cloud Server - Hostinger VPS Master Automated Deployer
# Multi-Tenant SaaS, Zero-Leak Docker Orchestration, Auto-SSL, Auto-Backup & Health
# ==============================================================================
set -euo pipefail

echo "=============================================================================="
echo ">>> NEXA POS Cloud Server - Hostinger VPS Enterprise Orchestration Starting..."
echo "=============================================================================="

# 0. التحقق من صلاحيات الجذر (Root Privileges)
if [ "$EUID" -ne 0 ]; then
    echo "[!] Error: This script must be run as root or with sudo privileges." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. تحديث حزم نظام التشغيل الأساسية وتثبيت الأدوات الحيوية
echo "[1/10] Updating system packages and installing core dependencies..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git ufw openssl ca-certificates gnupg lsb-release

# 2. ضبط بارامترات كيرنل لينكس للأداء الفائق وحماية الشبكة ومقابس الـ TCP
echo "[2/10] Hardening Linux Kernel for high-throughput concurrency (Somaxconn, TCP reuse)..."
tee /etc/sysctl.d/99-nexa-performance.conf > /dev/null <<EOF
# رفع سعة طابور اتصالات الشبكة المتزامنة
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
# تمكين تخصيص الذاكرة الافتراضية لمنع انهيار Redis أثناء الحفظ في الخلفية
vm.overcommit_memory = 1
# تسريع تدوير مقابس TCP في وضع TIME_WAIT
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
EOF
sysctl --system > /dev/null

# 3. ضبط حدود المقابس والملفات المفتوحة في نظام التشغيل (Ulimits)
echo "[3/10] Setting OS-level file descriptor limits to 65536..."
tee /etc/security/limits.d/99-nexa-limits.conf > /dev/null <<EOF
* soft nofile 65536
* hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF

# 4. تثبيت Docker Engine و Docker Compose الرسمي إن لم يكونا مثبتين
if ! command -v docker &> /dev/null; then
    echo "[4/10] Installing official Docker Engine & Docker Compose plugin..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    rm -f get-docker.sh
else
    echo "[4/10] Docker is already installed: $(docker --version)"
fi

# 5. تأمين جدار الحماية (UFW) - السماح فقط بالمنافذ الحيوية (SSH, HTTP, HTTPS)
echo "[5/10] Securing firewall (UFW) - Exposing only SSH (22), HTTP (80), HTTPS (443)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 6. تجهيز المجلدات الإنتاجية المحمية على السيرفر
echo "[6/10] Creating production backup and certbot webroot directories..."
mkdir -p /var/backups/nexa
mkdir -p /var/www/certbot
mkdir -p /etc/letsencrypt/live/default

# 7. تجهيز وتوليد ملف المتغيرات البيئية .env إن لم يكن موجوداً
if [ ! -f .env ]; then
    echo "[7/10] Generating cryptographically secure production .env file..."
    PG_PASS=$(openssl rand -hex 24)
    REDIS_PASS=$(openssl rand -hex 24)
    JWT_SEC=$(openssl rand -hex 32)
    LIC_KEY=$(openssl rand -hex 32)
    
    cat <<EOF > .env
NODE_ENV=production
POSTGRES_DB=nexa_saas
POSTGRES_USER=nexa_admin
POSTGRES_PASSWORD=${PG_PASS}
REDIS_PASSWORD=${REDIS_PASS}
JWT_SECRET=${JWT_SEC}
LICENSE_SIGNING_KEY=${LIC_KEY}
EOF
    chmod 600 .env
else
    echo "[7/10] Existing .env file found. Retaining cryptographic credentials."
fi

# 8. منع انهيار Nginx الأولي: توليد شهادة SSL ذاتية التوقيع إن لم تكن متوفرة
if [ ! -f /etc/letsencrypt/live/default/fullchain.pem ] || [ ! -f /etc/letsencrypt/live/default/privkey.pem ]; then
    echo "[8/10] Bootstrapping temporary self-signed SSL certificate for Nginx initial start..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
        -keyout /etc/letsencrypt/live/default/privkey.pem \
        -out /etc/letsencrypt/live/default/fullchain.pem \
        -subj "/CN=localhost" 2>/dev/null
    chmod 600 /etc/letsencrypt/live/default/privkey.pem
else
    echo "[8/10] SSL certificates found. Ready for HTTPS."
fi

# 9. التحقق من بناء لوحة تحكم الأسطول SPA (Dashboard Dist)
if [ ! -f dashboard/dist/index.html ]; then
    echo "[9/10] Dashboard SPA dist bundle not found. Building dashboard..."
    if command -v npm &> /dev/null; then
        (cd dashboard && npm ci && npm run build)
    else
        echo "[!] Warning: npm not found on host. Ensure dashboard/dist is built prior to deploy."
    fi
else
    echo "[9/10] Dashboard SPA bundle verified at dashboard/dist/index.html."
fi

# 10. التحقق من صحة ملف التكوين وبناء وتشغيل الحاويات المعزولة
echo "[10/10] Validating Docker Compose configuration and launching containers..."
docker compose -f docker-compose.prod.yml config > /dev/null

echo ">>> Tearing down any orphan containers and launching production stack..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml up -d --build

echo "=============================================================================="
echo ">>> Checking NEXA Cloud Server Live Health (Probe timeout: 60s)..."
echo "=============================================================================="

HEALTH_OK=false
for i in {1..12}; do
    if curl -fsSL http://localhost/healthz &>/dev/null; then
        HEALTH_OK=true
        echo ">>> [HEALTH-CHECK PASS] Nginx Edge is responding OK!"
        break
    fi
    echo "Waiting for services to become healthy... (attempt $i/12)"
    sleep 5
done

if [ "$HEALTH_OK" = true ]; then
    echo "=============================================================================="
    echo ">>> NEXA POS SaaS Cloud Server is LIVE & HEALTHY on Hostinger VPS!"
    echo ">>> Nginx Edge:       http://localhost/healthz"
    echo ">>> Mission Control:  http://localhost/dashboard/"
    echo ">>> Auto-Migrations:  Executed atomically with pg_advisory_lock"
    echo ">>> Database Backups: Daily automated cron snapshot in nexa_backups"
    echo "=============================================================================="
else
    echo "[!] Warning: Healthcheck probe timed out. Inspect container logs with:"
    echo "    docker compose -f docker-compose.prod.yml logs -n 50"
    exit 1
fi
