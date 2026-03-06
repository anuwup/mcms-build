import { HugeiconsIcon } from '@hugeicons/react';

/**
 * Wrapper around HugeiconsIcon for consistent usage with size, className, and style (e.g. color).
 */
export default function Icon({ icon, size = 24, className, style, ...rest }) {
  if (icon == null || !Array.isArray(icon)) {
    return null;
  }
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      color={style?.color ?? 'currentColor'}
      className={className}
      {...rest}
    />
  );
}
