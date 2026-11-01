import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function AuthDialog({ children, onClose, label = 'Your FlightSure account' }: { children: ReactNode; onClose: () => void; label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} aria-label={label} className="account-dialog"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {children}
  </dialog>;
}
