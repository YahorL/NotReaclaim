import type { ReactNode } from 'react';
import { FieldBox } from './FieldBox';
import { FIELD_ERROR } from './formStyles';

/** A labelled FieldBox with its validation line underneath (rendered only while `error` is set). */
export function FormField({ label, error, errorTestId, className, children }: {
  label: string;
  error?: string;
  errorTestId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <FieldBox label={label}>{children}</FieldBox>
      {error && <p data-testid={errorTestId} className={FIELD_ERROR}>{error}</p>}
    </div>
  );
}
