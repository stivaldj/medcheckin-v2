#!/bin/sh
# Backup diário: pg_dump -Fc → cifrado (aes-256-cbc, pbkdf2) com BACKUP_PASSPHRASE → /backups.
# Uso: variáveis PG* (libpq) + BACKUP_PASSPHRASE [+ BACKUP_DIR (default /backups), BACKUP_KEEP_DAYS (14)].
set -eu
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE obrigatório}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR"
TMP="$DIR/.tmp-$STAMP.dump"
OUT="$DIR/medcheckin-$STAMP.dump.enc"
pg_dump -Fc --no-owner --no-acl -f "$TMP"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$TMP" -out "$OUT" -pass env:BACKUP_PASSPHRASE
rm -f "$TMP"
sha256sum "$OUT" | awk '{print $1}' > "$OUT.sha256"
SIZE=$(wc -c < "$OUT")
echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.ok\",\"file\":\"$(basename "$OUT")\",\"bytes\":$SIZE,\"sha256\":\"$(cat "$OUT.sha256")\"}"
# retenção
find "$DIR" -name 'medcheckin-*.dump.enc' -mtime +"$KEEP" -print -delete | sed 's/^/{"msg":"backup.pruned","file":"/;s/$/"}/'
find "$DIR" -name 'medcheckin-*.dump.enc.sha256' -mtime +"$KEEP" -delete
# D38: anexos vivem fora do banco. Segunda parte do backup: tar do volume, cifrado com a mesma frase.
UP_OUT=""
if [ -n "${UPLOADS_DIR:-}" ] && [ -d "$UPLOADS_DIR" ]; then
  UP_TMP="$DIR/.tmp-$STAMP.uploads.tar"
  UP_OUT="$DIR/uploads-$STAMP.tar.enc"
  tar -C "$UPLOADS_DIR" -cf "$UP_TMP" .
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$UP_TMP" -out "$UP_OUT" -pass env:BACKUP_PASSPHRASE
  rm -f "$UP_TMP"
  sha256sum "$UP_OUT" | awk '{print $1}' > "$UP_OUT.sha256"
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.uploads_ok\",\"file\":\"$(basename "$UP_OUT")\",\"bytes\":$(wc -c < "$UP_OUT")}"
  find "$DIR" -name 'uploads-*.tar.enc' -mtime +"$KEEP" -print -delete | sed 's/^/{"msg":"backup.pruned","file":"/;s/$/"}/'
  find "$DIR" -name 'uploads-*.tar.enc.sha256' -mtime +"$KEEP" -delete
fi
# off-site (opcional). Configurado = obrigatório: se BACKUP_RCLONE_REMOTE está definido e a cópia não
# acontece, é falha — antes o script pulava calado quando faltava o rclone e dizia "backup.ok", e a
# única cópia continuava no mesmo disco do banco (lição do v1: 910 prontuários numa cópia única).
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.offsite_failed\",\"reason\":\"rclone ausente\"}"
    exit 5
  fi
  if ! rclone copy "$OUT" "$BACKUP_RCLONE_REMOTE" || ! rclone copy "$OUT.sha256" "$BACKUP_RCLONE_REMOTE"; then
    echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.offsite_failed\",\"reason\":\"rclone copy falhou\",\"remote\":\"$BACKUP_RCLONE_REMOTE\"}"
    exit 6
  fi
  echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"msg\":\"backup.offsite_ok\",\"remote\":\"$BACKUP_RCLONE_REMOTE\"}"
  if [ -n "$UP_OUT" ]; then rclone copy "$UP_OUT" "$BACKUP_RCLONE_REMOTE" && rclone copy "$UP_OUT.sha256" "$BACKUP_RCLONE_REMOTE" || { echo '{"msg":"backup.offsite_failed","reason":"uploads"}'; exit 6; }; fi
fi
