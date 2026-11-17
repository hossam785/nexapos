import * as real from '../../node_modules/xlsx/xlsx.mjs'
export const utils = real.utils
export function writeFile(wb, filename) {
  window.writes = (window.writes || 0) + 1
  if (window.writerMode === 'hold') return new Promise((resolve, reject) => { window.finishWrite = resolve; window.rejectWrite = reject })
  if (window.writerMode === 'fail') throw Error('fictional writer failure')
  return real.writeFile(wb, filename)
}
