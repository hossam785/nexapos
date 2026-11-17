import { useEffect, useRef } from 'react'

export function useFlagsDialog(isOpen, onClose, busy) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    if (!isOpen) return undefined
    const previous = document.activeElement
    const dialog = ref.current
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
    focusable()[0]?.focus()
    const keydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) closeRef.current()
      } else if (event.key === 'Tab') {
        const items = focusable()
        if (!items.length) { event.preventDefault(); dialog.focus(); return }
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [isOpen])
  return ref
}
