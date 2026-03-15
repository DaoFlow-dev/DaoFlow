import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  isPending?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Confirm Action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isPending = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="df-confirm__actions">
          <button className="df-btn df-btn--ghost" onClick={onClose} disabled={isPending}>
            {cancelLabel}
          </button>
          <button
            className={`df-btn ${variant === "danger" ? "df-btn--danger" : "df-btn--primary"}`}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Processing..." : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="df-confirm__message">{message}</p>
    </Modal>
  );
}
