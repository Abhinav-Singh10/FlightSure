type IconProps = { className?: string };

export function PlaneIcon({ className }: IconProps) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m22 2-1 5-6 6 2 8-2 2-4-7-4 3v3l-2 1-1-5-5-1 1-2h3l3-4-7-4 2-2 8 2 6-6Z" />
  </svg>;
}
