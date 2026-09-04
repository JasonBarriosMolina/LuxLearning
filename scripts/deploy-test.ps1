# deploy-test.ps1 — thin wrapper around deploy-lambda.ps1 that ALWAYS targets -DeployEnv
# test, structurally, regardless of any caller argument — so this specific script is safe
# to permission-allowlist for autonomous use without ever risking a staging/prod deploy
# (Jason, 2026-09-03: "deja de pedir permisos para ejecución de scripts... trabajar más
# autónomo"). Staging/prod deploys still go through deploy-lambda.ps1 -DeployEnv directly,
# which stays outside the allowlist per the standing test-first rule.
#
# Usage: .\scripts\deploy-test.ps1 lux-admin lux-reflection
#        .\scripts\deploy-test.ps1 all

param(
  [Parameter(ValueFromRemainingArguments)][string[]]$targets
)

& "$PSScriptRoot\deploy-lambda.ps1" @targets -DeployEnv test
