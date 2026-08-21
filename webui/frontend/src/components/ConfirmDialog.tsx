import React from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirmer',
  danger = false,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 24,
          width: 'min(420px, 90vw)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 10px 0', fontSize: 17 }}>{title}</h3>
        <p style={{ margin: '0 0 20px 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 16px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '9px 16px',
              borderRadius: 9,
              border: 'none',
              background: danger ? 'var(--danger)' : 'var(--primary)',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
