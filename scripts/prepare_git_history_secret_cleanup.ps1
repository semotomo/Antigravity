[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$sensitivePath = '_archived/streamlit_era/.streamlit/secrets.toml'
$repositoryRoot = (Resolve-Path -LiteralPath $RepositoryPath).Path
$mirrorPath = [System.IO.Path]::GetFullPath($OutputDirectory)

if (Test-Path -LiteralPath $mirrorPath) {
    throw "出力先は未作成の空きパスを指定してください: $mirrorPath"
}

& git -C $repositoryRoot rev-parse --show-toplevel | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Gitリポジトリを確認できません: $repositoryRoot"
}

$filterRepo = Get-Command git-filter-repo -ErrorAction SilentlyContinue
if (-not $filterRepo) {
    throw 'git-filter-repo が未導入です。手順書に従って導入後、もう一度実行してください。'
}

$remoteUrl = (& git -C $repositoryRoot remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
    throw 'origin のURLを取得できません。'
}

Write-Host '1/3 GitHubの現在状態から専用ミラーを作成しています...'
& git clone --mirror $remoteUrl $mirrorPath
if ($LASTEXITCODE -ne 0) {
    throw '専用ミラーの作成に失敗しました。'
}

Write-Host '2/3 専用ミラー内だけで機密ファイルを全履歴から除外しています...'
& git -C $mirrorPath filter-repo --path $sensitivePath --invert-paths --force
if ($LASTEXITCODE -ne 0) {
    throw '履歴の準備に失敗しました。元リポジトリは変更されていません。'
}

Write-Host '3/3 除外結果を確認しています...'
$remaining = & git -C $mirrorPath log --all --format='%H' -- $sensitivePath
if ($LASTEXITCODE -ne 0) {
    throw '除外結果の確認に失敗しました。'
}
if ($remaining) {
    throw '機密ファイルを含むコミットが残っています。pushせず調査してください。'
}

# filter-repoの仕様変更があっても誤送信できないよう、push先を必ず外して停止する。
& git -C $mirrorPath remote remove origin 2>$null

Write-Host ''
Write-Host '準備完了: 元リポジトリとGitHubにはまだ変更を加えていません。'
Write-Host "確認用ミラー: $mirrorPath"
Write-Host "確認対象のGitHub: $remoteUrl"
Write-Host '安全のため、確認用ミラーにはpush先を登録していません。'
Write-Host '次は docs/observability_security/git_history_secret_cleanup.md の確認・承認手順へ進んでください。'
