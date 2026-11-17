window.runCases = async () => {
  const assert = window.assertTest
  let a = deferred(), b = deferred()
  wizard.handleReset(); await tick()
  const fileA = makeFile('A', 1, a), fileB = makeFile('B', 2, b)
  const pa = wizard.handleFileSelect(fileA), pb = wizard.handleFileSelect(fileB)
  a.reject(new Error('old read')); await pa; await tick()
  assert(wizard.parsingLoading && !wizard.parsingError, 'old read cleared new loading')
  b.resolve(fileB.bytes); await pb; await tick()
  assert(wizard.parsedRows[0].name === 'B', 'new read failed')

  await setup()
  let calls = []
  mgpos.warehouses.classifyReconciliationExcel = () => { const d = deferred(); calls.push(d); return d.promise }
  const ca = wizard.runClassification(); wizard.handleReset(); await tick()
  await wizard.handleFileSelect(makeFile('new', 2)); await tick()
  const cb = wizard.runClassification(); await tick()
  calls[0].resolve({ success: true }); await ca; await tick()
  wizard.runClassification(); await tick()
  assert(calls.length === 2 && wizard.classifyingLoading, 'old classification unlocked new request')
  calls[1].resolve({ success: true, matchedRows: [{ product_id: 1, product_name: 'fictional', system_quantity: 3, physical_quantity: 4, physical_units: 4, strategy: 'replace' }] }); await cb; await tick()

  let rebase = deferred()
  mgpos.warehouses.rebaseReconciliationItems = () => rebase.promise
  const rp = wizard.autoRebaseToLiveStock()
  wizard.updateRowQuantity(1, 8); await tick()
  rebase.resolve({ success: true, rebasedItems: [{ product_id: 1, system_quantity: 10, physical_quantity: 4, strategy: 'replace' }] }); await rp; await tick()
  assert(wizard.matchedRows[0].physical_quantity === 8, 'rebase lost edited count')

  await setup()
  let preflight = deferred(), writes = []
  mgpos.warehouses.checkReconciliationConcurrencyDrift = () => preflight.promise
  mgpos.warehouses.executeReconciliation = payload => { writes.push(payload); return Promise.resolve({ success: true }) }
  const ex = wizard.executeFinalReconciliation(); wizard.handleReset(); await tick()
  preflight.resolve({ hasConflicts: false }); await ex; await tick()
  assert(writes.length === 0, 'reset allowed stale preflight write')

  for (const change of ['file', 'warehouse']) {
    await setup()
    preflight = deferred(); writes = []
    mgpos.warehouses.checkReconciliationConcurrencyDrift = () => preflight.promise
    mgpos.warehouses.executeReconciliation = p => { writes.push(p); return Promise.resolve({ success: true }) }
    const pendingPreflight = wizard.executeFinalReconciliation()
    if (change === 'file') await wizard.handleFileSelect(makeFile('replacement', 5))
    else controls.setWarehouse(2)
    await tick(); preflight.resolve({ hasConflicts: false }); await pendingPreflight; await tick()
    assert(writes.length === 0, change + ' allowed stale preflight write')
    if (change === 'warehouse') { controls.setWarehouse(1); await tick() }
  }

  await setup()
  writes = []
  mgpos.warehouses.checkReconciliationConcurrencyDrift = () => Promise.reject(new Error('preflight failure'))
  mgpos.warehouses.executeReconciliation = payload => { writes.push(payload); return Promise.resolve({ success: true }) }
  await wizard.executeFinalReconciliation(); await tick()
  assert(writes.length === 0 && wizard.executionError, 'failed preflight allowed write')

  await setup()
  let errorEnvelopeWrites = 0
  mgpos.warehouses.checkReconciliationConcurrencyDrift = async () => ({ error: 'fictional denied' })
  mgpos.warehouses.executeReconciliation = async () => { errorEnvelopeWrites++; return { success: true } }
  await wizard.executeFinalReconciliation(); await tick()
  await setup()
  let staleResetWrites = 0
  mgpos.warehouses.executeReconciliation = async () => { staleResetWrites++; return { success: true } }
  const oldExecute = wizard.executeFinalReconciliation
  wizard.handleReset(); await oldExecute(); await tick()
  assert(errorEnvelopeWrites === 0 && staleResetWrites === 0, 'parent guard failures: ' + JSON.stringify({ errorEnvelopeWrites, staleResetWrites }))

  for (const [label, response] of [
    ['success false', { success: false, hasConflicts: false }],
    ['empty envelope', {}], ['null envelope', null],
    ['nonboolean flag', { hasConflicts: 0 }],
    ['conflicts', { success: true, hasConflicts: true, conflicts: [{ product_id: 1 }] }],
  ]) {
    await setup(); let count = 0
    mgpos.warehouses.checkReconciliationConcurrencyDrift = async () => response
    mgpos.warehouses.executeReconciliation = async () => { count++; return { success: true } }
    await wizard.executeFinalReconciliation(); await tick()
    assert(count === 0, label + ' allowed a write')
  }
  for (const response of [{ hasConflicts: false }, { success: true, hasConflicts: false, conflicts: [] }]) {
    await setup(); let count = 0
    mgpos.warehouses.checkReconciliationConcurrencyDrift = async () => response
    mgpos.warehouses.executeReconciliation = async () => { count++; return { success: true } }
    await wizard.executeFinalReconciliation(); await tick()
    assert(count === 1, 'valid clean preflight did not write')
  }

  for (const change of ['reset', 'file', 'warehouse']) {
    await setup()
    const old = [wizard.executeFinalReconciliation, wizard.runClassification, wizard.autoRebaseToLiveStock, wizard.checkConcurrencyDrift, wizard.fetchScopeAnalytics]
    let operations = 0
    for (const name of ['executeReconciliation', 'classifyReconciliationExcel', 'rebaseReconciliationItems', 'checkReconciliationConcurrencyDrift', 'getReconciliationScopeAnalytics']) {
      mgpos.warehouses[name] = async () => { operations++; return { success: true, hasConflicts: false, rebasedItems: [] } }
    }
    let fileRead, newFile
    if (change === 'reset') wizard.handleReset()
    if (change === 'file') { fileRead = deferred(); newFile = makeFile('replacement-held', 8, fileRead); wizard.handleFileSelect(newFile) }
    if (change === 'warehouse') { controls.setWarehouse(2); await tick() }
    await Promise.all(old.map(fn => fn())); await tick()
    assert(operations === 0, 'stale callbacks started operations after ' + change + ': ' + operations)
    if (fileRead) { fileRead.resolve(newFile.bytes); await tick() }
    if (change === 'warehouse') { controls.setWarehouse(1); await tick() }
  }

  await setup()
  wizard.setStrategyForProductIds([], 'keep')
  wizard.linkUnmatchedRow(999, null)
  wizard.setSessionNotes('')
  await tick()
  let noOpWrites = 0
  mgpos.warehouses.executeReconciliation = async () => { noOpWrites++; return { success: true } }
  await wizard.executeFinalReconciliation(); await tick()
  assert(noOpWrites === 1, 'no-op input left fresh callbacks unusable')

  await setup()
  let sameTurnWrites = []
  mgpos.warehouses.executeReconciliation = async payload => { sameTurnWrites.push(payload); return { success: true } }
  const beforeEdit = wizard.executeFinalReconciliation
  wizard.updateRowQuantity(1, 9)
  await beforeEdit(); await tick()
  assert(sameTurnWrites.length === 0, 'same-turn edit sent stale payload')
  await wizard.executeFinalReconciliation(); await tick()
  assert(sameTurnWrites.length === 1 && sameTurnWrites[0].items[0].physical_quantity === 9, 'fresh callback did not send edited quantity')

  await setup()
  let write = deferred(), completions = 0
  window.completed = () => { completions++; throw new Error('callback failure') }
  writes = []
  mgpos.warehouses.executeReconciliation = payload => { writes.push(payload); return write.promise }
  const pending = wizard.executeFinalReconciliation(); await tick()
  assert(writes.length === 1, 'write did not start')
  wizard.handleReset(); await tick()
  await wizard.handleFileSelect(makeFile('another', 4)); await tick()
  await wizard.runClassification(); await tick()
  await wizard.executeFinalReconciliation(); await tick()
  assert(writes.length === 1, 'reset allowed another write while first is pending')
  wizard.handleReset(); await tick()
  write.resolve({ success: true }); await pending; await tick()
  assert(completions === 1 && !wizard.executionResult && wizard.currentStep === 1, 'old write did not notify cleanly')
  assert(writes[0].items[0].excel_row_number === 2 && !('user_id' in writes[0]) && !('username' in writes[0]), 'payload changed')

  await setup()
  writes = []; let attempts = 0
  mgpos.warehouses.executeReconciliation = payload => { writes.push(payload); attempts++; return attempts === 1 ? Promise.reject(new Error('rejected')) : Promise.resolve({ success: true }) }
  window.completed = async () => { throw new Error('async callback failure') }
  await wizard.executeFinalReconciliation(); await tick()
  await wizard.executeFinalReconciliation(); await tick()
  await wizard.executeFinalReconciliation(); await tick()
  assert(writes.length === 2 && JSON.stringify(writes[0]) === JSON.stringify(writes[1]), 'retry/ack duplicate handling failed')
  await setup()
  wizard.setUncountedPolicy('zero'); wizard.setSessionNotes('fictional note'); await tick()
  for (const strategy of ['replace', 'add', 'keep']) {
    wizard.setRowStrategy(1, strategy); await tick()
    writes = []
    mgpos.warehouses.executeReconciliation = p => { writes.push(p); return Promise.reject(new Error('retry fixture')) }
    await wizard.executeFinalReconciliation(); await tick()
    const payload = writes[0]
    assert(payload.uncounted_action === 'zero' && payload.notes === 'fictional note' && payload.items[0].strategy === strategy && payload.items[0].excel_row_number === 2 && payload.items[0].system_quantity === 3, 'strategy DTO changed: ' + strategy)
    assert(payload.items[0].physical_quantity === ({replace: 4, add: 7, keep: 3})[strategy], 'strategy target changed: ' + strategy)
  }

  await setup()
  let scopeA = deferred(), scopeB = deferred(), scopeCalls = 0
  mgpos.warehouses.getReconciliationScopeAnalytics = () => (++scopeCalls === 1 ? scopeA.promise : scopeB.promise)
  const scopeFirst = wizard.fetchScopeAnalytics(), scopeSecond = wizard.fetchScopeAnalytics()
  scopeB.resolve({ totalCatalogItems: 12 }); await scopeSecond; await tick()
  scopeA.resolve({ totalCatalogItems: 99 }); await scopeFirst; await tick()
  assert(wizard.scopeAnalytics.data.totalCatalogItems === 12 && !wizard.scopeAnalytics.loading, 'older scope overwrote newer scope')
  wizard.setCurrentStep(3); await tick(); await tick()
  assert(scopeCalls <= 3, 'scope analytics auto-effect looped')

  await setup()
  let oldScope = deferred(), oldDrift = deferred()
  mgpos.warehouses.getReconciliationScopeAnalytics = () => oldScope.promise
  mgpos.warehouses.checkReconciliationConcurrencyDrift = () => oldDrift.promise
  const sp = wizard.fetchScopeAnalytics(), dp = wizard.checkConcurrencyDrift()
  controls.setWarehouse(2); await tick()
  oldScope.resolve({ totalCatalogItems: 999 }); oldDrift.resolve({ hasConflicts: true, conflicts: [{ product_id: 1 }] })
  await Promise.all([sp, dp]); await tick()
  assert(!wizard.scopeAnalytics.data && !wizard.concurrencyDrift && !wizard.concurrencyChecking, 'old warehouse result polluted new session')
  controls.setWarehouse(1); await tick()

  await setup()
  preflight = deferred(); writes = []
  mgpos.warehouses.checkReconciliationConcurrencyDrift = () => preflight.promise
  mgpos.warehouses.executeReconciliation = p => { writes.push(p); return Promise.resolve({ success: true }) }
  const unmounted = wizard.executeFinalReconciliation()
  controls.setMounted(false); await tick()
  preflight.resolve({ hasConflicts: false }); await unmounted; await tick()
  assert(writes.length === 0, 'unmount allowed stale write')
  controls.setMounted(true); await tick()

  await setup()
  writes = []
  mgpos.warehouses.checkReconciliationConcurrencyDrift = () => { throw new Error('forced check called') }
  mgpos.warehouses.executeReconciliation = p => { writes.push(p); return Promise.resolve({ success: true }) }
  wizard.setForceConcurrency(true); await tick()
  await wizard.executeFinalReconciliation(); await tick()
  assert(writes.length === 1 && writes[0].force_concurrency, 'force policy changed')

  return `parent guards ${JSON.stringify({ errorEnvelopeWrites, staleResetWrites })}; cached callbacks/envelopes/edit/retry and prior cases passed`
}
