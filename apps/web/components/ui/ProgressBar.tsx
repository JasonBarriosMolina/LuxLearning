interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
};

export function ProgressBar({ value, label, showPercent = false, size = 'md' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex flex-col gap-1.5">
      {(label || showPercent) && (
        <div className="flex justify-between items-center">
          {label && <span className="text-xs text-gray-500 font-medium">{label}</span>}
          {showPercent && <span className="text-xs font-semibold text-charcoal">{clamped}%</span>}
        </div>
      )}
      <div className={`progress-bar ${sizeClasses[size]}`}>
        <div
          className="progress-bar-fill"
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
