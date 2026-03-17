'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { MoreHorizontal, ExternalLink, Search, RefreshCw, Trash2 } from 'lucide-react';
import type { Company } from '@/lib/types';

interface CompanyTableProps {
  companies: Company[];
  isLoading?: boolean;
  onAnalyze?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpdateStatus?: (id: string, status: string) => void;
  onSelectCompany?: (company: Company) => void;
  filters: {
    search: string;
    status: string;
    isLegacy: string;
    verifiedOnly: string;
    sentOnly: string;
  };
  onFiltersChange: (filters: {
    search: string;
    status: string;
    isLegacy: string;
    verifiedOnly: string;
    sentOnly: string;
  }) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  analyzing: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  needs_contacts: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  fetching_contacts: 'bg-indigo-500/20 text-indigo-600 border-indigo-500/30 animate-pulse',
  needs_verified_contacts: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  needs_drafts: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
  drafting: 'bg-cyan-500/20 text-cyan-600 border-cyan-500/30 animate-pulse',
  drafts_ready: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold',
  contacted: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  qualified: 'bg-green-500/10 text-green-500 border-green-500/20',
  converted: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
  unreachable: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

function getPageSpeedColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 90) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

export function CompanyTable({
  companies,
  isLoading,
  onAnalyze,
  onDelete,
  onUpdateStatus,
  onSelectCompany,
  filters,
  onFiltersChange,
  pagination,
  onPageChange,
}: CompanyTableProps) {
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const handleAnalyze = async (id: string) => {
    setAnalyzingId(id);
    try {
      await onAnalyze?.(id);
    } finally {
      setAnalyzingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by domain or name..."
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            className="pl-10"
          />
        </div>
        <Select
          value={filters.status}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, status: value })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="discovery">Discovery</SelectItem>
            <SelectItem value="needs_verified_contacts">Needs Verified</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.isLegacy}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, isLegacy: value })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="true">Legacy Only</SelectItem>
            <SelectItem value="false">Modern Only</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.verifiedOnly}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, verifiedOnly: value })
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Verified Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contacts</SelectItem>
            <SelectItem value="true">Verified Only</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.sentOnly}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, sentOnly: value })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Sent Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outreach</SelectItem>
            <SelectItem value="true">Sent Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{pagination?.total ?? companies.length} matching companies</span>
        {filters.verifiedOnly === 'true' && <Badge variant="outline">Verified only</Badge>}
        {filters.sentOnly === 'true' && <Badge variant="outline">Sent only</Badge>}
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Legacy</TableHead>
              <TableHead>PageSpeed</TableHead>
              <TableHead>Tech Stack</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  </TableCell>
                  <TableCell>
                    <div className="h-4 w-8 animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))
            ) : companies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <p className="text-muted-foreground">No companies found</p>
                </TableCell>
              </TableRow>
            ) : (
              companies.map((company) => (
                <TableRow
                  key={company.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onSelectCompany?.(company)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{company.domain}</span>
                      <a
                        href={`https://${company.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    {company.name && (
                      <p className="text-sm text-muted-foreground">
                        {company.name}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusColors[company.status || 'new']}
                    >
                      {company.status || 'new'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {company.is_legacy ? (
                      <Badge variant="destructive">Legacy</Badge>
                    ) : company.status === 'unreachable' ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Unknown
                      </Badge>
                    ) : company.analyzed_at ? (
                      <Badge
                        variant="outline"
                        className="border-green-500/20 bg-green-500/10 text-green-500"
                      >
                        Modern
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={getPageSpeedColor(company.pagespeed_score)}>
                      {company.pagespeed_score ?? '-'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(company.tech_stack || []).slice(0, 3).map((tech) => (
                        <Badge
                          key={typeof tech === 'string' ? tech : tech.name}
                          variant="secondary"
                          className="text-xs"
                        >
                          {typeof tech === 'string' ? tech : tech.name}
                        </Badge>
                      ))}
                      {(company.tech_stack || []).length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{(company.tech_stack || []).length - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAnalyze(company.id);
                          }}
                          disabled={analyzingId === company.id}
                        >
                          <RefreshCw
                            className={`mr-2 h-4 w-4 ${
                              analyzingId === company.id ? 'animate-spin' : ''
                            }`}
                          />
                          {analyzingId === company.id ? 'Analyzing...' : 'Analyze'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateStatus?.(company.id, 'contacted');
                          }}
                        >
                          Mark as Contacted
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateStatus?.(company.id, 'qualified');
                          }}
                        >
                          Mark as Qualified
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.(company.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-4">
          <p className="text-sm text-muted-foreground">
            Showing {Math.min(pagination.total, (pagination.page - 1) * pagination.limit + 1)} to{' '}
            {Math.min(pagination.total, pagination.page * pagination.limit)} of{' '}
            {pagination.total} results
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                // Simple pagination logic for current page context
                let pageNum = pagination.page;
                if (pagination.page <= 3) pageNum = i + 1;
                else if (pagination.page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i;
                else pageNum = pagination.page - 2 + i;

                if (pageNum < 1 || pageNum > pagination.totalPages) return null;

                return (
                  <Button
                    key={pageNum}
                    variant={pagination.page === pageNum ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => onPageChange?.(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {!isLoading && companies.length === 0 && (
        <div className="flex flex-col items-center justify-center space-y-2 py-12 text-center">
          <p className="text-muted-foreground">No companies match your filters.</p>
          <Button
            variant="link"
            onClick={() =>
              onFiltersChange({
                search: '',
                status: 'all',
                isLegacy: 'all',
                verifiedOnly: 'all',
                sentOnly: 'all',
              })
            }
          >
            Clear all filters
          </Button>
        </div>
      )}
    </div>
  );
}
