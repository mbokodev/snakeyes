import React, { useState, useEffect } from 'react'
import { getConfigs, getConfig, getConfigRaw, updateConfigRaw, createConfigRaw, updateConfig, createConfig, deleteConfig } from '../lib/api'
import { toast } from '../lib/toast'
import { Save, FileText, Settings, Plus, Type, SquareStack, Trash2, Copy, Code, Bot as BotIcon } from 'lucide-react'
import yaml from 'js-yaml'
import ConfirmDialog from '../components/ConfirmDialog'

interface ConfigData {
  bot: string[]
  price_ranges: string[]
  keywords: string[]
  enabled?: boolean
  bot_blocklist?: string[]
  ebay_category?: string[]
  item_location_provinces?: string[]
  search_query?: string
  limit_ebay?: number
  // Champs hérités (kleinanzeigen) préservés au round-trip mais non affichés
  category?: string[]
  page_count?: number
  get_description?: boolean
  direkt_kaufen_only?: boolean
  [key: string]: any // Champs dynamiques : price_ranges_2, keywords_2, etc.
}

export default function Bot() {
  const [configs, setConfigs] = useState<string[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [configData, setConfigData] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNewConfig, setShowNewConfig] = useState(false)
  const [newConfigName, setNewConfigName] = useState('')
  const [textMode, setTextMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [showRawModal, setShowRawModal] = useState(false)
  const [rawContent, setRawContent] = useState('')
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const [duplicateName, setDuplicateName] = useState('')

  // Get all price_ranges fields (price_ranges, price_ranges_2, etc.)
  const getPriceRangeFields = () => {
    if (!configData) return []
    return Object.keys(configData)
      .filter(key => key.startsWith('price_ranges') && !key.endsWith('_active'))
      .sort()
  }

  // Get all keywords fields (keywords, keywords_2, etc.)
  const getKeywordFields = () => {
    if (!configData) return []
    return Object.keys(configData)
      .filter(key => key.startsWith('keywords') && !key.endsWith('_active'))
      .sort()
  }

  const addPriceRangeField = () => {
    if (!configData) return
    const fields = getPriceRangeFields()
    const nextIndex = fields.length === 1 ? 2 : Math.max(...fields.map(f => {
      const match = f.match(/_([0-9]+)$/)
      return match ? parseInt(match[1]) : 1
    })) + 1
    const newField = nextIndex === 1 ? 'price_ranges' : `price_ranges_${nextIndex}`
    setConfigData({ ...configData, [newField]: [''] })
  }

  const addKeywordField = () => {
    if (!configData) return
    const fields = getKeywordFields()
    const nextIndex = fields.length === 1 ? 2 : Math.max(...fields.map(f => {
      const match = f.match(/_([0-9]+)$/)
      return match ? parseInt(match[1]) : 1
    })) + 1
    const newField = nextIndex === 1 ? 'keywords' : `keywords_${nextIndex}`
    setConfigData({ ...configData, [newField]: [''] })
  }

  const removePriceRangeField = (field: string) => {
    if (!configData || field === 'price_ranges') return // Don't remove the base field
    const { [field]: _, ...rest } = configData
    setConfigData(rest as ConfigData)
  }

  const removeKeywordField = (field: string) => {
    if (!configData || field === 'keywords') return // Don't remove the base field
    const { [field]: _, ...rest } = configData
    setConfigData(rest as ConfigData)
  }

  useEffect(() => {
    loadConfigs()
  }, [])

  // Track viewport to adjust layout for mobile
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const loadConfigs = async () => {
    try {
      const res = await getConfigs()
      setConfigs(res.data)
    } catch (error) {
      toast('Erreur lors du chargement des configurations', 'error')
    }
  }

  const loadConfig = async (name: string) => {
    setLoading(true)
    try {
      const res = await getConfig(name)
      setConfigData(res.data)
      setSelectedConfig(name)
    } catch (error) {
      toast('Erreur lors du chargement de la configuration', 'error')
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    if (!selectedConfig || !configData) return
    setSaving(true)
    try {
      await updateConfig(selectedConfig, configData)
      toast('Configuration enregistrée', 'success')
    } catch (error) {
      toast("Erreur lors de l'enregistrement", 'error')
    } finally {
      setSaving(false)
    }
  }

  const duplicateConfig = async () => {
    if (!selectedConfig || !configData) return
    const baseName = selectedConfig.replace('.yml', '')
    setDuplicateName(`${baseName}-copy`)
    setShowDuplicateDialog(true)
  }

  const confirmDuplicate = async () => {
    if (!duplicateName || !selectedConfig) return

    const filename = duplicateName.endsWith('.yml') ? duplicateName : `${duplicateName}.yml`
    if (configs.includes(filename)) {
      toast('Ce nom existe déjà', 'error')
      return
    }

    setDuplicating(true)
    setShowDuplicateDialog(false)
    try {
      // Fetch raw content from original file and create new file with it
      const rawRes = await getConfigRaw(selectedConfig)
      await createConfigRaw(filename, rawRes.data.content)
      await loadConfigs()
      await loadConfig(filename)
      toast('Configuration dupliquée', 'success')
    } catch (error) {
      toast('Erreur lors de la duplication', 'error')
    } finally {
      setDuplicating(false)
    }
  }

  const duplicateRawToOriginal = async () => {
    try {
      // Validate YAML first
      yaml.load(rawContent)
      // Save directly to original file
      await updateConfigRaw(selectedConfig, rawContent)
      // Reload the config to update the main view
      await loadConfig(selectedConfig)
      setShowRawModal(false)
      toast('Enregistré dans le fichier original', 'success')
    } catch (err: any) {
      if (err.name === 'YAMLException') {
        toast('Syntaxe YAML invalide', 'error')
      } else {
        toast("Erreur lors de l'enregistrement", 'error')
      }
    }
  }

  const updateField = (field: keyof ConfigData, value: any) => {
    if (!configData) return
    setConfigData({ ...configData, [field]: value })
  }

  const addToArray = (field: 'bot' | 'price_ranges' | 'keywords', value: string) => {
    if (!configData) return
    updateField(field, [...configData[field], value])
  }

  const removeFromArray = (field: 'bot' | 'price_ranges' | 'keywords', index: number) => {
    if (!configData) return
    if (field === 'price_ranges' || field === 'keywords') {
      const newPriceRanges = [...configData.price_ranges]
      const newKeywords = [...configData.keywords]
      newPriceRanges.splice(index, 1)
      newKeywords.splice(index, 1)
      setConfigData({ ...configData, price_ranges: newPriceRanges, keywords: newKeywords })
    } else {
      const newArray = [...configData[field]]
      newArray.splice(index, 1)
      updateField(field, newArray)
    }
  }

  const updateArrayItem = (field: 'bot' | 'price_ranges' | 'keywords', index: number, value: string) => {
    if (!configData) return
    const newArray = [...configData[field]]
    newArray[index] = value
    updateField(field, newArray)
  }

  const createNewConfig = async () => {
    if (!newConfigName.trim()) {
      toast('Veuillez saisir un nom', 'error')
      return
    }
    try {
      const defaultConfig: ConfigData = {
        bot: ['Laptops'],
        enabled: true,
        keywords: [''],
        price_ranges: [''],
        ebay_category: [],
        bot_blocklist: [],
        item_location_provinces: [],
      }
      await createConfig(newConfigName, defaultConfig)
      toast('Configuration créée', 'success')
      setShowNewConfig(false)
      setNewConfigName('')
      await loadConfigs()
      loadConfig(`${newConfigName}.yml`)
    } catch (error: any) {
      toast(error?.response?.data?.detail || 'Erreur lors de la création', 'error')
    }
  }

  const handleDeleteConfig = async (configName: string) => {
    setConfirmDelete(false)
    try {
      await deleteConfig(configName)
      toast('Configuration supprimée', 'success')
      if (selectedConfig === configName) {
        setSelectedConfig('')
        setConfigData(null)
      }
      await loadConfigs()
    } catch (error: any) {
      toast(error?.response?.data?.detail || 'Erreur lors de la suppression', 'error')
    }
  }

  return (
    <div className="card">
      {/* Gradient Header */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(217,70,239,0.12), rgba(124,58,237,0.08))',
        borderRadius: 14, padding: '24px 28px',
        display: 'flex', alignItems: 'center', gap: 16,
        border: '1px solid rgba(217,70,239,0.15)', marginBottom: 20,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #d946ef, #7c3aed)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BotIcon size={20} style={{ color: '#fff' }} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700 }}>Configurations des bots</h2>
          <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Gérer et configurer les bots du scraper eBay
          </p>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h4 style={{ marginTop: 0, marginBottom: 12, color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Configurations disponibles
        </h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {configs.map(config => (
            <button
              key={config}
              onClick={() => loadConfig(config)}
              style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: selectedConfig === config ? '1px solid rgba(217,70,239,0.45)' : '1px solid var(--border)',
                background: selectedConfig === config ? 'rgba(217,70,239,0.12)' : 'var(--surface)',
                color: selectedConfig === config ? 'var(--fuchsia)' : 'var(--text)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s',
                fontWeight: selectedConfig === config ? 600 : 400,
                fontSize: 14,
              }}
            >
              <FileText size={16} />
              {config.replace('.yml', '')}
            </button>
          ))}
          <button
            onClick={() => setShowNewConfig(true)}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px dashed var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
              fontSize: 14,
            }}
          >
            <Plus size={16} />
            Nouvelle config
          </button>
        </div>
      </div>

      {showNewConfig && (
        <div className="card" style={{ padding: 16, marginBottom: 20, background: 'var(--surface-2)' }}>
          <h4 style={{ marginTop: 0, marginBottom: 12, color: 'var(--text)', fontSize: 14 }}>Créer une nouvelle configuration</h4>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={newConfigName}
              onChange={(e) => setNewConfigName(e.target.value)}
              placeholder="ex. tablets"
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 14,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewConfig()
                if (e.key === 'Escape') { setShowNewConfig(false); setNewConfigName('') }
              }}
            />
            <button
              onClick={createNewConfig}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid rgba(124,58,237,0.45)',
                background: 'rgba(124,58,237,0.12)',
                color: 'var(--purple)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Créer
            </button>
            <button
              onClick={() => { setShowNewConfig(false); setNewConfigName('') }}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {configData && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 10 : 0 }}>
            <h3 style={{ margin: 0, color: 'var(--text)', fontSize: 18, width: isMobile ? '100%' : 'auto' }}>{selectedConfig.replace('.yml', '')}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap', width: isMobile ? '100%' : 'auto' }}>
              <button
                onClick={() => setConfirmSave(true)}
                disabled={saving}
                style={{
                  padding: isMobile ? '10px 14px' : '10px 18px',
                  borderRadius: 10,
                  border: '1px solid rgba(124,58,237,0.45)',
                  background: saving ? 'var(--surface)' : 'rgba(124,58,237,0.12)',
                  color: 'var(--purple)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  transition: 'all 0.2s',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <Save size={16} />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
              <button
                onClick={duplicateConfig}
                disabled={duplicating || !configData}
                style={{
                  padding: isMobile ? '10px 14px' : '10px 18px',
                  borderRadius: 10,
                  border: '1px solid rgba(99,102,241,0.4)',
                  background: duplicating ? 'var(--surface)' : 'rgba(99,102,241,0.12)',
                  color: 'rgb(99,102,241)',
                  cursor: duplicating ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  transition: 'all 0.2s',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <Copy size={16} />
                {duplicating ? 'Duplication...' : 'Dupliquer'}
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await getConfigRaw(selectedConfig)
                    setRawContent(res.data.content)
                    setShowRawModal(true)
                  } catch (error) {
                    toast('Erreur lors du chargement du YAML brut', 'error')
                  }
                }}
                style={{
                  padding: isMobile ? '10px 14px' : '10px 18px',
                  borderRadius: 10,
                  border: '1px solid rgba(139,92,246,0.4)',
                  background: 'rgba(139,92,246,0.12)',
                  color: 'rgb(139,92,246)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  transition: 'all 0.2s',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <Code size={16} />
                Raw
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: isMobile ? '10px 14px' : '10px 18px',
                  borderRadius: 10,
                  border: '1px solid rgba(239,68,68,0.45)',
                  background: 'rgba(239,68,68,0.12)',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  transition: 'all 0.2s',
                  width: isMobile ? '100%' : 'auto',
                }}
              >
                <Trash2 size={16} />
                Supprimer
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ color: 'var(--muted)', padding: 20, textAlign: 'center' }}>Chargement...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Bot */}
              <div className="card" style={{ padding: 16 }}>
                <label style={{ fontWeight: 600, marginBottom: 12, display: 'block', color: 'var(--text)', fontSize: 14 }}>Nom du bot</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    value={configData.bot[0] || ''}
                    onChange={(e) => updateArrayItem('bot', 0, e.target.value)}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: 14,
                    }}
                  />
                </div>
              </div>

              {/* Paramètres */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: '14px 18px',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.06))',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Settings size={16} style={{ color: 'rgb(139,92,246)' }} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Paramètres</span>
                </div>

                {/* Toggle Config active */}
                <div
                  onClick={() => updateField('enabled', !(configData.enabled ?? true))}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: '1px solid var(--border)',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(52,211,153,0.04)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Config active</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>Le scraper exécute cette configuration à chaque cycle</div>
                  </div>
                  <div style={{
                    width: 42, height: 24, borderRadius: 12,
                    background: (configData.enabled ?? true)
                      ? 'linear-gradient(135deg, #34d399, #059669)'
                      : 'rgba(156,163,175,0.3)',
                    position: 'relative', transition: 'background 0.25s',
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#fff',
                      position: 'absolute', top: 3,
                      left: (configData.enabled ?? true) ? 21 : 3,
                      transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </div>
                </div>

                {/* Requête de recherche eBay */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px', borderBottom: '1px solid var(--border)', gap: 12,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Requête de recherche</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>Optionnel — texte de recherche eBay (q)</div>
                  </div>
                  <input
                    type="text"
                    value={configData.search_query || ''}
                    onChange={(e) => updateField('search_query', e.target.value)}
                    placeholder="(aucune)"
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: 13,
                      flex: 1,
                      maxWidth: 260,
                    }}
                  />
                </div>

                {/* Limite de résultats */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 18px',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Limite de résultats</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>Nombre d'annonces par requête eBay (limit_ebay)</div>
                  </div>
                  <input
                    type="number"
                    value={configData.limit_ebay ?? 50}
                    onChange={(e) => updateField('limit_ebay', parseInt(e.target.value) || 50)}
                    min={1}
                    max={200}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: 14,
                      fontWeight: 600,
                      width: '70px',
                      textAlign: 'center',
                    }}
                  />
                </div>
              </div>

              {/* Bot Blocklist */}
              {configData.bot_blocklist !== undefined && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <label style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Liste de blocage</label>
                    <button
                      onClick={() => updateField('bot_blocklist', [...(configData.bot_blocklist || []), ''])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '6px 12px', borderRadius: 6, border: 'none',
                        background: 'rgba(239,68,68,0.15)', color: 'var(--red)',
                        cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      <Plus size={14} /> Ajouter
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(configData.bot_blocklist || []).map((entry: string, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '4px 10px', borderRadius: 8,
                          border: '1px solid rgba(239,68,68,0.35)',
                          background: 'rgba(239,68,68,0.08)', fontSize: 13,
                        }}
                      >
                        <input
                          type="text"
                          value={entry}
                          onChange={(e) => {
                            const updated = [...(configData.bot_blocklist || [])]
                            updated[idx] = e.target.value
                            updateField('bot_blocklist', updated)
                          }}
                          style={{
                            border: 'none', background: 'transparent',
                            color: 'var(--red)', fontWeight: 500, outline: 'none',
                            width: `${Math.min(Math.max(entry.length * 8 + 30, 80), 260)}px`,
                            fontSize: 13,
                          }}
                        />
                        <button
                          onClick={() => {
                            const updated = (configData.bot_blocklist || []).filter((_: string, i: number) => i !== idx)
                            updateField('bot_blocklist', updated)
                          }}
                          style={{
                            border: 'none', background: 'transparent',
                            color: 'var(--red)', cursor: 'pointer',
                            fontSize: 16, padding: 0, display: 'flex',
                            alignItems: 'center', lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {(configData.bot_blocklist || []).length === 0 && (
                      <span style={{ color: 'var(--muted)', fontSize: 13 }}>Aucune entrée — le bot ne bloque aucun terme</span>
                    )}
                  </div>
                  <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, color: 'var(--muted)' }}>
                    Les annonces contenant l'un de ces termes sont ignorées par le bot.
                  </p>
                </div>
              )}

              {/* eBay Category */}
              {configData.ebay_category !== undefined && (() => {
                // Normalise: YAML may deserialise a single value as string/number instead of array
                const toArray = (v: any): string[] => {
                  if (Array.isArray(v)) return v
                  if (v === null || v === undefined) return []
                  return [String(v)]
                }
                const ebayCats = toArray(configData.ebay_category)
                return (
                  <div className="card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <label style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Catégories eBay</label>
                        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--muted)' }}>IDs de catégories eBay (ex. 175672, 9355)</p>
                      </div>
                      <button
                        onClick={() => updateField('ebay_category', [...(configData.ebay_category || []), ''])}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '6px 12px', borderRadius: 6, border: 'none',
                          background: 'rgba(234,179,8,0.15)', color: 'rgb(234,179,8)',
                          cursor: 'pointer', fontSize: 12, fontWeight: 600,
                        }}
                      >
                        <Plus size={14} /> Ajouter
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {ebayCats.map((entry: string, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '4px 10px', borderRadius: 8,
                            border: '1px solid rgba(234,179,8,0.4)',
                            background: 'rgba(234,179,8,0.08)', fontSize: 13,
                          }}
                        >
                          <input
                            type="text"
                            value={entry}
                            placeholder="Category ID"
                            onChange={(e) => {
                              const updated = [...ebayCats]
                              updated[idx] = e.target.value
                              updateField('ebay_category', updated)
                            }}
                            style={{
                              border: 'none', background: 'transparent',
                              color: 'rgb(234,179,8)', fontWeight: 600, outline: 'none',
                              width: `${Math.min(Math.max(entry.length * 9 + 40, 80), 180)}px`,
                              fontSize: 13,
                            }}
                          />
                          <button
                            onClick={() => {
                              const updated = ebayCats.filter((_: string, i: number) => i !== idx)
                              updateField('ebay_category', updated)
                            }}
                            style={{
                              border: 'none', background: 'transparent',
                              color: 'rgb(234,179,8)', cursor: 'pointer',
                              fontSize: 16, padding: 0, display: 'flex',
                              alignItems: 'center', lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      {ebayCats.length === 0 && (
                        <span style={{ color: 'var(--muted)', fontSize: 13 }}>Aucune catégorie eBay — la recherche ne sera pas restreinte par catégorie</span>
                      )}
                    </div>
                  </div>
                )
              })()
              }

              {/* Provinces (filtre géographique Canada) */}
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <label style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>Provinces</label>
                    <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--muted)' }}>
                      Filtre géographique (ex. QC, ON, BC). Liste vide = tout le Canada.
                    </p>
                  </div>
                  <button
                    onClick={() => updateField('item_location_provinces', [...(configData.item_location_provinces || []), ''])}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: 6, border: 'none',
                      background: 'rgba(103,232,249,0.15)', color: 'var(--cyan)',
                      cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <Plus size={14} /> Ajouter
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(configData.item_location_provinces || []).map((entry: string, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px', borderRadius: 8,
                        border: '1px solid rgba(103,232,249,0.35)',
                        background: 'rgba(103,232,249,0.08)', fontSize: 13,
                      }}
                    >
                      <input
                        type="text"
                        value={entry}
                        placeholder="QC"
                        onChange={(e) => {
                          const updated = [...(configData.item_location_provinces || [])]
                          updated[idx] = e.target.value
                          updateField('item_location_provinces', updated)
                        }}
                        style={{
                          border: 'none', background: 'transparent',
                          color: 'var(--cyan)', fontWeight: 600, outline: 'none',
                          width: `${Math.min(Math.max(entry.length * 9 + 40, 60), 160)}px`,
                          fontSize: 13,
                        }}
                      />
                      <button
                        onClick={() => {
                          const updated = (configData.item_location_provinces || []).filter((_: string, i: number) => i !== idx)
                          updateField('item_location_provinces', updated)
                        }}
                        style={{
                          border: 'none', background: 'transparent',
                          color: 'var(--cyan)', cursor: 'pointer',
                          fontSize: 16, padding: 0, display: 'flex',
                          alignItems: 'center', lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {(configData.item_location_provinces || []).length === 0 && (
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>Aucune restriction — annonces de tout le Canada</span>
                  )}
                </div>
              </div>

              {/* Price Ranges and Keywords - Dynamic Sets */}
              {getPriceRangeFields().map((priceField) => {
                const keywordField = priceField.replace('price_ranges', 'keywords')
                const priceRanges = configData[priceField] || []
                const keywords = configData[keywordField] || []
                const fieldIndex = priceField.match(/_(\d+)$/)?.[1] || ''
                const fieldLabel = fieldIndex ? `Set ${fieldIndex}` : 'Set 1'
                const canRemove = priceField !== 'price_ranges'

                return (
                  <div key={priceField} className="card" style={{ padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <label style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
                        Plages de prix & mots-clés — {fieldLabel}
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setTextMode(!textMode)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: textMode ? 'rgba(124,58,237,0.12)' : 'var(--surface)',
                            color: textMode ? 'var(--purple)' : 'var(--muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {textMode ? <SquareStack size={14} /> : <Type size={14} />}
                          {textMode ? 'Chips' : 'Text'}
                        </button>
                        {canRemove && (
                          <button
                            onClick={() => {
                              removePriceRangeField(priceField)
                              removeKeywordField(keywordField)
                            }}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 8,
                              border: '1px solid rgba(239,68,68,0.3)',
                              background: 'rgba(239,68,68,0.08)',
                              color: 'var(--red)',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 500,
                            }}
                          >
                            Supprimer le set
                          </button>
                        )}
                      </div>
                    </div>
                    {priceRanges.map((range: string, index: number) => {
                      const keywordString = keywords[index] || ''
                      const keywordList = keywordString ? keywordString.split(';') : []
                      const displayKeywords = keywordList.length ? keywordList : ['']

                      // Get active state for this entry
                      const activeField = `${priceField}_active`
                      const keywordActiveField = `${keywordField}_active`
                      const activeStates = configData[activeField] || []
                      const isActive = activeStates[index] !== false // Default to active if not specified

                      const toggleActive = () => {
                        const newActiveStates = [...activeStates]
                        // Ensure array is long enough
                        while (newActiveStates.length <= index) {
                          newActiveStates.push(true)
                        }
                        newActiveStates[index] = !isActive

                        // Sync keywords active state
                        const keywordActiveStates = [...(configData[keywordActiveField] || [])]
                        while (keywordActiveStates.length <= index) {
                          keywordActiveStates.push(true)
                        }
                        keywordActiveStates[index] = !isActive

                        setConfigData({
                          ...configData,
                          [activeField]: newActiveStates,
                          [keywordActiveField]: keywordActiveStates
                        })
                      }

                      const removeKeyword = (kwIndex: number) => {
                        const newKeywords = keywordList.filter((_: string, i: number) => i !== kwIndex)
                        const updatedKeywords = [...keywords]
                        updatedKeywords[index] = newKeywords.join(';')
                        setConfigData({ ...configData, [keywordField]: updatedKeywords })
                      }

                      const updateKeyword = (kwIndex: number, newValue: string) => {
                        const newKeywords = [...keywordList]
                        newKeywords[kwIndex] = newValue
                        const updatedKeywords = [...keywords]
                        updatedKeywords[index] = newKeywords.join(';')
                        setConfigData({ ...configData, [keywordField]: updatedKeywords })
                      }

                      const addKeyword = () => {
                        const newKeywords = [...keywordList, '']
                        const updatedKeywords = [...keywords]
                        updatedKeywords[index] = newKeywords.join(';')
                        setConfigData({ ...configData, [keywordField]: updatedKeywords })
                      }

                      return (
                        <div key={index} style={{ marginBottom: 16, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', opacity: isActive ? 1 : 0.6 }}>
                          {isMobile ? (
                            <>
                              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                <button
                                  onClick={toggleActive}
                                  style={{
                                    flex: 1,
                                    padding: '12px 14px',
                                    borderRadius: 10,
                                    border: '1px solid',
                                    borderColor: isActive ? 'rgba(16,185,129,0.35)' : 'rgba(156,163,175,0.35)',
                                    background: isActive ? 'rgba(16,185,129,0.12)' : 'rgba(156,163,175,0.12)',
                                    color: isActive ? 'var(--green)' : 'var(--muted)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    fontWeight: 600,
                                    lineHeight: 1,
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  {isActive ? 'Actif' : 'Désactivé'}
                                </button>
                                <button
                                  onClick={() => {
                                    const updatedRanges = priceRanges.filter((_: any, i: number) => i !== index)
                                    const updatedKeywords = keywords.filter((_: any, i: number) => i !== index)
                                    setConfigData({
                                      ...configData,
                                      [priceField]: updatedRanges,
                                      [keywordField]: updatedKeywords,
                                    })
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '12px 14px',
                                    borderRadius: 10,
                                    border: '1px solid rgba(239,68,68,0.35)',
                                    background: 'rgba(239,68,68,0.12)',
                                    color: 'var(--red)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    fontWeight: 600,
                                    lineHeight: 1,
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.18)')}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.12)')}
                                >
                                  <Trash2 size={16} /> Supprimer
                                </button>
                              </div>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr auto',
                                  gap: 8,
                                  marginBottom: 8,
                                  alignItems: 'center',
                                }}
                              >
                                <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Min</label>
                                <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max</label>
                                <span style={{ color: 'var(--muted)', fontSize: 13, justifySelf: 'end', fontWeight: 600 }}>$ CAD</span>

                                <input
                                  type="number"
                                  value={String(range || '').split('-')[0] || ''}
                                  onChange={(e) => {
                                    const max = String(range || '').split('-')[1] || ''
                                    const updatedRanges = [...priceRanges]
                                    updatedRanges[index] = `${e.target.value}-${max}`
                                    setConfigData({ ...configData, [priceField]: updatedRanges })
                                  }}
                                  placeholder="0"
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    border: '1px solid var(--border)',
                                    background: 'var(--surface)',
                                    color: 'var(--text)',
                                    fontWeight: 600,
                                    fontSize: 14,
                                  }}
                                />
                                <input
                                  type="number"
                                  value={String(range || '').split('-')[1] || ''}
                                  onChange={(e) => {
                                    const min = String(range || '').split('-')[0] || ''
                                    const updatedRanges = [...priceRanges]
                                    updatedRanges[index] = `${min}-${e.target.value}`
                                    setConfigData({ ...configData, [priceField]: updatedRanges })
                                  }}
                                  placeholder="0"
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    border: '1px solid var(--border)',
                                    background: 'var(--surface)',
                                    color: 'var(--text)',
                                    fontWeight: 600,
                                    fontSize: 14,
                                  }}
                                />
                              </div>
                            </>
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                gap: 8,
                                marginBottom: 12,
                                alignItems: 'center',
                              }}
                            >
                              <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Min</label>
                              <input
                                type="number"
                                value={String(range || '').split('-')[0] || ''}
                                onChange={(e) => {
                                  const max = String(range || '').split('-')[1] || ''
                                  const updatedRanges = [...priceRanges]
                                  updatedRanges[index] = `${e.target.value}-${max}`
                                  setConfigData({ ...configData, [priceField]: updatedRanges })
                                }}
                                placeholder="0"
                                style={{
                                  width: '90px',
                                  padding: '10px 12px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                  color: 'var(--text)',
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              />
                              <span style={{ color: 'var(--muted)', fontWeight: 600 }}>–</span>
                              <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max</label>
                              <input
                                type="number"
                                value={String(range || '').split('-')[1] || ''}
                                onChange={(e) => {
                                  const min = String(range || '').split('-')[0] || ''
                                  const updatedRanges = [...priceRanges]
                                  updatedRanges[index] = `${min}-${e.target.value}`
                                  setConfigData({ ...configData, [priceField]: updatedRanges })
                                }}
                                placeholder="0"
                                style={{
                                  width: '90px',
                                  padding: '10px 12px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface)',
                                  color: 'var(--text)',
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              />
                              <span style={{ color: 'var(--muted)', fontSize: 13 }}>$ CAD</span>
                              <button
                                onClick={toggleActive}
                                style={{
                                  padding: '9px 11px',
                                  borderRadius: 10,
                                  border: '1px solid',
                                  borderColor: isActive ? 'rgba(16,185,129,0.35)' : 'rgba(156,163,175,0.35)',
                                  background: isActive ? 'rgba(16,185,129,0.12)' : 'rgba(156,163,175,0.12)',
                                  color: isActive ? 'var(--green)' : 'var(--muted)',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  lineHeight: 1,
                                  marginLeft: 'auto',
                                  transition: 'all 0.15s ease',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  gap: 6,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = isActive ? 'rgba(16,185,129,0.18)' : 'rgba(156,163,175,0.18)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = isActive ? 'rgba(16,185,129,0.12)' : 'rgba(156,163,175,0.12)')}
                              >
                                {isActive ? 'Actif' : 'Off'}
                              </button>
                              <button
                                onClick={() => {
                                  const updatedRanges = priceRanges.filter((_: any, i: number) => i !== index)
                                  const updatedKeywords = keywords.filter((_: any, i: number) => i !== index)
                                  setConfigData({
                                    ...configData,
                                    [priceField]: updatedRanges,
                                    [keywordField]: updatedKeywords,
                                  })
                                }}
                                style={{
                                  padding: '9px 11px',
                                  borderRadius: 10,
                                  border: '1px solid rgba(239,68,68,0.35)',
                                  background: 'rgba(239,68,68,0.12)',
                                  color: 'var(--red)',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  lineHeight: 1,
                                  transition: 'all 0.15s ease',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.18)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(239,68,68,0.12)')}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}

                          {textMode ? (
                            <textarea
                              value={keywords[index] || ''}
                              onChange={(e) => {
                                const updatedKeywords = [...keywords]
                                updatedKeywords[index] = e.target.value
                                setConfigData({ ...configData, [keywordField]: updatedKeywords })
                              }}
                              placeholder="Mots-clés (séparés par ; — ! pour exclure, regex: pour une regex)"
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                borderRadius: 8,
                                border: '1px solid var(--border)',
                                background: 'var(--surface)',
                                color: 'var(--text)',
                                minHeight: 80,
                                resize: 'vertical',
                                fontSize: 13,
                                fontFamily: 'monospace',
                              }}
                            />
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                              {displayKeywords.map((keyword: string, kwIndex: number) => {
                                const isBadWord = keyword.startsWith('!')
                                const isRegex = keyword.startsWith('regex:')
                                const displayText = keyword
                                const color = isBadWord ? 'var(--red)' : isRegex ? 'var(--purple)' : 'var(--lime)'
                                const bgColor = isBadWord ? 'rgba(239,68,68,0.1)' : isRegex ? 'rgba(124,58,237,0.1)' : 'rgba(132,204,22,0.1)'

                                return (
                                  <div
                                    key={kwIndex}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      padding: '4px 10px',
                                      borderRadius: 8,
                                      border: `1px solid ${color}33`,
                                      background: bgColor,
                                      fontSize: 15,
                                    }}
                                  >
                                    <input
                                      type="text"
                                      value={displayText}
                                      onChange={(e) => updateKeyword(kwIndex, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          e.currentTarget.blur()
                                        }
                                      }}
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: color,
                                        fontWeight: 500,
                                        outline: 'none',
                                        width: `${Math.min(Math.max(displayText.length * 9.5 + 26, 80), 260)}px`,
                                        fontSize: 13,
                                      }}
                                    />
                                    <button
                                      onClick={() => removeKeyword(kwIndex)}
                                      style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: color,
                                        cursor: 'pointer',
                                        fontSize: 16,
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        lineHeight: 1,
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                )
                              })}
                              <button
                                onClick={addKeyword}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  border: '1px dashed var(--border)',
                                  background: 'transparent',
                                  color: 'var(--muted)',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                + Mot-clé
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <button
                      onClick={() => {
                        const updatedRanges = [...priceRanges, '']
                        const updatedKeywords = [...keywords, '']
                        setConfigData({
                          ...configData,
                          [priceField]: updatedRanges,
                          [keywordField]: updatedKeywords,
                        })
                      }}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: '1px dashed var(--border)',
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        fontSize: 14,
                      }}
                    >
                      + Ajouter une plage de prix
                    </button>
                  </div>
                )
              })}

              {/* Add New Price Range / Keywords Set */}
              <button
                onClick={() => {
                  // Create price_ranges_X and keywords_X together to keep arrays in sync
                  setConfigData((prev) => {
                    if (!prev) return prev
                    const fields = Object.keys(prev).filter((k) => k.startsWith('price_ranges')).sort()
                    const nextIndex = fields.length === 1
                      ? 2
                      : Math.max(
                        ...fields.map((f) => {
                          const m = f.match(/_([0-9]+)$/)
                          return m ? parseInt(m[1]) : 1
                        })
                      ) + 1
                    const priceField = nextIndex === 1 ? 'price_ranges' : `price_ranges_${nextIndex}`
                    const keywordField = nextIndex === 1 ? 'keywords' : `keywords_${nextIndex}`
                    return {
                      ...prev,
                      [priceField]: [''],
                      [keywordField]: [''],
                    }
                  })
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: '1px dashed var(--border)',
                  background: 'transparent',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 16,
                }}
              >
                + Ajouter un nouveau set
              </button>


            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmSave}
        title="Enregistrer les modifications"
        message="Enregistrer la configuration ?"
        onCancel={() => setConfirmSave(false)}
        onConfirm={() => { setConfirmSave(false); saveConfig() }}
        confirmText="Enregistrer"
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer la configuration"
        message={`Voulez-vous vraiment supprimer la configuration « ${selectedConfig.replace('.yml', '')} » ?`}
        confirmText="Supprimer"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => handleDeleteConfig(selectedConfig)}
      />

      {showRawModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            backgroundColor: 'var(--surface)',
            borderRadius: 12,
            padding: 24,
            maxWidth: 900,
            maxHeight: '90vh',
            overflowY: 'auto',
            border: '1px solid var(--border)',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            height: '80vh'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, color: 'var(--text)' }}>YAML brut — {selectedConfig}</h2>
              <button
                onClick={() => setShowRawModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 24,
                  padding: 0,
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--muted)' }}>
              Les modifications ici sont enregistrées directement dans le fichier. La vue principale sera mise à jour au rechargement.
            </p>
            <textarea
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              style={{
                backgroundColor: 'var(--bg)',
                padding: 16,
                borderRadius: 8,
                overflow: 'auto',
                minHeight: 400,
                flex: 1,
                color: 'var(--cyan)',
                fontSize: 13,
                fontFamily: 'Courier New, monospace',
                margin: '0 0 16px 0',
                border: '1px solid var(--border)',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  try {
                    if (navigator.clipboard && window.isSecureContext) {
                      await navigator.clipboard.writeText(rawContent)
                    } else {
                      const textarea = document.createElement('textarea')
                      textarea.value = rawContent
                      textarea.style.position = 'fixed'
                      textarea.style.left = '-9999px'
                      textarea.style.top = '-9999px'
                      textarea.style.opacity = '0'
                      document.body.appendChild(textarea)
                      textarea.focus()
                      textarea.select()
                      document.execCommand('copy')
                      document.body.removeChild(textarea)
                    }
                    toast('Copié dans le presse-papiers', 'success')
                  } catch {
                    toast('Échec de la copie', 'error')
                  }
                }}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid rgba(99,102,241,0.4)',
                  background: 'rgba(99,102,241,0.12)',
                  color: 'rgb(99,102,241)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 120
                }}
              >
                Copier
              </button>
              <button
                onClick={async () => {
                  try {
                    // Validate YAML first
                    yaml.load(rawContent)
                    // Save directly to file
                    await updateConfigRaw(selectedConfig, rawContent)
                    toast('Fichier enregistré', 'success')
                  } catch (err: any) {
                    if (err.name === 'YAMLException') {
                      toast('Syntaxe YAML invalide', 'error')
                    } else {
                      toast("Erreur lors de l'enregistrement", 'error')
                    }
                  }
                }}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid rgba(132,204,22,0.4)',
                  background: 'rgba(132,204,22,0.12)',
                  color: 'rgb(132,204,22)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 120
                }}
              >
                Enregistrer
              </button>
              <button
                onClick={duplicateRawToOriginal}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid rgba(251,146,60,0.4)',
                  background: 'rgba(251,146,60,0.12)',
                  color: 'rgb(251,146,60)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 120
                }}
              >
                Appliquer & fermer
              </button>
              <button
                onClick={() => setShowRawModal(false)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 120
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Dialog */}
      {showDuplicateDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            backgroundColor: 'var(--surface)',
            borderRadius: 12,
            padding: 24,
            border: '1px solid var(--border)',
            width: '100%',
            maxWidth: 400
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--text)' }}>Dupliquer la configuration</h3>
            <p style={{ margin: '0 0 16px 0', color: 'var(--muted)', fontSize: 14 }}>
              Saisissez un nom pour la nouvelle copie :
            </p>
            <input
              type="text"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmDuplicate()}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 14,
                marginBottom: 16
              }}
              placeholder="config-name"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowDuplicateDialog(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Annuler
              </button>
              <button
                onClick={confirmDuplicate}
                disabled={!duplicateName.trim()}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: duplicateName.trim() ? 'var(--primary)' : 'var(--surface-2)',
                  color: duplicateName.trim() ? 'white' : 'var(--muted)',
                  cursor: duplicateName.trim() ? 'pointer' : 'not-allowed',
                  fontWeight: 600
                }}
              >
                Dupliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}