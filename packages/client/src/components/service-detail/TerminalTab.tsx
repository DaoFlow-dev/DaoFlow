import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildObservabilityWebSocketUrl } from "./observability-client";

interface TerminalTabProps {
  serviceId: string;
}

export default function TerminalTab({ serviceId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [shell, setShell] = useState("bash");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const display = displayRef.current;
    const input = inputRef.current;
    if (!display || !input) return;

    display.textContent = "";

    const url = buildObservabilityWebSocketUrl("/ws/docker-terminal", {
      serviceId,
      shell
    });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      appendText(display, `Connected to ${serviceId} (${shell})\r\n`, "#22c55e");
      input.focus();
    };
    ws.onclose = () => {
      setIsConnected(false);
      appendText(display, "\r\nConnection closed.\r\n", "#a1a1aa");
    };
    ws.onerror = () => {
      setIsConnected(false);
      appendText(display, "\r\nTerminal connection unavailable.\r\n", "#facc15");
    };
    ws.onmessage = (event) => {
      appendText(display, String(event.data), "inherit");
    };

    const handleKey = (e: KeyboardEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      e.preventDefault();

      if (e.key === "Enter") {
        ws.send("\n");
      } else if (e.key === "Backspace") {
        ws.send("\x7f");
      } else if (e.key === "Tab") {
        ws.send("\t");
      } else if (e.key === "ArrowUp") {
        ws.send("\x1b[A");
      } else if (e.key === "ArrowDown") {
        ws.send("\x1b[B");
      } else if (e.key === "ArrowRight") {
        ws.send("\x1b[C");
      } else if (e.key === "ArrowLeft") {
        ws.send("\x1b[D");
      } else if (e.key === "Escape") {
        ws.send("\x1b");
      } else if (e.ctrlKey && e.key === "c") {
        ws.send("\x03");
      } else if (e.ctrlKey && e.key === "d") {
        ws.send("\x04");
      } else if (e.ctrlKey && e.key === "l") {
        ws.send("\x0c");
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        ws.send(e.key);
      }
    };

    input.addEventListener("keydown", handleKey);
    return () => {
      input.removeEventListener("keydown", handleKey);
      ws.close();
    };
  }, [serviceId, shell]);

  return (
    <Card className="shadow-sm" data-testid={`terminal-card-${serviceId}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TerminalIcon size={14} />
            Docker Terminal
            <Badge
              variant={isConnected ? "default" : "secondary"}
              data-testid={`terminal-status-${serviceId}`}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </CardTitle>
          <Tabs value={shell} onValueChange={setShell}>
            <TabsList className="h-8">
              <TabsTrigger
                value="bash"
                className="h-6 px-3 text-xs"
                data-testid={`terminal-shell-${serviceId}-bash`}
              >
                Bash
              </TabsTrigger>
              <TabsTrigger
                value="sh"
                className="h-6 px-3 text-xs"
                data-testid={`terminal-shell-${serviceId}-sh`}
              >
                /bin/sh
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className="relative h-[500px] cursor-text overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
          data-testid={`terminal-output-${serviceId}`}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Visible output — read-only */}
          <pre
            ref={displayRef}
            className="h-full w-full overflow-y-auto whitespace-pre-wrap break-all p-3 font-mono text-[13px] leading-relaxed text-zinc-200"
          />

          {/* Hidden textarea captures keyboard input without rendering text */}
          <textarea
            ref={inputRef}
            aria-label="Terminal input"
            className="absolute top-0 left-0 h-0 w-0 opacity-0"
            autoFocus
          />
        </div>
        <p
          className="mt-2 text-xs text-muted-foreground"
          data-testid={`terminal-help-${serviceId}`}
        >
          Type commands and press Enter. Ctrl+C to interrupt, Ctrl+D to detach.
        </p>
      </CardContent>
    </Card>
  );
}

function appendText(container: HTMLElement, text: string, color: string) {
  const span = document.createElement("span");
  span.style.color = color;
  span.textContent = text;
  container.appendChild(span);
  container.scrollTop = container.scrollHeight;
}
