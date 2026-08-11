param(
  [Parameter(Mandatory)][ValidateSet('test','staging','prod')] [string] $Env
)
# Switches ALL API Gateway routes (v4vabtmerb) to the target environment's Lambda functions.
# Usage:
#   .\scripts\switch-environment.ps1 test
#   .\scripts\switch-environment.ps1 staging
#   .\scripts\switch-environment.ps1 prod

$API_ID   = 'v4vabtmerb'
$REGION   = 'us-east-1'
$ACCOUNT  = '798694628803'
$AUTH_ID  = 'zsk60q'

$SUFFIX = if ($Env -eq 'prod') { '' } else { "-$Env" }
Write-Host "Switching all routes to: $Env (Lambda suffix: '$SUFFIX')"

# ── Step 1: build integration map (lambda-name -> integration-id) ──────────────
$integrations = aws apigatewayv2 get-integrations --api-id $API_ID --output json | ConvertFrom-Json

# Index existing integrations by function name
$existingByFn = @{}
foreach ($i in $integrations.Items) {
  $fn = $i.IntegrationUri -replace ".*:function:", ""
  $existingByFn[$fn] = $i.IntegrationId
}

# Base Lambda names (without environment suffix)
$baseLambdas = @(
  'lux-admin','lux-evaluator','lux-courses','lux-quiz','lux-reflection',
  'lux-certs','lux-reports','lux-tasks','lux-messages','lux-lessons',
  'lux-notifs','lux-push','lux-attendance'
)

$targetIntegMap = @{} # base-name -> integration-id for target env

foreach ($base in $baseLambdas) {
  $targetFn = "$base$SUFFIX"
  if ($existingByFn.ContainsKey($targetFn)) {
    $targetIntegMap[$base] = $existingByFn[$targetFn]
  } else {
    # Create integration
    Write-Host "  Creating integration for $targetFn..."
    $uri = "arn:aws:lambda:$REGION`:$ACCOUNT`:function:$targetFn"
    $result = aws apigatewayv2 create-integration `
      --api-id $API_ID --integration-type AWS_PROXY --integration-method POST `
      --integration-uri $uri --payload-format-version '2.0' --timeout-in-millis 30000 `
      --output json | ConvertFrom-Json
    $targetIntegMap[$base] = $result.IntegrationId
    # Add invoke permission
    aws lambda add-permission --function-name $targetFn --statement-id "ApiGw-$Env-invoke" `
      --action 'lambda:InvokeFunction' --principal 'apigateway.amazonaws.com' `
      --source-arn "arn:aws:execute-api:$REGION`:$ACCOUNT`:$API_ID`/*/*" 2>&1 | Out-Null
  }
}

# ── Step 2: update all routes ──────────────────────────────────────────────────
$routes = aws apigatewayv2 get-routes --api-id $API_ID --output json | ConvertFrom-Json

# Build current integration-id -> base Lambda name map
$integToBase = @{}
foreach ($i in $integrations.Items) {
  $fn = $i.IntegrationUri -replace ".*:function:", "" # e.g. lux-admin-test
  $base = $fn -replace "-test$|-staging$", ""          # e.g. lux-admin
  $integToBase[$i.IntegrationId] = $base
}

$updated = 0; $skipped = 0
foreach ($r in $routes.Items) {
  $integId  = $r.Target -replace "integrations/", ""
  $baseName = $integToBase[$integId]
  if (-not $baseName) { $skipped++; continue }

  $newIntegId = $targetIntegMap[$baseName]
  if (-not $newIntegId) { Write-Host "  WARN: no integration for $baseName -> skipping $($r.RouteKey)"; $skipped++; continue }

  if ($integId -eq $newIntegId) { $skipped++; continue } # already correct

  $authArgs = if ($r.AuthorizationType -eq 'CUSTOM') {
    @('--authorization-type','CUSTOM','--authorizer-id',$AUTH_ID)
  } else {
    @('--authorization-type','NONE')
  }

  aws apigatewayv2 update-route --api-id $API_ID --route-id $r.RouteId `
    --target "integrations/$newIntegId" @authArgs --output json | Out-Null
  $updated++
}

Write-Host ""
Write-Host "Done. Updated: $updated routes | Skipped: $skipped"
Write-Host "All traffic now routed to: $Env Lambda functions."
