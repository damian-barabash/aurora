export type Role = 'moderator' | 'admin' | 'member'

export interface Profile {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  is_moderator: boolean
  onboarding: { closed_at?: string; claude_done?: boolean; hidden?: boolean }
}

export interface Company {
  id: string
  name: string
  slug: string
  description: string
  website: string | null
  logo_path: string | null
  settings: { auto_apply?: boolean; stale_days?: number }
  role: Role
}

export interface Collection {
  id: string
  company_id: string
  name: string
  icon: string
  position: number
}

export type ProductState = 'current' | 'review' | 'archived'

export interface Product {
  id: string
  company_id: string
  collection_id: string | null
  name: string
  kind: string
  icon: string
  summary: string
  description: string
  cover_path: string | null
  logo_path: string | null
  status: ProductState
  owner_id: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
  entries_count: number
  files_count: number
  pending_count: number
  last_change: string
  state: ProductState
}

export type EntryType = 'fact' | 'price' | 'date' | 'news' | 'announcement' | 'faq' | 'link' | 'document'
export type Source = 'manual' | 'email' | 'calendar' | 'claude' | 'website' | 'file' | 'chat'

export interface Entry {
  id: string
  company_id: string
  product_id: string | null
  type: EntryType
  title: string
  body: string
  effective_from: string | null
  effective_to: string | null
  importance: number
  pinned: boolean
  status: 'current' | 'review' | 'outdated' | 'archived'
  source: Source
  source_label: string | null
  confidence: number | null
  verified_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Proposal {
  id: string
  company_id: string
  kind: 'new' | 'update' | 'conflict' | 'new_product'
  source: Source
  source_label: string | null
  source_user: string | null
  product_id: string | null
  entry_id: string | null
  payload: {
    type: EntryType
    title: string
    body: string
    effective_from: string | null
    effective_to: string | null
    importance: number
    new_product?: { name: string; summary: string } | null
  }
  summary: string
  evidence: string
  confidence: number | null
  status: 'pending' | 'applied' | 'rejected'
  created_at: string
}

export interface HistoryRow {
  id: string
  product_id: string | null
  entry_id: string | null
  target: 'product' | 'entry'
  action: 'create' | 'update' | 'delete' | 'revert'
  title: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  source: Source
  actor: string | null
  created_at: string
}

export interface FileRow {
  id: string
  company_id: string
  product_id: string | null
  entry_id: string | null
  kind: 'image' | 'logo' | 'document' | 'brand'
  name: string
  path: string
  mime: string | null
  size: number | null
  note: string
  created_by: string | null
  created_at: string
}

export interface Brand {
  company_id: string
  tagline: string
  strategy: string
  audience: string
  tone: string
  dos: string
  donts: string
  colors: { name: string; hex: string }[]
  fonts: { role: string; name: string }[]
  updated_at: string
}

export interface Chat {
  id: string
  title: string
  pinned: boolean
  updated_at: string
}

export interface Integration {
  id: string
  user_id: string
  company_id: string
  provider: 'google'
  account_email: string | null
  status: 'active' | 'error' | 'revoked'
  last_sync_at: string | null
  last_error: string | null
  stats: { mails?: number; facts?: number; proposed?: number }
  created_at: string
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read_at: string | null
  created_at: string
}

export interface Member {
  user_id: string
  role: 'admin' | 'member'
  created_at: string
  profile: { id: string; email: string; full_name: string; is_moderator: boolean }
}
