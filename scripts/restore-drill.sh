#!/bin/sh
# Restore drill: decifra o último backup, restaura em um banco temporário e compara o HASH de conteúdo
# (count + md5 dos ids ordenados, por tabela) com o banco de origem. Imprime "RESTORE DRILL OK <hash>" ou falha.
# Uso: PG* (libpq, apontando para o servidor), BACKUP_PASSPHRASE, [BACKUP_DIR=/backups] [SOURCE_DB=medcheckin] [DRILL_DB=medcheckin_drill] [BACKUP_FILE=...]
set -eu
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE obrigatório}"
DIR="${BACKUP_DIR:-/backups}"
SRC="${SOURCE_DB:-${PGDATABASE:-medcheckin}}"
DRILL="${DRILL_DB:-medcheckin_drill}"
FILE="${BACKUP_FILE:-$(ls -1t "$DIR"/medcheckin-*.dump.enc 2>/dev/null | head -1)}"
[ -n "$FILE" ] || { echo "RESTORE DRILL FAIL: nenhum backup em $DIR"; exit 2; }
# 1) integridade do arquivo
if [ -f "$FILE.sha256" ]; then
  EXPECT="$(cat "$FILE.sha256")"; GOT="$(sha256sum "$FILE" | awk '{print $1}')"
  [ "$EXPECT" = "$GOT" ] || { echo "RESTORE DRILL FAIL: sha256 do arquivo não confere"; exit 3; }
fi
TMP="$(mktemp)"; trap 'rm -f "$TMP"; psql -d postgres -qAtc "drop database if exists $DRILL" >/dev/null 2>&1 || true' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP" -pass env:BACKUP_PASSPHRASE
# 2) restaura em banco temporário
psql -d postgres -qAtc "drop database if exists $DRILL" >/dev/null
psql -d postgres -qAtc "create database $DRILL" >/dev/null
pg_restore --no-owner --no-acl -d "$DRILL" "$TMP" >/dev/null 2>&1 || true
# 3) hash de conteúdo por tabela (mesma consulta nos dois bancos)
HASHQ="select string_agg(t || ':' || n || ':' || coalesce(h,'-'), ';' order by t) from (
  select c.relname as t,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text::bigint as n,
    (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from (select row_to_json(r)::text as x from %I r) s', ',', '', c.relname), false, true, '')))[1]::text as h
  from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where ns.nspname='public' and c.relkind='r' and c.relname not like 'knex_%') q"
SRC_HASH="$(psql -d "$SRC" -qAtc "$HASHQ" | md5sum | awk '{print $1}')"
DRILL_HASH="$(psql -d "$DRILL" -qAtc "$HASHQ" | md5sum | awk '{print $1}')"
TABLES="$(psql -d "$DRILL" -qAtc "select count(*) from pg_tables where schemaname='public'")"
if [ "$SRC_HASH" = "$DRILL_HASH" ]; then
  echo "RESTORE DRILL OK $SRC_HASH (arquivo $(basename "$FILE"), $TABLES tabelas restauradas)"
else
  echo "RESTORE DRILL FAIL: hash origem $SRC_HASH ≠ restaurado $DRILL_HASH (arquivo $(basename "$FILE"))"; exit 4
fi
