'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

interface SearchPanelProps {
  onSearch: (query: string, autoAnalyze: boolean) => Promise<{
    success: boolean;
    results?: {
      companiesAdded: number;
      companiesSkipped: number;
    };
    error?: string;
  }>;
}

export function SearchPanel({ onSearch }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    companiesAdded?: number;
    companiesSkipped?: number;
    error?: string;
  } | null>(null);

  const [isTestRunning, setIsTestRunning] = useState<number | 'all' | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    setResult(null);

    try {
      const response = await onSearch(query, autoAnalyze);
      setResult({
        success: response.success,
        companiesAdded: response.results?.companiesAdded,
        companiesSkipped: response.results?.companiesSkipped,
        error: response.error,
      });
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const forceTest = async (stage: number | 'all') => {
    setIsTestRunning(stage);
    setResult(null);
    try {
      const response = await fetch('/api/admin/force-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      setResult({
        success: true,
        companiesAdded: typeof data.result.count === 'number' ? data.result.count : undefined,
        error: `Stage ${stage} executed successfully. Check server logs.`
      });
    } catch (error) {
       setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Force test failed',
      });
    } finally {
      setIsTestRunning(null);
    }
  };

  const suggestedQueries = [
    'Drupal 7',
    'Drupal 6',
    'Magento 1',
    'jQuery 1.x',
    'WordPress < 4',
    'Joomla 2',
    'osCommerce',
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Discover Companies
        </CardTitle>
        <CardDescription>
          Find companies using legacy technologies via PublicWWW &amp; CommonCrawl
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter a technology name (e.g. Drupal 7, Magento 1, jQuery 1.x)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={isSearching || !query.trim()}>
            {isSearching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Search
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="autoAnalyze"
            checked={autoAnalyze}
            onCheckedChange={(checked) => setAutoAnalyze(checked === true)}
          />
          <Label htmlFor="autoAnalyze" className="text-sm text-muted-foreground">
            Automatically analyze found companies (slower but finds legacy leads immediately)
          </Label>
        </div>

        {/* Suggested queries */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Suggested searches:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQueries.map((q) => (
              <Button
                key={q}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setQuery(q)}
              >
                {q.length > 35 ? q.slice(0, 35) + '...' : q}
              </Button>
            ))}
          </div>
        </div>

        {/* Result message */}
        {result && (
          <Alert variant={result.success ? 'default' : 'destructive'}>
            {result.success ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>
              {result.success
                ? `Found and added ${result.companiesAdded} companies (${result.companiesSkipped} already in database)`
                : result.error}
            </AlertDescription>
          </Alert>
        )}

        {/* Admin Testing Section */}
        <div className="pt-4 border-t space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Autonomous Pipeline Testing</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((stage) => (
              <Button
                key={stage}
                variant="outline"
                size="sm"
                onClick={() => forceTest(stage)}
                disabled={isTestRunning !== null}
              >
                {isTestRunning === stage && <Loader2 className="mr-2 h-3 w-3 animate-spin"/>}
                Force Stage {stage}
              </Button>
            ))}
            <Button
              variant="default"
              size="sm"
              onClick={() => forceTest('all')}
              disabled={isTestRunning !== null}
              title="Run entire pipeline (Scrape -> Analyze -> Contacts -> Drafts)"
            >
              {isTestRunning === 'all' && <Loader2 className="mr-2 h-3 w-3 animate-spin"/>}
              Test Full Pipeline
            </Button>
          </div>
        </div>

        {/* API Key reminder */}
        {result?.error?.includes('not configured') && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              To use Google Search Scraping, you need to set up:
              <ol className="mt-2 list-inside list-decimal text-sm">
                <li>Create an account at Apify</li>
                <li>Add APIFY_API_TOKEN to your environment (.env.local)</li>
              </ol>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
