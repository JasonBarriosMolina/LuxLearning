#!/usr/bin/env bash
# hq-provision-env.sh — create (or bring up to date) all Lux HQ infrastructure for one env.
# Usage: scripts/hq-provision-env.sh test|staging|prod   (prod needs HQ_CONFIRM_PROD=yes)
#
# Idempotent. Creates what is missing and leaves what exists:
#   1. Platform DB + secret (scripts/platform-db-provision.mjs) and migrations
#   2. Cognito pool lux-hq-staff-<env>: admin-only sign-up, TOTP MFA required, groups, web client
#   3. IAM role lux-platform-<env>-role (logs, its DB secret, SES from noreply@ only)
#   4. Log group (30-day retention) and the lux-platform Lambda; env vars merged, never wiped
#   5. API Gateway: integration, JWT authorizer, /public/* and /hq/* routes, invoke permissions,
#      and the HQ origin added to CORS
# Does not create staff users. See docs/reference/lux-hq.md.
set -euo pipefail
ENV="${1:-}"
case "$ENV" in
  test)    API=hxnd6tzmce; FN=lux-platform-test;    HQ_ORIGIN=https://hq-test.luxlearning.academy ;;
  staging) API=1ohrw48nii; FN=lux-platform-staging; HQ_ORIGIN=https://hq-staging.luxlearning.academy ;;
  prod)    API=v4vabtmerb; FN=lux-platform;         HQ_ORIGIN=https://hq.luxlearning.academy ;;
  *) echo "Usage: $0 test|staging|prod"; exit 1 ;;
esac
if [ "$ENV" = prod ] && [ "${HQ_CONFIRM_PROD:-}" != yes ]; then echo "Refusing to touch prod without HQ_CONFIRM_PROD=yes"; exit 1; fi

export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
ACC=798694628803
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ROLE="lux-platform-$ENV-role"
POOL_NAME="lux-hq-staff-$ENV"
TAGS_KV="Key=Project,Value=LuxLearning Key=Env,Value=$ENV Key=App,Value=lux-hq"
step() { printf '\n==> %s\n' "$1"; }

step "1. Platform database"
(cd "$ROOT" && node scripts/platform-db-provision.mjs "$ENV" && node scripts/platform-db-migrate.mjs "$ENV")
SECRET_ARN=$(aws secretsmanager describe-secret --secret-id "lux/platform-db-$ENV" --query ARN --output text)

step "2. Cognito pool $POOL_NAME"
POOL=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)
if [ "$POOL" = None ] || [ -z "$POOL" ]; then
  POOL=$(aws cognito-idp create-user-pool --pool-name "$POOL_NAME" \
    --username-attributes email --auto-verified-attributes email --mfa-configuration OFF \
    --admin-create-user-config AllowAdminCreateUserOnly=true \
    --policies 'PasswordPolicy={MinimumLength=12,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true,TemporaryPasswordValidityDays=7}' \
    --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
    --deletion-protection ACTIVE --user-pool-tags "Project=LuxLearning,Env=$ENV,App=lux-hq" \
    --query UserPool.Id --output text)
  echo "created pool $POOL"
fi
# Pools can't be created with MFA required unless SMS is configured; turn on TOTP-only afterwards.
aws cognito-idp set-user-pool-mfa-config --user-pool-id "$POOL" \
  --software-token-mfa-configuration Enabled=true --mfa-configuration ON --query MfaConfiguration --output text >/dev/null
for g in OWNER MARKETING DEV DATA; do
  case $g in OWNER) d="Duenos de Lux Learning: acceso total";; MARKETING) d="Marketing y ventas: demos y postulaciones";; DEV) d="Desarrollo";; DATA) d="Datos y analitica";; esac
  aws cognito-idp create-group --user-pool-id "$POOL" --group-name $g --description "$d" >/dev/null 2>&1 || true
done
CLIENT=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL" --query "UserPoolClients[?ClientName=='lux-hq-web'].ClientId | [0]" --output text)
if [ "$CLIENT" = None ] || [ -z "$CLIENT" ]; then
  CLIENT=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL" --client-name lux-hq-web --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH --prevent-user-existence-errors ENABLED \
    --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 12 \
    --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=hours \
    --enable-token-revocation --query UserPoolClient.ClientId --output text)
fi
echo "pool $POOL · client $CLIENT"

step "3. IAM role $ROLE"
cat > "$TMP/trust.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
cat > "$TMP/policy.json" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],
  "Resource":["arn:aws:logs:us-east-1:$ACC:log-group:/aws/lambda/$FN","arn:aws:logs:us-east-1:$ACC:log-group:/aws/lambda/$FN:*"]},
 {"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"$SECRET_ARN"},
 {"Effect":"Allow","Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"*","Condition":{"StringEquals":{"ses:FromAddress":"noreply@luxlearning.academy"}}}
]}
JSON
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$TMP/trust.json" --tags $TAGS_KV >/dev/null
  echo "created role (waiting for IAM to propagate)"; sleep 10
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name "lux-platform-$ENV-inline" --policy-document "file://$TMP/policy.json"

step "4. Lambda $FN"
aws logs create-log-group --log-group-name "/aws/lambda/$FN" --tags "Project=LuxLearning,Env=$ENV" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "/aws/lambda/$FN" --retention-in-days 30
BUILD_ONLY=1 "$ROOT/scripts/deploy-platform.sh" "$ENV"
ZIP="$ROOT/services/api/dist/platform/lux-platform.zip"
# Desired values; existing vars are kept and IP_HASH_SALT is only generated once.
python3 - "$SECRET_ARN" "$HQ_ORIGIN" > "$TMP/desired.json" <<'PY'
import json, sys
print(json.dumps({"PLATFORM_DB_SECRET_ARN": sys.argv[1], "SALES_EMAIL": "sales@luxlearning.academy",
  "TALENT_EMAIL": "talent@luxlearning.academy", "SES_FROM_EMAIL": "noreply@luxlearning.academy", "HQ_URL": sys.argv[2]}))
PY
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  aws lambda get-function-configuration --function-name "$FN" --query "Environment.Variables" --output json > "$TMP/current.json"
  aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" --query LastUpdateStatus --output text >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FN"
else
  echo '{}' > "$TMP/current.json"
fi
python3 - "$TMP/current.json" "$TMP/desired.json" > "$TMP/env.json" <<'PY'
import json, secrets, sys
cur = json.load(open(sys.argv[1])) or {}
cur.update(json.load(open(sys.argv[2])))
cur.setdefault("IP_HASH_SALT", secrets.token_hex(16))
print(json.dumps({"Variables": cur}))
PY
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  aws lambda update-function-configuration --function-name "$FN" --environment "file://$TMP/env.json" \
    --description "Lux HQ platform API (demos, teacher applications, staff) - $ENV" --query LastUpdateStatus --output text >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FN"
else
  for i in 1 2 3 4 5 6; do
    if aws lambda create-function --function-name "$FN" --runtime nodejs20.x --architectures arm64 \
      --role "arn:aws:iam::$ACC:role/$ROLE" --handler index.handler --timeout 15 --memory-size 256 \
      --environment "file://$TMP/env.json" --zip-file "fileb://$ZIP" \
      --description "Lux HQ platform API (demos, teacher applications, staff) - $ENV" \
      --tags "Project=LuxLearning,Env=$ENV,App=lux-hq" --query FunctionName --output text >/dev/null; then break; fi
    echo "waiting for IAM role..."; sleep 8
  done
  aws lambda wait function-active-v2 --function-name "$FN"
fi
echo "lambda ready"

step "5. API Gateway $API"
FN_ARN="arn:aws:lambda:us-east-1:$ACC:function:$FN"
INTEG=$(aws apigatewayv2 get-integrations --api-id $API --query "Items[?IntegrationUri=='$FN_ARN'].IntegrationId | [0]" --output text)
if [ "$INTEG" = None ] || [ -z "$INTEG" ]; then
  INTEG=$(aws apigatewayv2 create-integration --api-id $API --integration-type AWS_PROXY --integration-uri "$FN_ARN" \
    --payload-format-version 2.0 --query IntegrationId --output text)
fi
AUTH=$(aws apigatewayv2 get-authorizers --api-id $API --query "Items[?Name=='lux-hq-jwt-$ENV'].AuthorizerId | [0]" --output text)
if [ "$AUTH" = None ] || [ -z "$AUTH" ]; then
  AUTH=$(aws apigatewayv2 create-authorizer --api-id $API --name "lux-hq-jwt-$ENV" --authorizer-type JWT \
    --identity-source '$request.header.Authorization' \
    --jwt-configuration "Audience=$CLIENT,Issuer=https://cognito-idp.us-east-1.amazonaws.com/$POOL" \
    --query AuthorizerId --output text)
fi
existing=$(aws apigatewayv2 get-routes --api-id $API --query "Items[].RouteKey" --output text | tr '\t' '\n')
route() {
  local key="$1"; shift
  if grep -qxF "$key" <<<"$existing"; then return; fi
  aws apigatewayv2 create-route --api-id $API --route-key "$key" --target "integrations/$INTEG" "$@" --query RouteKey --output text
}
route "POST /public/demo-requests" --authorization-type NONE
route "POST /public/teacher-applications" --authorization-type NONE
for key in "GET /hq/me" "GET /hq/leads" "GET /hq/leads/{id}" "PATCH /hq/leads/{id}" "POST /hq/leads/{id}/notes" \
           "GET /hq/teachers" "GET /hq/teachers/{id}" "PATCH /hq/teachers/{id}" "POST /hq/teachers/{id}/notes"; do
  route "$key" --authorization-type JWT --authorizer-id "$AUTH"
done
for p in public hq; do
  aws lambda add-permission --function-name "$FN" --statement-id "ApiGw-$ENV-$p" --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:$ACC:$API/*/*/$p/*" >/dev/null 2>&1 || true
done
# Add the HQ origin to the API's CORS list, keeping every existing setting.
aws apigatewayv2 get-api --api-id $API --query CorsConfiguration --output json > "$TMP/cors.json"
python3 - "$TMP/cors.json" "$HQ_ORIGIN" > "$TMP/cors-new.json" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])) or {}
origins = c.get("AllowOrigins", [])
if sys.argv[2] not in origins: origins.append(sys.argv[2])
c["AllowOrigins"] = origins
print(json.dumps(c))
PY
aws apigatewayv2 update-api --api-id $API --cors-configuration "file://$TMP/cors-new.json" --query "CorsConfiguration.AllowOrigins" --output text

step "Done ($ENV)"
cat <<OUT
  Lambda        $FN
  DB secret     lux/platform-db-$ENV
  Cognito pool  $POOL_NAME · $POOL
  App client    lux-hq-web · $CLIENT
  Authorizer    lux-hq-jwt-$ENV · $AUTH
  Integration   $INTEG
  API           https://$API.execute-api.us-east-1.amazonaws.com
  HQ origin     $HQ_ORIGIN
OUT
