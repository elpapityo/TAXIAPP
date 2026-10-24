# TAXIAPP 管理者オプチャネーム更新関数だけを本番に配信する手順
# 必ず Firebase プロジェクト所有者本人が実行すること。
# Cloud Functions の新規配信は Blaze プラン・課金設定が必要になる場合がある。
# 有料契約や課金変更はこのスクリプトから行わない。
$ErrorActionPreference = 'Stop'
$project = 'taxiapp-2b6bd'
$root = Split-Path -Parent $PSScriptRoot
Write-Host "配信先プロジェクト: $project"
Write-Host "配信対象: functions:account-admin:adminUpdateOpenChatName"
Write-Host 'Firestore Rules、Authentication設定、日報原本、Google帳票は変更しません。'
Write-Host 'Cloud Functions の配信には Blaze プランが必要になる可能性があります。'
Write-Host '有料契約や既存の権限変更が求められた場合は、ここで中断してください。'
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'Firebase CLI がありません。先に Node.js と firebase-tools をセットアップしてください。'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm がありません。先に Node.js をセットアップしてください。'
}
if (-not (Test-Path (Join-Path $root 'functions/index.js'))) {
  throw '最新版TAXIAPPのプロジェクトルートから実行してください。'
}
$answer = Read-Host 'Firebase本番の名前変更関数だけを配信します。続けるなら「配信」を入力'
if ($answer -ne '配信') {
  Write-Host '配信せずに終了しました。'
  exit 0
}
Push-Location $root
try {
  & firebase functions:list --project $project
  if ($LASTEXITCODE -ne 0) { throw '関数一覧の取得に失敗しました。ログインと権限を確認してください。' }
  & npm --prefix functions install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Functionsの依存ライブラリの準備に失敗しました。' }
  # Functions全体の一括配信は禁止。個別関数だけを更新する。
  & firebase deploy --only functions:account-admin:adminUpdateOpenChatName --project $project
  if ($LASTEXITCODE -ne 0) { throw '関数の配信に失敗しました。Cloud Functionsのログを確認してください。' }
  & firebase functions:list --project $project
  if ($LASTEXITCODE -ne 0) { throw '配信後の関数一覧を確認できませんでした。' }
  Write-Host '対象関数の配信が完了しました。管理者PCから「接続診断（保存しない）」を実行してください。'
} finally {
  Pop-Location
}
