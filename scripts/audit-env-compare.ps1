# audit-env-compare.ps1
# Compara dos ambientes de API GW/Lambda/DDB/S3 en Lux Learning
# Uso: .\scripts\audit-env-compare.ps1 -SrcEnv test -DstEnv staging
# Uso: .\scripts\audit-env-compare.ps1 -SrcEnv staging -DstEnv prod
param(
    [ValidateSet('test','staging','prod')][string]$SrcEnv = 'staging',
    [ValidateSet('test','staging','prod')][string]$DstEnv = 'prod'
)

$API_IDS = @{ test='hxnd6tzmce'; staging='1ohrw48nii'; prod='v4vabtmerb' }
$SRC_GW = $API_IDS[$SrcEnv]
$DST_GW = $API_IDS[$DstEnv]

function Get-LambdaBaseName($fnName) {
    return $fnName -replace "-test$","" -replace "-staging$",""
}

function Get-RouteMap($ApiId, $Suffix) {
    $routes  = aws apigatewayv2 get-routes      --api-id $ApiId --query "Items[].{Key:RouteKey,Target:Target,Auth:AuthorizationType}" --output json | ConvertFrom-Json
    $integs  = aws apigatewayv2 get-integrations --api-id $ApiId --query "Items[].{Id:IntegrationId,Uri:IntegrationUri}"             --output json | ConvertFrom-Json
    $im = @{}
    $integs | ForEach-Object {
        $fnName = ($_.Uri -split "function:")[1] -split "/invocations" | Select-Object -First 1
        $im[$_.Id] = (Get-LambdaBaseName $fnName)
    }
    $map = @{}
    $routes | ForEach-Object {
        $integId = $_.Target -replace "integrations/",""
        $map[$_.Key] = @{ Lambda=$im[$integId]; Auth=$_.Auth }
    }
    return $map
}

Write-Host "`n========================================="
Write-Host "  ENV COMPARE: $($SrcEnv.ToUpper()) → $($DstEnv.ToUpper())"
Write-Host "=========================================`n"

# ── 1. Lambda count & last-modified ──────────────────────────────────────────
Write-Host "=== LAMBDAS ==="
$srcLambdas = aws lambda list-functions --query "Functions[?contains(FunctionName,'$SrcEnv')].{Name:FunctionName,Modified:LastModified}" --output json | ConvertFrom-Json | Sort-Object Name
$dstSuffix  = if ($DstEnv -eq 'prod') { '' } else { $DstEnv }
$dstQuery   = if ($DstEnv -eq 'prod') {
    "Functions[?!contains(FunctionName,'test') && !contains(FunctionName,'staging') && starts_with(FunctionName,'lux-')].{Name:FunctionName,Modified:LastModified}"
} else {
    "Functions[?contains(FunctionName,'$DstEnv')].{Name:FunctionName,Modified:LastModified}"
}
$dstLambdas = aws lambda list-functions --query $dstQuery --output json | ConvertFrom-Json | Sort-Object Name

Write-Host "$SrcEnv lambdas: $($srcLambdas.Count)  |  $DstEnv lambdas: $($dstLambdas.Count)"

$srcNames = $srcLambdas.Name | ForEach-Object { Get-LambdaBaseName $_ } | Sort-Object
$dstNames = $dstLambdas.Name | ForEach-Object { Get-LambdaBaseName $_ } | Sort-Object
$missingInDst = $srcNames | Where-Object { $dstNames -notcontains $_ }
if ($missingInDst) { Write-Host "⚠️  Missing in $DstEnv`: $($missingInDst -join ', ')" }
else               { Write-Host "✅ Lambda count match" }

# ── 2. API GW route comparison ────────────────────────────────────────────────
Write-Host "`n=== API GATEWAY ROUTES ==="
$srcMap = Get-RouteMap $SRC_GW $SrcEnv
$dstMap = Get-RouteMap $DST_GW $DstEnv

Write-Host "$SrcEnv routes: $($srcMap.Count)  |  $DstEnv routes: $($dstMap.Count)"

$mismatches = @()
foreach ($key in $srcMap.Keys) {
    $s = $srcMap[$key]
    $d = $dstMap[$key]
    if (-not $d)                        { $mismatches += "MISSING in $DstEnv`: $key" }
    elseif ($s.Lambda -ne $d.Lambda)    { $mismatches += "LAMBDA MISMATCH $key : $SrcEnv=$($s.Lambda)  $DstEnv=$($d.Lambda)" }
    elseif ($s.Auth   -ne $d.Auth)      { $mismatches += "AUTH MISMATCH   $key : $SrcEnv=$($s.Auth)    $DstEnv=$($d.Auth)" }
}
foreach ($key in $dstMap.Keys) {
    if (-not $srcMap.ContainsKey($key)) { $mismatches += "EXTRA in $DstEnv (not in $SrcEnv): $key" }
}

if ($mismatches.Count -eq 0) { Write-Host "✅ All $($srcMap.Count) routes match (lambda + auth type)" }
else {
    Write-Host "⚠️  $($mismatches.Count) mismatches:"
    $mismatches | ForEach-Object { Write-Host "   $_" }
}

# ── 3. CORS comparison ───────────────────────────────────────────────────────
Write-Host "`n=== CORS ==="
$srcCors = aws apigatewayv2 get-api --api-id $SRC_GW --query "CorsConfiguration" --output json | ConvertFrom-Json
$dstCors = aws apigatewayv2 get-api --api-id $DST_GW --query "CorsConfiguration" --output json | ConvertFrom-Json
Write-Host "$SrcEnv origins: $($srcCors.AllowOrigins -join ', ')"
Write-Host "$DstEnv origins: $($dstCors.AllowOrigins -join ', ')"
Write-Host "$SrcEnv MaxAge: $($srcCors.MaxAge)  |  $DstEnv MaxAge: $($dstCors.MaxAge)"
Write-Host "$SrcEnv Methods: $($srcCors.AllowMethods -join ',')  |  $DstEnv Methods: $($dstCors.AllowMethods -join ',')"

# ── 4. DynamoDB tables ───────────────────────────────────────────────────────
Write-Host "`n=== DYNAMODB TABLES ==="
$allTables = aws dynamodb list-tables --query "TableNames" --output json | ConvertFrom-Json | Sort-Object
$srcSuffix = if ($SrcEnv -eq 'prod') { '' } else { "-$((Get-Culture).TextInfo.ToTitleCase($SrcEnv))" }
$dstSuffix2 = if ($DstEnv -eq 'prod') { '' } else { "-$((Get-Culture).TextInfo.ToTitleCase($DstEnv))" }

$srcTables = if ($SrcEnv -eq 'prod') {
    $allTables | Where-Object { $_ -notlike "*-Staging" -and $_ -notlike "*-Test" -and $_ -like "Lux*" -or $_ -in @("Certificates","CurriculumRecommendations","Enrollments","LessonProgress","Notifications","PushSubscriptions","QuizAttempts","Reflections","ReportAnalysis","ScheduledTasks") }
} else {
    $cap = (Get-Culture).TextInfo.ToTitleCase($SrcEnv)
    $allTables | Where-Object { $_ -like "*-$cap" }
}
$dstTables = if ($DstEnv -eq 'prod') {
    $allTables | Where-Object { $_ -notlike "*-Staging" -and $_ -notlike "*-Test" }
} else {
    $cap = (Get-Culture).TextInfo.ToTitleCase($DstEnv)
    $allTables | Where-Object { $_ -like "*-$cap" }
}

Write-Host "$SrcEnv tables: $($srcTables.Count)  |  $DstEnv tables: $($dstTables.Count)"

$srcBase = $srcTables | ForEach-Object { $_ -replace "-Staging$","" -replace "-Test$","" } | Sort-Object
$dstBase = $dstTables | ForEach-Object { $_ -replace "-Staging$","" -replace "-Test$","" } | Sort-Object
$missingDdbInDst = $srcBase | Where-Object { $dstBase -notcontains $_ }
$extraDdbInDst   = $dstBase | Where-Object { $srcBase -notcontains $_ }
if ($missingDdbInDst) { Write-Host "⚠️  Missing in $DstEnv DDB: $($missingDdbInDst -join ', ')" }
if ($extraDdbInDst)   { Write-Host "ℹ️  Extra in $DstEnv DDB (not in $SrcEnv): $($extraDdbInDst -join ', ')" }
if (-not $missingDdbInDst -and -not $extraDdbInDst) { Write-Host "✅ DynamoDB table sets match" }

# ── 5. Key env vars on critical lambdas ──────────────────────────────────────
Write-Host "`n=== ENV VAR SPOT CHECK (critical vars) ==="
$criticalVars = @("DB_SECRET_ARN","FRONTEND_URL","SQS_REFLECTION_QUEUE_URL","S3_IMAGES_BUCKET","SUBMISSIONS_BUCKET","BEDROCK_REGION","COGNITO_CLIENT_ID","COGNITO_USER_POOL_ID","APP_ENV")
$checkLambdas = @("lux-admin","lux-courses","lux-evaluator","lux-authorizer","lux-sqsconsumer")
foreach ($base in $checkLambdas) {
    $srcFn = if ($SrcEnv -eq 'prod') { $base } else { "$base-$SrcEnv" }
    $dstFn = if ($DstEnv -eq 'prod') { $base } else { "$base-$DstEnv" }
    try {
        $srcEnvVars = aws lambda get-function-configuration --function-name $srcFn --query "Environment.Variables" --output json 2>$null | ConvertFrom-Json
        $dstEnvVars = aws lambda get-function-configuration --function-name $dstFn --query "Environment.Variables" --output json 2>$null | ConvertFrom-Json
        if (-not $srcEnvVars -or -not $dstEnvVars) { Write-Host "  ⚠️  $base — could not fetch one or both env configs"; continue }
        $envDiffs = @()
        foreach ($k in $criticalVars) {
            $sv = if ($srcEnvVars.PSObject.Properties.Name -contains $k) { $srcEnvVars.$k } else { "(missing)" }
            $dv = if ($dstEnvVars.PSObject.Properties.Name -contains $k) { $dstEnvVars.$k } else { "(missing)" }
            if ($sv -ne $dv) { $envDiffs += "  $k`: $SrcEnv=[$sv] vs $DstEnv=[$dv]" }
        }
        if ($envDiffs.Count -eq 0) { Write-Host "  ✅ $base — critical vars match" }
        else { Write-Host "  ⚠️  $base — diffs:"; $envDiffs | ForEach-Object { Write-Host "     $_" } }
    } catch { Write-Host "  ⚠️  $base — error fetching config" }
}

# ── 6. S3 buckets ────────────────────────────────────────────────────────────
Write-Host "`n=== S3 BUCKETS ==="
$allBuckets = aws s3api list-buckets --query "Buckets[?contains(Name,'lux-learning')].Name" --output json | ConvertFrom-Json
Write-Host "Lux S3 buckets: $($allBuckets -join ', ')"

# ── 7. EventBridge rules ─────────────────────────────────────────────────────
Write-Host "`n=== EVENTBRIDGE ==="
$rules = aws events list-rules --name-prefix "lux-study-plans" --query "Rules[].{Name:Name,State:State}" --output json | ConvertFrom-Json
$rules | ForEach-Object { Write-Host "  $($_.Name) — $($_.State)" }

Write-Host "`n========================================="
Write-Host "  COMPARE DONE"
Write-Host "=========================================`n"
