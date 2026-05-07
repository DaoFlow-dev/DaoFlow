import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildObservabilityWebSocketUrl } from "@/components/service-detail/observability-client";

export function HostTerminalTab({ serverId }: { serverId: string }) {
  const displayRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [shell, setShell] = useState("bash");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const display = displayRef.current;
    const input = inputRef.current;
    if (!display || !input) return;

    display.textContent = "";
    const ws = new WebSocket(
      buildObservabilityWebSocketUrl("/ws/host-terminal", { serverId, shell })
    );

    ws.onopen = () => {
      setIsConnected(true);
      appendText(display, `Connected to host ${serverId} (${shell})\r\n`, "#22c55e");
      input.focus();
    };
    ws.onclose = () => {
      setIsConnected(false);
      appendText(display, "\r\nConnection closed.\r\n", "#a1a1aa");
    };
    ws.onerror = () => {
      setIsConnected(false);
      appendText(display, "\r\nHost terminal unavailable.\r\n", "#facc15");
    };
    ws.onmessage = (event) => appendText(display, String(event.data), "inherit");

    const handleKey = (event: KeyboardEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      event.preventDefault();

      if (event.key === "Enter") ws.send("\n");
      else if (event.key === "Backspace") ws.send("\x7f");
      else if (event.key === "Tab") ws.send("\t");
      else if (event.key === "ArrowUp") ws.send("\x1b[A");
      else if (event.key === "ArrowDown") ws.send("\x1b[B");
      else if (event.key === "ArrowRight") ws.send("\x1b[C");
      else if (event.key === "ArrowLeft") ws.send("\x1b[D");
      else if (event.key === "Escape") ws.send("\x1b");
      else if (event.ctrlKey && event.key === "c") ws.send("\x03");
      else if (event.ctrlKey && event.key === "d") ws.send("\x04");
      else if (event.ctrlKey && event.key === "l") ws.send("\x0c");
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) ws.send(event.key);
    };

    input.addEventListener("keydown", handleKey);
    return () => {
      input.removeEventListener("keydown", handleKey);
      ws.close();
    };
  }, [serverId, shell]);

  return (
    <Card className="shadow-sm" data-testid={`host-terminal-card-${serverId}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TerminalIcon size={14} />
            Host Terminal
            <Badge
              variant={isConnected ? "default" : "secondary"}
              data-testid={`host-terminal-status-${serverId}`}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </CardTitle>
          <Tabs value={shell} onValueChange={setShell}>
            <TabsList className="h-8">
              <TabsTrigger value="bash" className="h-6 px-3 text-xs">
                Bash
              </TabsTrigger>
              <TabsTrigger value="sh" className="h-6 px-3 text-xs">
                /bin/sh
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="relative h-[500px] cursor-text overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
          data-testid={`host-terminal-output-${serverId}`}
          onClick={() => inputRef.current?.focus()}
        >
          <pre
            ref={displayRef}
            className="h-full w-full overflow-y-auto whitespace-pre-wrap break-all p-3 font-mono text-[13px] leading-relaxed text-zinc-200"
          />
          <textarea
            ref={inputRef}
            aria-label="Host terminal input"
            className="absolute top-0 left-0 h-0 w-0 opacity-0"
            autoFocus
          />
        </div>
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
