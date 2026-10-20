"use client";

import { usePathname } from "next/navigation";
import { FolderGit2, GitBranch } from "lucide-react";
import {
  NavTreeAdd,
  NavTreeBranch,
  NavTreeColumn,
  NavTreeEmpty,
  NavTreeEmptyChild,
  NavTreeLeaf,
  NavTreeSkeleton,
} from "@/components/admin/nav-tree";
import { HEALTH_DOT, type Health } from "@/lib/health";
import type { BranchSyncState } from "@/lib/git/types";
import { SYNC_DOT, SYNC_LABEL } from "@/lib/git/ui";
import { cn } from "@/lib/utils";

export interface TreeConnection {
  id: string;
  name: string;
  /** Derived on the server (lib/health.ts), so the dot never flips on hydration. */
  health: Health;
  healthTitle: string;
}

export interface TreeRepo {
  id: string;
  connectionId: string;
  name: string;
  state: BranchSyncState;
}

const TITLE = "Git repositories";

/** Connections as collapsible roots, their synced repositories as children. */
export function GitTree({ connections, repos }: { connections: TreeConnection[]; repos: TreeRepo[] }) {
  const pathname = usePathname();
  return (
    <NavTreeColumn icon={FolderGit2} title={TITLE}>
      {connections.length === 0 ? (
        <NavTreeEmpty>No connections yet.</NavTreeEmpty>
      ) : (
        connections.map((c) => {
          const href = `/admin/git/connections/${c.id}`;
          const own = repos.filter((r) => r.connectionId === c.id);
          return (
            <NavTreeBranch
              key={c.id}
              href={href}
              label={c.name}
              pathname={pathname}
              // Repository pages live under /admin/git/repos/, not under the connection.
              inside={pathname.startsWith(href) || own.some((r) => pathname.startsWith(`/admin/git/repos/${r.id}`))}
              dot={{ className: HEALTH_DOT[c.health], title: c.healthTitle }}
            >
              {own.length === 0 ? (
                <NavTreeEmptyChild>No repositories yet</NavTreeEmptyChild>
              ) : (
                own.map((r) => {
                  const repoHref = `/admin/git/repos/${r.id}`;
                  return (
                    <NavTreeLeaf
                      key={r.id}
                      href={repoHref}
                      icon={GitBranch}
                      label={r.name}
                      active={pathname.startsWith(repoHref)}
                      badge={
                        <span
                          aria-label={SYNC_LABEL[r.state]}
                          title={SYNC_LABEL[r.state]}
                          className={cn(
                            "block size-1.5 rounded-full",
                            SYNC_DOT[r.state],
                            r.state === "syncing" && "animate-pulse",
                          )}
                        />
                      }
                    />
                  );
                })
              )}
              <NavTreeAdd href={`${href}?add=1`} label="Add repositories" active={false} nested />
            </NavTreeBranch>
          );
        })
      )}
      <NavTreeAdd href="/admin/git" label="Connect an account" active={pathname === "/admin/git"} />
    </NavTreeColumn>
  );
}

export function GitTreeSkeleton() {
  return <NavTreeSkeleton icon={FolderGit2} title={TITLE} />;
}
