export const AutoTrackIcon = ({ enabled, className }: { enabled?: boolean; className?: string }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.5" fill="none" />
    {enabled ? (
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6" />
    ) : null}
  </svg>
);


