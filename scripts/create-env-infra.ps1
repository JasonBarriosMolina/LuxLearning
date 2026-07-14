# create-env-infra.ps1 — Creates a full isolated environment (test or staging)
# Usage: .\scripts\create-env-infra.ps1 -Env test
#        .\scripts\create-env-infra.ps1 -Env staging
#
# Creates: 16 Lambda functions, 1 API Gateway + all routes, S3 bucket, SQS queue
# Idempotent: re-running is safe (skips already-created resources)

param([Parameter(Mandatory)][ValidateSet('test','staging')][string]$Env)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$ACCOUNT    = "798694628803"
$REGION     = "us-east-1"
$SUFFIX     = "-$Env"          # "-test" or "-staging"  (lambdas, S3, SQS, API GW)
$ENVUP      = $Env.ToUpper()
# DynamoDB tables were created with Title Case suffix (-Test / -Staging)
$ENV_TITLE  = $Env.Substring(0,1).ToUpper() + $Env.Substring(1)
$DDB_SUFFIX = "-$ENV_TITLE"   # "-Test" or "-Staging"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Creating LUX $ENVUP environment infra" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ─── Resource names ──────────────────────────────────────────────────────────
$S3_BUCKET       = "lux-learning-images$SUFFIX"
$SQS_NAME        = "lux-reflection-queue$SUFFIX"
$API_NAME        = "lux-learning-api$SUFFIX"
$FRONTEND_URL    = "https://$Env.luxlearning.academy"

# Cognito pools
$COGNITO_POOL_TEST    = "us-east-1_239WWd87I"   # shared test+staging pool
$COGNITO_POOL_STAGING = "us-east-1_239WWd87I"
$COGNITO_POOL_ID = if ($Env -eq 'test') { $COGNITO_POOL_TEST } else { $COGNITO_POOL_STAGING }

# DB Secrets
$DB_SECRET_ARN_TEST    = "arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:lux/neon-db-test-FFtXaR"
$DB_SECRET_ARN_STAGING = "arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:lux/neon-db-staging-yTtxUR"
$DB_SECRET_ARN = if ($Env -eq 'test') { $DB_SECRET_ARN_TEST } else { $DB_SECRET_ARN_STAGING }

# IAM role (reuse same role as prod)
$LAMBDA_ROLE = "arn:aws:iam::${ACCOUNT}:role/LuxLearningStack-AdminFnServiceRoleABECE09B-3joj0UrDDiec"

# VAPID — read from prod Lambda to avoid hardcoding secrets in source
$prodVapidCfg = aws lambda get-function-configuration --function-name lux-admin --query "Environment.Variables" --output json | ConvertFrom-Json
$VAPID_PUBLIC  = $prodVapidCfg.VAPID_PUBLIC_KEY
$VAPID_PRIVATE = $prodVapidCfg.VAPID_PRIVATE_KEY
$VAPID_EMAIL   = $prodVapidCfg.VAPID_EMAIL

# DynamoDB table names for this environment (Title Case suffix: -Test / -Staging)
$DDB = @{
  PROGRESS        = "LessonProgress$DDB_SUFFIX"
  QUIZ            = "QuizAttempts$DDB_SUFFIX"
  REFLECTIONS     = "Reflections$DDB_SUFFIX"
  NOTIFS          = "Notifications$DDB_SUFFIX"
  ENROLLMENTS     = "Enrollments$DDB_SUFFIX"
  CERTIFICATES    = "Certificates$DDB_SUFFIX"
  PUSH_SUBS       = "PushSubscriptions$DDB_SUFFIX"
  TASKS           = "ScheduledTasks$DDB_SUFFIX"
  REPORT_ANALYSIS = "ReportAnalysis$DDB_SUFFIX"
  RECOMMENDATIONS = "CurriculumRecommendations$DDB_SUFFIX"
  ACTIVITY        = "LuxActivity$DDB_SUFFIX"
  CHATS           = "LuxChats$DDB_SUFFIX"
  MESSAGES        = "LuxMessages$DDB_SUFFIX"
  RESOURCES       = "LuxResources$DDB_SUFFIX"
  CERT_TEMPLATES  = "LuxCertTemplates$DDB_SUFFIX"
  EMAIL_TEMPLATES = "LuxEmailTemplates$DDB_SUFFIX"
  TRANSLATIONS    = "LuxTranslations$DDB_SUFFIX"
  CALENDAR        = "LuxCalendarEvents$DDB_SUFFIX"
}

$ENGINE_PATH = "/var/task/node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node"

# ─── Helpers ─────────────────────────────────────────────────────────────────
function Step([string]$msg) { Write-Host "`n>>> $msg" -ForegroundColor Yellow }
function Ok([string]$msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Skip([string]$msg) { Write-Host "    SKIP: $msg" -ForegroundColor DarkGray }

function Lambda-Exists([string]$name) {
  try { aws lambda get-function --function-name $name --output text --query 'Configuration.FunctionName' 2>$null | Out-Null; return $true }
  catch { return $false }
}

# ─── Step 0: DynamoDB tables ─────────────────────────────────────────────────
Step "DynamoDB tables"
# Tables that need a simple PK-only schema (billing: PAY_PER_REQUEST)
$DDB_SIMPLE = @{
  $DDB.CALENDAR = @{ pk = "creatorId"; pkType = "S"; sk = "eventId"; skType = "S" }
}
# Tables already expected to exist (created during initial infra setup)
$DDB_EXPECTED = @(
  $DDB.PROGRESS, $DDB.QUIZ, $DDB.REFLECTIONS, $DDB.NOTIFS, $DDB.ENROLLMENTS,
  $DDB.CERTIFICATES, $DDB.PUSH_SUBS, $DDB.TASKS, $DDB.REPORT_ANALYSIS,
  $DDB.RECOMMENDATIONS, $DDB.ACTIVITY, $DDB.CHATS, $DDB.MESSAGES,
  $DDB.RESOURCES, $DDB.CERT_TEMPLATES, $DDB.EMAIL_TEMPLATES, $DDB.TRANSLATIONS
)
$existingTables = aws dynamodb list-tables --query "TableNames" --output json | ConvertFrom-Json
foreach ($entry in $DDB_SIMPLE.GetEnumerator()) {
  $tName = $entry.Key
  $pk    = $entry.Value.pk
  $pkT   = $entry.Value.pkType
  $sk    = $entry.Value.sk
  $skT   = $entry.Value.skType
  if ($existingTables -contains $tName) {
    Skip "$tName already exists"
  } else {
    aws dynamodb create-table `
      --table-name $tName `
      --attribute-definitions "AttributeName=$pk,AttributeType=$pkT" "AttributeName=$sk,AttributeType=$skT" `
      --key-schema "AttributeName=$pk,KeyType=HASH" "AttributeName=$sk,KeyType=RANGE" `
      --billing-mode PAY_PER_REQUEST `
      --query "TableDescription.TableName" --output text | Out-Null
    Ok "Created $tName"
  }
}
foreach ($t in $DDB_EXPECTED) {
  if ($existingTables -contains $t) { Skip "$t exists" }
  else { Write-Host "  WARNING: $t does not exist - create it manually" -ForegroundColor Red }
}

# ─── Step 1: S3 Bucket ───────────────────────────────────────────────────────
Step "S3 bucket: $S3_BUCKET"
try {
  aws s3api head-bucket --bucket $S3_BUCKET 2>$null
  Skip "$S3_BUCKET already exists"
} catch {
  aws s3api create-bucket --bucket $S3_BUCKET --region $REGION | Out-Null
  $corsCfg = '{"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["GET","PUT","POST","DELETE"],"AllowedOrigins":["*"],"MaxAgeSeconds":3000}]}'
  $corsFile = "$env:TEMP\s3-cors.json"
  $noBomS3 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($corsFile, $corsCfg, $noBomS3)
  aws s3api put-bucket-cors --bucket $S3_BUCKET --cors-configuration "file://$corsFile" | Out-Null
  Ok "Created $S3_BUCKET"
}

# ─── Step 2: SQS Queue ───────────────────────────────────────────────────────
Step "SQS queue: $SQS_NAME"
$existingQueues = aws sqs list-queues --queue-name-prefix $SQS_NAME --query "QueueUrls" --output json | ConvertFrom-Json
if ($existingQueues -and $existingQueues.Count -gt 0) {
  $SQS_URL = $existingQueues[0]
  Skip "$SQS_NAME already exists: $SQS_URL"
} else {
  $SQS_URL = aws sqs create-queue --queue-name $SQS_NAME --query "QueueUrl" --output text
  Ok "Created $SQS_NAME -> $SQS_URL"
}

# ─── Step 3: Cognito App Client ───────────────────────────────────────────────
Step "Cognito client in pool $COGNITO_POOL_ID"
$existingClients = aws cognito-idp list-user-pool-clients --user-pool-id $COGNITO_POOL_ID --query "UserPoolClients[?ClientName=='lux-$Env-client'].ClientId" --output text
if ($existingClients -and $existingClients -ne 'None') {
  $COGNITO_CLIENT_ID = $existingClients.Trim()
  Skip "Client already exists: $COGNITO_CLIENT_ID"
} else {
  $COGNITO_CLIENT_ID = aws cognito-idp create-user-pool-client `
    --user-pool-id $COGNITO_POOL_ID `
    --client-name "lux-$Env-client" `
    --no-generate-secret `
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH `
    --query "UserPoolClient.ClientId" --output text
  Ok "Created Cognito client: $COGNITO_CLIENT_ID"
}

# ─── Step 4: Lambda functions ─────────────────────────────────────────────────
Step "Lambda functions (16)"

# Base env vars shared by all lambdas
$BASE_ENV = @{
  COGNITO_USER_POOL_ID         = $COGNITO_POOL_ID
  COGNITO_CLIENT_ID            = $COGNITO_CLIENT_ID
  BEDROCK_REGION               = $REGION
  S3_IMAGES_BUCKET             = $S3_BUCKET
  SQS_REFLECTION_QUEUE_URL     = $SQS_URL
  FRONTEND_URL                 = $FRONTEND_URL
  SES_FROM_EMAIL               = "jason.rbm@gmail.com"
  VAPID_PUBLIC_KEY             = $VAPID_PUBLIC
  VAPID_PRIVATE_KEY            = $VAPID_PRIVATE
  VAPID_EMAIL                  = $VAPID_EMAIL
  AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  DB_SECRET_ARN                = $DB_SECRET_ARN
  DB_SECRET_ARN_TEST           = $DB_SECRET_ARN_TEST
  DB_SECRET_ARN_STAGING        = $DB_SECRET_ARN_STAGING
  APP_ENV                      = $Env
  DYNAMO_TABLE_PROGRESS        = $DDB.PROGRESS
  DYNAMO_TABLE_QUIZ            = $DDB.QUIZ
  DYNAMO_TABLE_REFLECTIONS     = $DDB.REFLECTIONS
  DYNAMO_TABLE_NOTIFS          = $DDB.NOTIFS
  DYNAMO_TABLE_ENROLLMENTS     = $DDB.ENROLLMENTS
  DYNAMO_TABLE_CERTIFICATES    = $DDB.CERTIFICATES
  DYNAMO_TABLE_PUSH_SUBS       = $DDB.PUSH_SUBS
  DYNAMO_TABLE_TASKS           = $DDB.TASKS
  DYNAMO_TABLE_REPORT_ANALYSIS = $DDB.REPORT_ANALYSIS
  DYNAMO_TABLE_RECOMMENDATIONS = $DDB.RECOMMENDATIONS
  DYNAMO_TABLE_ACTIVITY        = $DDB.ACTIVITY
  DYNAMO_TABLE_CHATS           = $DDB.CHATS
  DYNAMO_TABLE_MESSAGES        = $DDB.MESSAGES
  DYNAMO_TABLE_RESOURCES       = $DDB.RESOURCES
  DYNAMO_TABLE_CERT_TEMPLATES  = $DDB.CERT_TEMPLATES
  DYNAMO_TABLE_EMAIL_TEMPLATES = $DDB.EMAIL_TEMPLATES
  DYNAMO_TABLE_TRANSLATIONS    = $DDB.TRANSLATIONS
  DYNAMO_TABLE_CALENDAR        = $DDB.CALENDAR
  PRISMA_QUERY_ENGINE_LIBRARY  = $ENGINE_PATH
}

# Lambda list: name -> uses Prisma (needs DB env vars)
$LAMBDAS = [ordered]@{
  "lux-admin"       = $true
  "lux-reflection"  = $true
  "lux-evaluator"   = $true
  "lux-courses"     = $true
  "lux-quiz"        = $true
  "lux-certs"       = $true
  "lux-analysis"    = $true
  "lux-reminders"   = $true
  "lux-reports"     = $true
  "lux-messages"    = $false
  "lux-sqsconsumer" = $false
  "lux-lessons"     = $true
  "lux-tasks"       = $false
  "lux-notifs"      = $false
  "lux-push"        = $false
  "lux-authorizer"  = $false
}

# Get the prod zip for each lambda to bootstrap the new function (same code, different env)
$noBom = New-Object System.Text.UTF8Encoding($false)
$tmpEnv = "$env:TEMP\lux-env-$Env.json"
$tmpZip = "$env:TEMP\lux-bootstrap.zip"

foreach ($baseName in $LAMBDAS.Keys) {
  $targetName = "$baseName$SUFFIX"
  $usesPrisma = $LAMBDAS[$baseName]

  if (Lambda-Exists $targetName) {
    Skip "$targetName already exists"
    continue
  }

  Write-Host "  Creating $targetName..." -ForegroundColor Cyan

  # Build env vars for this lambda
  $envVars = @{}
  $BASE_ENV.GetEnumerator() | ForEach-Object { $envVars[$_.Key] = $_.Value }
  if (-not $usesPrisma) {
    # Remove Prisma-specific vars for non-Prisma lambdas
    $envVars.Remove('PRISMA_QUERY_ENGINE_LIBRARY') | Out-Null
    $envVars.Remove('DB_SECRET_ARN') | Out-Null
  }

  # Write env JSON
  $envBody = @{ Variables = $envVars } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($tmpEnv, $envBody, $noBom)

  # Get prod function's code location to copy the zip
  $prodCode = aws lambda get-function --function-name $baseName --query "Code.Location" --output text 2>$null
  if (-not $prodCode -or $prodCode -eq 'None') {
    Write-Host "  WARNING: could not get prod code for $baseName - creating with placeholder" -ForegroundColor Yellow
    # Create minimal placeholder zip
    $placeholderPath = "$env:TEMP\placeholder.js"
    $placeholderJs = 'exports.handler = async function() { return { statusCode: 200, body: "placeholder" }; };'
    [System.IO.File]::WriteAllText($placeholderPath, $placeholderJs, $noBom)
    Compress-Archive -Path $placeholderPath -DestinationPath $tmpZip -Force
    $codeArg = @("--zip-file", "fileb://$tmpZip")
  } else {
    # Download the prod zip and reuse it
    Invoke-WebRequest -Uri $prodCode -OutFile $tmpZip -UseBasicParsing
    $codeArg = @("--zip-file", "fileb://$tmpZip")
  }

  # Create the function
  aws lambda create-function `
    --function-name $targetName `
    --runtime nodejs20.x `
    --architectures arm64 `
    --role $LAMBDA_ROLE `
    --handler index.handler `
    --timeout 300 `
    --memory-size 1024 `
    --environment "file://$tmpEnv" `
    @codeArg `
    --query "FunctionName" --output text | Out-Null

  Ok "Created $targetName"
}

# ─── Step 5: API Gateway ──────────────────────────────────────────────────────
Step "API Gateway: $API_NAME"

$existingApis = aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId" --output text
if ($existingApis -and $existingApis -ne 'None') {
  $API_ID = $existingApis.Trim()
  Skip "$API_NAME already exists: $API_ID"
} else {
  # Create API GW without inline CORS (Lambda handles CORS in response.ts)
  $API_ID = (aws apigatewayv2 create-api `
    --name $API_NAME `
    --protocol-type HTTP `
    --query "ApiId" --output text).Trim()
  Ok "Created API Gateway: $API_ID"
}

# ─── Step 6: Auto-deploy stage ───────────────────────────────────────────────
$stageExists = aws apigatewayv2 get-stages --api-id $API_ID --output json 2>$null | ConvertFrom-Json | Select-Object -ExpandProperty Items | Where-Object { $_.StageName -eq '$default' }
if (-not $stageExists) {
  aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy | Out-Null
  Ok "Created `$default stage with auto-deploy"
} else {
  Skip "`$default stage already exists"
}

# ─── Step 7: Integrations (one per Lambda) ───────────────────────────────────
Step "Lambda integrations"

$integMap = @{}  # baseName -> integrationId
foreach ($baseName in $LAMBDAS.Keys) {
  $targetName = "$baseName$SUFFIX"
  $lambdaArn  = "arn:aws:lambda:${REGION}:${ACCOUNT}:function:$targetName"

  # Check if integration already exists
  $existingInteg = aws apigatewayv2 get-integrations --api-id $API_ID `
    --query "Items[?contains(IntegrationUri,'$targetName')].IntegrationId" --output text 2>$null

  if ($existingInteg -and $existingInteg -ne 'None') {
    $integMap[$baseName] = $existingInteg.Trim()
    Skip "Integration for $targetName already exists: $($integMap[$baseName])"
  } else {
    $integId = aws apigatewayv2 create-integration `
      --api-id $API_ID `
      --integration-type AWS_PROXY `
      --integration-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/$lambdaArn/invocations" `
      --payload-format-version "2.0" `
      --query "IntegrationId" --output text
    $integMap[$baseName] = $integId
    Ok "Integration $targetName -> $integId"

    # Add Lambda invoke permission
    $stmtId = "ApiGw-$Env-$($targetName -replace 'lux-','')"
    aws lambda add-permission `
      --function-name $targetName `
      --statement-id $stmtId `
      --action lambda:InvokeFunction `
      --principal apigateway.amazonaws.com `
      --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*/*/*" `
      --query "Statement" --output text 2>$null | Out-Null
  }
}

# ─── Step 8: Authorizer ───────────────────────────────────────────────────────
Step "Authorizer (lux-authorizer$SUFFIX)"
$existingAuth = aws apigatewayv2 get-authorizers --api-id $API_ID `
  --query "Items[?Name=='JwtAuthorizer'].AuthorizerId" --output text 2>$null

if ($existingAuth -and $existingAuth -ne 'None') {
  $AUTHORIZER_ID = $existingAuth.Trim()
  Skip "Authorizer already exists: $AUTHORIZER_ID"
} else {
  $authorizerLambdaArn = "arn:aws:lambda:${REGION}:${ACCOUNT}:function:lux-authorizer$SUFFIX"

  $AUTHORIZER_ID = aws apigatewayv2 create-authorizer `
    --api-id $API_ID `
    --authorizer-type REQUEST `
    --identity-source '$request.header.Authorization' `
    --name JwtAuthorizer `
    --authorizer-uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/$authorizerLambdaArn/invocations" `
    --authorizer-payload-format-version "2.0" `
    --enable-simple-responses `
    --authorizer-result-ttl-in-seconds 300 `
    --query "AuthorizerId" --output text

  # Permission for API GW to invoke authorizer
  aws lambda add-permission `
    --function-name "lux-authorizer$SUFFIX" `
    --statement-id "ApiGw-$Env-authorizer" `
    --action lambda:InvokeFunction `
    --principal apigateway.amazonaws.com `
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API_ID}/*" `
    --query "Statement" --output text 2>$null | Out-Null

  Ok "Authorizer: $AUTHORIZER_ID"
}

# ─── Step 9: Routes ──────────────────────────────────────────────────────────
Step "Routes (copying all prod routes)"

# Map: prod integration ID -> base lambda name (from prod API GW)
$PROD_INTEG_TO_LAMBDA = @{
  "05jm7p4" = "lux-lessons";   "0fz3e9k" = "lux-evaluator"; "0hng7j4" = "lux-tasks"
  "0lugrzm" = "lux-lessons";   "0p4x4w0" = "lux-admin";     "0r1p1mn" = "lux-tasks"
  "0rou8rj" = "lux-admin";     "0thjk91" = "lux-admin";     "15cipf2" = "lux-admin"
  "1awiegq" = "lux-messages";  "1x2yv8i" = "lux-evaluator"; "251toyu" = "lux-lessons"
  "362omh5" = "lux-reflection";"3uxy7r8" = "lux-courses";   "4cc1nqj" = "lux-admin"
  "4y9vcub" = "lux-admin";     "5h3jguf" = "lux-lessons";   "5pu2y86" = "lux-evaluator"
  "6650gdn" = "lux-admin";     "6aoajo2" = "lux-admin";     "7v0bwv7" = "lux-tasks"
  "8be3m13" = "lux-lessons";   "8vjkz98" = "lux-messages";  "95thle5" = "lux-admin"
  "97fnj5f" = "lux-evaluator"; "9tj1yy0" = "lux-lessons";   "akcqpcq" = "lux-lessons"
  "axru3lh" = "lux-admin";     "b0mp4wb" = "lux-notifs";    "b27ef3g" = "lux-admin"
  "b5sm49f" = "lux-reflection";"bnwyfcg" = "lux-evaluator"; "btf6hn9" = "lux-admin"
  "c1lanv4" = "lux-reflection";"el3vtol" = "lux-admin";     "et62u0s" = "lux-admin"
  "fef4a5h" = "lux-evaluator"; "ftabv33" = "lux-admin";     "g7zn3gp" = "lux-messages"
  "gexfmnp" = "lux-admin";     "h6zm1ll" = "lux-lessons";   "hfhxjv1" = "lux-certs"
  "hqydsko" = "lux-lessons";   "jhksjfi" = "lux-lessons";   "kbrcx5l" = "lux-evaluator"
  "kdbtwfp" = "lux-admin";     "keze2wg" = "lux-evaluator"; "km33cqo" = "lux-reports"
  "knfpras" = "lux-admin";     "li2ba3b" = "lux-admin";     "lvdfn0p" = "lux-admin"
  "lzy1z8j" = "lux-reports";   "m11xqor" = "lux-push";      "mjr4rzo" = "lux-admin"
  "mm34qev" = "lux-evaluator"; "ms9rulo" = "lux-evaluator"; "mwar5bk" = "lux-courses"
  "n48xo31" = "lux-certs";     "o7wuzhl" = "lux-messages";  "p4773uu" = "lux-admin"
  "pqqhiku" = "lux-lessons";   "q0djuck" = "lux-push";      "qg0wk9e" = "lux-lessons"
  "qpr5j9f" = "lux-tasks";     "qtscrgv" = "lux-lessons";   "qu1kak1" = "lux-evaluator"
  "r5itb71" = "lux-evaluator"; "rcv5bbr" = "lux-reports";   "rja4kc0" = "lux-reports"
  "rugqqxd" = "lux-notifs";    "sdbeghl" = "lux-admin";     "sk1nrzb" = "lux-admin"
  "sr3mva9" = "lux-messages";  "tuabfvu" = "lux-lessons";   "u6b9oz2" = "lux-messages"
  "u8c858g" = "lux-tasks";     "u9dq37c" = "lux-admin";     "vzxlmhj" = "lux-evaluator"
  "w1v0ciq" = "lux-quiz";      "w6ag7l4" = "lux-evaluator"; "wg3cgbk" = "lux-push"
  "wlatua1" = "lux-certs";     "wm74wd8" = "lux-admin";     "x7jesql" = "lux-admin"
  "xea4it9" = "lux-admin";     "xiufj3b" = "lux-admin";     "y1ikpvp" = "lux-admin"
  "y9p44fg" = "lux-quiz";      "ybgkls4" = "lux-admin";     "zbopqbp" = "lux-messages"
  "zdokxum" = "lux-lessons";   "zimtf9f" = "lux-tasks";     "zrmuzjj" = "lux-lessons"
}

# Public routes (no auth)
$PUBLIC_ROUTES = @(
  "GET /certificates/{certId}",
  "GET /push/vapid-key",
  "GET /tasks/calendar.ics"
)

# Get prod routes
$prodRoutes = aws apigatewayv2 get-routes --api-id v4vabtmerb --output json | ConvertFrom-Json | Select-Object -ExpandProperty Items

# Get existing routes in new API GW
$existingRoutes = aws apigatewayv2 get-routes --api-id $API_ID --query "Items[*].RouteKey" --output json | ConvertFrom-Json

$created = 0
$skipped = 0

foreach ($route in $prodRoutes) {
  $routeKey = $route.RouteKey
  $prodIntegId = $route.Target -replace 'integrations/',''

  if ($existingRoutes -contains $routeKey) {
    $skipped++
    continue
  }

  $lambdaBase = $PROD_INTEG_TO_LAMBDA[$prodIntegId]
  if (-not $lambdaBase) {
    Write-Host "  WARNING: no lambda mapping for integration $prodIntegId ($routeKey)" -ForegroundColor Yellow
    continue
  }

  $newIntegId = $integMap[$lambdaBase]
  if (-not $newIntegId) {
    Write-Host "  WARNING: no integration created for $lambdaBase" -ForegroundColor Yellow
    continue
  }

  $isPublic = $PUBLIC_ROUTES -contains $routeKey
  if ($isPublic) {
    aws apigatewayv2 create-route `
      --api-id $API_ID `
      --route-key $routeKey `
      --target "integrations/$newIntegId" `
      --query "RouteId" --output text | Out-Null
  } else {
    aws apigatewayv2 create-route `
      --api-id $API_ID `
      --route-key $routeKey `
      --authorization-type CUSTOM --authorizer-id $AUTHORIZER_ID `
      --target "integrations/$newIntegId" `
      --query "RouteId" --output text | Out-Null
  }
  $created++
}

Ok "Routes: $created created, $skipped skipped"

# ─── Step 10: SQS Event Source Mapping (sqsconsumer) ─────────────────────────
Step "SQS trigger for lux-sqsconsumer$SUFFIX"
$sqsArn = "arn:aws:sqs:${REGION}:${ACCOUNT}:$SQS_NAME"
$existingMappings = aws lambda list-event-source-mappings --function-name "lux-sqsconsumer$SUFFIX" --query "EventSourceMappings[*].EventSourceArn" --output json 2>$null | ConvertFrom-Json
if ($existingMappings -contains $sqsArn) {
  Skip "SQS trigger already exists"
} else {
  aws lambda create-event-source-mapping `
    --function-name "lux-sqsconsumer$SUFFIX" `
    --event-source-arn $sqsArn `
    --batch-size 1 `
    --query "UUID" --output text | Out-Null
  Ok "SQS trigger created: $sqsArn -> lux-sqsconsumer$SUFFIX"
}

# ─── Done ────────────────────────────────────────────────────────────────────
$API_ENDPOINT = aws apigatewayv2 get-api --api-id $API_ID --query "ApiEndpoint" --output text

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  LUX $ENVUP environment ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  API Gateway ID : $API_ID" -ForegroundColor White
Write-Host "  API Endpoint   : $API_ENDPOINT" -ForegroundColor White
Write-Host "  Cognito Pool   : $COGNITO_POOL_ID" -ForegroundColor White
Write-Host "  Cognito Client : $COGNITO_CLIENT_ID" -ForegroundColor White
Write-Host "  S3 Bucket      : $S3_BUCKET" -ForegroundColor White
Write-Host "  SQS Queue      : $SQS_URL" -ForegroundColor White
Write-Host "`n  Next step: set NEXT_PUBLIC_API_URL=$API_ENDPOINT" -ForegroundColor Cyan
Write-Host "  in Vercel for the $Env environment." -ForegroundColor Cyan
Write-Host ""
