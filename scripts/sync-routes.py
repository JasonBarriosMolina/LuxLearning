#!/usr/bin/env python3
"""
sync-routes.py — Syncs API Gateway routes from infra/api-routes.json.

Usage:
  python scripts/sync-routes.py --env test
  python scripts/sync-routes.py --env staging
  python scripts/sync-routes.py --env prod

Adds missing routes to the target API GW. Never deletes existing routes.
Idempotent — safe to run multiple times.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
ROUTES_FILE = ROOT / "infra" / "api-routes.json"
ENVS_FILE   = ROOT / "infra" / "environments.json"


def run(cmd: list[str]) -> dict:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}", file=sys.stderr)
        return {}
    return json.loads(result.stdout) if result.stdout.strip() else {}


def get_existing_routes(api_id: str) -> set[str]:
    data = run(["aws", "apigatewayv2", "get-routes", "--api-id", api_id, "--output", "json"])
    return {item["RouteKey"] for item in data.get("Items", [])}


def get_integrations(api_id: str) -> dict[str, str]:
    """Returns {lambda_base_name: integration_id}"""
    data = run(["aws", "apigatewayv2", "get-integrations", "--api-id", api_id, "--output", "json"])
    result = {}
    for item in data.get("Items", []):
        uri = item.get("IntegrationUri", "")
        if "function:" in uri:
            fname = uri.split("function:")[1].split("/")[0].split(":")[0]
            # Strip lux- prefix to get base name
            if fname.startswith("lux-"):
                base = fname[4:]  # e.g. "lux-admin-test" → "admin-test"
                result[base] = item["IntegrationId"]
                result[fname] = item["IntegrationId"]  # also store full name
    return result


def ensure_permission(function_name: str, api_id: str, region: str, account: str):
    """Adds invoke permission for the API GW wildcard. Idempotent via statement-id."""
    sid = f"ApiGw-{api_id}"
    source_arn = f"arn:aws:execute-api:{region}:{account}:{api_id}/*/*/*"
    run([
        "aws", "lambda", "add-permission",
        "--function-name", function_name,
        "--statement-id", sid,
        "--action", "lambda:InvokeFunction",
        "--principal", "apigateway.amazonaws.com",
        "--source-arn", source_arn,
    ])
    # Ignore errors — usually means the permission already exists


def resolve_lambda_name(service: str, env_cfg: dict) -> str:
    """
    Resolves the full Lambda function name for a service in a given environment.
    Handles lambdaOverrides (e.g. attendance → lux-attendance-test across all envs).
    """
    overrides = env_cfg.get("lambdaOverrides", {})
    if service in overrides:
        return overrides[service]
    suffix = env_cfg["suffix"]
    return f"lux-{service}{suffix}"


def main():
    parser = argparse.ArgumentParser(description="Sync API GW routes from manifest")
    parser.add_argument("--env", required=True, choices=["test", "staging", "prod"],
                        help="Target environment")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be created without making changes")
    args = parser.parse_args()

    routes   = json.loads(ROUTES_FILE.read_text())
    envs     = json.loads(ENVS_FILE.read_text())
    env_cfg  = envs[args.env]

    api_id       = env_cfg["apiId"]
    authorizer   = env_cfg["authorizerId"]
    region       = env_cfg["region"]
    account      = env_cfg["account"]

    print(f"\n=== Syncing routes to {args.env} (API GW: {api_id}) ===\n")

    existing    = get_existing_routes(api_id)
    integrations = get_integrations(api_id)

    print(f"  Existing routes : {len(existing)}")
    print(f"  Manifest routes : {len(routes)}")

    added   = 0
    skipped = 0
    failed  = 0
    permissions_ensured: set[str] = set()

    for route in routes:
        method   = route["method"]
        path     = route["path"]
        service  = route["lambda"]
        needs_auth = route.get("auth", True)

        route_key = f"{method} {path}"

        if route_key in existing:
            skipped += 1
            continue

        # Resolve lambda name and integration
        lambda_name = resolve_lambda_name(service, env_cfg)
        suffix = env_cfg["suffix"]

        # Try to find integration: first by base name with suffix, then without, then full
        integ_id = (
            integrations.get(f"{service}{suffix}") or
            integrations.get(service) or
            integrations.get(lambda_name[4:]) or  # strip lux-
            integrations.get(lambda_name)
        )

        if not integ_id:
            print(f"  [SKIP] {route_key} — no integration found for '{lambda_name}'. "
                  f"Create the integration first.")
            failed += 1
            continue

        if args.dry_run:
            auth_label = f"auth={authorizer}" if needs_auth else "no-auth"
            print(f"  [DRY] Would create: {route_key} → {lambda_name} ({auth_label})")
            added += 1
            continue

        # Build create-route command
        cmd = [
            "aws", "apigatewayv2", "create-route",
            "--api-id", api_id,
            "--route-key", route_key,
            "--target", f"integrations/{integ_id}",
            "--output", "json",
        ]
        if needs_auth:
            cmd += ["--authorization-type", "CUSTOM", "--authorizer-id", authorizer]

        result = run(cmd)
        if result.get("RouteId"):
            print(f"  [ADDED]  {route_key} → {lambda_name}")
            added += 1

            # Ensure Lambda has permission for this API GW (once per lambda per run)
            if lambda_name not in permissions_ensured:
                ensure_permission(lambda_name, api_id, region, account)
                permissions_ensured.add(lambda_name)
        else:
            print(f"  [FAIL]   {route_key}")
            failed += 1

    print(f"\n=== Done ===")
    print(f"  Added   : {added}")
    print(f"  Skipped : {skipped} (already existed)")
    if failed:
        print(f"  Failed  : {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
