import React, { useState } from 'react'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider, useLanguage } from './context/LanguageContext'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { Shell } from './components/layout/Shell'
import { DashboardOverview } from './pages/DashboardOverview'
import { StoresPage } from './pages/StoresPage'
import { CashiersPage } from './pages/CashiersPage'
import { FeatureFlagsPage } from './pages/FeatureFlagsPage'
import { LicenseGeneratorPage } from './pages/LicenseGeneratorPage'
import { OtaReleasesPage } from './pages/OtaReleasesPage'
import { AuditAndFailuresPage } from './pages/AuditAndFailuresPage'
import { VitalTelemetryPage } from './pages/VitalTelemetryPage'
import { StoreDevicesPage } from './pages/StoreDevicesPage'

function DashboardContent() {
  const [activeView, setActiveView] = useState('overview')
  const { t } = useLanguage()

  const renderActiveView = () => {
    switch (activeView) {
      case 'overview':
        return <DashboardOverview onNavigate={setActiveView} />
      case 'stores':
        return <StoresPage onNavigate={setActiveView} />
      case 'cashiers':
        return <CashiersPage onNavigate={setActiveView} />
      case 'store-devices':
        return <StoreDevicesPage />
      case 'feature-flags':
        return <FeatureFlagsPage />
      case 'licenses':
        return <LicenseGeneratorPage />
      case 'ota':
        return <OtaReleasesPage />
      case 'telemetry':
        return <VitalTelemetryPage />
      case 'audit':
        return <AuditAndFailuresPage />
      default:
        return <DashboardOverview onNavigate={setActiveView} />
    }
  }

  return (
    <Shell activeView={activeView} onViewChange={setActiveView}>
      {renderActiveView()}
    </Shell>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ProtectedRoute>
            <DashboardContent />
          </ProtectedRoute>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

