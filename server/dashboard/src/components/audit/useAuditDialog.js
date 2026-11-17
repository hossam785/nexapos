import { useEffect, useRef } from 'react'

export function useAuditDialog(open, onClose, busyRef) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = ref.current
    const focusable = () => Array.from(dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])
    ;(focusable()[0] || dialog)?.focus()
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busyRef?.current) closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) { event.preventDefault(); dialog?.focus(); return }
      const index = items.indexOf(document.activeElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus() }
  }, [open, busyRef])
  return ref
}
