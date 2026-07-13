#!/usr/bin/env bash
#
# provision.sh — idempotent VPS provisioning for Stellar Shield.
#
# Automates the manual rollout in deploy/README.md. Fresh Ubuntu LTS, run as
# root. Build happens in CI (never on the box): this installs deps so
# `next start` runs, but does NOT run `next build`. NEXT_PUBLIC_* build vars do
# not belong here.
#
# Two tiers (see deploy/README.md):
#   web    -> user `deploy`, Bun, Caddy (TLS + reverse proxy), stellar-shield.service,
#             sudoers so CI can restart without a password.
#   keeper -> user `keeper`, Bun, keeper .service + .timer, root-owned chmod-600
#             env at /etc/stellar-shield/keeper.env (holds hot keys — never clobbered).
#
# Safe to re-run. See --help.

set -euo pipefail

# --- Resolve where the deploy/ files live (this script's dir) ---
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# --- Constants that match the existing deploy files byte-for-byte ---
APP_DIR="/srv/stellar-shield"            # git checkout lives in $APP_DIR/current
APP_CHECKOUT="${APP_DIR}/current"
KEEPER_ENV_DIR="/etc/stellar-shield"
KEEPER_ENV="${KEEPER_ENV_DIR}/keeper.env"
CADDYFILE="/etc/caddy/Caddyfile"
SUDOERS_FILE="/etc/sudoers.d/stellar-shield-deploy"
DEFAULT_REPO_URL="git@github.com:Whit3knight/StellarShield.git"

# --- Defaults / flags ---
ROLE=""
DOMAIN=""
REPO_URL=""
BRANCH="main"
APP_USER="deploy"
KEEPER_USER="keeper"
DRY_RUN=0

# --- Colored logging (guarded when there's no tty / no tput) ---
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ -n "$(tput colors 2>/dev/null || echo)" ]]; then
	C_BOLD="$(tput bold)"; C_BLUE="$(tput setaf 4)"; C_GREEN="$(tput setaf 2)"
	C_YELLOW="$(tput setaf 3)"; C_RED="$(tput setaf 1)"; C_RESET="$(tput sgr0)"
else
	C_BOLD=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

step() { printf '%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

usage() {
	cat <<EOF
${C_BOLD}provision.sh${C_RESET} — idempotent VPS provisioning for Stellar Shield.

Fresh Ubuntu LTS, run as root. Safe to re-run.

${C_BOLD}Usage:${C_RESET}
  sudo bash deploy/provision.sh --role web    --domain shield.example.com
  sudo bash deploy/provision.sh --role keeper
  sudo bash deploy/provision.sh --role all    --domain shield.example.com

${C_BOLD}Flags:${C_RESET}
  --role web|keeper|all   (required) which tier to provision
  --domain <d>            (required for web/all) domain Caddy serves TLS for
  --repo-url <url>        git remote to clone   (default: origin, else placeholder)
  --branch <b>            branch to check out   (default: ${BRANCH})
  --app-user <u>          web app user          (default: ${APP_USER})
  --keeper-user <u>       keeper user           (default: ${KEEPER_USER})
  --dry-run               print privileged actions instead of running them
  --help                  this help

Build runs in CI, not here. This installs deps for \`next start\`; it never runs
\`next build\`. NEXT_PUBLIC_* build vars do not belong on the box.
EOF
}

# --- run(): every privileged / mutating action goes through this so --dry-run
#     can print it instead of executing. Read-only checks call binaries directly. ---
run() {
	if [[ "$DRY_RUN" -eq 1 ]]; then
		printf '%s[dry-run]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"
	else
		"$@"
	fi
}

# run_user(): run a command as another (unprivileged) user with their login env,
# routed through run() for dry-run support.
run_user() {
	local u="$1"; shift
	run sudo -u "$u" -H bash -lc "$*"
}

# --- Parse flags robustly ---
while [[ $# -gt 0 ]]; do
	case "$1" in
		--role)        ROLE="${2:-}"; shift 2 ;;
		--role=*)      ROLE="${1#*=}"; shift ;;
		--domain)      DOMAIN="${2:-}"; shift 2 ;;
		--domain=*)    DOMAIN="${1#*=}"; shift ;;
		--repo-url)    REPO_URL="${2:-}"; shift 2 ;;
		--repo-url=*)  REPO_URL="${1#*=}"; shift ;;
		--branch)      BRANCH="${2:-}"; shift 2 ;;
		--branch=*)    BRANCH="${1#*=}"; shift ;;
		--app-user)    APP_USER="${2:-}"; shift 2 ;;
		--app-user=*)  APP_USER="${1#*=}"; shift ;;
		--keeper-user) KEEPER_USER="${2:-}"; shift 2 ;;
		--keeper-user=*) KEEPER_USER="${1#*=}"; shift ;;
		--dry-run)     DRY_RUN=1; shift ;;
		-h|--help)     usage; exit 0 ;;
		*)             usage; die "unknown argument: $1" ;;
	esac
done

# --- Validate ---
[[ "$(id -u)" -eq 0 ]] || die "must run as root (try: sudo bash deploy/provision.sh ...)"

case "$ROLE" in
	web|keeper|all) ;;
	"") usage; die "--role is required" ;;
	*)  die "--role must be one of: web, keeper, all (got: $ROLE)" ;;
esac

if [[ "$ROLE" == "web" || "$ROLE" == "all" ]]; then
	[[ -n "$DOMAIN" ]] || die "--domain is required for role '$ROLE'"
fi

# Default repo URL: prefer the origin remote if this is a checkout, else placeholder.
if [[ -z "$REPO_URL" ]]; then
	REPO_URL="$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || true)"
	[[ -n "$REPO_URL" ]] || REPO_URL="$DEFAULT_REPO_URL"
fi

for f in stellar-shield.service stellar-shield-keeper.service stellar-shield-keeper.timer keeper.env.example Caddyfile; do
	[[ -f "${SCRIPT_DIR}/${f}" ]] || die "missing expected deploy file: ${SCRIPT_DIR}/${f}"
done

step "Plan"
info "role=${ROLE}  domain=${DOMAIN:-n/a}  branch=${BRANCH}"
info "repo=${REPO_URL}"
info "app-user=${APP_USER}  keeper-user=${KEEPER_USER}  dry-run=${DRY_RUN}"

# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

ensure_user() {
	# $1 user, $2 extra useradd args. -m gives a home dir (Bun installs there).
	local u="$1"; shift
	if id -u "$u" >/dev/null 2>&1; then
		ok "user '$u' already exists"
	else
		step "Create user '$u'"
		run useradd "$@" "$u"
	fi
}

ensure_bun() {
	# Install Bun as the target user (lands in ~user/.bun/bin). Skip if present.
	local u="$1"
	local home; home="$(getent passwd "$u" | cut -d: -f6)"
	if [[ -x "${home}/.bun/bin/bun" ]]; then
		ok "Bun already installed for '$u'"
	else
		step "Install Bun for '$u'"
		run_user "$u" 'curl -fsSL https://bun.sh/install | bash'
	fi
}

seed_repo() {
	# Clone or update the app checkout as the owning user.
	local u="$1"
	step "Seed repo at ${APP_CHECKOUT} (branch ${BRANCH}) as '$u'"
	run install -d -o "$u" -g "$u" -m 755 "$APP_DIR"
	if [[ -d "${APP_CHECKOUT}/.git" ]]; then
		info "checkout exists — fetch + checkout + pull"
		run_user "$u" "cd '${APP_CHECKOUT}' && git fetch origin && git checkout '${BRANCH}' && git pull --ff-only origin '${BRANCH}'"
	else
		# install -d makes the parent; git clone needs the target empty/absent.
		run_user "$u" "git clone --branch '${BRANCH}' '${REPO_URL}' '${APP_CHECKOUT}'"
	fi
	step "Install dependencies (bun install --frozen-lockfile) — NOT a build"
	run_user "$u" "cd '${APP_CHECKOUT}' && \$HOME/.bun/bin/bun install --frozen-lockfile"
}

install_unit() {
	# Copy a systemd unit from the repo into /etc/systemd/system if changed.
	local name="$1"
	local src="${SCRIPT_DIR}/${name}" dst="/etc/systemd/system/${name}"
	if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
		ok "unit ${name} up to date"
	else
		step "Install systemd unit ${name}"
		run install -m 644 "$src" "$dst"
	fi
}

apt_update_once() {
	if [[ "${_APT_UPDATED:-0}" -eq 0 ]]; then
		step "apt-get update"
		run apt-get update -y
		_APT_UPDATED=1
	fi
}

# ---------------------------------------------------------------------------
# Base packages + Caddy repo (idempotent)
# ---------------------------------------------------------------------------

step "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt_update_once
run apt-get install -y ca-certificates curl git ufw gnupg debian-keyring debian-archive-keyring apt-transport-https

install_caddy() {
	# Official Caddy apt repo — add only if the list file is absent (idempotent).
	if command -v caddy >/dev/null 2>&1 && [[ -f /etc/apt/sources.list.d/caddy-stable.list ]]; then
		ok "Caddy already installed from official repo"
		return
	fi
	if [[ ! -f /etc/apt/sources.list.d/caddy-stable.list ]]; then
		step "Add official Caddy apt repo"
		run bash -c 'curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg'
		run bash -c 'curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" > /etc/apt/sources.list.d/caddy-stable.list'
		run apt-get update -y
	fi
	step "Install Caddy"
	run apt-get install -y caddy
}

# ---------------------------------------------------------------------------
# Firewall — allow 22 BEFORE enabling so we never drop our own SSH session.
# ---------------------------------------------------------------------------

configure_ufw() {
	step "Firewall (ufw): allow 22/80/443, then enable"
	run ufw allow 22/tcp
	run ufw allow 80/tcp
	run ufw allow 443/tcp
	if ufw status 2>/dev/null | grep -q "Status: active"; then
		ok "ufw already active"
	else
		warn "enabling ufw — 22/tcp is already allowed above, so your SSH session survives"
		run bash -c 'ufw --force enable'
	fi
}

# ---------------------------------------------------------------------------
# Web tier
# ---------------------------------------------------------------------------

provision_web() {
	ensure_user "$APP_USER" -m -s /bin/bash
	ensure_bun "$APP_USER"
	seed_repo "$APP_USER"

	install_caddy

	# Caddyfile: template the domain onto a copy each run (never edit the repo file
	# in place). The repo Caddyfile has a literal `example.com` to replace.
	step "Install Caddyfile for ${DOMAIN}"
	if [[ "$DRY_RUN" -eq 1 ]]; then
		printf '%s[dry-run]%s sed s/example.com/%s/ %s > %s\n' \
			"$C_YELLOW" "$C_RESET" "$DOMAIN" "${SCRIPT_DIR}/Caddyfile" "$CADDYFILE"
	else
		install -d -m 755 /etc/caddy
		sed "s/example\.com/${DOMAIN}/g" "${SCRIPT_DIR}/Caddyfile" > "$CADDYFILE"
		ok "wrote ${CADDYFILE}"
	fi
	run systemctl reload caddy || run systemctl restart caddy

	install_unit stellar-shield.service
	run systemctl daemon-reload
	run systemctl enable --now stellar-shield.service

	# Sudoers so CI can restart the app without a password. Write to a file in
	# /etc/sudoers.d/ and validate with visudo -c before it goes live.
	step "Install sudoers rule for '$APP_USER'"
	local sudo_line="${APP_USER} ALL=(root) NOPASSWD: /bin/systemctl restart stellar-shield"
	if [[ "$DRY_RUN" -eq 1 ]]; then
		printf '%s[dry-run]%s write %s: %s (validated via visudo -c)\n' \
			"$C_YELLOW" "$C_RESET" "$SUDOERS_FILE" "$sudo_line"
	else
		local tmp; tmp="$(mktemp)"
		printf '%s\n' "$sudo_line" > "$tmp"
		chmod 440 "$tmp"
		if visudo -cf "$tmp" >/dev/null; then
			install -m 440 "$tmp" "$SUDOERS_FILE"
			rm -f "$tmp"
			ok "wrote ${SUDOERS_FILE}"
		else
			rm -f "$tmp"
			die "sudoers line failed visudo validation — not installed"
		fi
	fi

	configure_ufw
}

# ---------------------------------------------------------------------------
# Keeper tier
# ---------------------------------------------------------------------------

provision_keeper() {
	# -r = system account (no login shell needed for a timer-driven one-shot),
	# but -m so Bun has a home to install into (units reference %h/.bun/bin).
	ensure_user "$KEEPER_USER" -r -m -s /usr/sbin/nologin
	ensure_bun "$KEEPER_USER"
	seed_repo "$KEEPER_USER"

	# Env file: root-owned, chmod 600, seeded from the template. NEVER overwrite —
	# it holds hot keys once an operator fills it in.
	step "Keeper env at ${KEEPER_ENV}"
	run install -d -m 755 "$KEEPER_ENV_DIR"
	if [[ -f "$KEEPER_ENV" ]]; then
		ok "${KEEPER_ENV} already exists — left untouched (holds hot keys)"
	else
		run install -m 600 -o root -g root "${SCRIPT_DIR}/keeper.env.example" "$KEEPER_ENV"
		warn "seeded ${KEEPER_ENV} from template — edit it to add contract id + hot keys"
	fi

	install_unit stellar-shield-keeper.service
	install_unit stellar-shield-keeper.timer
	run systemctl daemon-reload
	# Enable the timer, but do NOT start it — the operator must fill the env first.
	run systemctl enable stellar-shield-keeper.timer

	# Keeper box still wants a firewall. It's outbound-only (no 80/443 needed) but
	# configure_ufw keeps 22 open and is harmless if those ports are unused.
	configure_ufw
}

# ---------------------------------------------------------------------------
# Drive it
# ---------------------------------------------------------------------------

case "$ROLE" in
	web)    provision_web ;;
	keeper) provision_keeper ;;
	all)
		# Co-located web + keeper. README warns: acceptable on testnet only —
		# a hot key on a web-facing box widens the blast radius.
		warn "role 'all' co-locates the keeper's HOT KEYS on the web tier — testnet only"
		provision_web
		provision_keeper
		;;
esac

# ---------------------------------------------------------------------------
# Next steps + hardening reminder
# ---------------------------------------------------------------------------

printf '\n%s%s Provisioning complete (role: %s)%s\n' "$C_GREEN" "$C_BOLD" "$ROLE" "$C_RESET"

echo
step "NEXT STEPS"

if [[ "$ROLE" == "web" || "$ROLE" == "all" ]]; then
	cat <<EOF
  ${C_BOLD}web tier${C_RESET}
    1. Point DNS for ${DOMAIN} at this box (Cloudflare: orange proxy ON caches the zkeys).
    2. Set CI secrets/vars (see deploy/README.md step 10), then run the GitHub
       ${C_BOLD}Deploy${C_RESET} workflow (Actions -> Deploy -> Run) — it builds in CI, rsyncs, restarts.
    3. Sudoers is installed (${SUDOERS_FILE}) so CI restarts stellar-shield without a password.
    4. Caddy auto-provisions + auto-renews TLS once DNS resolves.
EOF
fi

if [[ "$ROLE" == "keeper" || "$ROLE" == "all" ]]; then
	cat <<EOF
  ${C_BOLD}keeper tier${C_RESET}
    1. Edit ${C_BOLD}${KEEPER_ENV}${C_RESET} (root, chmod 600) — set contract id, RPC, and HOT KEYS.
    2. Start the timer:  ${C_BOLD}systemctl start stellar-shield-keeper.timer${C_RESET}
    3. Logs:  journalctl -u stellar-shield-keeper
    (Drop --trigger from the service for read-only watchlist mode.)
EOF
fi

echo
warn "HARDENING REMINDER (not done by this script, to avoid locking you out):"
warn "  - add your SSH pubkey, then disable root login + password auth in sshd_config"
warn "  - enable unattended-upgrades for security patches"
warn "  - keeper hot keys belong on a SEPARATE box from the web tier for production"
