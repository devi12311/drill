import "server-only";
import type { GitProvider } from "@/lib/git/types";
import { bitbucket } from "./bitbucket";
import { github } from "./github";
import type { GitProviderClient } from "./types";

export const PROVIDERS: Record<GitProvider, GitProviderClient> = { github, bitbucket };

export { isFullName } from "./types";
