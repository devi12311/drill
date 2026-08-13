/**
 * Page chrome for ordinary admin pages: one scrolling, centred reading column.
 *
 * Split out of the admin shell so a section can opt out of it — `monitoring/`
 * renders its own navigation column flush against the sidebar instead. Route
 * groups are invisible in URLs, so every page under here keeps its path.
 */
export default function AdminPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      {/* pb-20 keeps the last row clear of the mode island. */}
      <div className="mx-auto w-full max-w-[1100px] px-8 pb-20 pt-8">
        {children}
      </div>
    </main>
  );
}
