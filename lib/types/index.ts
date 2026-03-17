// Lead/Company status
export type LeadStatus = 'new' | 'analyzing' | 'needs_contacts' | 'fetching_contacts' | 'needs_verified_contacts' | 'needs_drafts' | 'drafting' | 'drafts_ready' | 'contacted' | 'qualified' | 'converted' | 'rejected' | 'unreachable'

// Job status
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

// Queue status
export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed'

// Technology detected on a website
export interface DetectedTechnology {
  name: string
  version?: string
  category: string
  confidence: number
  isLegacy?: boolean
}

// PageSpeed analysis result
export interface PageSpeedResult {
  performanceScore: number
  accessibilityScore: number
  bestPracticesScore: number
  seoScore: number
  firstContentfulPaint: number
  largestContentfulPaint: number
  totalBlockingTime: number
  cumulativeLayoutShift: number
  speedIndex: number
}

// Email draft for a contact
export interface ContactDraft {
  subject: string
  body: string
  type: string // e.g. 'initial', 'followup_1'
  created_at: Date | string
  sent_at?: Date | string
}

export interface ContactPerson {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  linkedinUrl: string | null
  title: string
  seniority: string
  department: string
  rocketreachId?: string
  emailProviderVerified?: boolean
  verificationStatus?: 'verified' | 'invalid' | 'catch_all' | 'unknown' | 'guessed'
  deliveryStatus?: 'unknown' | 'sent' | 'bounced'
  drafts: ContactDraft[]
  has_replied?: boolean
  last_reply_at?: Date | string
}

// AI-extracted company enrichment data
export interface EnrichmentData {
  industry: string
  description: string
  value_proposition: string
  target_audience: string
  problems_solved: string
  estimated_revenue: string
  competitors: string[]
}

// Company/Lead from database
export interface Company {
  id: string
  domain: string
  name: string | null
  description: string | null
  search_query: string | null
  tech_stack: DetectedTechnology[]
  pagespeed_score: number | null
  pagespeed_data: PageSpeedResult | null
  is_legacy: boolean
  legacy_reasons: string[]
  enrichment?: EnrichmentData
  contacts: ContactPerson[]
  contact_retry_count: number
  status: LeadStatus
  notes: string | null
  last_error?: string | null
  screenshot_path?: string | null
  created_at: string
  updated_at: string
  analyzed_at: string | null
}

// Search job from database
export interface SearchJob {
  id: string
  query: string
  status: JobStatus
  results_count: number
  leads_found: number
  error: string | null
  created_at: string
  completed_at: string | null
}

// Analysis queue item from database
export interface AnalysisQueueItem {
  id: string
  company_id: string
  domain: string
  status: QueueStatus
  retry_count: number
  retry_delay_until?: Date | string | null
  error: string | null
  created_at: string
  processed_at: string | null
}

// Google Custom Search result
export interface GoogleSearchResult {
  title: string
  link: string
  displayLink: string
  snippet: string
  formattedUrl: string
}

// API request/response types
export interface SearchRequest {
  query: string
  maxResults?: number
}

export interface AnalyzeRequest {
  domain: string
  companyId?: string
}

export interface BatchAnalyzeRequest {
  domains: string[]
}

// Legacy classification result
export interface LegacyClassification {
  isLegacy: boolean
  reasons: string[]
  score: number // 0-100, higher = more legacy
}

// Dashboard stats
export interface DashboardStats {
  totalLeads: number
  newLeads: number
  legacyLeads: number
  avgPagespeedScore: number
  recentSearches: number
  pendingAnalysis: number
}
