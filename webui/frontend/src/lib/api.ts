// Wrapper fetch imitant le contrat axios attendu par les pages : { data },
// erreurs avec err.response.data.detail (format FastAPI).

async function request<T = any>(method: string, url: string, body?: unknown): Promise<{ data: T }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err: any = new Error(`HTTP ${res.status}`)
    err.response = { status: res.status, data }
    throw err
  }
  return { data: data as T }
}

// ── Configs ────────────────────────────────────────────────────────────────
export const getConfigs = () => request<string[]>('GET', '/api/configs')
export const getConfig = (name: string) => request('GET', `/api/configs/${encodeURIComponent(name)}`)
export const updateConfig = (name: string, config: unknown) =>
  request('PUT', `/api/configs/${encodeURIComponent(name)}`, config)
export const getConfigRaw = (name: string) =>
  request<{ content: string }>('GET', `/api/configs/${encodeURIComponent(name)}/raw`)
export const updateConfigRaw = (name: string, content: string) =>
  request('PUT', `/api/configs/${encodeURIComponent(name)}/raw`, { content })
export const createConfig = (name: string, config: unknown) =>
  request('POST', '/api/configs', { name, config })
export const createConfigRaw = (name: string, content: string) =>
  request('POST', '/api/configs/raw', { name, content })
export const deleteConfig = (name: string) =>
  request('DELETE', `/api/configs/${encodeURIComponent(name)}`)

// ── Statut ─────────────────────────────────────────────────────────────────
export interface LastRun {
  ts: string
  duration_s: number
  total: number
  new: number
  matched: number
  seed: boolean
  ok: boolean
  error: string | null
}

export interface StatusEntry {
  name: string
  enabled: boolean
  running: boolean
  cache_size: number | null
  cache_mtime: string | null
  cache_items: number | null
  last_run: LastRun | null
}

export const getStatus = () => request<StatusEntry[]>('GET', '/api/status')
export const runNow = (name: string) =>
  request<{ ok: boolean; stopped?: boolean; returncode: number; output: string }>(
    'POST',
    `/api/status/${encodeURIComponent(name)}/run`,
  )
export const stopRun = (name: string) =>
  request<{ ok: boolean }>('POST', `/api/status/${encodeURIComponent(name)}/stop`)
export const setEnabled = (name: string, enabled: boolean) =>
  request<{ name: string; enabled: boolean }>(
    'PUT',
    `/api/status/${encodeURIComponent(name)}/enabled`,
    { enabled },
  )
