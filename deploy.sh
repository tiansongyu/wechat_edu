#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-${ROOT_DIR}/.env}"
MODE="experience"
MODE_SET=false
CHECK_ONLY=false
CURRENT_STEP="初始化"
BACKUP_FILE=""
TEMP_FILES=()
LAST_HTTP_BODY_FILE=""
DEPLOYMENT_STARTED=false
LOCK_DIR=""

usage() {
  cat <<'EOF'
Tutor Link 一键 Docker 部署

用法：
  ./deploy.sh                         # 体验环境，保留 HTTP :4000
  ./deploy.sh experience              # 同上
  ./deploy.sh production              # 正式 HTTPS，使用 80/443 与证书
  ./deploy.sh [模式] --check           # 只检查环境，不部署

可选环境变量：
  DEPLOY_ENV_FILE=/path/to/.env       指定 Compose 环境文件
  DEPLOY_BASE_URL=https://example.com 指定部署后的验证地址
  DEPLOY_SKIP_BACKUP=true             跳过部署前 PostgreSQL 备份
  DEPLOY_BACKUP_DIR=/safe/path        指定备份目录
  DEPLOY_TIMEOUT_SECONDS=180          指定容器等待秒数
  DEPLOY_PULL_BASE_IMAGES=false       网络异常时使用本地基础镜像缓存
  DEPLOY_EXPOSE_DATA_PORTS=true       体验模式下允许公开数据库等内部端口
  DEPLOY_ALLOW_DIRTY=true             显式允许脏 Git 工作树（不建议生产使用）

脚本不会执行 down、down -v、prune 或测试数据重置。
EOF
}

for arg in "$@"; do
  case "$arg" in
    experience|production)
      if [[ "$MODE_SET" == "true" ]]; then
        echo "错误：一次只能指定一个部署模式。" >&2
        exit 2
      fi
      MODE="$arg"
      MODE_SET=true
      ;;
    --check)
      CHECK_ONLY=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "错误：未知参数 ${arg}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cd "$ROOT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "错误：找不到环境文件 ${ENV_FILE}" >&2
  echo "请先从 .env.example 创建 .env，并替换全部生产密钥。" >&2
  exit 1
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml")
if [[ "$MODE" == "production" ]]; then
  COMPOSE+=(-f "$ROOT_DIR/compose.production.yaml")
fi

compose() {
  "${COMPOSE[@]}" "$@"
}

cleanup() {
  local file
  # macOS 自带 Bash 3.2 在 nounset 模式下展开空数组会报错。
  set +u
  for file in "${TEMP_FILES[@]}"; do
    [[ -n "$file" ]] && rm -f "$file" || true
  done
  [[ -n "$LOCK_DIR" ]] && rmdir "$LOCK_DIR" 2>/dev/null || true
  set -u
}

diagnose() {
  local exit_code=$?
  trap - ERR
  echo >&2
  echo "部署失败：${CURRENT_STEP}（退出码 ${exit_code}）" >&2
  if [[ "$DEPLOYMENT_STARTED" == "true" ]] \
    && command -v docker >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1; then
    echo "---- Docker Compose 状态 ----" >&2
    compose ps -a >&2 || true
    echo "---- API / Worker / Gateway / Migrate 最近日志 ----" >&2
    compose logs --no-color --tail=120 api worker gateway migrate >&2 || true
    echo "---- API 镜像与容器 ----" >&2
    compose images api >&2 || true
    local container_id
    while IFS= read -r container_id; do
      [[ -z "$container_id" ]] && continue
      docker inspect \
        --format 'name={{.Name}} image={{.Image}} created={{.Created}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$container_id" >&2 || true
    done < <(compose ps -q api 2>/dev/null || true)
  fi
  echo "未执行清库或删除数据卷。请根据上面的失败阶段和日志处理后重新运行。" >&2
  exit "$exit_code"
}

trap cleanup EXIT
trap diagnose ERR

log_step() {
  CURRENT_STEP="$1"
  echo
  echo "==> ${CURRENT_STEP}"
}

abort_deploy() {
  echo "错误：$1" >&2
  return 1
}

dotenv_value() {
  local key="$1"
  local line=""
  local value=""

  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi

  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

require_value() {
  local key="$1"
  local value
  value="$(dotenv_value "$key")"
  if [[ -z "$value" ]]; then
    echo "错误：${key} 未配置。" >&2
    return 1
  fi
}

require_secret() {
  local key="$1"
  local min_length="$2"
  local value lower
  value="$(dotenv_value "$key")"
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"

  if [[ ${#value} -lt $min_length ]]; then
    echo "错误：${key} 未配置或长度不足 ${min_length} 位。" >&2
    return 1
  fi
  if [[ "$lower" == *change-me* || "$lower" == *local-access-secret* || "$lower" == *local-refresh-secret* || "$lower" == *local-data-encryption* ]]; then
    echo "错误：${key} 仍是示例值，请在 ${ENV_FILE} 中替换。" >&2
    return 1
  fi
  case "$value" in
    tutor_dev_password|Admin123456\!|minioadmin123)
      echo "错误：${key} 仍是默认值，请在 ${ENV_FILE} 中替换。" >&2
      return 1
      ;;
  esac
}

require_local_database_targets() {
  local database_url direct_url database_name database_user app_base direct_base expected_app expected_direct
  database_url="$(dotenv_value DATABASE_URL)"
  direct_url="$(dotenv_value DIRECT_DATABASE_URL)"
  database_name="$(dotenv_value POSTGRES_DB)"
  database_user="$(dotenv_value POSTGRES_USER)"

  if [[ -z "$database_name" || -z "$database_user" ]]; then
    echo "错误：POSTGRES_DB 和 POSTGRES_USER 必须显式配置。" >&2
    return 1
  fi
  if [[ "$database_url" == *change-me* || "$direct_url" == *change-me* ]]; then
    echo "错误：数据库 URL 仍包含 change-me 示例值。" >&2
    return 1
  fi

  app_base="${database_url%%\?*}"
  direct_base="${direct_url%%\?*}"
  expected_app="@pgbouncer:5432/${database_name}"
  expected_direct="@postgres:5432/${database_name}"
  if [[ "$app_base" != postgresql://*"$expected_app" && "$app_base" != postgres://*"$expected_app" ]]; then
    echo "错误：DATABASE_URL 必须指向本项目 pgbouncer:5432/${database_name}。" >&2
    return 1
  fi
  if [[ "$direct_base" != postgresql://*"$expected_direct" && "$direct_base" != postgres://*"$expected_direct" ]]; then
    echo "错误：DIRECT_DATABASE_URL 必须指向本项目 postgres:5432/${database_name}，确保备份与迁移目标一致。" >&2
    return 1
  fi
  if [[ "${app_base#*://}" != "${database_user}:"* || "${direct_base#*://}" != "${database_user}:"* ]]; then
    echo "错误：数据库 URL 用户名必须与 POSTGRES_USER 一致。" >&2
    return 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误：缺少命令 $1。" >&2
    return 1
  fi
}

require_compose_version() {
  local version major minor patch
  version="$(docker compose version --short)"
  version="${version#v}"
  version="${version%%-*}"
  IFS=. read -r major minor patch <<<"$version"
  major="${major:-0}"
  minor="${minor:-0}"
  patch="${patch:-0}"
  patch="${patch%%[^0-9]*}"
  if ((major < 2 || (major == 2 && minor < 24) || (major == 2 && minor == 24 && patch < 4))); then
    echo "错误：Docker Compose ${version} 过旧，需要 2.24.4 或更高版本。" >&2
    return 1
  fi
}

acquire_lock() {
  local lock_file="${TMPDIR:-/tmp}/tutor-link-deploy.lock"
  local candidate_lock_dir
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$lock_file"
    if flock -n 9; then
      return 0
    fi
    echo "错误：已有另一个部署任务正在运行。" >&2
    return 1
  fi

  candidate_lock_dir="${lock_file}.d"
  if ! mkdir "$candidate_lock_dir" 2>/dev/null; then
    echo "错误：已有另一个部署任务正在运行，或遗留锁目录 ${candidate_lock_dir}。" >&2
    return 1
  fi
  LOCK_DIR="$candidate_lock_dir"
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local body_file error_file status attempt
  local curl_args=(--silent --show-error --connect-timeout 3 --max-time 10)
  body_file="$(mktemp)"
  error_file="$(mktemp)"
  TEMP_FILES+=("$body_file" "$error_file")
  LAST_HTTP_BODY_FILE="$body_file"

  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    status="$(curl "${curl_args[@]}" \
      --output "$body_file" --write-out '%{http_code}' \
      "$url" 2>"$error_file" || true)"
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    sleep 2
  done

  echo "错误：${label} 在等待期间未返回 200（最后状态 ${status:-不可达}）。" >&2
  if [[ -s "$body_file" ]]; then
    echo "最后响应：$(head -c 500 "$body_file")" >&2
  fi
  if [[ -s "$error_file" ]]; then
    echo "连接错误：$(head -c 500 "$error_file")" >&2
  fi
  return 1
}

verify_api_containers() {
  local container_id count=0
  while IFS= read -r container_id; do
    [[ -z "$container_id" ]] && continue
    count=$((count + 1))
    docker exec "$container_id" node -e '
      Promise.all([
        fetch("http://127.0.0.1:3000/health"),
        fetch("http://127.0.0.1:3000/api/v1/platform/overview")
      ]).then(async ([health, overview]) => {
        const healthBody = await health.json().catch(() => ({}));
        const overviewBody = await overview.json().catch(() => ({}));
        const valid = health.status === 200
          && healthBody.status === "ok"
          && healthBody.service === "tutor-link-api"
          && overview.status === 200
          && typeof overviewBody.brand === "object"
          && Array.isArray(overviewBody.trustHighlights)
          && typeof overviewBody.metrics === "object"
          && process.env.WECHAT_LOGIN_MOCK === "false"
          && process.env.SEED_DEMO_DATA === "false";
        if (!valid) {
          console.error(JSON.stringify({ healthStatus: health.status, overviewStatus: overview.status }));
          process.exit(1);
        }
      }).catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
    '
  done < <(compose ps -q api)

  if [[ $count -eq 0 ]]; then
    echo "错误：没有找到正在运行的 API 容器。" >&2
    return 1
  fi
}

verify_runtime_service() {
  local service="$1"
  local container_id state restart_count count=0
  while IFS= read -r container_id; do
    [[ -z "$container_id" ]] && continue
    count=$((count + 1))
    state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
    restart_count="$(docker inspect --format '{{.RestartCount}}' "$container_id")"
    if [[ "$state" != "running" || "$restart_count" != "0" ]]; then
      echo "错误：${service} 容器状态异常（state=${state}, restartCount=${restart_count}）。" >&2
      return 1
    fi
  done < <(compose ps -q "$service")

  if [[ $count -eq 0 ]]; then
    echo "错误：没有找到正在运行的 ${service} 容器。" >&2
    return 1
  fi
}

verify_worker() {
  local recent_logs
  verify_runtime_service worker
  sleep 3
  verify_runtime_service worker
  recent_logs="$(compose logs --no-color --since 30s worker 2>/dev/null || true)"
  if printf '%s' "$recent_logs" | grep -Eq 'initial outbox dispatch failed|outbox dispatch failed|domain event failed'; then
    echo "错误：Worker 启动后出现数据库、Redis 或事件消费错误。" >&2
    return 1
  fi
}

log_step "检查部署环境"
require_command docker
require_command curl
require_compose_version
docker info >/dev/null
acquire_lock

require_value WECHAT_APP_ID
require_secret WECHAT_APP_SECRET 16
require_secret POSTGRES_PASSWORD 12
require_secret JWT_ACCESS_SECRET 32
require_secret JWT_REFRESH_SECRET 32
require_secret DATA_ENCRYPTION_KEY 32
require_secret ADMIN_PASSWORD 12
require_secret MINIO_ROOT_PASSWORD 12
require_value DATABASE_URL
require_value DIRECT_DATABASE_URL
require_local_database_targets

if [[ "$MODE" == "production" ]]; then
  if [[ -z "${DEPLOY_BASE_URL:-}" ]]; then
    echo "错误：production 模式必须设置 DEPLOY_BASE_URL=https://你的域名。" >&2
    exit 1
  fi
  if [[ ! -s "$ROOT_DIR/infra/nginx/certs/fullchain.pem" || ! -s "$ROOT_DIR/infra/nginx/certs/privkey.pem" ]]; then
    echo "错误：production 模式需要 infra/nginx/certs/fullchain.pem 和 privkey.pem。" >&2
    exit 1
  fi
fi

if [[ -n "${DEPLOY_BASE_URL:-}" ]]; then
  case "$DEPLOY_BASE_URL" in
    http://*|https://*) ;;
    *)
      echo "错误：DEPLOY_BASE_URL 必须以 http:// 或 https:// 开头。" >&2
      exit 1
      ;;
  esac
  if [[ "$MODE" == "production" && "$DEPLOY_BASE_URL" != https://* ]]; then
    echo "错误：production 模式的 DEPLOY_BASE_URL 必须使用 https://。" >&2
    exit 1
  fi
fi

# 无论 .env 中的旧值是什么，服务器部署都使用真实微信接口且不写演示业务数据。
export NODE_ENV=production
export WECHAT_LOGIN_MOCK=false
export SEED_DEMO_DATA=false

if [[ "$MODE" == "experience" ]]; then
  configured_gateway_port="$(dotenv_value GATEWAY_PORT)"
  export GATEWAY_PORT="${configured_gateway_port:-4000}"
  gateway_port_number="${GATEWAY_PORT##*:}"
  if [[ ! "$gateway_port_number" =~ ^[0-9]+$ || "$gateway_port_number" -lt 1 || "$gateway_port_number" -gt 65535 ]]; then
    echo "错误：GATEWAY_PORT 必须是 1 到 65535 的有效端口。" >&2
    exit 1
  fi
  if [[ "${DEPLOY_EXPOSE_DATA_PORTS:-false}" != "true" ]]; then
    # API 仍通过 Docker 网络访问依赖；回环绑定可避免数据库与管理控制台暴露到公网。
    export POSTGRES_PORT="127.0.0.1:${DEPLOY_POSTGRES_PORT:-4001}"
    export REDIS_PORT="127.0.0.1:${DEPLOY_REDIS_PORT:-4002}"
    export MINIO_CONSOLE_PORT="127.0.0.1:${DEPLOY_MINIO_CONSOLE_PORT:-4004}"
  fi
fi

# 只校验，不把展开后的 Compose 配置输出到终端，避免泄露密钥。
compose config --quiet

if [[ -d "$ROOT_DIR/.git" ]]; then
  revision="$(git rev-parse --short HEAD)"
  echo "部署版本：${revision}"
  git_state="$(git status --porcelain --untracked-files=normal)"
  if [[ -n "$git_state" && "${DEPLOY_ALLOW_DIRTY:-false}" != "true" ]]; then
    echo "错误：Git 工作树不干净，拒绝构建不可复现镜像。确认修改后提交，或显式设置 DEPLOY_ALLOW_DIRTY=true。" >&2
    exit 1
  elif [[ -n "$git_state" ]]; then
    echo "警告：已按 DEPLOY_ALLOW_DIRTY=true 允许使用脏工作树构建。" >&2
  fi
fi
echo "部署模式：${MODE}"
echo "微信登录：真实接口"
echo "演示数据：禁用"

if [[ "$CHECK_ONLY" == "true" ]]; then
  echo "检查通过，未修改容器或数据库。"
  exit 0
fi

TIMEOUT_SECONDS="${DEPLOY_TIMEOUT_SECONDS:-180}"
if [[ ! "$TIMEOUT_SECONDS" =~ ^[0-9]+$ || "$TIMEOUT_SECONDS" -lt 30 ]]; then
  abort_deploy "DEPLOY_TIMEOUT_SECONDS 必须是大于等于 30 的整数。"
fi

log_step "构建 API、Worker、迁移与管理后台镜像"
if [[ "${DEPLOY_PULL_BASE_IMAGES:-true}" == "false" ]]; then
  echo "提示：已跳过基础镜像拉取，使用本地缓存构建。"
  compose build migrate api worker admin-web
else
  compose build --pull migrate api worker admin-web
fi
DEPLOYMENT_STARTED=true

log_step "启动并等待 PostgreSQL、Redis 与 MinIO"
compose up -d --wait --wait-timeout "$TIMEOUT_SECONDS" postgres redis minio

log_step "重建并等待 PgBouncer"
# PostgreSQL 容器地址变化后，重建连接池可清除旧 DNS/连接缓存。
compose up -d --no-deps --force-recreate --wait --wait-timeout "$TIMEOUT_SECONDS" pgbouncer

if [[ "${DEPLOY_SKIP_BACKUP:-false}" != "true" ]]; then
  log_step "备份 PostgreSQL"
  BACKUP_DIR="${DEPLOY_BACKUP_DIR:-${ROOT_DIR}/.deploy-backups}"
  mkdir -p "$BACKUP_DIR"
  revision="$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
  BACKUP_FILE="${BACKUP_DIR}/tutor-link-$(date '+%Y%m%d-%H%M%S')-${revision}.dump"
  backup_tmp="${BACKUP_FILE}.tmp"
  TEMP_FILES+=("$backup_tmp")
  compose exec -T postgres sh -eu -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$backup_tmp"
  if [[ ! -s "$backup_tmp" ]]; then
    abort_deploy "PostgreSQL 备份文件为空。"
  fi
  compose exec -T postgres pg_restore --list <"$backup_tmp" >/dev/null
  mv "$backup_tmp" "$BACKUP_FILE"
  echo "数据库备份：${BACKUP_FILE}"
else
  echo "警告：已按 DEPLOY_SKIP_BACKUP=true 跳过数据库备份。" >&2
fi

log_step "执行增量数据库迁移与幂等基础初始化"
compose run --rm --no-deps migrate

log_step "替换 API、Worker 与管理后台容器"
compose up -d --no-deps --force-recreate --wait --wait-timeout "$TIMEOUT_SECONDS" api worker admin-web

log_step "切换网关前验证 API、Worker 与管理后台容器"
verify_api_containers
verify_worker
verify_runtime_service admin-web

log_step "替换网关容器"
compose up -d --no-deps --force-recreate --wait --wait-timeout "$TIMEOUT_SECONDS" gateway

if [[ -n "${DEPLOY_BASE_URL:-}" ]]; then
  VERIFY_BASE_URL="${DEPLOY_BASE_URL%/}"
else
  gateway_binding="$(compose port gateway 80 | head -n 1)"
  gateway_port="${gateway_binding##*:}"
  if [[ ! "$gateway_port" =~ ^[0-9]+$ ]]; then
    abort_deploy "无法识别 Gateway 对外端口：${gateway_binding}"
  fi
  VERIFY_BASE_URL="http://127.0.0.1:${gateway_port}"
fi

log_step "验证 Gateway 健康检查"
wait_for_http "${VERIFY_BASE_URL}/health" "健康检查"
health_body_file="$LAST_HTTP_BODY_FILE"
if ! grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' "$health_body_file" \
  || ! grep -q '"service"[[:space:]]*:[[:space:]]*"tutor-link-api"' "$health_body_file"; then
  abort_deploy "/health 返回了非本项目服务。请检查端口是否指向其他 Compose 项目。"
fi

log_step "验证平台总览接口"
wait_for_http "${VERIFY_BASE_URL}/api/v1/platform/overview" "平台总览接口"
overview_body_file="$LAST_HTTP_BODY_FILE"
if ! grep -q '"brand"[[:space:]]*:' "$overview_body_file" \
  || ! grep -q '"trustHighlights"[[:space:]]*:' "$overview_body_file" \
  || ! grep -q '"metrics"[[:space:]]*:' "$overview_body_file"; then
  abort_deploy "平台总览响应缺少预期字段，可能仍有旧 API 副本。"
fi

log_step "验证管理后台入口"
wait_for_http "${VERIFY_BASE_URL}/" "管理后台入口"
admin_body_file="$LAST_HTTP_BODY_FILE"
if ! grep -q '<div id="app"></div>' "$admin_body_file" \
  || ! grep -q '<title>家教直聘 · 管理后台</title>' "$admin_body_file"; then
  abort_deploy "管理后台入口响应不是预期页面。"
fi

echo
echo "部署成功。"
echo "验证地址：${VERIFY_BASE_URL}"
echo "健康检查：200 OK"
echo "平台总览：200 OK（brand / trustHighlights / metrics 已验证）"
if [[ -n "$BACKUP_FILE" ]]; then
  echo "数据库备份：${BACKUP_FILE}"
fi
compose ps || true
trap - ERR
