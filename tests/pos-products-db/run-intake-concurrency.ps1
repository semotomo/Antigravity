param([switch]$Classification)
$ErrorActionPreference = 'Stop'
$testWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testBinaryRoot = Join-Path $testWorkspace 'local_exports\postgres-17.11-test-20261008-csvguard-a8e32157\pgsql\bin'
foreach ($testBinary in @('initdb.exe','pg_ctl.exe','createdb.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $testBinaryRoot $testBinary))) { throw "Dedicated PostgreSQL test binary missing: $testBinary" }
}
$testClusterRoot = Join-Path $testWorkspace ('local_exports\kennel-pos-pg-' + [guid]::NewGuid().ToString('N'))
$testDataDirectory = Join-Path $testClusterRoot 'data'
# 保存先と停止対象は検証済みworkspace内のUUID専用clusterだけに限定する。
if (-not ([IO.Path]::GetFullPath($testClusterRoot)).StartsWith($testWorkspace + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Test cluster escaped workspace' }
New-Item -ItemType Directory -Path $testClusterRoot | Out-Null
$testListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$testListener.Start()
$testPort = $testListener.LocalEndpoint.Port
$testListener.Stop()
$testUser = 'kennel_pg_intake_test'
$testDatabase = 'kennel_pos_intake_concurrency_control_test'
$testStarted = $false
$testExitCode = 1
try {
    & (Join-Path $testBinaryRoot 'initdb.exe') '-D' $testDataDirectory '-U' $testUser '--auth=trust' '--encoding=UTF8' '--locale=C'
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated cluster initialization failed' }
    & (Join-Path $testBinaryRoot 'pg_ctl.exe') '-D' $testDataDirectory '-l' (Join-Path $testClusterRoot 'server.log') '-w' '-t' '15' '-o' "-h 127.0.0.1 -p $testPort" 'start'
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated loopback cluster start failed' }
    $testStarted = $true
    & (Join-Path $testBinaryRoot 'createdb.exe') '-h' '127.0.0.1' '-p' $testPort '-U' $testUser $testDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated test database creation failed' }
    $env:POS_PRODUCT_INTAKE_TEST_HOST = '127.0.0.1'
    $env:POS_PRODUCT_INTAKE_TEST_PORT = [string]$testPort
    $env:POS_PRODUCT_INTAKE_TEST_USER = $testUser
    $env:POS_PRODUCT_INTAKE_TEST_DATABASE = $testDatabase
    $env:POS_PRODUCT_INTAKE_TEST_DATA_DIRECTORY = $testDataDirectory
    $testEntry = if ($Classification) { 'classification-concurrency.integration.mjs' } else { 'intake-concurrency.integration.mjs' }
    & node '--test' (Join-Path $PSScriptRoot $testEntry)
    $testExitCode = $LASTEXITCODE
} finally {
    if ($testStarted) {
        & (Join-Path $testBinaryRoot 'pg_ctl.exe') '-D' $testDataDirectory '-w' '-t' '15' '-m' 'fast' 'stop'
        if ($LASTEXITCODE -ne 0) { $testExitCode = 1 }
        & (Join-Path $testBinaryRoot 'pg_ctl.exe') '-D' $testDataDirectory 'status'
        if ($LASTEXITCODE -ne 3) { $testExitCode = 1 }
    }
    foreach ($testEnvironmentName in @('POS_PRODUCT_INTAKE_TEST_HOST','POS_PRODUCT_INTAKE_TEST_PORT','POS_PRODUCT_INTAKE_TEST_USER','POS_PRODUCT_INTAKE_TEST_DATABASE','POS_PRODUCT_INTAKE_TEST_DATA_DIRECTORY')) {
        [Environment]::SetEnvironmentVariable($testEnvironmentName,$null,'Process')
    }
    Write-Output "Retained dedicated test artifacts: $testClusterRoot"
}
exit $testExitCode
