import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RefreshCw, Save } from "lucide-react";
import { useState } from "react";

export function RestartPolicyCard() {
  const [restartPolicy, setRestartPolicy] = useState("unless-stopped");
  const [maxRetries, setMaxRetries] = useState("3");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw size={14} />
          Restart Policy
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Policy</label>
            <Select value={restartPolicy} onValueChange={setRestartPolicy}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                <SelectItem value="on-failure">On Failure</SelectItem>
                <SelectItem value="no">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {restartPolicy === "on-failure" && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Max Retries</label>
              <Input
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                className="h-8 text-sm"
                type="number"
                min="1"
              />
            </div>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button size="sm">
            <Save size={14} className="mr-1" />
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
