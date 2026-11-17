import React from 'react'
import { createRoot } from 'react-dom/client'
import AuditLogPage from '/src/pages/audit/AuditLogPage.jsx'
window.rows = [{id:0, created_at:'2025-01-02T03:04:05Z', username:'=HYPERLINK("https://example.invalid","x")', user_role:'admin', action:'constructor', entity_type:'product', entity_name:'001', entity_id:0, details:'@SUM(1,2)'}]
window.rows.push(...['=cmd|\'/C calc\'!A0', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd', '\ncmd', '\u2003=cmd', '"quoted"', 'عربي', '-12.00', '001'].map((name,i)=>({id:i+1, created_at:'2025-01-02T03:04:05Z', username:'fixture', user_role:'cashier', action:i===0?'__proto__':'unknown', entity_type:'other', entity_name:name, entity_id:i, details:name})))
window.calls = []
window.mode = 'ok'
window.mgpos = {db:{
  getAuditLogs: filters => { window.calls.push(filters); if(window.mode==='hold') return new Promise((resolve,reject)=>window.pending={resolve,reject}); if(window.mode==='bad') return Promise.resolve({}); if(window.mode==='fail') return Promise.reject(Error('fictional failure')); return Promise.resolve(window.rows) },
  getAuditCount: () => Promise.resolve(123), getAuditStats: () => Promise.resolve({total:123,today:1,week:2})
}}
const root=createRoot(document.getElementById('root'))
window.renderAudit = user => root.render(<AuditLogPage user={user} />)
window.unmountAudit = () => root.unmount()
window.renderAudit({role:'admin'})
