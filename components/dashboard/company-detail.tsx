'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  ExternalLink,
  RefreshCw,
  Globe,
  Zap,
  AlertTriangle,
  CheckCircle,
  Save,
  Users,
  Target,
  FileText,
  ImageIcon,
  Send,
  Loader2,
} from 'lucide-react';
import type { Company, ContactPerson, ContactDraft } from '@/lib/types';
import { canSendOutreachToContact, getContactOutreachLabel } from '@/lib/utils';
import { EmailPreviewModal } from './email-preview-modal';
import { toast } from 'sonner';

interface CompanyDetailProps {
  company: Company | null;
  open: boolean;
  onClose: () => void;
  onAnalyze?: (id: string) => Promise<void>;
  onUpdate?: (id: string, data: Partial<Company>) => Promise<void>;
}

function getPageSpeedColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 90) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

function getPageSpeedBg(score: number | null): string {
  if (score === null) return 'bg-muted';
  if (score >= 90) return 'bg-green-500/20';
  if (score >= 50) return 'bg-yellow-500/20';
  return 'bg-red-500/20';
}

export function CompanyDetail({
  company,
  open,
  onClose,
  onAnalyze,
  onUpdate,
}: CompanyDetailProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notes, setNotes] = useState(company?.notes || '');
  const [status, setStatus] = useState(company?.status || 'new');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<ContactDraft | null>(null);
  const [activeContact, setActiveContact] = useState<ContactPerson | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handlePreviewEmail = (contact: ContactPerson, draft: ContactDraft) => {
    setActiveContact(contact);
    setActiveDraft(draft);
    setIsPreviewOpen(true);
  };

  const handleSendEmail = async (contactId: string, draft: ContactDraft) => {
    if (!company) return;
    if (!activeContact || !canSendOutreachToContact(activeContact)) {
      toast.error('This contact does not have a verified email, so outreach is blocked.');
      return;
    }

    setIsSending(true);
    try {
      const draftIndex = activeContact?.drafts.findIndex(d => d.subject === draft.subject) ?? 0;
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: company.id,
          contactId,
          draftIndex,
        }),
      });

      if (!res.ok) throw new Error('Failed to send email');
      
      toast.success(`Email sent to ${activeContact?.fullName}!`);
      setIsPreviewOpen(false);
      // Wait a moment and then refresh
      onUpdate?.(company.id, {}); 
    } catch (err) {
      toast.error('Failed to send email. Check your SMTP settings.');
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleAnalyze = async () => {
    if (!company) return;
    setIsAnalyzing(true);
    try {
      await onAnalyze?.(company.id);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!company) return;
    setIsSaving(true);
    try {
      await onUpdate?.(company.id, { notes, status });
    } finally {
      setIsSaving(false);
    }
  };

  if (!company) return null;

  const techStack = company.tech_stack || [];
  const legacyReasons = company.legacy_reasons || [];
  const pagespeedData = company.pagespeed_data as Record<string, unknown> | null;
  const metrics = pagespeedData?.metrics as Record<string, number> | undefined;
  const verifiedContacts = company.contacts.filter((contact) => canSendOutreachToContact(contact)).length;
  const sentDrafts = company.contacts.reduce(
    (count, contact) => count + contact.drafts.filter((draft) => draft.sent_at).length,
    0
  );
  const guessedContacts = company.contacts.filter((contact) => contact.verificationStatus === 'guessed').length;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {company.domain}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Visit website <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status and Actions */}
          <div className="flex items-center justify-between gap-4">
            <Select value={status} onValueChange={(val) => setStatus(val as any)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="needs_verified_contacts">Needs Verified</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`}
                />
                {isAnalyzing ? 'Analyzing...' : 'Re-analyze'}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>

          {/* Legacy Status */}
          {company.is_legacy ? (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Legacy Stack Detected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {legacyReasons.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-destructive">•</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : company.analyzed_at ? (
            <Card className="border-green-500/50 bg-green-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-green-500">
                  <CheckCircle className="h-4 w-4" />
                  Modern Stack
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  This website appears to be using modern technologies.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* PageSpeed Score */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4" />
                PageSpeed Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {company.pagespeed_score !== null ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-16 w-16 items-center justify-center rounded-full ${getPageSpeedBg(
                        company.pagespeed_score
                      )}`}
                    >
                      <span
                        className={`text-2xl font-bold ${getPageSpeedColor(
                          company.pagespeed_score
                        )}`}
                      >
                        {company.pagespeed_score}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">
                        {company.pagespeed_score >= 90
                          ? 'Good'
                          : company.pagespeed_score >= 50
                          ? 'Needs Improvement'
                          : 'Poor'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Mobile performance score
                      </p>
                    </div>
                  </div>

                  {metrics && (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">First Contentful Paint</p>
                        <p className="font-medium">
                          {(metrics.firstContentfulPaint / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Largest Contentful Paint</p>
                        <p className="font-medium">
                          {(metrics.largestContentfulPaint / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total Blocking Time</p>
                        <p className="font-medium">
                          {Math.round(metrics.totalBlockingTime)}ms
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Layout Shift</p>
                        <p className="font-medium">
                          {metrics.cumulativeLayoutShift?.toFixed(3) || '0'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not analyzed yet. Click &quot;Re-analyze&quot; to get performance data.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Tech Stack */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-muted-foreground">Technology Stack</CardTitle>
            </CardHeader>
            <CardContent>
              {techStack.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {techStack.map((tech, i) => {
                    const techName = typeof tech === 'string' ? tech : tech.name;
                    const techCategory = typeof tech === 'string' ? '' : tech.category;
                    return (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        <span>{techName}</span>
                        {techCategory && (
                          <span className="text-xs text-muted-foreground">
                            ({techCategory})
                          </span>
                        )}
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No technologies detected.
                </p>
              )}
            </CardContent>
          </Card>

          {/* AI Enrichment */}
          {company.enrichment && (
            <Card className="border-blue-500/20 bg-blue-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-blue-500">
                  <Target className="h-4 w-4" />
                  AI Enrichment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 pb-2">
                  <Badge variant="outline" className="bg-white/50 text-blue-700 border-blue-200">
                    {company.enrichment.industry}
                  </Badge>
                  <Badge variant="outline" className="bg-white/50 text-green-700 border-green-200">
                    Est. Rev: {company.enrichment.estimated_revenue}
                  </Badge>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Description</p>
                  <p className="mt-1 text-sm">{company.enrichment.description}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Problems Solved</p>
                  <p className="mt-1 text-sm">{company.enrichment.problems_solved}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Value Proposition</p>
                  <p className="mt-1 text-sm">{company.enrichment.value_proposition}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Target Audience</p>
                  <p className="mt-1 text-sm">{company.enrichment.target_audience}</p>
                </div>
                
                {company.enrichment.competitors && company.enrichment.competitors.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Competitors</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {company.enrichment.competitors.map((comp, idx) => (
                        <span key={idx} className="text-xs px-1.5 py-0.5 rounded bg-muted">
                          {comp}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}



          {/* Contacts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Decision Makers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {company.contacts && company.contacts.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{verifiedContacts} verified</Badge>
                    <Badge variant="outline">{sentDrafts} sent</Badge>
                    {guessedContacts > 0 && (
                      <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-700">
                        {guessedContacts} guessed and ineligible
                      </Badge>
                    )}
                    {company.status === 'needs_verified_contacts' && (
                      <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-700">
                        Waiting for a verified email before drafting
                      </Badge>
                    )}
                  </div>

                  {company.contacts.map((contact, i) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{contact.fullName}</p>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {contact.seniority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{contact.title} • {contact.department}</p>
                      
                      <div className="mt-2 flex flex-col gap-1">
                        {contact.email && (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="flex items-center gap-1 text-blue-500">
                              <Zap className="h-3 w-3" />
                              <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a>
                            </div>
                            {contact.verificationStatus && contact.verificationStatus !== 'unknown' && (
                              <Badge 
                                variant="outline" 
                                className={`h-4 border-0 px-1 py-0 text-[10px] uppercase font-bold ${
                                  contact.verificationStatus === 'verified' ? 'bg-green-500/10 text-green-600' :
                                  contact.verificationStatus === 'guessed' ? 'bg-amber-500/10 text-amber-700' :
                                  contact.verificationStatus === 'invalid' ? 'bg-red-500/10 text-red-600' :
                                  contact.verificationStatus === 'catch_all' ? 'bg-yellow-500/10 text-yellow-600' :
                                  'bg-gray-500/10 text-gray-600'
                                }`}
                              >
                                {getContactOutreachLabel(contact)}
                              </Badge>
                            )}
                          </div>
                        )}
                        {contact.linkedinUrl && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <ExternalLink className="h-3 w-3" />
                            <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" className="hover:underline">LinkedIn Profile</a>
                          </div>
                        )}
                      </div>

                      {contact.drafts && contact.drafts.length > 0 && (
                        <div className="mt-3 border-t pt-2 space-y-2">
                          <p className="flex items-center gap-1 text-[11px] font-bold uppercase text-muted-foreground">
                            <FileText className="h-3 w-3" /> AI Drafts
                          </p>
                          {contact.drafts.map((draft, idx) => (
                            <div key={idx} className="group relative rounded border bg-background p-2 text-xs hover:border-primary/50 transition-colors">
                              <div className="flex items-center justify-between mb-1">
                                <p className="font-semibold truncate pr-8">{draft.subject}</p>
                                {draft.sent_at && (
                                  <Badge variant="outline" className="h-4 text-[9px] bg-green-500/10 text-green-600 border-green-500/20">
                                    Sent {new Date(draft.sent_at).toLocaleDateString()}
                                  </Badge>
                                )}
                              </div>
                              <p className="line-clamp-2 text-muted-foreground mb-2">{draft.body}</p>
                              <Button 
                                variant="secondary" 
                                size="sm" 
                                className="w-full h-7 text-[10px] gap-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100"
                                onClick={() => handlePreviewEmail(contact, draft)}
                                disabled={Boolean(draft.sent_at) || !canSendOutreachToContact(contact)}
                              >
                                <Send className="h-3 w-3" />
                                {draft.sent_at ? 'Already Sent' : canSendOutreachToContact(contact) ? 'Review & Send' : 'Verified Email Required'}
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {company.status === 'fetching_contacts' 
                    ? '🔍 RocketReach fetching in progress...' 
                    : 'No contacts found yet. Ensure RR_API_KEY is configured.'}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Screenshot */}
          {company.screenshot_path && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImageIcon className="h-4 w-4" />
                  Website Screenshot
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-md border">
                  <img 
                    src={company.screenshot_path.startsWith('/') ? company.screenshot_path : `/${company.screenshot_path}`} 
                    alt="Website Screenshot" 
                    className="h-auto w-full"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />


          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              placeholder="Add notes about this lead..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          {/* Metadata */}
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Added:{' '}
              {company.created_at
                ? new Date(company.created_at).toLocaleDateString()
                : 'Unknown'}
            </p>
            {company.analyzed_at && (
              <p>
                Last analyzed:{' '}
                {new Date(company.analyzed_at).toLocaleDateString()}
              </p>
            )}
            {company.search_query && (
              <p>Found via: &quot;{company.search_query}&quot;</p>
            )}
          </div>
        </div>
      </SheetContent>

      <EmailPreviewModal
        open={isPreviewOpen}
        contact={activeContact}
        draft={activeDraft}
        onClose={() => setIsPreviewOpen(false)}
        onSend={handleSendEmail}
        isSending={isSending}
      />
    </Sheet>
  );
}
