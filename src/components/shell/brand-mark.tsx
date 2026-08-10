/**
 * The DRILL wordmark + tracked eyebrow. One definition for the chat sidebar,
 * the admin sidebar and the auth screens (they had three copies).
 */
export function BrandMark({
  eyebrow = "Root cause, on demand",
  className,
}: {
  eyebrow?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="font-mono text-body font-medium tracking-[0.2em] text-warm-off-white">
        DRILL
      </div>
      <div className="text-caption-tracked mt-1 uppercase text-bone-gray">
        {eyebrow}
      </div>
    </div>
  );
}
