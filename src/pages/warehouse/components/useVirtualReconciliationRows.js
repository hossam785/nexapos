import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

// Logical items stay separate from this DOM window, including for selection.
export default function useVirtualReconciliationRows(items, enabled, density, editingId) {
  const containerRef = useRef(null)
  const cache = useRef(new Map())
  const previousItems = useRef(items)
  const [width, setWidth] = useState(0)
  const [revision, setRevision] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 600 })
  const frame = useRef(0)
  const previousLayout = useRef({ density, width })
  if (previousLayout.current.density !== density || previousLayout.current.width !== width) {
    cache.current = new Map()
    previousLayout.current = { density, width }
  }
  if (previousItems.current !== items) {
    const ids = new Set(items.map(item => item.product_id))
    for (const id of cache.current.keys()) {
      if (!ids.has(id)) cache.current.delete(id)
    }
    previousItems.current = items
  }
  const offsets = useMemo(() => {
    const result = [0]
    for (const item of items) result.push(result[result.length - 1] + (cache.current.get(item.product_id) || (density === 'compact' ? 58 : 70)))
    return result
  }, [items, density, width, revision])
  const updateViewport = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = containerRef.current
      if (el) setViewport({ top: el.scrollTop, height: el.clientHeight })
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return
    const observer = new ResizeObserver(() => { setWidth(el.clientWidth); updateViewport() })
    observer.observe(el)
    updateViewport()
    return () => observer.disconnect()
  }, [enabled, updateViewport])
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return
    const observer = new ResizeObserver(entries => {
      let changed = false
      for (const entry of entries) {
        const index = Number(entry.target.dataset.virtualIndex)
        const item = items[index]
        if (!item) continue
        const height = entry.target.getBoundingClientRect().height
        if (height > 0 && Math.abs((cache.current.get(item.product_id) || 0) - height) > 0.5) {
          cache.current.set(item.product_id, height)
          changed = true
        }
      }
      if (changed) setRevision(n => n + 1)
    })
    el.querySelectorAll('tr[data-virtual-index]').forEach(row => observer.observe(row))
    return () => observer.disconnect()
  })
  const entries = useMemo(() => {
    if (!enabled) return items.map((item, index) => ({ item, index }))
    const find = value => {
      let lo = 0, hi = items.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (offsets[mid + 1] < value) lo = mid + 1
        else hi = mid
      }
      return lo
    }
    const start = Math.max(0, find(Math.max(0, viewport.top - 500)) - 1)
    const end = Math.min(items.length, find(viewport.top + viewport.height + 500) + 2)
    const indices = []
    for (let i = start; i < end; i++) indices.push(i)
    const pinned = editingId == null ? -1 : items.findIndex(item => item.product_id === editingId)
    if (pinned >= 0 && (pinned < start || pinned >= end)) indices.push(pinned)
    indices.sort((a, b) => a - b)
    const result = []
    let cursor = 0
    for (const index of indices) {
      if (index > cursor) result.push({ gap: offsets[index] - offsets[cursor], key: `gap-${cursor}` })
      result.push({ item: items[index], index })
      cursor = index + 1
    }
    if (cursor < items.length) result.push({ gap: offsets[items.length] - offsets[cursor], key: `gap-${cursor}` })
    return result
  }, [items, enabled, offsets, viewport, editingId])
  return { containerRef, updateViewport, entries }
}
