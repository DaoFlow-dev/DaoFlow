import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cpu, Save } from "lucide-react";
import { useState } from "react";

export function ResourceLimitsCard() {
  const [cpuLimit, setCpuLimit] = useState("");
  const [cpuReservation, setCpuReservation] = useState("");
  const [memoryLimit, setMemoryLimit] = useState("");
  const [memoryReservation, setMemoryReservation] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu size={14} />
          Resource Limits
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ResourceInput
            label="CPU Limit"
            value={cpuLimit}
            onChange={setCpuLimit}
            placeholder="1.0 (cores)"
            step="0.25"
            hint="Maximum CPU cores (e.g. 2.0 = 2 cores)"
          />
          <ResourceInput
            label="CPU Reservation"
            value={cpuReservation}
            onChange={setCpuReservation}
            placeholder="0.5 (cores)"
            step="0.25"
            hint="Guaranteed minimum CPU"
          />
          <ResourceInput
            label="Memory Limit"
            value={memoryLimit}
            onChange={setMemoryLimit}
            placeholder="512 (MB)"
            step="128"
            hint="Hard memory limit in MB"
          />
          <ResourceInput
            label="Memory Reservation"
            value={memoryReservation}
            onChange={setMemoryReservation}
            placeholder="256 (MB)"
            step="128"
            hint="Soft memory limit in MB"
          />
        </div>
        <div className="flex justify-end mt-4">
          <Button size="sm">
            <Save size={14} className="mr-1" />
            Save Resources
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ResourceInput({
  label,
  value,
  onChange,
  placeholder,
  step,
  hint
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  step: string;
  hint: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const n = Math.max(0, (parseFloat(value) || 0) - parseFloat(step));
            onChange(n.toString());
          }}
        >
          −
        </Button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm text-center"
          placeholder={placeholder}
          type="number"
          step={step}
          min="0"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const n = (parseFloat(value) || 0) + parseFloat(step);
            onChange(n.toString());
          }}
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
