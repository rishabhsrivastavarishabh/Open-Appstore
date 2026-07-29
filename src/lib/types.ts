export interface AppRow {
  id: string
  app_id: string | null
  app_name: string
  app_slug: string
  description: string | null
  icon_url: string | null
  screenshots: string[] | null
  current_version: string | null
  latest_version: string | null
  min_version: string | null
  download_url: string | null
  developer_id: string | null
  category: string | null
  rating: number | null
  total_ratings: number | null
  downloads: number | null
  price: number | null
  is_free: boolean | null
  is_featured: boolean | null
  release_date: string | null
  last_updated: string | null
  store_id: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  website: string | null
  support_email: string | null
  developers?: { developer_name?: string; logo_url?: string | null; verified?: boolean } | null
}

export interface DeveloperRow {
  id: string
  user_id: string | null
  developer_id: string | null
  developer_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  website: string | null
  description: string | null
  avatar_url: string | null
  logo_url: string | null
  verified: boolean | null
  store_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ReviewRow {
  id: string
  app_id: string
  user_id: string | null
  rating: number | null
  title: string | null
  review_text: string | null
  helpful_count: number | null
  created_at: string | null
}

/** Normalised app shape used by the whole front-end */
export interface AppView {
  id: string
  app_id: string | null
  name: string
  slug: string
  description: string
  short_description: string
  icon_url: string | null
  screenshots: string[]
  category: string
  version: string
  is_free: boolean
  price: number
  rating: number
  total_ratings: number
  downloads: number
  is_featured: boolean
  status: string
  website: string | null
  support_email: string | null
  download_url: string | null
  developer_id: string | null
  developer_name: string
  developer_verified: boolean
  created_at: string | null
  updated_at: string | null
}

export const CATEGORIES = [
  'Games',
  'Productivity',
  'Social',
  'Education',
  'Entertainment',
  'Business',
  'Utilities',
  'Health',
  'News',
  'Travel',
  'Shopping',
  'Photography',
  'Finance',
  'Music',
  'Developer Tools',
] as const

export const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  Games: { icon: 'fa-gamepad', color: '#a855f7' },
  Productivity: { icon: 'fa-bolt', color: '#3b82f6' },
  Social: { icon: 'fa-comments', color: '#ec4899' },
  Education: { icon: 'fa-graduation-cap', color: '#f59e0b' },
  Entertainment: { icon: 'fa-clapperboard', color: '#ef4444' },
  Business: { icon: 'fa-briefcase', color: '#0ea5e9' },
  Utilities: { icon: 'fa-screwdriver-wrench', color: '#64748b' },
  Health: { icon: 'fa-heart-pulse', color: '#10b981' },
  News: { icon: 'fa-newspaper', color: '#f97316' },
  Travel: { icon: 'fa-plane', color: '#06b6d4' },
  Shopping: { icon: 'fa-bag-shopping', color: '#e11d48' },
  Photography: { icon: 'fa-camera', color: '#8b5cf6' },
  Finance: { icon: 'fa-chart-line', color: '#22c55e' },
  Music: { icon: 'fa-music', color: '#d946ef' },
  'Developer Tools': { icon: 'fa-code', color: '#14b8a6' },
  Other: { icon: 'fa-cube', color: '#6366f1' },
}

const APP_SELECT =
  'id,app_id,app_name,app_slug,description,icon_url,screenshots,current_version,latest_version,download_url,developer_id,category,rating,total_ratings,downloads,price,is_free,is_featured,status,created_at,updated_at,website,support_email'

export const APP_SELECT_WITH_DEV = `${APP_SELECT},developers(developer_name,logo_url,verified)`
export const APP_SELECT_PLAIN = APP_SELECT

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`~-]/g, ' ')
    .replace(/\[\d+(?:,\s*\d+)*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function toAppView(row: AppRow): AppView {
  const description = (row.description || '').trim()
  const plain = stripMarkdown(description)
  return {
    id: row.id,
    app_id: row.app_id,
    name: row.app_name,
    slug: row.app_slug,
    description,
    short_description: plain.length > 160 ? `${plain.slice(0, 157)}…` : plain,
    icon_url: row.icon_url,
    screenshots: Array.isArray(row.screenshots) ? row.screenshots.filter(Boolean) : [],
    category: row.category || 'Other',
    version: row.latest_version || row.current_version || '1.0.0',
    is_free: row.is_free !== false,
    price: Number(row.price || 0),
    rating: Number(row.rating || 0),
    total_ratings: Number(row.total_ratings || 0),
    downloads: Number(row.downloads || 0),
    is_featured: !!row.is_featured,
    status: row.status || 'draft',
    website: row.website,
    support_email: row.support_email,
    download_url: row.download_url,
    developer_id: row.developer_id,
    developer_name: row.developers?.developer_name || 'Independent Developer',
    developer_verified: !!row.developers?.verified,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
