#!/bin/sh
set -e

: "${APP_DB_USER:?APP_DB_USER nao definido}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD nao definido}"
: "${APP_DB_NAME:?APP_DB_NAME nao definido}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v usuario="$APP_DB_USER" \
  -v senha="$APP_DB_PASSWORD" \
  -v banco="$APP_DB_NAME" <<'SQL'
CREATE ROLE :"usuario" WITH LOGIN PASSWORD :'senha';
CREATE DATABASE :"banco" OWNER :"usuario";
REVOKE ALL ON DATABASE :"banco" FROM PUBLIC;
SQL
