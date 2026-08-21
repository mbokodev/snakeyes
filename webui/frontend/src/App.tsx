import React, { useState } from 'react'
import { Bot as BotIcon, Activity } from 'lucide-react'
import Bot from './pages/Bot'
import Status from './pages/Status'

type Tab = 'configs' | 'status'

export default function App() {
  const [tab, setTab] = useState<Tab>('configs')

  const tabButton = (t: Tab, label: string, Icon: typeof BotIcon) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: '10px 18px',
        borderRadius: 10,
        border: tab === t ? '1px solid rgba(124,58,237,0.45)' : '1px solid var(--border)',
        background: tab === t ? 'rgba(124,58,237,0.12)' : 'var(--surface)',
        color: tab === t ? 'var(--purple)' : 'var(--muted)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
        fontSize: 14,
      }}
    >
      <Icon size={16} />
      {label}
    </button>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 60px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.3px' }}>
          eBay CA <span style={{ color: 'var(--fuchsia)' }}>Scraper</span>
        </h1>
        <div style={{ flex: 1 }} />
        {tabButton('configs', 'Configurations', BotIcon)}
        {tabButton('status', 'Statut', Activity)}
      </header>
      {tab === 'configs' ? <Bot /> : <Status />}
    </div>
  )
}
