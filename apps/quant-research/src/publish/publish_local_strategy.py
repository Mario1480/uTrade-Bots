#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish optimized config.json to LocalStrategyDefinition via Admin API.")
    parser.add_argument("--strategy-id", required=True, help="Local strategy definition id.")
    parser.add_argument("--config-file", required=True, help="Path to config.json produced by run_vectorbt.py")
    parser.add_argument("--api-url", default=os.getenv("ADMIN_API_URL", "http://localhost:3001"))
    parser.add_argument("--auth-token", default=os.getenv("ADMIN_API_TOKEN"))
    parser.add_argument(
        "--session-cookie",
        default=os.getenv("ADMIN_SESSION_COOKIE"),
        help='Optional raw cookie header, e.g. "token=..."',
    )
    parser.add_argument("--timeout-ms", type=int, default=8000)
    parser.add_argument("--version", default=None, help="Explicit new version; defaults to patch-bumped current version.")
    parser.add_argument("--shadow-mode", choices=["true", "false"], default="true")
    parser.add_argument(
        "--skip-remote-check",
        choices=["true", "false"],
        default="false",
        help="Skip API GET /admin/local-strategies/:id (useful for offline dry-run).",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def normalize_base_url(raw: str) -> str:
    out = raw.strip()
    return out[:-1] if out.endswith("/") else out


def read_json(path: str) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise SystemExit(f"Config file not found: {file_path}")

    try:
        parsed = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise SystemExit(f"Invalid JSON in {file_path}: {error}")

    if not isinstance(parsed, dict):
        raise SystemExit("Config file must contain a JSON object.")

    return parsed


def get_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = {"content-type": "application/json"}
    if args.auth_token:
        headers["authorization"] = f"Bearer {args.auth_token.strip()}"
    if args.session_cookie:
        headers["cookie"] = args.session_cookie.strip()
    return headers


def parse_semver(value: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value.strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_patch(version: str) -> str:
    parsed = parse_semver(version)
    if not parsed:
        return "1.0.1"
    major, minor, patch = parsed
    return f"{major}.{minor}.{patch + 1}"


def fetch_existing(base_url: str, strategy_id: str, headers: dict[str, str], timeout_s: float) -> dict[str, Any]:
    url = f"{base_url}/admin/local-strategies/{strategy_id}"
    response = requests.get(url, headers=headers, timeout=timeout_s)
    if response.status_code >= 400:
        raise SystemExit(f"Fetch failed ({response.status_code}): {response.text[:800]}")

    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("item"), dict):
        raise SystemExit("Unexpected response shape from admin local-strategies endpoint.")

    return payload["item"]


def main() -> None:
    args = parse_args()
    base_url = normalize_base_url(args.api_url)
    headers = get_headers(args)
    skip_remote_check = args.skip_remote_check == "true"

    timeout_s = max(0.2, min(30.0, args.timeout_ms / 1000.0))

    config_payload = read_json(args.config_file)
    selected_params = config_payload.get("selectedParams")
    if not isinstance(selected_params, dict) or not selected_params:
        raise SystemExit("Config file must contain non-empty selectedParams object.")

    current_version = "1.0.0"
    if not skip_remote_check:
        existing = fetch_existing(base_url, args.strategy_id, headers, timeout_s)
        current_version = str(existing.get("version") or "1.0.0")
    next_version = args.version.strip() if isinstance(args.version, str) and args.version.strip() else bump_patch(current_version)

    body = {
        "configJson": selected_params,
        "version": next_version,
        "shadowMode": args.shadow_mode == "true",
    }

    if args.dry_run:
        print("publish_dry_run")
        print(f"strategy_id={args.strategy_id}")
        print(f"current_version={current_version}")
        print(f"next_version={next_version}")
        print(f"skip_remote_check={skip_remote_check}")
        print(json.dumps(body, indent=2))
        return

    url = f"{base_url}/admin/local-strategies/{args.strategy_id}"
    response = requests.put(url, headers=headers, json=body, timeout=timeout_s)
    if response.status_code >= 400:
        raise SystemExit(f"Publish failed ({response.status_code}): {response.text[:800]}")

    payload = response.json() if response.text.strip() else {}
    item = payload.get("item") if isinstance(payload, dict) else None

    print("publish_ok")
    print(f"strategy_id={args.strategy_id}")
    print(f"prev_version={current_version}")
    print(f"new_version={item.get('version') if isinstance(item, dict) else next_version}")
    print(f"shadow_mode={body['shadowMode']}")


if __name__ == "__main__":
    main()
