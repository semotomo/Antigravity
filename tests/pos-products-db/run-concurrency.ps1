param([Parameter(Mandatory=$true)][string]$PostgresBin)

# 公式バイナリを明示し、既存サービス・DB・汎用PG環境変数を使わず合成データだけを試験する。
$testBin = [IO.Path]::GetFullPath($PostgresBin)
foreach ($testExecutable in @('initdb.exe','pg_ctl.exe','psql.exe','createdb.exe','postgres.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $testBin $testExecutable) -PathType Leaf)) { throw 'PostgreSQL binaries not found' }
}
$testVersion = & (Join-Path $testBin 'postgres.exe') --version
if ($LASTEXITCODE -ne 0 -or $testVersion -notmatch 'PostgreSQL\) (1[7-9]|[2-9][0-9])\.') { throw 'PostgreSQL 17 or newer is required' }
$testRuntime = Join-Path ([IO.Path]::GetTempPath()) ('kennel-pos-pg-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRuntime -ErrorAction Stop | Out-Null
$testData = Join-Path $testRuntime 'data'
$testProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$testProbe.Start()
$testPort = $testProbe.LocalEndpoint.Port
$testProbe.Stop()
$testStarted = $false
$testResult = 1
Write-Output ('SYNTHETIC_PG_RUNTIME=' + $testRuntime)
try {
    & (Join-Path $testBin 'initdb.exe') -D $testData --username=kennel_pg_test_admin --encoding=UTF8 --locale=C --auth=trust
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic cluster initialization failed' }
    & (Join-Path $testBin 'pg_ctl.exe') -D $testData -l (Join-Path $testRuntime 'server.log') -o "-h 127.0.0.1 -p $testPort -c max_connections=15 -c shared_buffers=16MB" -w -t 15 start
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic cluster start failed' }
    $testStarted = $true
    # control DB作成前にも接続先clusterを照合する。既存DBへのfallbackは行わない。
    $testActualData = & (Join-Path $testBin 'psql.exe') -h 127.0.0.1 -p $testPort -U kennel_pg_test_admin -d postgres -Atqc 'SHOW data_directory'
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath([string]$testActualData) -ne [IO.Path]::GetFullPath($testData)) { throw 'Synthetic cluster identity mismatch' }
    & (Join-Path $testBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U kennel_pg_test_admin kennel_pos_product_concurrency_control_test
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic control DB creation failed' }
    $env:POS_PRODUCT_TEST_PG_HOST='127.0.0.1'
    $env:POS_PRODUCT_TEST_PG_PORT=[string]$testPort
    $env:POS_PRODUCT_TEST_PG_USER='kennel_pg_test_admin'
    $env:POS_PRODUCT_TEST_PG_CONTROL_DB='kennel_pos_product_concurrency_control_test'
    $env:POS_PRODUCT_TEST_PG_DATA_DIRECTORY=$testData
    Push-Location -LiteralPath $PSScriptRoot
    try { npm run test:concurrency; $testResult=$LASTEXITCODE } finally { Pop-Location }
} finally {
    if ($testStarted) {
        & (Join-Path $testBin 'pg_ctl.exe') -D $testData -w -t 15 -m fast stop
        if ($LASTEXITCODE -ne 0) { $testResult=1; Write-Output 'Synthetic cluster stop failed; keep logs and do not delete.' }
    }
    # clusterとログは検証記録用に保持する。子UUID DBだけをharnessの所有確認後に削除する。
    Write-Output ('SYNTHETIC_PG_RESULT=' + $testResult)
}
exit $testResult
