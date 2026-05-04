#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Optional env file can be passed as the first arg:
#   ./repo_backup.sh /etc/repo-backup.env
if [[ $# -gt 0 && -f "${1:-}" ]]; then
  # shellcheck disable=SC1090
  source "$1"
fi

# Defaults (can be overridden by environment or env file)
: "${BACKUP_MOUNT:=/mnt/backup_repo}"
: "${BACKUP_NAMESPACE:=repo}"
: "${BACKUP_ROOT:=${BACKUP_MOUNT}/${BACKUP_NAMESPACE}}"
: "${APP_UPLOADS_DIR:=${REPO_ROOT}/backend/uploads}"

: "${AUTH_DB_NAME:=${REPO_AUTH_DB_NAME:-repo_auth_system}}"
: "${AUTH_DB_HOST:=${REPO_AUTH_DB_HOST:-localhost}}"
: "${AUTH_DB_PORT:=${REPO_AUTH_DB_PORT:-5432}}"
: "${AUTH_DB_USER:=${REPO_AUTH_DB_USER:-postgres}}"
: "${AUTH_DB_PASSWORD:=${REPO_AUTH_DB_PASSWORD:-}}"

: "${REPO_DB_NAME:=${REPOSITORY_DB_NAME:-repository_system}}"
: "${REPO_DB_HOST:=${REPOSITORY_DB_HOST:-${DB_HOST:-localhost}}}"
: "${REPO_DB_PORT:=${REPOSITORY_DB_PORT:-${DB_PORT:-5432}}}"
: "${REPO_DB_USER:=${REPOSITORY_DB_USER:-${DB_USER:-postgres}}}"
: "${REPO_DB_PASSWORD:=${REPOSITORY_DB_PASSWORD:-${DB_PASSWORD:-}}}"

: "${RETENTION_DAYS:=14}"
: "${LOG_RETENTION_DAYS:=30}"

STAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
AUTH_BACKUP_DIR="${BACKUP_ROOT}/auth_db"
REPO_BACKUP_DIR="${BACKUP_ROOT}/repo_db"
UPLOADS_BACKUP_DIR="${BACKUP_ROOT}/uploads"
LOG_DIR="${BACKUP_ROOT}/logs"
LOCK_FILE="${BACKUP_ROOT}/.backup.lock"

AUTH_BACKUP_FILE="${AUTH_BACKUP_DIR}/${STAMP}.sql.gz"
REPO_BACKUP_FILE="${REPO_BACKUP_DIR}/${STAMP}.sql.gz"
UPLOADS_BACKUP_FILE="${UPLOADS_BACKUP_DIR}/${STAMP}.tar.gz"
CHECKSUM_FILE="${LOG_DIR}/${STAMP}.sha256"
RUN_LOG_FILE="${LOG_DIR}/${STAMP}.log"

log() {
  local message="$1"
  local now
  now="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[${now}] ${message}" | tee -a "${RUN_LOG_FILE}"
}

fail() {
  log "ERROR: $1"
  exit 1
}

require_command() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

run_pg_dump() {
  local db_name="$1"
  local db_host="$2"
  local db_port="$3"
  local db_user="$4"
  local db_password="$5"
  local out_file="$6"

  if [[ -n "${db_password}" ]]; then
    PGPASSWORD="${db_password}" pg_dump \
      --host="${db_host}" \
      --port="${db_port}" \
      --username="${db_user}" \
      --format=plain \
      --no-owner \
      --no-privileges \
      "${db_name}" | gzip -9 > "${out_file}"
  else
    pg_dump \
      --host="${db_host}" \
      --port="${db_port}" \
      --username="${db_user}" \
      --format=plain \
      --no-owner \
      --no-privileges \
      "${db_name}" | gzip -9 > "${out_file}"
  fi
}

require_command pg_dump
require_command gzip
require_command tar
require_command sha256sum
require_command find

mkdir -p "${AUTH_BACKUP_DIR}" "${REPO_BACKUP_DIR}" "${UPLOADS_BACKUP_DIR}" "${LOG_DIR}"
touch "${RUN_LOG_FILE}"

touch "${BACKUP_ROOT}/.write_test" || fail "Backup destination is not writable: ${BACKUP_ROOT}"
rm -f "${BACKUP_ROOT}/.write_test"

if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    fail "Another backup process is already running"
  fi
else
  log "WARN: flock command not found; running without lock protection"
fi

log "Backup started"
log "Auth DB: ${AUTH_DB_NAME} (${AUTH_DB_HOST}:${AUTH_DB_PORT})"
log "Repository DB: ${REPO_DB_NAME} (${REPO_DB_HOST}:${REPO_DB_PORT})"
log "Uploads dir: ${APP_UPLOADS_DIR}"
log "Backup destination: ${BACKUP_ROOT}"

log "Dumping auth database..."
run_pg_dump "${AUTH_DB_NAME}" "${AUTH_DB_HOST}" "${AUTH_DB_PORT}" "${AUTH_DB_USER}" "${AUTH_DB_PASSWORD}" "${AUTH_BACKUP_FILE}"

log "Dumping repository database..."
run_pg_dump "${REPO_DB_NAME}" "${REPO_DB_HOST}" "${REPO_DB_PORT}" "${REPO_DB_USER}" "${REPO_DB_PASSWORD}" "${REPO_BACKUP_FILE}"

if [[ -d "${APP_UPLOADS_DIR}" ]]; then
  log "Archiving uploads..."
  tar -C "$(dirname "${APP_UPLOADS_DIR}")" -czf "${UPLOADS_BACKUP_FILE}" "$(basename "${APP_UPLOADS_DIR}")"
else
  fail "Uploads directory not found: ${APP_UPLOADS_DIR}"
fi

log "Generating checksums..."
sha256sum "${AUTH_BACKUP_FILE}" "${REPO_BACKUP_FILE}" "${UPLOADS_BACKUP_FILE}" > "${CHECKSUM_FILE}"

log "Applying retention policy..."
find "${AUTH_BACKUP_DIR}" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
find "${REPO_BACKUP_DIR}" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
find "${UPLOADS_BACKUP_DIR}" -type f -name "*.tar.gz" -mtime +"${RETENTION_DAYS}" -delete
find "${LOG_DIR}" -type f -name "*.sha256" -mtime +"${LOG_RETENTION_DAYS}" -delete
find "${LOG_DIR}" -type f -name "*.log" -mtime +"${LOG_RETENTION_DAYS}" -delete

log "Backup completed successfully"
log "Auth dump: ${AUTH_BACKUP_FILE}"
log "Repository dump: ${REPO_BACKUP_FILE}"
log "Uploads archive: ${UPLOADS_BACKUP_FILE}"
log "Checksums: ${CHECKSUM_FILE}"
