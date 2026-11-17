import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, useAuth } from '../src/context/AuthContext'
import { LanguageProvider } from '../src/context/LanguageContext'
import { ThemeProvider } from '../src/context/ThemeContext'
import { ProtectedRoute } from '../src/components/auth/ProtectedRoute'
import { Shell } from '../src/components/layout/Shell'
import '../src/index.css'
function Probe() {
  const auth = useAuth()
  window.__auth = auth
  return <ProtectedRoute><Shell activeView="overview"><div>Fixture dashboard</div></Shell></ProtectedRoute>
}
window.__root = createRoot(document.getElementById('root'))
window.__root.render(<ThemeProvider><LanguageProvider><AuthProvider><Probe /></AuthProvider></LanguageProvider></ThemeProvider>)
