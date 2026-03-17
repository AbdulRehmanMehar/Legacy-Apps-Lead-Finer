'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, MailCheck, Send, Target, TrendingUp, Zap } from 'lucide-react';

interface StatsCardsProps {
  stats: {
    overview: {
      totalCompanies: number;
      legacyCompanies: number;
      analyzedCompanies: number;
      verifiedCompanies: number;
      sentCompanies: number;
      avgPageSpeed: number | null;
      conversionRate: number;
    };
  } | null;
  isLoading?: boolean;
}

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  const cards = [
    {
      title: 'Total Companies',
      value: stats?.overview.totalCompanies ?? 0,
      icon: Building2,
      description: 'Companies in database',
    },
    {
      title: 'Legacy Leads',
      value: stats?.overview.legacyCompanies ?? 0,
      icon: Target,
      description: 'Using outdated tech',
      highlight: true,
    },
    {
      title: 'Analyzed',
      value: stats?.overview.analyzedCompanies ?? 0,
      icon: Zap,
      description: 'Fully analyzed',
    },
    {
      title: 'Verified Ready',
      value: stats?.overview.verifiedCompanies ?? 0,
      icon: MailCheck,
      description: 'Companies with verified contacts',
    },
    {
      title: 'Outreach Sent',
      value: stats?.overview.sentCompanies ?? 0,
      icon: Send,
      description: 'Companies with sent emails',
    },
    {
      title: 'Avg. PageSpeed',
      value: stats?.overview.avgPageSpeed ?? '-',
      icon: TrendingUp,
      description: 'Performance score',
      suffix: stats?.overview.avgPageSpeed ? '/100' : '',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      {cards.map((card) => (
        <Card
          key={card.title}
          className={`${card.highlight ? 'border-chart-1/50 bg-chart-1/5' : ''}`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-8 w-20 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-2xl font-bold">
                {card.value}
                {card.suffix && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {card.suffix}
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{card.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
