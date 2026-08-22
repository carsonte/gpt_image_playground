#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.server.yml"
ENV_FILE="${DEPLOY_ENV_FILE:-$SCRIPT_DIR/.env.server}"
DATA_DIR="$SCRIPT_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"
LOCK_DIR="$DATA_DIR/.update-lock"
SERVICE="gpt-image-playground"
IMAGE="gpt-image-playground-server:local"
ROLLBACK_IMAGE="gpt-image-playground-server:rollback"
REMOTE="${DEPLOY_REMOTE:-origin}"
BRANCH="${DEPLOY_BRANCH:-stable}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/app-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"
chown 1000:1000 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo '已有更新任务正在执行，请稍后再试。' >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$DATA_DIR/update.log"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 45); do
    if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  log '新版本健康检查失败，开始自动回退。'
  compose stop "$SERVICE" >/dev/null 2>&1 || true

  if [[ -f "$BACKUP_FILE" ]]; then
    cp -- "$BACKUP_FILE" "$DATA_DIR/app.db"
    chown 1000:1000 "$DATA_DIR/app.db" 2>/dev/null || true
  fi

  if docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker tag "$ROLLBACK_IMAGE" "$IMAGE"
    compose up -d --no-build --force-recreate "$SERVICE"
    if wait_for_health; then
      log '已恢复上一版本，数据库也已恢复到更新前备份。'
      return 0
    fi
  fi

  log '自动回退未能恢复服务，请检查 Docker 日志。'
  compose logs --tail=120 "$SERVICE" || true
  return 1
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少服务器环境文件：$ENV_FILE" >&2
  echo "请先复制 $SCRIPT_DIR/.env.server.example 并填写真实配置。" >&2
  exit 1
fi

for command in git docker curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少必要命令：$command" >&2
    exit 1
  fi
done

cd "$APP_ROOT"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo '服务器代码存在未提交修改，已停止更新以避免覆盖。' >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Git 远程仓库不存在：$REMOTE" >&2
  exit 1
fi

log "检查 $REMOTE/$BRANCH 的新版本。"
git fetch --prune "$REMOTE" "$BRANCH"

CURRENT_COMMIT="$(git rev-parse HEAD)"
TARGET_COMMIT="$(git rev-parse "$REMOTE/$BRANCH")"

if ! git merge-base --is-ancestor "$CURRENT_COMMIT" "$TARGET_COMMIT"; then
  echo '服务器版本与远程分支已经分叉，无法安全快进更新。' >&2
  exit 1
fi

CONTAINER_ID="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
if [[ -n "$CONTAINER_ID" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID" 2>/dev/null || true)" == 'true' ]]; then
  log '创建 SQLite 在线备份。'
  compose exec -T "$SERVICE" node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('/app/data/app.db'); await db.backup('/app/data/backups/app-$TIMESTAMP.db'); db.close()"
elif [[ -f "$DATA_DIR/app.db" ]]; then
  log '服务未运行，直接备份 SQLite 数据库。'
  cp -- "$DATA_DIR/app.db" "$BACKUP_FILE"
else
  log '当前没有数据库文件，首次部署将跳过数据库备份。'
fi

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$ROLLBACK_IMAGE"
fi

if [[ "$CURRENT_COMMIT" != "$TARGET_COMMIT" ]]; then
  log "更新代码到 ${TARGET_COMMIT:0:12}。"
  git merge --ff-only "$REMOTE/$BRANCH"
else
  log '代码已经是最新版本，将重新构建以应用当前配置。'
fi

log '构建新镜像；旧容器在构建期间继续提供服务。'
if ! compose build "$SERVICE"; then
  log '镜像构建失败，旧容器保持运行。'
  exit 1
fi

log '启动新版本并执行健康检查。'
compose up -d --no-build "$SERVICE"

if ! wait_for_health; then
  rollback
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'app-*.db' -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +11 \
  | cut -d' ' -f2- \
  | xargs -r rm --

log "更新完成，当前版本：$(git rev-parse --short HEAD)。"
