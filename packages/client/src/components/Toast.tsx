import { useState, useCallback, useEffect, type ReactNode } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;
let externalAdd: ((msg: string, type: ToastType) => void) | null = null;

/**
 * Imperative toast trigger — call from anywhere.
 *
 *   toast.success("Deployment started");
 *   toast.error("Server unreachable");
 */
export const toast = {
  success: (msg: string) => externalAdd?.(msg, "success"),
  error: (msg: string) => externalAdd?.(msg, "error"),
  warning: (msg: string) => externalAdd?.(msg, "warning"),
  info: (msg: string) => externalAdd?.(msg, "info")
};

/**
 * Mount once at app root.
 */
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const add = useCallback((message: string, type: ToastType) => {
    const id = ++toastId;
    setItems((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => {
    externalAdd = add;
    return () => {
      externalAdd = null;
    };
  }, [add]);

  if (items.length === 0) return null;

  return (
    <div className="df-toast-container">
      {items.map((item) => (
        <div key={item.id} className={`df-toast df-toast--${item.type}`}>
          <span>{item.message}</span>
          <button
            className="df-toast__dismiss"
            onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
