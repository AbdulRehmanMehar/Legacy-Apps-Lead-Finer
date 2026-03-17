'use client';

import useSWR from 'swr';
import type { Company } from '@/lib/types';

interface CompaniesResponse {
  companies: Company[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface StatsResponse {
  overview: {
    totalCompanies: number;
    legacyCompanies: number;
    analyzedCompanies: number;
    verifiedCompanies: number;
    sentCompanies: number;
    avgPageSpeed: number | null;
    conversionRate: number;
  };
  statusBreakdown: Record<string, number>;
  recentJobs: Array<{
    id: string;
    query: string;
    status: string;
    results_count: number;
    leads_found: number;
    created_at: string;
  }>;
  recentLeads: Company[];
  topLegacyReasons: Array<{ reason: string; count: number }>;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to fetch');
  }
  return res.json();
};

export function useCompanies(filters: {
  search?: string;
  status?: string;
  isLegacy?: string;
  verifiedOnly?: string;
  sentOnly?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.isLegacy && filters.isLegacy !== 'all') params.set('is_legacy', filters.isLegacy);
  if (filters.verifiedOnly === 'true') params.set('verified_only', 'true');
  if (filters.sentOnly === 'true') params.set('sent_only', 'true');
  if (filters.page) params.set('page', filters.page.toString());
  if (filters.limit) params.set('limit', filters.limit.toString());

  const { data, error, isLoading, mutate } = useSWR<CompaniesResponse>(
    `/api/companies?${params.toString()}`,
    fetcher
  );

  return {
    companies: data?.companies || [],
    pagination: data?.pagination,
    isLoading,
    error,
    mutate,
  };
}

export function useCompany(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ company: Company }>(
    id ? `/api/companies/${id}` : null,
    fetcher
  );

  return {
    company: data?.company,
    isLoading,
    error,
    mutate,
  };
}

export function useStats() {
  const { data, error, isLoading, mutate } = useSWR<StatsResponse>(
    '/api/stats',
    fetcher,
    { refreshInterval: 30000 } // Refresh every 30 seconds
  );

  return {
    stats: data,
    isLoading,
    error,
    mutate,
  };
}

// Actions
export async function analyzeCompany(id: string) {
  const res = await fetch(`/api/companies/${id}/analyze`, {
    method: 'POST',
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Analysis failed');
  }
  
  return res.json();
}

export async function deleteCompany(id: string) {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'DELETE',
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Delete failed');
  }
  
  return res.json();
}

export async function updateCompany(id: string, data: Partial<Company>) {
  const res = await fetch(`/api/companies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Update failed');
  }
  
  return res.json();
}

export async function searchCompanies(query: string, autoAnalyze: boolean = false) {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, autoAnalyze }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Search failed');
  }
  
  return res.json();
}

export async function quickAnalyze(domain: string) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, saveAsLead: true }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Analysis failed');
  }
  
  return res.json();
}
