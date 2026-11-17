import { useEffect, useRef } from 'react'

// Dialog focus stays local; restore the actual opener on dismissal.
export function useOtaDialog(isOpen, onClose, busy = false) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy
  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = ref.current
    const focusable = () => [...dialog.querySelectorAll('button:enabled, input:enabled, select:enabled, textarea:enabled, [tabindex="0"]')]
    ;(focusable()[0] || dialog).focus()
    const keydown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      if (!nodes.length) { event.preventDefault(); dialog.focus(); return }
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus() }
      else if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus() }
  }, [isOpen])
  return ref
}
