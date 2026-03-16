import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="df-modal-overlay" onClick={onClose}>
      <div
        className={`df-modal df-modal--${size}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="df-modal__header">
            <h2 className="df-modal__title">{title}</h2>
            <button className="df-modal__close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="df-modal__body">{children}</div>
        {footer && <div className="df-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
