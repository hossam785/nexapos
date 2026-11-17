import React from 'react'
import { Sun, Moon, Languages, Menu, LogOut } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { useLanguage } from '../../context/LanguageContext'
import { useAuth } from '../../context/AuthContext'

export function Topbar({ onToggleSidebar }) {
  const { theme, toggleTheme } = useTheme()
  const { lang, toggleLanguage, t } = useLanguage()
  const { user, logout } = useAuth()
  const ar = lang === 'ar'
  return (
    <header className="topbar">
      <button onClick={onToggleSidebar} className="btn btn-secondary btn-icon" aria-label={ar ? 'فتح أو إغلاق القائمة' : 'Toggle navigation'}><Menu size={18} /></button>
      <div className="topbar-actions">
        <button onClick={toggleLanguage} className="btn btn-secondary" type="button"><Languages size={15} /><span>{ar ? 'English' : 'عربي'}</span></button>
        <button onClick={toggleTheme} className="btn btn-secondary btn-icon" aria-label={theme === 'dark' ? (ar ? 'الوضع الفاتح' : 'Light mode') : (ar ? 'الوضع الداكن' : 'Dark mode')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
        <div className="topbar-user"><strong>{user?.fullName || user?.username || t('superAdmin')}</strong><span>{user?.email}</span></div>
        <button onClick={logout} className="btn btn-secondary btn-icon" aria-label={ar ? 'تسجيل الخروج' : 'Sign out'}><LogOut size={16} /></button>
      </div>
    </header>
  )
}
