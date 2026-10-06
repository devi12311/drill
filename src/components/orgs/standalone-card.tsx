import { BrandMark } from "@/components/shell/brand-mark";

/**
 * The centred card the auth screens use, for the pages that live outside the
 * app shell (an invitation, the no-org screen): reachable by someone who has no
 * org yet, so they cannot depend on the session the shell provides.
 */
export function StandaloneCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex h-dvh items-center justify-center bg-background px-6">
      <div className="w-full max-w-[420px]">
        <BrandMark className="mb-8" />
        <div className="space-y-5 rounded-lg border border-border bg-smoked-onyx p-6">
          <h1 className="text-heading-sm text-warm-off-white">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
