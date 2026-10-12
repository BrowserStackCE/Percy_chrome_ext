interface TokenRequiredNoticeProps {
  message?: string;
  onOpenSettings?: () => void;
}

export function TokenRequiredNotice({
  message = 'A Percy token is required for this action.',
  onOpenSettings,
}: TokenRequiredNoticeProps) {
  return (
    <div className="token-notice" role="alert">
      <span>{message}</span>
      {onOpenSettings && (
        <button
          type="button"
          className="button button--link"
          onClick={onOpenSettings}
        >
          Set token (⚙) →
        </button>
      )}
    </div>
  );
}