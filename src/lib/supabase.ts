/**
 * Supabase REST/Auth client for Cloudflare Workers (fetch-only, no Node APIs).
 */

export type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

export type SbResult<T> = { data: T | null; error: string | null; status: number }

function baseHeaders(env: Env, token?: string) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

/** Generic PostgREST query */
export async function sbSelect<T = any>(
  env: Env,
  table: string,
  query: string,
  token?: string
): Promise<SbResult<T>> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${query}`
  try {
    const res = await fetch(url, { headers: baseHeaders(env, token) })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) {
      return { data: null, error: json?.message || `Request failed (${res.status})`, status: res.status }
    }
    return { data: json as T, error: null, status: res.status }
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error', status: 500 }
  }
}

export async function sbWrite<T = any>(
  env: Env,
  table: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  query = '',
  token?: string
): Promise<SbResult<T>> {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`
  try {
    const res = await fetch(url, {
      method,
      headers: { ...baseHeaders(env, token), Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) {
      return { data: null, error: json?.message || json?.hint || `Request failed (${res.status})`, status: res.status }
    }
    return { data: json as T, error: null, status: res.status }
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error', status: 500 }
  }
}

/** Supabase GoTrue auth call */
export async function sbAuth<T = any>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {}
): Promise<SbResult<T>> {
  const url = `${env.SUPABASE_URL}/auth/v1/${path.replace(/^\//, '')}`
  try {
    const res = await fetch(url, {
      method: init.method || 'GET',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) {
      return {
        data: null,
        error: json?.msg || json?.error_description || json?.message || `Auth failed (${res.status})`,
        status: res.status,
      }
    }
    return { data: json as T, error: null, status: res.status }
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error', status: 500 }
  }
}

export function bearer(header: string | undefined | null): string | undefined {
  if (!header) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1] : undefined
}
