import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, Settings2, Trash2 } from "lucide-react";

interface ProjectSettingsPanelProps {
  editName: string;
  onEditName: (v: string) => void;
  editDesc: string;
  onEditDesc: (v: string) => void;
  onSave: () => void;
  onRequestDelete: () => void;
  isSaving: boolean;
  isDeletePending: boolean;
  saveDisabled: boolean;
  errorMessage?: string | null;
}

export function ProjectSettingsPanel({
  editName,
  onEditName,
  editDesc,
  onEditDesc,
  onSave,
  onRequestDelete,
  isSaving,
  isDeletePending,
  saveDisabled,
  errorMessage
}: ProjectSettingsPanelProps) {
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings2 size={14} />
          Project Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Project Name</label>
          <Input
            value={editName}
            onChange={(e) => onEditName(e.target.value)}
            className="h-8 text-sm max-w-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Description</label>
          <Input
            value={editDesc}
            onChange={(e) => onEditDesc(e.target.value)}
            className="h-8 text-sm max-w-lg"
            placeholder="Optional project description"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onSave}
            disabled={saveDisabled}
            data-testid="project-settings-save"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={14} className="mr-1" />
                Save
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            title="Delete project — this cannot be undone"
            onClick={onRequestDelete}
            disabled={isSaving || isDeletePending}
            data-testid="project-settings-delete"
          >
            <Trash2 size={14} className="mr-1" />
            Delete Project
          </Button>
        </div>
        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      </CardContent>
    </Card>
  );
}
