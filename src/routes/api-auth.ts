import { Hono } from 'hono'
import { sbAuth, sbSelect, sbWrite, bearer, type Env } from '../lib/supabase'

const auth = new Hono<{ Bindings: Env }>()

/** POST /api/auth/signup { email, password, developer_name? } */
auth.post('/auth/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) return c.json({ success: false, error: 'Email and password are required' }, 400)
  if (password.length < 8) return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400)

  const { data, error, status } = await sbAuth<any>(c.env, 'signup', {
    method: 'POST',
    body: {
      email,
      password,
      data: {
        developer_name: body.developer_name || null,
        full_name: body.full_name || null,
      },
    },
  })
  if (error) return c.json({ success: false, error }, (status as any) || 400)

  // Session present => email confirmation disabled; otherwise user must confirm.
  const session = data?.access_token ? data : data?.session || null
  return c.json({
    success: true,
    needs_confirmation: !session?.access_token,
    message: session?.access_token
      ? 'Account created and signed in.'
      : 'Account created. Check your inbox and confirm your email address, then sign in.',
    session: session?.access_token
      ? {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          user: session.user || data?.user || null,
        }
      : null,
  })
})

/** POST /api/auth/login { email, password } */
auth.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any)
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  if (!email || !password) return c.json({ success: false, error: 'Email and password are required' }, 400)

  const { data, error, status } = await sbAuth<any>(c.env, 'token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (error) return c.json({ success: false, error }, (status as any) || 401)

  return c.json({
    success: true,
    session: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    },
  })
})

/** POST /api/auth/magic-link { email } — passwordless / OTP email */
auth.post('/auth/magic-link', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any)
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return c.json({ success: false, error: 'Email is required' }, 400)
  const { error, status } = await sbAuth(c.env, 'otp', {
    method: 'POST',
    body: { email, create_user: true },
  })
  if (error) return c.json({ success: false, error }, (status as any) || 400)
  return c.json({ success: true, message: 'Sign-in link sent. Check your email inbox.' })
})

/** POST /api/auth/reset-password { email } */
auth.post('/auth/reset-password', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any)
  const email = String(body.email || '').trim().toLowerCase()
  if (!email) return c.json({ success: false, error: 'Email is required' }, 400)
  const { error, status } = await sbAuth(c.env, 'recover', { method: 'POST', body: { email } })
  if (error) return c.json({ success: false, error }, (status as any) || 400)
  return c.json({ success: true, message: 'Password reset email sent.' })
})

/** POST /api/auth/refresh { refresh_token } */
auth.post('/auth/refresh', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any)
  const refresh_token = String(body.refresh_token || '')
  if (!refresh_token) return c.json({ success: false, error: 'refresh_token required' }, 400)
  const { data, error, status } = await sbAuth<any>(c.env, 'token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token },
  })
  if (error) return c.json({ success: false, error }, (status as any) || 401)
  return c.json({
    success: true,
    session: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    },
  })
})

/** POST /api/auth/logout */
auth.post('/auth/logout', async (c) => {
  const token = bearer(c.req.header('Authorization'))
  if (token) await sbAuth(c.env, 'logout', { method: 'POST', token })
  return c.json({ success: true })
})

/** GET /api/me — current user + developer profile */
auth.get('/me', async (c) => {
  const token = bearer(c.req.header('Authorization'))
  if (!token) return c.json({ success: false, error: 'Not authenticated' }, 401)

  const { data: user, error, status } = await sbAuth<any>(c.env, 'user', { token })
  if (error) return c.json({ success: false, error }, (status as any) || 401)

  const [devRes, profileRes] = await Promise.all([
    sbSelect<any[]>(
      c.env,
      'developers',
      `select=*&user_id=eq.${user.id}&limit=1`,
      token
    ),
    sbSelect<any[]>(c.env, 'user_profiles', `select=*&id=eq.${user.id}&limit=1`, token),
  ])

  return c.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      email_confirmed_at: user.email_confirmed_at,
      metadata: user.user_metadata || {},
    },
    developer: (devRes.data || [])[0] || null,
    profile: (profileRes.data || [])[0] || null,
  })
})

/** POST /api/developer/register — create or update developer profile */
auth.post('/developer/register', async (c) => {
  const token = bearer(c.req.header('Authorization'))
  if (!token) return c.json({ success: false, error: 'Sign in first' }, 401)

  const { data: user, error: uErr } = await sbAuth<any>(c.env, 'user', { token })
  if (uErr || !user?.id) return c.json({ success: false, error: uErr || 'Invalid session' }, 401)

  const body = await c.req.json().catch(() => ({}) as any)
  const developer_name = String(body.developer_name || '').trim()
  if (!developer_name) return c.json({ success: false, error: 'Developer / studio name is required' }, 400)

  const payload: Record<string, unknown> = {
    developer_name,
    company_name: body.company_name || null,
    description: body.description || null,
    website: body.website || null,
    email: body.email || user.email,
    phone: body.phone || null,
    logo_url: body.logo_url || null,
    avatar_url: body.avatar_url || null,
  }

  const { data: existing } = await sbSelect<any[]>(
    c.env,
    'developers',
    `select=id&user_id=eq.${user.id}&limit=1`,
    token
  )

  if ((existing || []).length) {
    const { data, error, status } = await sbWrite<any[]>(
      c.env,
      'developers',
      'PATCH',
      payload,
      `id=eq.${existing![0].id}`,
      token
    )
    if (error) return c.json({ success: false, error }, (status as any) || 400)
    return c.json({ success: true, developer: (data || [])[0] || null, updated: true })
  }

  const { data, error, status } = await sbWrite<any[]>(
    c.env,
    'developers',
    'POST',
    { ...payload, user_id: user.id, developer_id: `dev-${String(user.id).replace(/-/g, '')}` },
    '',
    token
  )
  if (error) {
    return c.json(
      {
        success: false,
        error,
        hint:
          error.includes('row-level security')
            ? 'The developers table blocks inserts for this role. Add an RLS INSERT policy: USING/WITH CHECK (user_id = auth.uid()).'
            : undefined,
      },
      (status as any) || 400
    )
  }
  return c.json({ success: true, developer: (data || [])[0] || null, created: true })
})

export default auth
