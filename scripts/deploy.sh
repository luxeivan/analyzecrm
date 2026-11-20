#!/usr/bin/env bash
# Деплой кода на прод: копирование проекта (git pull или tar) + пересборка api/web.
# Использование: ./scripts/deploy.sh
# Переменные: DEPLOY_HOST (user@host), DEPLOY_DIR, DEPLOY_KEY, DEPLOY_MODE (auto|git|tar)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-werstakoff@192.168.1.65}"
TARGET="${DEPLOY_DIR:-/srv/analyzeCRM}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/bitrix_deploy}"
MODE="${DEPLOY_MODE:-auto}"
SSH="ssh -i $KEY -o ConnectTimeout=15"

cd "$ROOT"

echo "==> ssh: $HOST"
$SSH "$HOST" 'echo ok' >/dev/null

# --- доставка кода ---------------------------------------------------------
SRV_GIT=""
if $SSH "$HOST" "git -C $TARGET ls-remote origin >/dev/null 2>&1" 2>/dev/null; then
  SRV_GIT=1
fi

if [ "$MODE" = "auto" ]; then
  if [ -n "$SRV_GIT" ]; then MODE=git; else MODE=tar; fi
fi

if [ "$MODE" = "git" ]; then
  echo "==> git: push + pull на сервере"
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    echo "!! есть незакоммиченные изменения — закоммитьте их или используйте DEPLOY_MODE=tar" >&2
    exit 1
  fi
  git push origin "$BRANCH"
  $SSH "$HOST" "cd $TARGET && git fetch origin && git reset --hard origin/$BRANCH"
else
  echo "==> tar: $ROOT -> $HOST:$TARGET"
  tar czf - \
    --exclude=node_modules --exclude=.env --exclude=backup --exclude=.git \
    --exclude=dist --exclude='*.log' --exclude='*.dump' --exclude=__pycache__ \
    . | $SSH "$HOST" "tar xzf - -C $TARGET"
fi

# --- сборка и запуск -------------------------------------------------------
echo "==> build + up ($MODE)"
$SSH "$HOST" "cd $TARGET && docker compose -f docker-compose.prod.yml up -d --build --remove-orphans"

echo "==> health"
$SSH "$HOST" "sleep 5; curl -fsS -m 10 http://127.0.0.1:8090/api/health" || {
  echo "!! health не ответил: $SSH $HOST 'docker compose -f $TARGET/docker-compose.prod.yml logs api --tail 50'"
  exit 1
}
echo
echo "Готово: https://analyzecrm.luxeivan.ru"
