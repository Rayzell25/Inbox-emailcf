#!/usr/bin/env bash
# =====================================================================
#  Cloudflare Single Email Viewer — one-shot VPS installer
# ---------------------------------------------------------------------
#  Target: fresh Ubuntu / Debian server.
#  Usage : bash install.sh
#
#  This script will:
#    1) apt update && apt upgrade
#    2) install base packages (curl, git, nano, ca-certificates)
#    3) install Node.js + npm (for deploying the Email Worker)
#    4) install Docker Engine + Docker Compose plugin
#    5) create .env from .env.example (if missing)
#    6) build the app image and run it as a background container
#
#  Re-running is safe (idempotent): already-installed steps are skipped.
# =====================================================================

set -Eeuo pipefail

# ---------- pretty logging ----------
BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"
GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
RED="$(printf '\033[31m')"; CYAN="$(printf '\033[36m')"; RESET="$(printf '\033[0m')"

log()  { echo "${CYAN}==>${RESET} ${BOLD}$*${RESET}"; }
ok()   { echo "${GREEN}  ok${RESET} $*"; }
warn() { echo "${YELLOW}  ! ${RESET} $*"; }
err()  { echo "${RED}  x ${RESET} $*" >&2; }

on_error() {
  err "Instalasi gagal pada baris $1. Periksa pesan di atas lalu jalankan ulang: bash install.sh"
}
trap 'on_error $LINENO' ERR

# ---------- resolve project dir & privilege ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    err "Script ini butuh akses root. Jalankan sebagai root atau install 'sudo' dulu."
    exit 1
  fi
fi

# ---------- OS sanity check ----------
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*) : ;;
    *)
      warn "OS terdeteksi: ${PRETTY_NAME:-unknown}. Script ini ditujukan untuk Ubuntu/Debian; melanjutkan dengan asumsi apt tersedia."
      ;;
  esac
else
  warn "Tidak bisa membaca /etc/os-release; melanjutkan dengan asumsi Debian/Ubuntu."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  err "apt-get tidak ditemukan. Script ini hanya mendukung distribusi berbasis Debian/Ubuntu."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo
log "Cloudflare Single Email Viewer — installer"
echo "${DIM}Direktori proyek: ${SCRIPT_DIR}${RESET}"
echo

# ---------- 1) update & upgrade ----------
log "1/6 Memperbarui sistem (apt update & upgrade)"
$SUDO apt-get update -y
$SUDO apt-get upgrade -y
ok "Sistem diperbarui"

# ---------- 2) base packages ----------
log "2/6 Memasang paket dasar (curl, git, nano, ca-certificates, gnupg)"
$SUDO apt-get install -y curl git nano ca-certificates gnupg lsb-release
ok "Paket dasar terpasang"

# ---------- 3) Node.js + npm ----------
# Dibutuhkan untuk men-deploy Email Worker (npx wrangler) dari folder worker/.
install_node() {
  log "3/6 Memasang Node.js + npm (untuk deploy Email Worker)"
  local need=1
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
    if [ -n "${major:-}" ] && [ "$major" -ge 18 ]; then
      need=0
      ok "Node.js sudah terpasang ($(node -v), npm $(npm -v 2>/dev/null || echo '?'))"
    else
      warn "Node.js versi lama terdeteksi ($(node -v)); memasang Node 20."
    fi
  fi
  if [ "$need" -eq 1 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
    $SUDO bash /tmp/nodesource_setup.sh
    rm -f /tmp/nodesource_setup.sh
    $SUDO apt-get install -y nodejs
    ok "Node.js terpasang ($(node -v 2>/dev/null || echo '?'), npm $(npm -v 2>/dev/null || echo '?'))"
  fi
}
install_node

# ---------- 4) Docker + Compose ----------
install_docker() {
  log "4/6 Memasang Docker Engine + Docker Compose"
  if command -v docker >/dev/null 2>&1; then
    ok "Docker sudah terpasang ($(docker --version 2>/dev/null || echo 'versi tidak diketahui'))"
  else
    # Official convenience script (adds the Docker apt repo and installs
    # docker-ce, containerd, and the compose plugin).
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    $SUDO sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
    ok "Docker terpasang ($(docker --version 2>/dev/null || echo '?'))"
  fi

  # Ensure the daemon is enabled & running.
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl enable docker >/dev/null 2>&1 || true
    $SUDO systemctl start docker >/dev/null 2>&1 || true
  fi

  # Add the invoking (non-root) user to the docker group for convenience.
  if [ -n "${SUDO}" ] && [ -n "${USER:-}" ] && [ "${USER}" != "root" ]; then
    $SUDO usermod -aG docker "$USER" 2>/dev/null || true
    warn "User '$USER' ditambahkan ke grup docker. Logout/login ulang agar 'docker' bisa tanpa sudo."
  fi
}
install_docker

# Determine the compose command (plugin "docker compose" preferred).
COMPOSE=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif $SUDO docker compose version >/dev/null 2>&1; then
  COMPOSE="$SUDO docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  log "Memasang Docker Compose plugin"
  $SUDO apt-get install -y docker-compose-plugin
  COMPOSE="$SUDO docker compose"
fi
ok "Compose siap: ${COMPOSE}"

# Pick the docker invocation that actually has daemon access.
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
  COMPOSE="$SUDO docker compose"
fi

# ---------- 4) .env ----------
log "5/6 Menyiapkan konfigurasi (.env)"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    ok ".env dibuat dari .env.example"
    NEW_ENV=1
  else
    warn ".env.example tidak ditemukan; melewati pembuatan .env (app akan jalan mode demo)."
    NEW_ENV=0
  fi
else
  ok ".env sudah ada (tidak ditimpa)"
  NEW_ENV=0
fi

# ---------- 6) build & run ----------
log "6/6 Build image & menjalankan container (background)"
$COMPOSE up -d --build
ok "Container berjalan"

# ---------- summary ----------
PORT="$(grep -E '^PORT=' .env 2>/dev/null | head -n1 | cut -d= -f2 | tr -d '"' || true)"
PORT="${PORT:-3000}"

echo
echo "${GREEN}${BOLD}Selesai!${RESET} Aplikasi berjalan di port ${BOLD}${PORT}${RESET}."
echo
echo "  Cek status   : ${DIM}${COMPOSE} ps${RESET}"
echo "  Lihat log    : ${DIM}${COMPOSE} logs -f${RESET}"
echo "  Akses web    : ${DIM}http://<IP-VPS>:${PORT}${RESET}"
echo

if [ "${NEW_ENV:-0}" = "1" ]; then
  echo "${YELLOW}${BOLD}Langkah berikutnya (PENTING):${RESET}"
  echo "  Saat ini app berjalan dalam ${BOLD}mode demo${RESET} (kredensial belum diisi)."
  echo "  1) Edit konfigurasi : ${DIM}nano .env${RESET}"
  echo "     - isi NEXT_PUBLIC_SITE_NAME, NEXT_PUBLIC_THEME_COLOR"
  echo "     - isi CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID"
  echo "  2) Muat ulang       : ${DIM}${COMPOSE} up -d --force-recreate${RESET}"
  echo "     ${DIM}(restart biasa TIDAK memuat ulang nilai .env yang berubah)${RESET}"
  echo
  echo "  Lihat README bagian 4 untuk setup KV + Email Worker (agar email asli tampil)."
fi
echo
