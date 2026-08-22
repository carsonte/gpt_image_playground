#!/usr/bin/env bash

set -Eeuo pipefail

BUNDLE_FILE="${1:-}"
APP_ROOT="${DEPLOY_APP_ROOT:-/www/wwwroot/img2.blackengine.top}"
DEPLOY_DIR="$APP_ROOT/deploy"
ENV_FILE="$DEPLOY_DIR/.env.server"
DATA_DIR="$DEPLOY_DIR/data"
BACKUP_DIR="$DATA_DIR/backups"
LOCK_DIR="$DATA_DIR/.bundle-update-lock"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.server.yml"
SERVICE="gpt-image-playground"
IMAGE="gpt-image-playground-server:local"
ROLLBACK_IMAGE="gpt-image-playground-server:rollback"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
DB_BACKUP="$BACKUP_DIR/app-$TIMESTAMP.db"
SOURCE_BACKUP="$BACKUP_DIR/source-$TIMESTAMP.tgz"

if [[ -z "$BUNDLE_FILE" || ! -f "$BUNDLE_FILE" ]]; then
  echo '更新包不存在。' >&2
  exit 1
fi

if [[ ! "$APP_ROOT" = /* || "$APP_ROOT" == '/' || ! -d "$APP_ROOT" ]]; then
  echo "部署目录无效：$APP_ROOT" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少服务器配置：$ENV_FILE" >&2
  exit 1
fi

for command in docker curl tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "缺少必要命令：$command" >&2
    exit 1
  fi
done

mkdir -p "$BACKUP_DIR"
chown 1000:1000 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo '已有更新任务正在执行，请稍后再试。' >&2
  exit 1
fi
trap 'rm -f -- "$BUNDLE_FILE" "${BASH_SOURCE[0]}" 2>/dev/null || true; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

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

restore_source() {
  if [[ -f "$SOURCE_BACKUP" ]]; then
    tar -xzf "$SOURCE_BACKUP" -C "$APP_ROOT"
  fi
}

rollback() {
  log '新版本健康检查失败，开始自动回退。'
  compose stop "$SERVICE" >/dev/null 2>&1 || true
  restore_source

  if [[ -f "$DB_BACKUP" ]]; then
    cp -- "$DB_BACKUP" "$DATA_DIR/app.db"
    chown 1000:1000 "$DATA_DIR/app.db" 2>/dev/null || true
  fi

  if docker image inspect "$ROLLBACK_IMAGE" >/dev/null 2>&1; then
    docker tag "$ROLLBACK_IMAGE" "$IMAGE"
    compose up -d --no-build --force-recreate "$SERVICE"
    if wait_for_health; then
      log '已恢复上一版本、源码和更新前数据库。'
      return 0
    fi
  fi

  log '自动回退未能恢复服务，请检查 Docker 日志。'
  compose logs --tail=120 "$SERVICE" || true
  return 1
}

log '备份当前服务器源码。'
tar \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./deploy/data' \
  --exclude='./deploy/.env.server' \
  --exclude='./*.tgz' \
  -czf "$SOURCE_BACKUP" -C "$APP_ROOT" .

CONTAINER_ID="$(compose ps -q "$SERVICE" 2>/dev/null || true)"
if [[ -n "$CONTAINER_ID" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_ID" 2>/dev/null || true)" == 'true' ]]; then
  log '创建 SQLite 在线备份。'
  compose exec -T "$SERVICE" node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('/app/data/app.db'); await db.backup('/app/data/backups/app-$TIMESTAMP.db'); db.close()"
elif [[ -f "$DATA_DIR/app.db" ]]; then
  log '服务未运行，直接备份 SQLite 数据库。'
  cp -- "$DATA_DIR/app.db" "$DB_BACKUP"
else
  log '当前没有数据库文件，跳过数据库备份。'
fi

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker tag "$IMAGE" "$ROLLBACK_IMAGE"
fi

log '解压新版本代码；服务器配置和数据保持不变。'
if ! tar -xzf "$BUNDLE_FILE" -C "$APP_ROOT"; then
  restore_source
  log '更新包解压失败，已恢复原源码。'
  exit 1
fi

if [[ ! -f "$APP_ROOT/package.json" || ! -f "$COMPOSE_FILE" ]]; then
  restore_source
  log '更新包结构无效，已恢复原源码。'
  exit 1
fi

log '构建新镜像；旧容器继续提供服务。'
if ! compose build "$SERVICE"; then
  restore_source
  log '镜像构建失败，已恢复原源码，旧容器保持运行。'
  exit 1
fi

log '启动新版本并执行健康检查。'
compose up -d --no-build "$SERVICE"

if ! wait_for_health; then
  rollback
  exit 1
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'app-*.db' -printf '%T@ %p\n' | sort -nr | tail -n +11 | cut -d' ' -f2- | xargs -r rm --
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'source-*.tgz' -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm --

log '更新完成，服务健康检查已通过。'
