'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { CompanyTable } from '@/components/dashboard/company-table';
import { CompanyDetail } from '@/components/dashboard/company-detail';
import { SearchPanel } from '@/components/dashboard/search-panel';
import { QuickAnalyze } from '@/components/dashboard/quick-analyze';
import {
  useCompanies,
  useStats,
  analyzeCompany,
  deleteCompany,
  updateCompany,
  searchCompanies,
  quickAnalyze,
} from '@/lib/hooks/use-companies';
import type { Company } from '@/lib/types';
import { LayoutDashboard, Search, Zap } from 'lucide-react';

export default function Dashboard() {
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    isLegacy: 'true', // Default to Legacy Only
    verifiedOnly: 'all',
    sentOnly: 'all',
  });
  const [page, setPage] = useState(1);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  const { 
    companies, 
    pagination,
    isLoading: companiesLoading, 
    mutate: mutateCompanies 
  } = useCompanies({ ...filters, page, limit: 10 });
  const { stats, isLoading: statsLoading, mutate: mutateStats } = useStats();

  const handleAnalyze = useCallback(
    async (id: string) => {
      await analyzeCompany(id);
      mutateCompanies();
      mutateStats();
    },
    [mutateCompanies, mutateStats]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm('Are you sure you want to delete this company?')) return;
      await deleteCompany(id);
      mutateCompanies();
      mutateStats();
    },
    [mutateCompanies, mutateStats]
  );

  const handleUpdateStatus = useCallback(
    async (id: string, status: string) => {
      await updateCompany(id, { status } as Partial<Company>);
      mutateCompanies();
      mutateStats();
    },
    [mutateCompanies, mutateStats]
  );

  const handleUpdate = useCallback(
    async (id: string, data: Partial<Company>) => {
      await updateCompany(id, data);
      mutateCompanies();
      if (selectedCompany?.id === id) {
        setSelectedCompany({ ...selectedCompany, ...data } as Company);
      }
    },
    [mutateCompanies, selectedCompany]
  );

  const handleSearch = useCallback(
    async (query: string, autoAnalyze: boolean) => {
      try {
        const result = await searchCompanies(query, autoAnalyze);
        mutateCompanies();
        mutateStats();
        return {
          success: true,
          results: result.results,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Search failed',
        };
      }
    },
    [mutateCompanies, mutateStats]
  );

  const handleQuickAnalyze = useCallback(
    async (domain: string) => {
      const result = await quickAnalyze(domain);
      mutateCompanies();
      mutateStats();
      return result;
    },
    [mutateCompanies, mutateStats]
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-chart-1 text-white">
              <Zap className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-semibold">LeadStack</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Legacy Tech Lead Generator
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search
            </TabsTrigger>
            <TabsTrigger value="analyze" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Analyze
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <StatsCards stats={stats || null} isLoading={statsLoading} />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Companies</h2>
              </div>
              <CompanyTable
                companies={companies}
                isLoading={companiesLoading}
                onAnalyze={handleAnalyze}
                onDelete={handleDelete}
                onUpdateStatus={handleUpdateStatus}
                onSelectCompany={setSelectedCompany}
                filters={filters}
                onFiltersChange={(newFilters) => {
                  setFilters(newFilters);
                  setPage(1);
                }}
                pagination={pagination}
                onPageChange={setPage}
              />
            </div>
          </TabsContent>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-6">
            <SearchPanel onSearch={handleSearch} />

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Recent Companies</h2>
              <CompanyTable
                companies={companies}
                isLoading={companiesLoading}
                onAnalyze={handleAnalyze}
                onDelete={handleDelete}
                onUpdateStatus={handleUpdateStatus}
                onSelectCompany={setSelectedCompany}
                filters={filters}
                onFiltersChange={(newFilters) => {
                  setFilters(newFilters);
                  setPage(1);
                }}
                pagination={pagination}
                onPageChange={setPage}
              />
            </div>
          </TabsContent>

          {/* Analyze Tab */}
          <TabsContent value="analyze" className="space-y-6">
            <QuickAnalyze onAnalyze={handleQuickAnalyze} />

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Recent Legacy Leads</h2>
              <CompanyTable
                companies={companies.filter((c) => c.is_legacy)}
                isLoading={companiesLoading}
                onAnalyze={handleAnalyze}
                onDelete={handleDelete}
                onUpdateStatus={handleUpdateStatus}
                onSelectCompany={setSelectedCompany}
                filters={{ ...filters, isLegacy: 'true' }}
                onFiltersChange={(newFilters) => {
                  setFilters(newFilters);
                  setPage(1);
                }}
                pagination={pagination}
                onPageChange={setPage}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Company Detail Sheet */}
      <CompanyDetail
        company={selectedCompany}
        open={!!selectedCompany}
        onClose={() => setSelectedCompany(null)}
        onAnalyze={handleAnalyze}
        onUpdate={handleUpdate}
      />
    </div>
  );
}
