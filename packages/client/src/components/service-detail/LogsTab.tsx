import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Terminal as TerminalIcon,
  Download,
  Search,
  Pause,
  Play,
  Loader2,
  RefreshCw,
  Trash2,
  Copy,
  Check
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";

interface LogsTabProps {
  serviceId: string;
  serviceName: string;
}

interface LogLine {
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
}

export default function LogsTab({ serviceId, serviceName }: LogsTabProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isFollowing, setIsFollowing] = useState(true);
  const [tailLines, setTailLines] = useState("200");
  const [searchQuery, setSearchQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [isConnected, setIsConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/container-logs?serviceId=${serviceId}&tail=${tailLines}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => setIsConnected(false);
      ws.onerror = () => setIsConnected(false);

      ws.onmessage = (event) => {
        try {
          const line = JSON.parse(event.data as string) as LogLine;
          setLogs((prev) => [...prev.slice(-2000), line]);
        } catch {
          setLogs((prev) => [
            ...prev.slice(-2000),
            {
              timestamp: new Date().toISOString(),
              message: event.data as string,
              stream: "stdout"
            }
          ]);
        }
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      wsRef.current?.close();
    };
  }, [serviceId, tailLines]);

  useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  useEffect(() => {
    if (isFollowing && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isFollowing]);

  const filteredLogs = logs
    .filter((l) => streamFilter === "all" || l.stream === streamFilter)
    .filter((l) => !searchQuery || l.message.toLowerCase().includes(searchQuery.toLowerCase()));

  function handleDownload() {
    const text = filteredLogs.map((l) => `${l.timestamp} [${l.stream}] ${l.message}`).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${serviceName}-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    const text = filteredLogs.map((l) => `${l.timestamp} [${l.stream}] ${l.message}`).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function parseAnsi(text: string): string {
    // Strip ANSI escape codes for plain text display
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TerminalIcon size={14} />
            Container Logs
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? "Live" : "Disconnected"}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Stream filter */}
            <div className="flex items-center rounded-md border text-xs">
              {(["all", "stdout", "stderr"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStreamFilter(s)}
                  className={`px-2.5 py-1 transition-colors ${
                    streamFilter === s ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  } ${s === "all" ? "rounded-l-md" : s === "stderr" ? "rounded-r-md" : ""}`}
                >
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>

            {/* Tail selector */}
            <Select value={tailLines} onValueChange={setTailLines}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">Last 100</SelectItem>
                <SelectItem value="200">Last 200</SelectItem>
                <SelectItem value="500">Last 500</SelectItem>
                <SelectItem value="1000">Last 1000</SelectItem>
              </SelectContent>
            </Select>

            {/* Follow toggle */}
            <Button
              size="sm"
              variant={isFollowing ? "default" : "outline"}
              onClick={() => setIsFollowing(!isFollowing)}
            >
              {isFollowing ? (
                <Pause size={14} className="mr-1" />
              ) : (
                <Play size={14} className="mr-1" />
              )}
              {isFollowing ? "Following" : "Follow"}
            </Button>

            {/* Reconnect */}
            {!isConnected && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLogs([]);
                  connectWebSocket();
                }}
              >
                <RefreshCw size={14} className="mr-1" />
                Reconnect
              </Button>
            )}

            {/* Clear */}
            <Button size="sm" variant="outline" onClick={() => setLogs([])} title="Clear logs">
              <Trash2 size={14} />
            </Button>

            {/* Copy */}
            <Button size="sm" variant="outline" onClick={handleCopy} title="Copy logs">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>

            {/* Download */}
            <Button size="sm" variant="outline" onClick={handleDownload} title="Download logs">
              <Download size={14} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search */}
        <div className="mb-3 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
          {searchQuery && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {filteredLogs.length} matches
            </span>
          )}
        </div>

        {/* Log output */}
        <div className="bg-[#0d1117] rounded-lg p-3 h-[500px] overflow-y-auto font-mono text-xs leading-relaxed">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              {isConnected ? (
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Waiting for logs...
                </div>
              ) : (
                "No logs available. Container may not be running."
              )}
            </div>
          ) : (
            filteredLogs.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 flex gap-2 hover:bg-white/5 ${
                  line.stream === "stderr" ? "text-red-400" : "text-gray-300"
                }`}
              >
                <span className="text-gray-600 shrink-0 select-none">
                  {new Date(line.timestamp).toLocaleTimeString()}
                </span>
                <span className="break-all">{parseAnsi(line.message)}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </CardContent>
    </Card>
  );
}
