'use client';

import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Mail, Send, User, ChevronRight, Info } from 'lucide-react';
import type { ContactPerson, ContactDraft } from '@/lib/types';
import { canSendOutreachToContact } from '@/lib/utils';

interface EmailPreviewModalProps {
  contact: ContactPerson | null;
  draft: ContactDraft | null;
  open: boolean;
  onClose: () => void;
  onSend: (contactId: string, draft: ContactDraft) => Promise<void>;
  isSending?: boolean;
}

export function EmailPreviewModal({
  contact,
  draft,
  open,
  onClose,
  onSend,
  isSending = false,
}: EmailPreviewModalProps) {
  if (!contact || !draft) return null;

  const canSend = canSendOutreachToContact(contact);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden bg-background border-none shadow-2xl">
        {/* Mailbox Header Styling */}
        <div className="bg-muted/50 p-6 space-y-4">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Mail className="h-5 w-5 text-primary" />
                Preview Outreach
              </DialogTitle>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                Draft
              </Badge>
            </div>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm">
              <span className="w-12 text-muted-foreground font-medium pt-1">From:</span>
              <div className="flex-1 p-2 rounded-md bg-background border flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                  ME
                </div>
                <span className="font-medium text-foreground">Outreach Assistant</span>
                <span className="text-muted-foreground">&lt;outreach@your-company.com&gt;</span>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <span className="w-12 text-muted-foreground font-medium pt-1">To:</span>
              <div className="flex-1 p-2 rounded-md bg-background border flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{contact.fullName}</span>
                <span className="text-muted-foreground text-xs">&lt;{contact.email}&gt;</span>
                <Badge variant="outline" className={canSend ? 'text-green-600 border-green-200 bg-green-50' : 'text-amber-700 border-amber-200 bg-amber-50'}>
                  {canSend ? 'Verified' : 'Not verified'}
                </Badge>
              </div>
            </div>

            <div className="flex items-start gap-3 text-sm">
              <span className="w-12 text-muted-foreground font-medium pt-1">Subj:</span>
              <div className="flex-1 p-2 rounded-md bg-background border font-semibold">
                {draft.subject}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Email Body Area */}
        <div className="p-8 min-h-[300px] bg-background">
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {draft.body.split('\n').map((line, i) => (
              <p key={i} className="mb-4 text-foreground/90 leading-relaxed">
                {line}
              </p>
            ))}
          </div>
          
          <div className="mt-12 pt-6 border-t border-dashed">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3 w-3" />
              <span>This draft was generated using AI based on the lead's tech stack and industry.</span>
            </div>
          </div>
        </div>

        <DialogFooter className="p-6 bg-muted/30 border-t">
          <Button variant="ghost" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button 
            className="px-8 shadow-lg shadow-primary/20" 
            onClick={() => onSend(contact.id, draft)}
            disabled={isSending || !canSend}
          >
            {isSending ? (
              <>
                <ChevronRight className="mr-2 h-4 w-4 animate-ping" />
                Sending...
              </>
            ) : canSend ? (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Email
              </>
            ) : (
              'Verified Email Required'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
