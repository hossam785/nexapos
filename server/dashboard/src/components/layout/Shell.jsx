import React, { useState, useEffect, useRef } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ErrorBoundary } from '../common/ErrorBoundary'

export function Shell({ activeView, onViewChange, children }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const shellRef = useRef(null)
  useEffect(() => {
    if (!mobileOpen) return
    const shell = shellRef.current
    const previous = document.activeElement
    const main = shell.querySelector('.main-content')
    main.inert = true
    const items = () => [...shell.querySelectorAll('.sidebar button:not(:disabled)')]
    items()[0]?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false) }
      if (event.key === 'Tab') {
        const buttons = items()
        if (!buttons.length) return
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); main.inert = false; previous?.focus() }
  }, [mobileOpen])

  return (
    <div ref={shellRef} className={`app-container${mobileOpen ? ' mobile-nav-open' : ''}`}>
      <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} tabIndex={mobileOpen ? 0 : -1} />
      <Sidebar
        activeView={activeView}
        onViewChange={(view) => { onViewChange?.(view); setMobileOpen(false) }}
        isCollapsed={isSidebarCollapsed}
      />
      <div className="main-content">
        <Topbar
          onToggleSidebar={() => { if (window.matchMedia('(max-width: 767px)').matches) setMobileOpen((prev) => !prev); else setIsSidebarCollapsed((prev) => !prev) }}
        />
        <main className="content-body">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
