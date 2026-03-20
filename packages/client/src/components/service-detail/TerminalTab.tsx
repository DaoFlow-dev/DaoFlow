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
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef("");
  const [shell, setShell] = useState("bash");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!termRef.current) {
      return;
    }

    const container = termRef.current;
    container.innerHTML = "";
    const display = document.createElement("div");
    display.className = "terminal-display";
    display.style.cssText =
      "width:100%;height:100%;overflow-y:auto;padding:8px;font-family:monospace;font-size:13px;line-height:1.6;color:#d4d4d8;background:transparent;outline:none;";
    display.contentEditable = "true";
    display.spellcheck = false;
    container.appendChild(display);

    const url = buildObservabilityWebSocketUrl("/ws/docker-terminal", {
      serviceId,
      shell
    });
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      appendToTerminal(display, `Connected to ${serviceId} (${shell})\r\n`, "#22c55e");
    };
    ws.onclose = () => {
      setIsConnected(false);
      appendToTerminal(display, "\r\nConnection closed.\r\n", "#a1a1aa");
    };
    ws.onerror = () => {
      setIsConnected(false);
      appendToTerminal(display, "\r\nTerminal connection unavailable.\r\n", "#facc15");
    };
    ws.onmessage = (event) => {
      appendToTerminal(display, String(event.data), "inherit");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      event.preventDefault();
      if (event.key === "Enter") {
        ws.send(`${inputBufferRef.current}\n`);
        inputBufferRef.current = "";
      } else if (event.key === "Backspace") {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        ws.send("\x7f");
      } else if (event.ctrlKey && event.key === "c") {
        ws.send("\x03");
        inputBufferRef.current = "";
      } else if (event.ctrlKey && event.key === "d") {
        ws.send("\x04");
      } else if (event.key.length === 1) {
        inputBufferRef.current += event.key;
        ws.send(event.key);
      }
    };

    display.addEventListener("keydown", handleKeyDown);

    return () => {
      display.removeEventListener("keydown", handleKeyDown);
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
          ref={termRef}
          className="h-[500px] cursor-text overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
          data-testid={`terminal-output-${serviceId}`}
          onClick={() => {
            const display = termRef.current?.querySelector(
              ".terminal-display"
            ) as HTMLElement | null;
            display?.focus();
          }}
        />
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

function appendToTerminal(display: HTMLElement, text: string, color: string) {
  const span = document.createElement("span");
  span.style.color = color;
  span.textContent = text;
  display.appendChild(span);
  display.scrollTop = display.scrollHeight;
}
