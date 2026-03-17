'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Zap, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';

interface AnalysisResult {
  domain: string;
  analysis: {
    techStack: Array<{ name: string; category: string; version?: string }>;
    pageSpeed: { score: number } | null;
    legacyAnalysis: {
      isLegacy: boolean;
      score: number;
      reasons: string[];
      recommendations: string[];
    };
    errors: string[];
  };
  savedAsLead: boolean;
}

interface QuickAnalyzeProps {
  onAnalyze: (domain: string) => Promise<AnalysisResult>;
}

export function QuickAnalyze({ onAnalyze }: QuickAnalyzeProps) {
  const [domain, setDomain] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!domain.trim()) return;

    setIsAnalyzing(true);
    setResult(null);
    setError(null);

    try {
      const response = await onAnalyze(domain);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Quick Analyze
        </CardTitle>
        <CardDescription>
          Analyze any website instantly to check for legacy tech
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter domain (e.g., example.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            className="flex-1"
          />
          <Button onClick={handleAnalyze} disabled={isAnalyzing || !domain.trim()}>
            {isAnalyzing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Analyze
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="space-y-4 rounded-lg border p-4">
            {/* Legacy Status */}
            {result.analysis.legacyAnalysis.isLegacy ? (
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-destructive">Legacy Stack Detected</p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {result.analysis.legacyAnalysis.reasons.map((reason, i) => (
                      <li key={i}>• {reason}</li>
                    ))}
                  </ul>
                </div>
                <Badge variant="destructive">
                  Score: {result.analysis.legacyAnalysis.score}
                </Badge>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <div className="flex-1">
                  <p className="font-medium text-green-500">Modern Stack</p>
                  <p className="text-sm text-muted-foreground">
                    This website uses modern technologies
                  </p>
                </div>
              </div>
            )}

            {/* PageSpeed */}
            {result.analysis.pageSpeed && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">PageSpeed Score:</span>
                <span
                  className={`font-medium ${
                    result.analysis.pageSpeed.score >= 90
                      ? 'text-green-500'
                      : result.analysis.pageSpeed.score >= 50
                      ? 'text-yellow-500'
                      : 'text-red-500'
                  }`}
                >
                  {result.analysis.pageSpeed.score}/100
                </span>
              </div>
            )}

            {/* Tech Stack */}
            {result.analysis.techStack.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Detected Technologies:</p>
                <div className="flex flex-wrap gap-1">
                  {result.analysis.techStack.map((tech, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {tech.name}
                      {tech.version && ` ${tech.version}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Saved status */}
            {result.savedAsLead && (
              <p className="text-sm text-muted-foreground">
                <CheckCircle className="mr-1 inline h-3 w-3 text-green-500" />
                Saved to your leads database
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
