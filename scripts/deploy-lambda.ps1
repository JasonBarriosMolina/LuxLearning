# deploy-lambda.ps1 — Build and deploy one or more Lambda functions
# Usage:  .\scripts\deploy-lambda.ps1 lux-admin lux-reflection
#         .\scripts\deploy-lambda.ps1 all              (deploy every lambda to prod)
#         .\scripts\deploy-lambda.ps1 all -Env test    (deploy to test environment)
#         .\scripts\deploy-lambda.ps1 all -Env staging (deploy to staging environment)
#
# Lambdas that use Prisma automatically get node_modules/@prisma/client
# and .prisma/client bundled into the zip.

param(
  [Parameter(ValueFromRemainingArguments)][string[]]$targets,
  [ValidateSet('prod','staging','test')][string]$Env = 'prod'
)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$ROOT      = "D:\InHouse\Lux"
$API_SRC   = "$ROOT\services\api\src"
$DIST      = "$ROOT\services\api\dist"

# Engine binary path inside the Lambda zip (must match where .prisma/client is staged)
$ENGINE_PATH = "/var/task/node_modules/.prisma/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node"
$MODULES   = "$ROOT\node_modules"
$PRISMA_PKG    = "$MODULES\@prisma\client"
$PRISMA_GEN    = "$MODULES\.prisma\client"
$PRISMA_ENGINE = "$PRISMA_GEN\libquery_engine-linux-arm64-openssl-3.0.x.so.node"

# Map: lambda-name -> [ entrypoint, usesPrisma ]
$LAMBDAS = [ordered]@{
  "lux-admin"       = @("$API_SRC\admin\handler.ts",        $true)
  "lux-attendance"  = @("$API_SRC\attendance\handler.ts",   $true)
  "lux-reflection"  = @("$API_SRC\reflection\handler.ts",   $true)
  "lux-evaluator"   = @("$API_SRC\evaluator\handler.ts",    $true)
  "lux-courses"     = @("$API_SRC\courses\handler.ts",      $true)
  "lux-quiz"        = @("$API_SRC\quiz\handler.ts",         $true)
  "lux-certs"       = @("$API_SRC\certificates\handler.ts", $true)
  "lux-analysis"    = @("$API_SRC\analysis\handler.ts",     $true)
  "lux-reminders"   = @("$API_SRC\reminders\handler.ts",    $true)
  "lux-reports"     = @("$API_SRC\reports\handler.ts",      $true)
  "lux-messages"    = @("$API_SRC\messages\handler.ts",     $false)
  "lux-sqsconsumer" = @("$API_SRC\reflection\sqs-consumer.ts", $false)
  "lux-lessons"     = @("$API_SRC\lessons\handler.ts",      $true)
  "lux-tasks"       = @("$API_SRC\tasks\handler.ts",        $false)
  "lux-notifs"      = @("$API_SRC\notifications\handler.ts",$false)
  "lux-push"        = @("$API_SRC\push\handler.ts",         $false)
  "lux-authorizer"  = @("$API_SRC\shared\authorizer.ts",    $false)
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$ENV_SUFFIX = if ($Env -eq 'prod') { '' } else { "-$Env" }

function Deploy-Lambda([string]$name) {
  if (-not $LAMBDAS.Contains($name)) {
    Write-Host "  [SKIP] Unknown lambda: $name" -ForegroundColor Yellow
    return
  }

  $targetName = "$name$ENV_SUFFIX"   # e.g. lux-admin-test
  $entry      = $LAMBDAS[$name][0]
  $usesPrisma = $LAMBDAS[$name][1]
  $outDir     = "$DIST\$($name -replace 'lux-','')"
  $stage      = "$outDir\_stage"
  $zipPath    = "$outDir\$name.zip"

  Write-Host "`n==> $targetName" -ForegroundColor Cyan

  # 1. Build
  New-Item -ItemType Directory -Force $outDir | Out-Null
  $env:NODE_PATH = $MODULES
  $esbuildArgs = @(
    $entry,
    "--bundle", "--platform=node", "--target=node20",
    "--external:@prisma/client", "--external:sharp",
    "--external:@aws-sdk/client-secrets-manager",
    "--outfile=$outDir\index.js", "--minify"
  )
  $esbuildOut = cmd /c "node `"$ROOT\node_modules\esbuild\bin\esbuild`" $($esbuildArgs -join ' ') 2>&1"
  Write-Host $esbuildOut
  if ($LASTEXITCODE -ne 0) { throw "esbuild failed for $name" }

  # 2. Stage
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory $stage -Force | Out-Null
  Copy-Item "$outDir\index.js" "$stage\index.js"

  if ($usesPrisma) {
    New-Item -ItemType Directory "$stage\node_modules\.prisma"  -Force | Out-Null
    New-Item -ItemType Directory "$stage\node_modules\@prisma"  -Force | Out-Null
    # Generated Prisma client (JS + engine binary), skip Windows DLL
    Copy-Item $PRISMA_GEN "$stage\node_modules\.prisma\client" -Recurse
    Remove-Item "$stage\node_modules\.prisma\client\query_engine-windows.dll.node" -ErrorAction SilentlyContinue
    # @prisma/client JS package
    Copy-Item $PRISMA_PKG "$stage\node_modules\@prisma\client" -Recurse
  }

  # 3. Zip
  if (Test-Path $zipPath) { Remove-Item $zipPath }
  [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath)
  $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
  Write-Host "   Zip: $sizeMB MB" -ForegroundColor Gray

  # 4. Deploy code
  $codeSize = aws lambda update-function-code `
    --function-name $targetName `
    --zip-file "fileb://$zipPath" `
    --query "CodeSize" --output text
  if ($LASTEXITCODE -ne 0) { throw "Deploy failed for $targetName" }
  Write-Host "   Deployed: $([math]::Round([int]$codeSize / 1MB, 1)) MB" -ForegroundColor Green

  # 4b. Wait for function to be Active before touching config
  aws lambda wait function-updated --function-name $targetName | Out-Null

  # 5. Ensure PRISMA_QUERY_ENGINE_LIBRARY is set (merge, never wipe other vars)
  #    DATABASE_URL persists automatically — update-function-code never touches env vars
  if ($usesPrisma) {
    $tmpEnv = "$DIST\env-tmp.json"
    $noBom = New-Object System.Text.UTF8Encoding($false)
    $rawVars = (aws lambda get-function-configuration --function-name $targetName --query "Environment.Variables" --output json) -join ""
    $dObj = $rawVars | ConvertFrom-Json
    $h = @{}
    $dObj.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value }
    $h['PRISMA_QUERY_ENGINE_LIBRARY'] = $ENGINE_PATH
    if (-not $h.ContainsKey('DB_SECRET_ARN_STAGING')) { $h['DB_SECRET_ARN_STAGING'] = 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-staging-yTtxUR' }
    if (-not $h.ContainsKey('DB_SECRET_ARN_TEST'))    { $h['DB_SECRET_ARN_TEST']    = 'arn:aws:secretsmanager:us-east-1:798694628803:secret:lux/neon-db-test-FFtXaR' }
    $envBody = @{ Variables = $h } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($tmpEnv, $envBody, $noBom)
    aws lambda update-function-configuration --function-name $targetName --environment "file://$tmpEnv" --query "FunctionName" --output text | Out-Null
    Write-Host "   Env vars synced" -ForegroundColor Gray
  }
}

# Resolve target list
if ($targets -contains "all") {
  $toRun = $LAMBDAS.Keys
} else {
  $toRun = $targets
}

if (-not $toRun) {
  Write-Host "Usage: .\scripts\deploy-lambda.ps1 <lambda-name|all> [...]"
  Write-Host "Available: $($LAMBDAS.Keys -join ', ')"
  exit 0
}

foreach ($t in $toRun) { Deploy-Lambda $t }
Write-Host "`nDone." -ForegroundColor Green
