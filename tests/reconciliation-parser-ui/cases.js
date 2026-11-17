window.runParityCases = async () => {
  const cases = [
    { name: 'packs', sheets: [['Packs', [
      ['barcode', 'name', 'packs', 'pack_size', 'cost_price', 'sell_price', 'category', 'notes'],
      ['001234567', 'صنف عربي', 2, 16.5, 3.25, 8.25, 'فئة', 'ملاحظة'],
      ['1.23E+12', 'scientific', 0, 16.5, 0, 0, 'category', 'note']
    ]]] },
    { name: 'quantities', sheets: [['Counts', [
      ['barcode', 'name', 'quantity', 'cost_price', 'sell_price', 'category', 'notes'],
      ['001234', 'zero', 0, 2, 4, 'category', 'note'],
      ['002345', 'عربي', '٨٫٢٥', 2, 4, 'فئة', 'ملاحظة'],
      ['003456', 'negative', -1], ['004567', 'blank', null],
      ['005678', 'malformed', '12abc'], ['006789', 'overflow', '1e400']
    ]]] },
    { name: 'offset and explicit sheet', options: { sheetName: 'Chosen', previewLimit: 1 }, sheets: [
      ['Other', [['barcode', 'name', 'quantity'], ['99', 'other', 9]]],
      ['Chosen', [['fictional report'], ['barcode', 'name', 'quantity'], ['00123', 'chosen', 3], ['00456', 'second', 4]]]
    ] },
    { name: 'absent headers', sheets: [['Plain', [['unknown', 'other'], ['alpha', 'beta']]]] },
    { name: 'blank sheet', sheets: [['Empty', []]] },
  ]
  for (const item of cases) {
    const bytes = makeSheets(item.sheets)
    const options = item.options || { previewLimit: 25 }
    const expected = controlParse(bytes.slice(0), options)
    const job = startParse(bytes, options)
    const actual = await job.promise
    compareResults(actual, expected)
    if (item.name === 'packs') {
      testAssert(actual.rows[0].barcode === '001234567' && actual.rows[0].physical_quantity === 33, 'pack and leading zero')
      testAssert(actual.rows[0].pack_size === 16.5 && actual.rows[0].cost_price === 3.25 && actual.rows[0].sell_price === 8.25, 'pack and prices')
      testAssert(actual.rows[0].category && actual.rows[0].notes && actual.rows[0].raw_values.raw_barcode === '001234567', 'metadata')
      testAssert(actual.rows[1].barcode === '1230000000000' && actual.rows[1].physical_quantity === 0, 'scientific barcode and zero')
    }
    if (item.name === 'quantities') {
      testAssert(actual.rows[0].physical_quantity === 0 && actual.rows[1].physical_quantity === 8.25, 'zero and decimal')
      testAssert(actual.rows.slice(2).every(row => row.physical_quantity === null), 'invalid quantity')
    }
    if (item.name === 'offset and explicit sheet') testAssert(actual.selectedSheet === 'Chosen' && actual.headerRowNumber === 2 && actual.previewRows.length === 1, 'sheet options')
  }
  for (const bytes of [new ArrayBuffer(0), new Uint8Array([0, 1, 2, 3]).buffer]) {
    const expected = controlParse(bytes.slice(0))
    const actual = await startParse(bytes, { previewLimit: 25 }).promise
    compareResults(actual, expected)
  }
}

window.runLifecycleCases = async () => {
  let readRelease
  const read = new Promise(resolve => { readRelease = resolve })
  const before = workerRecords.length
  const oldRead = wizard.handleFileSelect({ name: 'old-read', size: 1, arrayBuffer: () => read })
  wizard.handleReset(); readRelease(makeWorkbook(2)); await oldRead; await tick()
  testAssert(workerRecords.length === before, 'late read started worker')

  const cancelJob = startParse(makeWorkbook(2), { previewLimit: 25 })
  const cancelRecord = workerRecords.at(-1)
  let settled = 0
  cancelJob.promise.then(() => settled++)
  cancelJob.cancel(); cancelJob.cancel()
  testAssert(await cancelJob.promise === null, 'cancel did not settle null')
  await tick()
  testAssert(settled === 1 && cancelRecord.terminated === 1 && cancelRecord.listeners.size === 0, 'cancel not idempotent')

  // Queue a real response, then replay its already-captured listener after cancellation.
  window.holdNextWorker = true
  const a = wizard.handleFileSelect(makeFile('A', makeWorkbook(30)))
  await waitFor(() => workerRecords.at(-1)?.queued.length, 'real A response')
  const recordA = workerRecords.at(-1)
  const staleError = recordA.listeners.get('error').listener
  window.holdNextWorker = true
  const b = wizard.handleFileSelect(makeFile('B', makeWorkbook(3)))
  await waitFor(() => workerRecords.at(-1) !== recordA && workerRecords.at(-1).queued.length, 'real B response')
  const recordB = workerRecords.at(-1)
  await a; await tick()
  const staleResponse = recordA.queued[0].deliver
  releaseWorker(recordA)
  staleError(new Event('error')) // fixture-injected late error to exercise the captured old listener
  await tick()
  testAssert(wizard.fileInfo.name === 'B' && wizard.parsingLoading && !wizard.parsingError, 'old completion unlocked B')
  releaseWorker(recordB); await b; await tick()
  staleResponse(); staleError(new Event('error')); await tick()
  testAssert(wizard.fileInfo.name === 'B' && wizard.parsedRows.length === 3 && !wizard.parsingError && !wizard.parsingLoading, 'B result ownership')
  testAssert(recordA.terminated === 1 && recordB.terminated === 1 && recordA.listeners.size === 0 && recordB.listeners.size === 0, 'race resource leak')

  for (const kind of ['reset', 'warehouse', 'unmount']) {
    window.holdNextWorker = true
    const pending = wizard.handleFileSelect(makeFile(kind, makeWorkbook(4)))
    await waitFor(() => workerRecords.at(-1)?.queued.length, kind + ' response')
    const record = workerRecords.at(-1)
    if (kind === 'reset') wizard.handleReset()
    else if (kind === 'warehouse') controls.setWarehouse(2)
    else controls.setMounted(false)
    await waitFor(() => record.terminated === 1, kind + ' cancellation')
    releaseWorker(record); await pending; await tick()
    testAssert(record.listeners.size === 0, kind + ' listeners remain')
    if (kind !== 'unmount') testAssert(!wizard.rawParseResult && !wizard.parsingLoading, kind + ' stale UI')
    else { controls.setMounted(true); await waitFor(() => wizard && controls, 'remount'); await tick() }
    await wizard.handleFileSelect(makeFile(kind + '-retry', makeWorkbook(2))); await tick()
    testAssert(wizard.parsedRows.length === 2 && !wizard.parsingError, kind + ' retry')
  }
  testAssert(workerRecords.every(record => record.terminated === 1 && record.listeners.size === 0), 'owned workers/listeners not cleaned up')
  testAssert(unhandled.length === 0, 'unhandled rejection: ' + unhandled.join(','))
}

window.runFailureCases = async () => {
  const WrappedWorker = window.Worker
  try {
    for (const mode of ['CSP', 'clone', 'error', 'messageerror', 'bad']) {
      window.Worker = class extends EventTarget {
        constructor() { super(); if (mode === 'CSP') throw Error('CSP denied') }
        postMessage() {
          if (mode === 'clone') throw new DOMException('DataCloneError', 'DataCloneError')
          queueMicrotask(() => this.dispatchEvent(mode === 'bad' ? new MessageEvent('message', { data: { result: { success: true } } }) : new Event(mode)))
        }
        terminate() {}
      }
      await wizard.handleFileSelect(makeFile(mode, makeWorkbook(2))); await tick()
      testAssert(wizard.parsingError && !wizard.parsingLoading, mode + ' error invisible')
    }
    window.Worker = undefined
    const bytes = makeWorkbook(2), expected = controlParse(bytes.slice(0))
    await wizard.handleFileSelect(makeFile('fallback', bytes)); await tick()
    compareResults(wizard.rawParseResult, expected)
  } finally { window.Worker = WrappedWorker }
  await wizard.handleFileSelect(makeFile('retry', makeWorkbook(2))); await tick()
  testAssert(!wizard.parsingError && wizard.parsedRows.length === 2, 'retry failed')
  testAssert(unhandled.length === 0, 'unhandled rejection')
}
