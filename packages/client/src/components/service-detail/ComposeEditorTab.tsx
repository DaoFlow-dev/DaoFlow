import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy, Download, FileCode, Info } from "lucide-react";
import { getRuntimeConfigSupportReason } from "./runtime-config";

interface ComposeEditorTabProps {
  serviceId: string;
  serviceName: string;
  sourceType: string;
  composeServiceName: string | null;
  runtimeConfigPreview: string | null;
}

export default function ComposeEditorTab({
  serviceId,
  serviceName,
  sourceType,
  composeServiceName,
  runtimeConfigPreview
}: ComposeEditorTabProps) {
  const [copied, setCopied] = useState(false);
  const supportReason = getRuntimeConfigSupportReason({
    sourceType,
    composeServiceName
  });

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  function handleDownload() {
    if (!runtimeConfigPreview) {
      return;
    }

    const blob = new Blob([runtimeConfigPreview], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${serviceName}-compose.override.yaml`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (!runtimeConfigPreview) {
      return;
    }

    void navigator.clipboard.writeText(runtimeConfigPreview).then(() => setCopied(true));
  }

  return (
    <Card className="shadow-sm" data-testid={`service-compose-preview-${serviceId}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileCode size={14} />
            Compose Override Preview
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              YAML
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              disabled={!runtimeConfigPreview}
              data-testid={`service-compose-preview-copy-${serviceId}`}
            >
              <Copy size={14} className="mr-1" />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              disabled={!runtimeConfigPreview}
              data-testid={`service-compose-preview-download-${serviceId}`}
            >
              <Download size={14} className="mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {supportReason ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{supportReason}</span>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground flex items-start gap-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            This tab previews the DaoFlow-managed compose override layer only. It does not edit the
            upstream compose source files directly.
          </span>
        </div>

        {runtimeConfigPreview ? (
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-10 bg-zinc-900 rounded-l-lg border-r border-zinc-800 flex flex-col items-end pr-2 pt-3 text-xs font-mono text-zinc-500 overflow-hidden select-none leading-[1.6]">
              {runtimeConfigPreview.split("\n").map((_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <textarea
              readOnly
              className="w-full h-[420px] pl-14 pr-4 py-3 font-mono text-sm bg-zinc-950 text-zinc-300 rounded-lg border border-zinc-800 focus:outline-none resize-y leading-[1.6]"
              value={runtimeConfigPreview}
              data-testid={`service-compose-preview-text-${serviceId}`}
            />
          </div>
        ) : (
          <div
            className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground"
            data-testid={`service-compose-preview-empty-${serviceId}`}
          >
            No DaoFlow-managed runtime overrides are saved for this service yet. The next deployment
            will inherit the upstream compose source unchanged.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
