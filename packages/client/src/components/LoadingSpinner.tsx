interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export function LoadingSpinner({ size = "md", label }: LoadingSpinnerProps) {
  return (
    <div className={`df-spinner df-spinner--${size}`} role="status">
      <svg className="df-spinner__svg" viewBox="0 0 24 24" fill="none">
        <circle
          className="df-spinner__track"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.2"
        />
        <path
          className="df-spinner__arc"
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="df-spinner__label">{label}</span>}
    </div>
  );
}
