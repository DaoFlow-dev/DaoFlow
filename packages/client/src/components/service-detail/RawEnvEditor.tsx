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
          Raw Editor — one KEY=value per line, # for comments
        </CardTitle>
      </CardHeader>
      <CardContent>
        <textarea
          className="w-full h-64 p-3 font-mono text-sm bg-[#0d1117] text-gray-300 rounded-lg border border-white/10 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
          value={rawText}
          onChange={(e) => onRawTextChange(e.target.value)}
          spellCheck={false}
        />
        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={onSave} disabled={isPending}>
            <Save size={14} className="mr-1" />
            Save All
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
