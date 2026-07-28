const gasUrl = 'https://script.google.com/macros/s/AKfycbxHchGAwbszXfDWceXtTepVl9G5aKQFfGU7IrAGI3ViHNMcpHfaChQ5DeYOrBrOf0LJGQ/exec'

async function runTest() {
  console.log('=== TEST 1: 本店の商品マスタ同期 (mode=master) ===')
  try {
    const url = new URL(gasUrl)
    url.searchParams.set('mode', 'master')
    url.searchParams.set('tenpoGroupId', '11098')
    url.searchParams.set('tenpoGroupName', 'からつケンネル本店')

    console.log('Requesting:', url.toString())
    const res = await fetch(url.toString())
    const json = await res.json()
    console.log('Response Success:', json.success)
    console.log('Master Result:', JSON.stringify(json.master, null, 2))
    if (json.logs) {
      console.log('GAS Logs:\n', json.logs)
    }
  } catch (err) {
    console.error('Test 1 failed:', err)
  }

  console.log('\n=== TEST 2: わんわんのリアルタイム入出庫履歴 (mode=history) ===')
  try {
    const url = new URL(gasUrl)
    url.searchParams.set('mode', 'history')
    url.searchParams.set('tenpoGroupId', '11054')
    url.searchParams.set('tenpoGroupName', 'わんわん')
    url.searchParams.set('startDate', '2026/07/28')
    url.searchParams.set('endDate', '2026/07/28')

    console.log('Requesting:', url.toString())
    const res = await fetch(url.toString())
    const json = await res.json()
    console.log('Response Success:', json.success)
    console.log('History Result:', JSON.stringify(json.history, null, 2))
    if (json.logs) {
      console.log('GAS Logs:\n', json.logs)
    }
  } catch (err) {
    console.error('Test 2 failed:', err)
  }
}

runTest()
