# deploy-lambda.ps1 — Build and deploy one or more Lambda functions
# Usage:  .\scripts\deploy-lambda.ps1 lux-admin lux-reflection
#         .\scripts\deploy-lambda.ps1 all          (deploy every lambda)
#
# Lambdas that use Prisma automatically get node_modules/@prisma/client
# and .prisma/client bundled into the zip.

param([Parameter(ValueFromRemainingArguments)][string[]]$targets)

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
  "lux-lessons"     = @("$API_SRC\lessons\handler.ts",      $false)
  "lux-tasks"       = @("$API_SRC\tasks\handler.ts",        $false)
  "lux-notifs"      = @("$API_SRC\notifications\handler.ts",$false)
  "lux-push"        = @("$API_SRC\push\handler.ts",         $false)
  "lux-authorizer"  = @("$API_SRC\authorizer\handler.ts",   $false)
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Deploy-Lambda([string]$name) {
  if (-not $LAMBDAS.Contains($name)) {
    Write-Host "  [SKIP] Unknown lambda: $name" -ForegroundColor Yellow
    return
  }

  $entry      = $LAMBDAS[$name][0]
  $usesPrisma = $LAMBDAS[$name][1]
  $outDir     = "$DIST\$($name -replace 'lux-','')"
  $stage      = "$outDir\_stage"
  $zipPath    = "$outDir\$name.zip"

  Write-Host "`n==> $name" -ForegroundColor Cyan

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
  & npx esbuild @esbuildArgs
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
    --function-name $name `
    --zip-file "fileb://$zipPath" `
    --query "CodeSize" --output text
  if ($LASTEXITCODE -ne 0) { throw "Deploy failed for $name" }
  Write-Host "   Deployed: $([math]::Round([int]$codeSize / 1MB, 1)) MB" -ForegroundColor Green

  # 5. Ensure PRISMA_QUERY_ENGINE_LIBRARY is set (merge, never wipe other vars)
  #    DATABASE_URL persists automatically — update-function-code never touches env vars
  if ($usesPrisma) {
    $tmpEnv = "$DIST\env-tmp.json"
    aws lambda get-function-configuration --function-name $name --query "Environment.Variables" --output json | Out-File -Encoding utf8 $tmpEnv
    python -c @"
import json
with open(r'$tmpEnv', encoding='utf-8') as f:
  d = json.loads(f.read().strip().lstrip('\xef\xbb\xbf'))
d['PRISMA_QUERY_ENGINE_LIBRARY'] = '$ENGINE_PATH'
with open(r'$tmpEnv', 'w', encoding='utf-8') as f:
  json.dump({'Variables': d}, f)
"@
    aws lambda update-function-configuration --function-name $name --environment "file://$tmpEnv" --query "FunctionName" --output text | Out-Null
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
