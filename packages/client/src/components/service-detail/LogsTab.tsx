import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal as TerminalIcon,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  buildObservabilityWebSocketUrl,
  type ServiceLogLine as LogLine
} from "./observability-client";

interface LogsTabProps {
  serviceId: string;
  serviceName: string;
}

const ANSI_ESCAPE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export default function LogsTab({ serviceId, serviceName }: LogsTabProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isFollowing, setIsFollowing] = useState(true);
  const [tailLines, setTailLines] = useState("200");
  const [searchQuery, setSearchQuery] = useState("");
  const [streamFilter, setStreamFilter] = useState<"all" | "stdout" | "stderr">("all");
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "closed">(
    "connecting"
  );
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connecting to live service logs...");
  const logEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
    }
    setConnectionState("connecting");
    setStatusMessage("Connecting to live service logs...");

    const url = buildObservabilityWebSocketUrl("/ws/container-logs", {
      serviceId,
      tail: tailLines
    });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState("connected");
      setStatusMessage("Streaming live logs.");
    };
    ws.onclose = () => {
      setConnectionState("closed");
      setStatusMessage("Log stream disconnected.");
    };
    ws.onerror = () => {
      setConnectionState("closed");
      setStatusMessage("Log stream unavailable.");
    };
    ws.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data as string) as LogLine;
        setLogs((prev) => [...prev.slice(-2000), line]);
      } catch {
        setLogs((prev) => [
          ...prev.slice(-2000),
          {
            timestamp: new Date().toISOString(),
            message: String(event.data),
            stream: "stdout"
          }
        ]);
      }
    };
  }, [serviceId, tailLines]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWebSocket]);

  useEffect(() => {
    if (isFollowing && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [isFollowing, logs]);

  const filteredLogs = logs
    .filter((line) => streamFilter === "all" || line.stream === streamFilter)
    .filter(
      (line) => !searchQuery || line.message.toLowerCase().includes(searchQuery.toLowerCase())
    );

  function handleDownload() {
    const text = filteredLogs
      .map((line) => `${line.timestamp} [${line.stream}] ${line.message}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${serviceName}-logs-${new Date().toISOString().slice(0, 10)}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    const text = filteredLogs
      .map((line) => `${line.timestamp} [${line.stream}] ${line.message}`)
      .join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function parseAnsi(text: string) {
    return text.replace(ANSI_ESCAPE_REGEX, "");
  }

  return (
    <Card className="shadow-sm" data-testid={`logs-card-${serviceId}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TerminalIcon size={14} />
            Container Logs
            <Badge
              variant={connectionState === "connected" ? "default" : "secondary"}
              data-testid={`logs-status-${serviceId}`}
            >
              {connectionState === "connecting"
                ? "Connecting"
                : connectionState === "connected"
                  ? "Live"
                  : "Disconnected"}
            </Badge>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-md border text-xs">
              {(["all", "stdout", "stderr"] as const).map((stream) => (
                <button
                  key={stream}
                  type="button"
                  data-testid={`logs-filter-${serviceId}-${stream}`}
                  onClick={() => setStreamFilter(stream)}
                  className={`px-2.5 py-1 transition-colors ${
                    streamFilter === stream
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  } ${stream === "all" ? "rounded-l-md" : stream === "stderr" ? "rounded-r-md" : ""}`}
                >
                  {stream === "all" ? "All" : stream}
                </button>
              ))}
            </div>
            <Select value={tailLines} onValueChange={setTailLines}>
              <SelectTrigger className="h-8 w-28 text-xs" data-testid={`logs-tail-${serviceId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">Last 100</SelectItem>
                <SelectItem value="200">Last 200</SelectItem>
                <SelectItem value="500">Last 500</SelectItem>
                <SelectItem value="1000">Last 1000</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={isFollowing ? "default" : "outline"}
              data-testid={`logs-follow-${serviceId}`}
              onClick={() => setIsFollowing((value) => !value)}
            >
              {isFollowing ? (
                <Pause size={14} className="mr-1" />
              ) : (
                <Play size={14} className="mr-1" />
              )}
              {isFollowing ? "Following" : "Follow"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid={`logs-reconnect-${serviceId}`}
              onClick={() => {
                setLogs([]);
                connectWebSocket();
              }}
            >
              <RefreshCw size={14} className="mr-1" />
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Clear logs"
              data-testid={`logs-clear-${serviceId}`}
              onClick={() => setLogs([])}
            >
              <Trash2 size={14} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Copy logs"
              data-testid={`logs-copy-${serviceId}`}
              onClick={handleCopy}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Download logs"
              data-testid={`logs-download-${serviceId}`}
              onClick={handleDownload}
            >
              <Download size={14} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchQuery}
            placeholder="Search logs..."
            className="h-8 pl-9 text-sm"
            data-testid={`logs-search-${serviceId}`}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
              {filteredLogs.length} matches
            </span>
          )}
        </div>

        <div
          className="h-[500px] overflow-y-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
          data-testid={`logs-output-${serviceId}`}
        >
          {filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500">
              {connectionState === "connecting" ? (
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  {statusMessage}
                </div>
              ) : (
                statusMessage
              )}
            </div>
          ) : (
            filteredLogs.map((line, index) => (
              <div
                key={`${line.timestamp}-${index}`}
                className={`flex gap-2 py-0.5 hover:bg-white/5 ${
                  line.stream === "stderr" ? "text-red-400" : "text-zinc-300"
                }`}
                data-testid={`logs-line-${serviceId}`}
              >
                <span className="shrink-0 select-none text-zinc-500">
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
