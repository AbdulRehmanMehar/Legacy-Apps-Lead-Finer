import mongoose, { Schema, Document } from 'mongoose';
import { Company as ICompany, SearchJob as ISearchJob, AnalysisQueueItem as IAnalysisQueueItem } from './types';

// Detect Technology Sub-schema
const DetectedTechnologySchema = new Schema({
  name: { type: String, required: true },
  version: { type: String },
  category: { type: String, required: true },
  confidence: { type: Number, required: true },
  isLegacy: { type: Boolean },
}, { _id: false });

// PageSpeed Result Sub-schema
const PageSpeedResultSchema = new Schema({
  performanceScore: { type: Number },
  accessibilityScore: { type: Number },
  bestPracticesScore: { type: Number },
  seoScore: { type: Number },
  firstContentfulPaint: { type: Number },
  largestContentfulPaint: { type: Number },
  totalBlockingTime: { type: Number },
  cumulativeLayoutShift: { type: Number },
  speedIndex: { type: Number },
}, { _id: false });

// Draft Sub-schema
const ContactDraftSchema = new Schema({
  subject: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  sent_at: { type: Date },
}, { _id: false });

// Contact Person Sub-schema
const ContactPersonSchema = new Schema({
  id: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  fullName: { type: String, required: true },
  email: { type: String },
  linkedinUrl: { type: String },
  title: { type: String },
  seniority: { type: String },
  department: { type: String },
  rocketreachId: { type: String },
  emailProviderVerified: { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['verified', 'invalid', 'catch_all', 'unknown', 'guessed'], default: 'unknown' },
  deliveryStatus: { type: String, enum: ['unknown', 'sent', 'bounced'], default: 'unknown' },
  drafts: { type: [ContactDraftSchema], default: [] },
  has_replied: { type: Boolean, default: false },
  last_reply_at: { type: Date },
}, { _id: false });

// Enrichment Data Sub-schema
const EnrichmentDataSchema = new Schema({
  industry: { type: String },
  description: { type: String },
  value_proposition: { type: String },
  target_audience: { type: String },
  problems_solved: { type: String },
  estimated_revenue: { type: String },
  competitors: { type: [String], default: [] },
}, { _id: false });

// Company Schema
export interface ICompanyDoc extends Omit<ICompany, 'id' | 'enrichment' | 'screenshot_path' | 'contact_retry_count'>, Document {
  enrichment?: {
    industry: string;
    description: string;
    value_proposition: string;
    target_audience: string;
    problems_solved: string;
    estimated_revenue: string;
    competitors: string[];
  };
  screenshot_path?: string;
  contact_retry_count: number;
}
const CompanySchema = new Schema<ICompanyDoc>({
  domain: { type: String, required: true, unique: true },
  name: { type: String },
  description: { type: String },
  search_query: { type: String },
  tech_stack: { type: [DetectedTechnologySchema], default: [] },
  pagespeed_score: { type: Number },
  pagespeed_data: { type: PageSpeedResultSchema },
  is_legacy: { type: Boolean, default: false },
  legacy_reasons: { type: [String], default: [] },
  enrichment: { type: EnrichmentDataSchema },
  contacts: { type: [ContactPersonSchema], default: [] },
  contact_retry_count: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: [
      'new', 
      'analyzing', 
      'needs_contacts', 
      'fetching_contacts', 
      'needs_verified_contacts', 
      'needs_drafts', 
      'drafting', 
      'drafts_ready', 
      'contacted', 
      'qualified', 
      'converted', 
      'rejected',
      'unreachable'
    ], 
    default: 'new' 
  },
  notes: { type: String },
  last_error: { type: String },
  screenshot_path: { type: String },
  analyzed_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// SearchJob Schema
export interface ISearchJobDoc extends Omit<ISearchJob, 'id'>, Document {}
const SearchJobSchema = new Schema<ISearchJobDoc>({
  query: { type: String, required: true },
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  results_count: { type: Number, default: 0 },
  leads_found: { type: Number, default: 0 },
  error: { type: String },
  completed_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// AnalysisQueueItem Schema
export interface IAnalysisQueueItemDoc extends Omit<IAnalysisQueueItem, 'id' | 'retry_delay_until'>, Document {
  retry_delay_until?: Date | null;
}
const AnalysisQueueItemSchema = new Schema<IAnalysisQueueItemDoc>({
  company_id: { type: String, required: true },
  domain: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  retry_count: { type: Number, default: 0 },
  retry_delay_until: { type: Date },
  error: { type: String },
  processed_at: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

// Transform _id to id in JSON output
CompanySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    delete (ret as any)._id;
  }
});
SearchJobSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    delete (ret as any)._id;
  }
});
AnalysisQueueItemSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    delete (ret as any)._id;
  }
});

// Avoid OverwriteModelError in Next.js development Hot-Reload
export const Company = mongoose.models.Company || mongoose.model<ICompanyDoc>('Company', CompanySchema);
export const SearchJob = mongoose.models.SearchJob || mongoose.model<ISearchJobDoc>('SearchJob', SearchJobSchema);
export const AnalysisQueueItem = mongoose.models.AnalysisQueueItem || mongoose.model<IAnalysisQueueItemDoc>('AnalysisQueueItem', AnalysisQueueItemSchema);
