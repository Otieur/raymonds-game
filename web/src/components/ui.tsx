import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/** CSS custom properties as an inline style. */
export function vars(values: Record<string, string | number>): CSSProperties {
  return values as CSSProperties;
}

/** A wuzhu coin: round, with a square hole. */
export function Coin() {
  return (
    <svg className="coin" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.4" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <rect x="7.1" y="7.1" width="5.8" height="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Money({ amount, signed = false }: { amount: number; signed?: boolean }) {
  const sign = signed ? (amount < 0 ? '−' : '+') : '';
  return (
    <span className="money">
      <Coin />
      {sign}
      {Math.abs(amount).toLocaleString('en-US')}
    </span>
  );
}

type Tone = 'primary' | 'plain' | 'ghost' | 'danger';

export function Btn({
  tone = 'plain',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type="button" className={`btn btn-${tone} ${className}`} {...rest} />;
}

export function Modal({
  onClose,
  children,
  className = '',
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="veil" onClick={onClose}>
      <div className={`modal panel ${className}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

/** A picture that cross-fades whenever its source changes. */
export function CrossFade({ src, className }: { src: string; className: string }) {
  const [layers, setLayers] = useState<[string, string]>([src, src]);
  useEffect(() => {
    setLayers(([, shown]) => (shown === src ? [shown, shown] : [shown, src]));
  }, [src]);
  return (
    <div className={className} aria-hidden="true">
      <div className="fade-layer" style={{ backgroundImage: `url(${layers[0]})` }} />
      <div key={layers[1]} className="fade-layer fade-in" style={{ backgroundImage: `url(${layers[1]})` }} />
    </div>
  );
}
