import { Suspense } from "react";
import { Sidebar } from "@/components/chat/sidebar";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";

/**
 * Workspace SHELL: the chat sidebar and the state behind it, kept mounted while
 * the user moves between chat, Resolutions and Skills — the same split
 * the admin panel makes (docs/DECISIONS.md, 40 and 52; this is 116). Pages only
 * fill the region next to the sidebar. Route groups are invisible, so /chat,
 * /skills and /resolutions keep their URLs.
 */
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <div className="flex min-h-0 w-full flex-1">
        {/* The sidebar reads `?c=` to highlight the open conversation. */}
        <Suspense fallback={<div className="w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar" />}>
          <Sidebar />
        </Suspense>
        {children}
      </div>
    </WorkspaceProvider>
  );
}
