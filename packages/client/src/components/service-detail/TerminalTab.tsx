import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal as TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface TerminalTabProps {
  serviceId: string;
  containerId?: string;
  serverId?: string;
}

export default function TerminalTab({ serviceId, containerId, serverId }: TerminalTabProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const [shell, setShell] = useState("bash");
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef("");

  useEffect(() => {
    if (!termRef.current) return;

    const container = termRef.current;
    container.innerHTML = "";

    // Create a simple terminal display
    const display = document.createElement("div");
    display.className = "terminal-display";
    display.style.cssText =
      "width:100%;height:100%;overflow-y:auto;padding:8px;font-family:monospace;font-size:13px;line-height:1.6;color:#e4e4e7;background:transparent;outline:none;";
    display.contentEditable = "true";
    display.spellcheck = false;
    container.appendChild(display);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const target = containerId ?? serviceId;
    const url = `${protocol}//${window.location.host}/ws/docker-terminal?containerId=${target}&shell=${shell}${serverId ? `&serverId=${serverId}` : ""}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        appendToTerminal(display, `Connected to ${target} (${shell})\r\n`, "green");
      };

      ws.onclose = () => {
        setIsConnected(false);
        appendToTerminal(display, "\r\nConnection closed.\r\n", "gray");
      };

      ws.onerror = () => {
        setIsConnected(false);
        appendToTerminal(
          display,
          "\r\nTerminal connection unavailable. Ensure the WebSocket endpoint is configured.\r\n",
          "yellow"
        );
      };

      ws.onmessage = (event) => {
        appendToTerminal(display, event.data as string, "inherit");
      };

      // Capture keypress events
      display.addEventListener("keydown", (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        e.preventDefault();

        if (e.key === "Enter") {
          ws.send(inputBufferRef.current + "\n");
          inputBufferRef.current = "";
        } else if (e.key === "Backspace") {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          ws.send("\x7f");
        } else if (e.key.length === 1) {
          inputBufferRef.current += e.key;
          ws.send(e.key);
        } else if (e.ctrlKey && e.key === "c") {
          ws.send("\x03");
          inputBufferRef.current = "";
        } else if (e.ctrlKey && e.key === "d") {
          ws.send("\x04");
        }
      });
    } catch {
      setIsConnected(false);
    }

    return () => {
      wsRef.current?.close();
    };
  }, [serviceId, containerId, shell, serverId]);

  function appendToTerminal(display: HTMLElement, text: string, color: string) {
    const span = document.createElement("span");
    span.style.color = color;
    span.textContent = text;
    display.appendChild(span);
    display.scrollTop = display.scrollHeight;
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TerminalIcon size={14} />
            Docker Terminal
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </CardTitle>
          <Tabs value={shell} onValueChange={setShell}>
            <TabsList className="h-8">
              <TabsTrigger value="bash" className="text-xs px-3 h-6">
                Bash
              </TabsTrigger>
              <TabsTrigger value="sh" className="text-xs px-3 h-6">
                /bin/sh
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <div
          className="bg-[#0d1117] rounded-lg border border-white/10 h-[500px] overflow-hidden cursor-text"
          ref={termRef}
          onClick={() => {
            // Focus the terminal display
            const display = termRef.current?.querySelector(".terminal-display") as HTMLElement;
            display?.focus();
          }}
        />
        <p className="text-xs text-muted-foreground mt-2">
          Type commands and press Enter. Ctrl+C to interrupt, Ctrl+D to detach.
        </p>
      </CardContent>
    </Card>
  );
}
