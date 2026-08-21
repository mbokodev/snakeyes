import React, { useEffect, useState } from 'react'
import { Activity, Play, RefreshCcw, Clock, Database, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { getStatus, runNow, StatusEntry } from '../lib/api'
import { toast } from '../lib/toast'

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 0) return 'à l’instant'
  if (diff < 60) return `il y a ${Math.floor(diff)} s`
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  return `il y a ${Math.floor(diff / 86400)} j`
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} o`
  return `${(bytes / 1024).toFixed(1)} Ko`
}

const badgeStyle = (color: string, bg: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  color,
  background: bg,
})

export default function Status() {
  const [entries, setEntries] = useState<StatusEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [runningNow, setRunningNow] = useState<string | null>(null)
  const [lastOutput, setLastOutput] = useState<{ name: string; output: string } | null>(null)

  const fetchStatus = async () => {
    try {
      const res = await getStatus()
      setEntries(res.data)
    } catch {
      // silencieux pendant le polling
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [])

  const handleRun = async (name: string) => {
    setRunningNow(name)
    try {
      const res = await runNow(name)
      setLastOutput({ name, output: res.data.output })
      if (res.data.ok) {
        toast(`Run terminé pour ${name.replace('.yml', '')}`, 'success')
      } else {
        toast(`Run en erreur (code ${res.data.returncode})`, 'error')
      }
    } catch (err: any) {
      toast(err?.response?.data?.detail || 'Erreur lors du lancement', 'error')
    } finally {
      setRunningNow(null)
      fetchStatus()
    }
  }

  return (
    <div className="card">
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(52,211,153,0.12), rgba(6,182,212,0.08))',
        borderRadius: 14, padding: '24px 28px',
        display: 'flex', alignItems: 'center', gap: 16,
        border: '1px solid rgba(52,211,153,0.15)', marginBottom: 20,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #34d399, #0891b2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Activity size={20} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Statut du scraper</h2>
          <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Dernières exécutions par configuration — rafraîchi toutes les 10 s
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchStatus() }}
          style={{
            padding: '10px 16px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600,
          }}
        >
          <RefreshCcw size={15} /> Rafraîchir
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>Chargement...</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {entries.map((e) => {
            const lr = e.last_run
            return (
              <div key={e.name} className="card" style={{ padding: 18, background: 'var(--surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{e.name.replace('.yml', '')}</span>
                  {e.enabled ? (
                    <span style={badgeStyle('var(--green)', 'rgba(52,211,153,0.12)')}>Active</span>
                  ) : (
                    <span style={badgeStyle('var(--muted)', 'rgba(156,163,175,0.12)')}>Désactivée</span>
                  )}
                  {e.running && (
                    <span style={badgeStyle('var(--cyan)', 'rgba(103,232,249,0.12)')}>
                      <Loader2 size={12} className="spin" /> En cours
                    </span>
                  )}
                  {lr && (lr.ok ? (
                    <span style={badgeStyle('var(--green)', 'rgba(52,211,153,0.12)')}>
                      <CheckCircle2 size={12} /> OK
                    </span>
                  ) : (
                    <span style={badgeStyle('var(--red)', 'rgba(248,113,113,0.12)')} title={lr.error || ''}>
                      <XCircle size={12} /> Erreur
                    </span>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => handleRun(e.name)}
                    disabled={runningNow !== null}
                    style={{
                      padding: '8px 14px', borderRadius: 9,
                      border: '1px solid rgba(52,211,153,0.4)',
                      background: runningNow === e.name ? 'var(--surface)' : 'rgba(52,211,153,0.12)',
                      color: 'var(--green)',
                      cursor: runningNow !== null ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 7,
                      fontWeight: 600, fontSize: 13,
                    }}
                  >
                    {runningNow === e.name ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    {runningNow === e.name ? 'Exécution...' : 'Lancer maintenant'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13, color: 'var(--muted)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={14} />
                    Dernier run : <strong style={{ color: 'var(--text)' }}>{timeAgo(lr?.ts ?? null)}</strong>
                    {lr && <span>({lr.duration_s}s{lr.seed ? ', seed' : ''})</span>}
                  </span>
                  {lr && (
                    <span>
                      <strong style={{ color: 'var(--text)' }}>{lr.total}</strong> annonces ·{' '}
                      <strong style={{ color: 'var(--cyan)' }}>{lr.new}</strong> nouvelles ·{' '}
                      <strong style={{ color: 'var(--lime)' }}>{lr.matched}</strong> matchées
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Database size={14} />
                    Cache : <strong style={{ color: 'var(--text)' }}>{formatSize(e.cache_size)}</strong>
                    {e.cache_items !== null && <span>({e.cache_items} IDs)</span>}
                  </span>
                </div>

                {lr && !lr.ok && lr.error && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
                    color: 'var(--red)', fontSize: 12.5, fontFamily: 'monospace',
                  }}>
                    {lr.error}
                  </div>
                )}

                {lastOutput?.name === e.name && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>
                      Sortie du dernier run manuel
                    </summary>
                    <pre style={{
                      marginTop: 8, padding: 12, borderRadius: 8,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      color: 'var(--cyan)', fontSize: 12, overflowX: 'auto',
                      whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                    }}>
                      {lastOutput.output}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
          {entries.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>
              Aucune configuration trouvée.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
