'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCareerCoachHistory,
  sendCareerCoachMessage,
  clearCareerCoachHistory,
  CareerCoachSendError,
} from '@/lib/api/career-agent';
import { markAgentHandoffsViewed } from '@/lib/agent-handoff-viewed';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { AgentHandoffTimeline } from './agent-handoff-timeline';
import { MessageContent } from './message-content';

interface ChatMessage {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export function CareerCoachView() {
  const t = useTranslations('careerCoach');
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data: history, isLoading } = useQuery({
    queryKey: ['career-coach-history'],
    queryFn: fetchCareerCoachHistory,
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<'rateLimited' | 'quotaExceeded' | 'generic' | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftOutreachTriggered = useRef(false);
  // get_job_context's tool-call result is never persisted to
  // career_coach_messages (only the final text reply is saved), so a
  // follow-up turn that reloads history from the server has lost it. Kept
  // for exactly one follow-up turn beyond the auto-sent one — the user's
  // channel answer — so that turn can re-send jobId and re-fetch context,
  // instead of the model losing track of which job this conversation is
  // about. Refs (not state) so the decrement takes effect synchronously
  // within the same handleSend call, no stale-closure risk.
  const outreachJobIdRef = useRef<string | undefined>(undefined);
  const outreachTurnsRemainingRef = useRef(0);

  useEffect(() => {
    if (!hydrated && history) {
      setMessages(history.map((m) => ({ role: m.role, content: m.content })));
      setHydrated(true);
    }
  }, [history, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Opening this page is what "reads" any pending agent handoffs — clears
  // the Sidebar's unread badge.
  useEffect(() => {
    markAgentHandoffsViewed();
  }, []);

  // DraftOutreachButton's entry point: jobId in the URL means send a
  // canned first message automatically,
  // scoped to that job via the API's jobId field rather than expecting the
  // user to describe which job they mean. Waits for hydration so this
  // doesn't race the history load and duplicate-send on a fast re-render;
  // the ref (not just the query param) guards against re-firing if the
  // effect re-runs before the param is stripped from the URL below.
  useEffect(() => {
    const jobId = searchParams.get('jobId');
    if (!jobId || !hydrated || draftOutreachTriggered.current) return;
    draftOutreachTriggered.current = true;

    const remainingParams = new URLSearchParams(searchParams.toString());
    remainingParams.delete('jobId');
    const query = remainingParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    outreachJobIdRef.current = jobId;
    outreachTurnsRemainingRef.current = 2; // this auto-sent turn + the next follow-up
    void handleSend(t('draftOutreachMessage'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, hydrated]);

  async function handleSend(overrideContent?: string) {
    const content = (overrideContent ?? input).trim();
    if (!content || isSending) return;

    const jobId = outreachTurnsRemainingRef.current > 0 ? outreachJobIdRef.current : undefined;
    if (outreachTurnsRemainingRef.current > 0) outreachTurnsRemainingRef.current -= 1;

    if (!overrideContent) setInput('');
    setError(null);
    setIsSending(true);
    setMessages((prev) => [...prev, { role: 'USER', content }, { role: 'ASSISTANT', content: '' }]);

    try {
      await sendCareerCoachMessage(
        content,
        (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1]!;
            next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        },
        jobId,
      );
    } catch (err) {
      // Drop the empty ASSISTANT placeholder — no content ever arrived, so
      // showing a permanently-empty bubble reads as "still thinking". For
      // the DraftOutreachButton auto-send (overrideContent set — jobId
      // alone no longer distinguishes this, since it now also carries on
      // the follow-up turn), also drop the USER bubble: it's canned text
      // the user never typed, and route.ts never persisted it (the jobId
      // ownership check runs before the message is saved) — keeping it
      // visible would be a client-only ghost message with no server-side
      // counterpart. A manually-typed message keeps its USER bubble so the
      // user can see what they wrote and retry.
      setMessages((prev) => prev.slice(0, overrideContent ? -2 : -1));
      if (err instanceof CareerCoachSendError && err.code === 'RATE_LIMITED') {
        setError('rateLimited');
      } else if (
        err instanceof CareerCoachSendError &&
        err.code === 'CAREER_COACH_QUOTA_EXCEEDED'
      ) {
        setError('quotaExceeded');
      } else {
        setError('generic');
      }
    } finally {
      setIsSending(false);
    }
  }

  // Hard delete, irreversible — no undo, no conversationId/multi-thread
  // concept.
  async function handleClear() {
    setIsClearing(true);
    try {
      await clearCareerCoachHistory();
      setMessages([]);
      setError(null);
      outreachTurnsRemainingRef.current = 0;
      queryClient.setQueryData(['career-coach-history'], []);
      setClearDialogOpen(false);
    } catch {
      setError('generic');
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={messages.length === 0}>
              {t('clearConversation')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>{t('clearConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('clearConfirmDescription')}</DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={isClearing}>
                  {t('clearCancel')}
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => void handleClear()}
                disabled={isClearing}
              >
                {t('clearConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AgentHandoffTimeline />

      <div className="flex-1 space-y-4 overflow-y-auto rounded-md border border-border p-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        ) : (
          messages.map((message, i) => (
            <div key={i} className={message.role === 'USER' ? 'text-right' : 'text-left'}>
              <span
                className={
                  message.role === 'USER'
                    ? 'inline-block max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'inline-block max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm'
                }
              >
                {message.content ? <MessageContent content={message.content} /> : '…'}
              </span>
            </div>
          ))
        )}
        {error && (
          <p className="text-sm text-destructive">
            {error === 'rateLimited'
              ? t('rateLimited')
              : error === 'quotaExceeded'
                ? t('quotaExceeded')
                : t('sendFailed')}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t('placeholder')}
          disabled={isSending}
        />
        <Button onClick={() => void handleSend()} disabled={isSending || !input.trim()}>
          {t('send')}
        </Button>
      </div>
    </div>
  );
}
