import { useState, useCallback, useEffect } from "react";
import { registerToastDispatcher, type ToastType } from "../lib/toast";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let toastId = 0;

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
    registerToastDispatcher(add);
    return () => {
      registerToastDispatcher(null);
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
