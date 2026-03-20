import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileCode, Save, Download, RotateCcw, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

interface ComposeEditorTabProps {
  serviceId: string;
  serviceName: string;
}

export default function ComposeEditorTab({
  serviceId: _serviceId,
  serviceName
}: ComposeEditorTabProps) {
  const [content, setContent] = useState(PLACEHOLDER_COMPOSE);
  const [originalContent, setOriginalContent] = useState(PLACEHOLDER_COMPOSE);
  const [isModified, setIsModified] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syntaxError, setSyntaxError] = useState<string | null>(null);

  useEffect(() => {
    setIsModified(content !== originalContent);

    // Basic YAML validation
    try {
      const lines = content.split("\n");
      let hasError = false;
      for (const line of lines) {
        if (line.trim() && !line.trim().startsWith("#")) {
          if (line.includes("\t")) {
            setSyntaxError("YAML does not allow tabs. Use spaces for indentation.");
            hasError = true;
            break;
          }
        }
      }
      if (!hasError) setSyntaxError(null);
    } catch {
      setSyntaxError(null);
    }
  }, [content, originalContent]);

  function handleSave() {
    setIsSaving(true);
    // Placeholder save — will be wired to backend
    setTimeout(() => {
      setOriginalContent(content);
      setIsModified(false);
      setIsSaving(false);
    }, 500);
  }

  function handleReset() {
    setContent(originalContent);
    setIsModified(false);
  }

  function handleDownload() {
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${serviceName}-compose.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileCode size={14} />
            Compose File
            {isModified && (
              <Badge variant="secondary" className="text-xs">
                Modified
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleReset} disabled={!isModified}>
              <RotateCcw size={14} className="mr-1" />
              Reset
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownload}>
              <Download size={14} />
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isModified || isSaving || !!syntaxError}
            >
              <Save size={14} className="mr-1" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {syntaxError && (
          <div className="mb-3 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle size={14} />
            {syntaxError}
          </div>
        )}
        <div className="relative">
          {/* Line numbers gutter */}
          <div className="absolute left-0 top-0 bottom-0 w-10 bg-[#161b22] rounded-l-lg border-r border-white/10 flex flex-col items-end pr-2 pt-3 text-xs font-mono text-gray-600 overflow-hidden select-none leading-[1.6]">
            {content.split("\n").map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            className="w-full h-[500px] pl-14 pr-4 py-3 font-mono text-sm bg-[#0d1117] text-gray-300 rounded-lg border border-white/10 focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-[1.6]"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            wrap="off"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-muted-foreground">
            Edit the compose configuration directly. Changes take effect on the next deployment.
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              YAML
            </Badge>
            <span>Spaces only · 2-space indent</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const PLACEHOLDER_COMPOSE = `# docker-compose.yaml
version: "3.8"

services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
`;
