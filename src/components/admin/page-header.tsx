/**
 * Standard header for an admin page: title, optional one-line description, and
 * right-aligned controls (range picker, export, row actions). Every admin page
 * uses this so titles, spacing and control alignment can't drift apart.
 */
export function AdminPageHeader({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-heading-sm text-warm-off-white">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[70ch] text-body-sm text-bone-gray">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-3">{children}</div>
      )}
    </div>
  );
}
