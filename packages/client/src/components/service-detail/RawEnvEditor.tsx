import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";

interface RawEnvEditorProps {
  rawText: string;
  onRawTextChange: (text: string) => void;
  onSave: () => void;
  isPending: boolean;
}

export function RawEnvEditor({ rawText, onRawTextChange, onSave, isPending }: RawEnvEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Raw editor for service overrides — one KEY=value per line, # for comments or redacted
          secrets
        </CardTitle>
      </CardHeader>
      <CardContent>
        <textarea
          data-testid="service-envvar-raw-text"
          aria-label="Raw service overrides"
          name="service-envvar-raw-text"
          className="w-full h-64 p-3 font-mono text-sm bg-zinc-950 text-zinc-300 rounded-lg border border-zinc-800 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          spellCheck={false}
        />
        <div className="flex justify-end mt-3">
          <Button
            data-testid="service-envvar-raw-save"
            size="sm"
            onClick={onSave}
            disabled={isPending}
          >
            <Save size={14} className="mr-1" />
            Save All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
