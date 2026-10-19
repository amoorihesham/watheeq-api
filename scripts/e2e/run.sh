#!/usr/bin/env bash
# End-to-end regression check: runs the real server and CLI against a throwaway PostgreSQL 18 container,
# records the HTTP exchanges, CLI output, final database state, and server log lines,
# normalizes what changes per run (request IDs, tokens, UUIDs, dates), and compares with expected-transcript.txt.
# Usage: pnpm e2e [--update]
#   --update  rewrites expected-transcript.txt; use it only when a behavior change is intended, and review the diff.
# Ports default to 55432 (PostgreSQL) and 3999 (app) so they do not clash with a local database on 5432.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
EXPECTED="$HERE/expected-transcript.txt"
UPDATE=0
[ "${1:-}" = "--update" ] && UPDATE=1
OUT=$(mktemp -d)
mkdir -p "$OUT/raw"

PGPORT=${E2E_PG_PORT:-55432}
APPPORT=${E2E_APP_PORT:-3999}
NAME=wq-e2e-$$
docker run -d --rm --name "$NAME" -e POSTGRES_USER=watheeq -e POSTGRES_PASSWORD=watheeq -e POSTGRES_DB=watheeq \
  -p 127.0.0.1:$PGPORT:5432 -v "$REPO/db/bootstrap/roles.sql:/docker-entrypoint-initdb.d/01-roles.sql:ro" \
  postgres:18 >/dev/null
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U watheeq -d watheeq >/dev/null 2>&1 && break
  sleep 1
done
sleep 1

ADMIN="postgres://watheeq:watheeq@127.0.0.1:$PGPORT/watheeq"
export MIGRATION_DATABASE_URL="postgres://watheeq_owner:watheeq_owner@127.0.0.1:$PGPORT/watheeq"
cd "$REPO"
pnpm exec tsx src/cli/migrate.ts >"$OUT/raw/cli-migrate.txt" 2>&1

cli() { # name, args...
  local name=$1; shift
  set +e
  OPERATOR_PASSWORD="$CLI_PW" pnpm exec tsx src/cli/create-operator.ts "$@" >"$OUT/raw/cli-$name.out" 2>"$OUT/raw/cli-$name.err" </dev/null
  echo "exit=$?" >"$OUT/raw/cli-$name.code"
  set -e
}
CLI_PW="omar correct horse battery" cli create omar@watheeq.sa
CLI_PW="omar correct horse battery" cli duplicate OMAR@watheeq.sa
CLI_PW="short" cli invalid not-an-email
CLI_PW="x" cli usage

psql() { docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U watheeq -d watheeq "$@"; }
HASH=$(cd "$REPO" && pnpm exec tsx -e 'import("@node-rs/argon2").then(async m => console.log(await m.hash("sara correct horse battery", { memoryCost: 19456, timeCost: 2, parallelism: 1 })))')
psql >/dev/null <<SQL
insert into tenants (id, name) values ('11111111-1111-1111-1111-111111111111', 'Al-Noor');
begin;
select set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
insert into users (tenant_id, email, password_hash) values
  ('11111111-1111-1111-1111-111111111111', 'sara@alnoor.test', '$HASH'),
  ('11111111-1111-1111-1111-111111111111', 'lock@alnoor.test', '$HASH'),
  ('11111111-1111-1111-1111-111111111111', 'off@alnoor.test', '$HASH');
update users set is_active = false where email = 'off@alnoor.test';
commit;
SQL

DATABASE_URL="postgres://watheeq_app:watheeq_app@127.0.0.1:$PGPORT/watheeq" PORT=$APPPORT NODE_ENV=development LOG_LEVEL=info \
  pnpm exec tsx src/main.ts >"$OUT/raw/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 60); do
  curl -s -o /dev/null "http://127.0.0.1:$APPPORT/health" && break
  sleep 0.5
done

N=0
call() { # name, method, path, cookie, csrf, body, [content-type]
  N=$((N + 1))
  local name; name=$(printf '%02d-%s' "$N" "$1")
  local args=(-s -i -X "$2" "http://127.0.0.1:$APPPORT$3")
  [ -n "$4" ] && args+=(-H "Cookie: $4")
  [ -n "$5" ] && args+=(-H "X-CSRF-Token: $5")
  if [ -n "$6" ]; then args+=(-H "Content-Type: ${7:-application/json}" --data-raw "$6"); fi
  curl "${args[@]}" >"$OUT/raw/http-$name.txt"
}
token() { grep -i '^set-cookie:' "$OUT/raw/http-$1.txt" | head -1 | sed -E 's/^[^=]*=([^;]*).*/\1/'; }
csrf() { tail -1 "$OUT/raw/http-$1.txt" | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfToken"])'; }
last() { printf '%02d-%s' "$N" "$1"; }

call health GET /health "" "" ""
call not-found GET /no-such-route "" "" ""
for realm in operator tenant; do
  if [ $realm = operator ]; then P=/operator/auth; C=__Host-wq_operator; E=omar@watheeq.sa; PW="omar correct horse battery"; else P=/auth; C=__Host-wq_session; E=sara@alnoor.test; PW="sara correct horse battery"; fi
  call $realm-login-wrong-password POST $P/login "" "" "{\"email\":\"$E\",\"password\":\"wrong password\"}"
  call $realm-login-unknown-email POST $P/login "" "" '{"email":"nobody@nowhere.test","password":"wrong password"}'
  call $realm-login-invalid-body POST $P/login "" "" '{"email":""}'
  call $realm-login-not-json POST $P/login "" "" 'email=x' 'application/x-www-form-urlencoded'
  call $realm-login-malformed-json POST $P/login "" "" '{"email":'
  call $realm-session-no-cookie GET $P/session "" "" ""
  call $realm-session-garbage-cookie GET $P/session "$C=garbage" "" ""
  call $realm-login-ok POST $P/login "$C=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" "" "{\"email\":\"$(echo $E | tr a-z A-Z)\",\"password\":\"$PW\"}"
  L=$(last $realm-login-ok); T=$(token "$L"); X=$(csrf "$L")
  call $realm-session-ok GET $P/session "$C=$T" "" ""
  call $realm-logout-no-csrf POST $P/logout "$C=$T" "" ""
  call $realm-logout-wrong-csrf POST $P/logout "$C=$T" "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ""
  call $realm-logout-ok POST $P/logout "$C=$T" "$X" ""
  call $realm-session-after-logout GET $P/session "$C=$T" "" ""
  call $realm-login-again POST $P/login "" "" "{\"email\":\"$E\",\"password\":\"$PW\"}"
  L=$(last $realm-login-again); eval "${realm}_token=$(token "$L")"
done
call cross-tenant-cookie-on-operator GET /operator/auth/session "__Host-wq_session=$tenant_token" "" ""
call cross-operator-cookie-on-tenant GET /auth/session "__Host-wq_operator=$operator_token" "" ""
call operator-cookie-renamed GET /operator/auth/session "__Host-wq_operator=$tenant_token" "" ""
call tenant-inactive POST /auth/login "" "" '{"email":"off@alnoor.test","password":"sara correct horse battery"}'
for i in 1 2 3 4 5; do call tenant-lock-wrong-$i POST /auth/login "" "" '{"email":"lock@alnoor.test","password":"wrong password"}'; done
call tenant-locked-right-password POST /auth/login "" "" '{"email":"lock@alnoor.test","password":"sara correct horse battery"}'

psql -At >"$OUT/raw/db-state.txt" <<'SQL'
select 'operators', email, failed_login_count, locked_until is not null, is_active from operators order by email;
select 'users', email, failed_login_count, locked_until is not null, is_active from users order by email;
select 'operator_sessions', count(*), count(revoked_at) from operator_sessions;
select 'user_sessions', count(*), count(revoked_at) from user_sessions;
select 'login_ip_throttle', host(ip), failed_count from login_ip_throttle order by ip;
select 'audit_log', count(*) from audit_log;
SQL

kill -TERM "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""
python3 -I "$HERE/normalize.py" "$OUT/raw" >"$OUT/transcript.txt"
if [ "$UPDATE" = 1 ]; then
  cp "$OUT/transcript.txt" "$EXPECTED"
  echo "updated $EXPECTED; review it with git diff"
elif diff -u "$EXPECTED" "$OUT/transcript.txt"; then
  echo "e2e: transcript matches ($(wc -l <"$EXPECTED") lines)"
else
  echo "e2e: transcript differs from $EXPECTED (raw output kept in $OUT/raw)" >&2
  exit 1
fi
rm -rf "$OUT"
