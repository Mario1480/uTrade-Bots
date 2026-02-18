#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:4000}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/utrade_part_enforce.cookie}"
SYMBOL="${SYMBOL:-BTCUSDT}"
MARKET_TYPE="${MARKET_TYPE:-perp}"
TIMEFRAME="${TIMEFRAME:-15m}"
SIGNAL_SOURCE="${SIGNAL_SOURCE:-local}"
PNL_THRESHOLD="${PNL_THRESHOLD:--0.05}"
SL_THRESHOLD="${SL_THRESHOLD:-20}"
MIN_SAMPLE="${MIN_SAMPLE:-30}"
ROLLBACK_STRATEGY_ID="${ROLLBACK_STRATEGY_ID:-}"
APPLY_ROLLBACK=0

usage() {
  cat <<'EOF'
Usage:
  scripts/part_enforce_guard.sh [options]

Options:
  --base-url URL                 API base URL (default: http://localhost:4000)
  --cookie-file PATH             Cookie file (default: /tmp/utrade_part_enforce.cookie)
  --symbol SYMBOL                Symbol filter (default: BTCUSDT)
  --market-type TYPE             spot|perp (default: perp)
  --timeframe TF                 5m|15m|1h|4h|1d (default: 15m)
  --signal-source SOURCE         local|ai (default: local)
  --pnl-threshold VALUE          Rollback if avgOutcomePnlPct < VALUE (default: -0.05)
  --sl-threshold VALUE           Rollback if SL >= VALUE (default: 20)
  --min-sample VALUE             Minimum sample size before decision (default: 30)
  --rollback-strategy-id ID      Target strategy id for rollback (required with --apply)
  --apply                        Execute rollback when rule matches (default: dry-run)
  -h, --help                     Show this help

Environment:
  ADMIN_EMAIL / ADMIN_PASSWORD are used for API login.
  If missing, script will try to load them from .env in current directory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --cookie-file) COOKIE_FILE="$2"; shift 2 ;;
    --symbol) SYMBOL="$2"; shift 2 ;;
    --market-type) MARKET_TYPE="$2"; shift 2 ;;
    --timeframe) TIMEFRAME="$2"; shift 2 ;;
    --signal-source) SIGNAL_SOURCE="$2"; shift 2 ;;
    --pnl-threshold) PNL_THRESHOLD="$2"; shift 2 ;;
    --sl-threshold) SL_THRESHOLD="$2"; shift 2 ;;
    --min-sample) MIN_SAMPLE="$2"; shift 2 ;;
    --rollback-strategy-id) ROLLBACK_STRATEGY_ID="$2"; shift 2 ;;
    --apply) APPLY_ROLLBACK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  echo "error: missing ADMIN_EMAIL / ADMIN_PASSWORD" >&2
  exit 1
fi

if [[ "$APPLY_ROLLBACK" -eq 1 && -z "$ROLLBACK_STRATEGY_ID" ]]; then
  echo "error: --rollback-strategy-id is required with --apply" >&2
  exit 1
fi

api_get() {
  curl --retry 4 --retry-all-errors --retry-delay 1 -sS -b "$COOKIE_FILE" "$@"
}

api_post_json() {
  local url="$1"
  local data="$2"
  curl --retry 4 --retry-all-errors --retry-delay 1 -sS \
    -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
    -H "content-type: application/json" \
    -X POST "$url" \
    --data "$data"
}

float_lt() {
  awk -v a="$1" -v b="$2" 'BEGIN { exit !(a < b) }'
}

echo "[guard] login..."
LOGIN_JSON="$(
  api_post_json \
    "$BASE_URL/auth/login" \
    "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
)"
if [[ "$(jq -r '.user.id // empty' <<<"$LOGIN_JSON")" == "" ]]; then
  echo "error: login failed: $LOGIN_JSON" >&2
  exit 1
fi

echo "[guard] load running state..."
RUNNING_JSON="$(api_get "$BASE_URL/api/predictions/running")"
RUNNING_ITEM="$(
  jq -c --arg symbol "$SYMBOL" --arg market "$MARKET_TYPE" --arg tf "$TIMEFRAME" '
    [.items[] | select(.symbol==$symbol and .marketType==$market and .timeframe==$tf)][0] // {}
  ' <<<"$RUNNING_JSON"
)"
STATE_ID="$(jq -r '.id // empty' <<<"$RUNNING_ITEM")"
ACCOUNT_ID="$(jq -r '.exchangeAccountId // empty' <<<"$RUNNING_ITEM")"
CURRENT_STRATEGY_ID="$(jq -r '.localStrategyId // empty' <<<"$RUNNING_ITEM")"
CURRENT_STRATEGY_NAME="$(jq -r '.localStrategyName // empty' <<<"$RUNNING_ITEM")"

if [[ -z "$STATE_ID" || -z "$ACCOUNT_ID" ]]; then
  echo "error: no running prediction scope found for $SYMBOL $MARKET_TYPE $TIMEFRAME" >&2
  exit 1
fi

echo "[guard] load quality metrics..."
QUALITY_JSON="$(
  curl --retry 4 --retry-all-errors --retry-delay 1 -sS -b "$COOKIE_FILE" --get \
    "$BASE_URL/api/predictions/quality" \
    --data-urlencode "symbol=$SYMBOL" \
    --data-urlencode "timeframe=$TIMEFRAME" \
    --data-urlencode "signalSource=$SIGNAL_SOURCE"
)"
if [[ "$(jq -r '.error // empty' <<<"$QUALITY_JSON")" != "" ]]; then
  echo "error: quality endpoint failed: $QUALITY_JSON" >&2
  exit 1
fi

SAMPLE_SIZE="$(jq -r '.sampleSize // 0' <<<"$QUALITY_JSON")"
TP_COUNT="$(jq -r '.tp // 0' <<<"$QUALITY_JSON")"
SL_COUNT="$(jq -r '.sl // 0' <<<"$QUALITY_JSON")"
EXPIRED_COUNT="$(jq -r '.expired // 0' <<<"$QUALITY_JSON")"
SKIPPED_COUNT="$(jq -r '.skipped // 0' <<<"$QUALITY_JSON")"
AVG_PNL="$(jq -r '.avgOutcomePnlPct // "null"' <<<"$QUALITY_JSON")"
WIN_RATE="$(jq -r '.winRatePct // "null"' <<<"$QUALITY_JSON")"
ACTIONABLE=$(( SAMPLE_SIZE - SKIPPED_COUNT ))

COND_MIN_SAMPLE=0
COND_PNL=0
COND_SL=0
DECISION="keep"
REASON="conditions_not_met"

if (( SAMPLE_SIZE >= MIN_SAMPLE )); then
  COND_MIN_SAMPLE=1
else
  REASON="insufficient_sample"
fi

if [[ "$AVG_PNL" != "null" ]] && float_lt "$AVG_PNL" "$PNL_THRESHOLD"; then
  COND_PNL=1
fi
if (( SL_COUNT >= SL_THRESHOLD )); then
  COND_SL=1
fi

if (( COND_MIN_SAMPLE == 1 && COND_PNL == 1 && COND_SL == 1 )); then
  DECISION="rollback"
  REASON="avg_pnl_below_threshold_and_sl_above_threshold"
fi

jq -n \
  --arg now "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg symbol "$SYMBOL" \
  --arg marketType "$MARKET_TYPE" \
  --arg timeframe "$TIMEFRAME" \
  --arg signalSource "$SIGNAL_SOURCE" \
  --arg stateId "$STATE_ID" \
  --arg accountId "$ACCOUNT_ID" \
  --arg currentStrategyId "$CURRENT_STRATEGY_ID" \
  --arg currentStrategyName "$CURRENT_STRATEGY_NAME" \
  --arg decision "$DECISION" \
  --arg reason "$REASON" \
  --arg applyRollback "$APPLY_ROLLBACK" \
  --arg rollbackStrategyId "$ROLLBACK_STRATEGY_ID" \
  --argjson sampleSize "$SAMPLE_SIZE" \
  --argjson actionable "$ACTIONABLE" \
  --argjson tp "$TP_COUNT" \
  --argjson sl "$SL_COUNT" \
  --argjson expired "$EXPIRED_COUNT" \
  --argjson skipped "$SKIPPED_COUNT" \
  --argjson avgOutcomePnlPct "$(jq -n "$AVG_PNL")" \
  --argjson winRatePct "$(jq -n "$WIN_RATE")" \
  --argjson minSample "$MIN_SAMPLE" \
  --argjson pnlThreshold "$PNL_THRESHOLD" \
  --argjson slThreshold "$SL_THRESHOLD" \
  --argjson condMinSample "$COND_MIN_SAMPLE" \
  --argjson condPnl "$COND_PNL" \
  --argjson condSl "$COND_SL" \
  '{
    ts: $now,
    scope: {
      symbol: $symbol,
      marketType: $marketType,
      timeframe: $timeframe,
      signalSource: $signalSource
    },
    running: {
      stateId: $stateId,
      exchangeAccountId: $accountId,
      localStrategyId: $currentStrategyId,
      localStrategyName: $currentStrategyName
    },
    thresholds: {
      minSample: $minSample,
      avgOutcomePnlPctLt: $pnlThreshold,
      slGte: $slThreshold
    },
    stats: {
      sampleSize: $sampleSize,
      actionable: $actionable,
      tp: $tp,
      sl: $sl,
      expired: $expired,
      skipped: $skipped,
      winRatePct: $winRatePct,
      avgOutcomePnlPct: $avgOutcomePnlPct
    },
    checks: {
      minSampleOk: ($condMinSample == 1),
      pnlConditionOk: ($condPnl == 1),
      slConditionOk: ($condSl == 1)
    },
    decision: $decision,
    reason: $reason,
    applyRequested: ($applyRollback == "1"),
    rollbackStrategyId: (if $rollbackStrategyId == "" then null else $rollbackStrategyId end)
  }'

if [[ "$DECISION" != "rollback" ]]; then
  echo "[guard] no rollback executed"
  exit 0
fi

if [[ "$APPLY_ROLLBACK" -ne 1 ]]; then
  echo "[guard] rollback recommended (dry-run). Re-run with --apply --rollback-strategy-id <id>."
  exit 0
fi

if [[ "$ROLLBACK_STRATEGY_ID" == "$CURRENT_STRATEGY_ID" ]]; then
  echo "error: rollback target strategy equals current strategy id ($CURRENT_STRATEGY_ID)" >&2
  exit 1
fi

echo "[guard] rollback apply: delete old schedule..."
DELETE_JSON="$(api_post_json "$BASE_URL/api/predictions/$STATE_ID/delete-schedule" "{}")"
if [[ "$(jq -r '.ok // empty' <<<"$DELETE_JSON")" != "true" ]]; then
  echo "error: delete-schedule failed: $DELETE_JSON" >&2
  exit 1
fi

echo "[guard] rollback apply: create new schedule with target strategy..."
GENERATE_JSON="$(
  api_post_json \
    "$BASE_URL/api/predictions/generate-auto" \
    "{\"exchangeAccountId\":\"$ACCOUNT_ID\",\"symbol\":\"$SYMBOL\",\"marketType\":\"$MARKET_TYPE\",\"timeframe\":\"$TIMEFRAME\",\"strategyRef\":{\"kind\":\"local\",\"id\":\"$ROLLBACK_STRATEGY_ID\"}}"
)"
if [[ "$(jq -r '.strategyRef.id // empty' <<<"$GENERATE_JSON")" != "$ROLLBACK_STRATEGY_ID" ]]; then
  echo "error: generate-auto failed or wrong strategy: $GENERATE_JSON" >&2
  exit 1
fi

echo "[guard] rollback applied successfully"
echo "$GENERATE_JSON" | jq '{predictionId,localStrategyId,localStrategyName,strategyRef,signal,confidence}'
