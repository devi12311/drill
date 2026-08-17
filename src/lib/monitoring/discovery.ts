import "server-only";
import { AppsV1Api, KubeConfig } from "@kubernetes/client-node";
import { detectTechnology } from "./technology";
import type { WorkloadKind, WorkloadTechnology } from "./types";

/**
 * Workload discovery — the ONLY thing Drill uses a cluster's kubeconfig for.
 * It populates the job picker; all actual investigating is done by the Holmes
 * deployment living in that cluster (docs/DECISIONS.md).
 *
 * The kubeconfig is never written to disk: Drill's pod runs with
 * `readOnlyRootFilesystem`, so it is loaded from the string every time.
 */

const DISCOVERY_TIMEOUT_MS = 15_000;

export interface DiscoveredWorkload {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  replicas: number | null;
  images: string[];
  /** Best guess at the software inside, or null when nothing is recognised. */
  technology: WorkloadTechnology | null;
  /** How the guess was reached, so the picker can justify it. */
  technologyReason: string | null;
}

export interface DiscoveryResult {
  workloads: DiscoveredWorkload[];
  contextName: string;
  server: string;
}

/**
 * Parse a pasted kubeconfig and reject the shapes that cannot work inside a
 * container. Throws with a user-facing message (same contract as
 * `validateAgent` in lib/holmes/validate.ts).
 */
function loadKubeconfig(text: string): KubeConfig {
  const kc = new KubeConfig();
  try {
    kc.loadFromString(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse the kubeconfig: ${detail}`);
  }

  const context = kc.getCurrentContext();
  if (!context) throw new Error("The kubeconfig has no current-context set");
  const cluster = kc.getCurrentCluster();
  if (!cluster?.server)
    throw new Error(
      `The kubeconfig's current context (${context}) has no cluster server URL`,
    );

  const user = kc.getCurrentUser();
  // Cloud auth plugins shell out to a binary that does not exist in this
  // container, and would fail at request time with an opaque ENOENT.
  if (user?.exec)
    throw new Error(
      "This kubeconfig uses exec-based authentication (e.g. gke-gcloud-auth-plugin, " +
        "aws-iam-authenticator, kubelogin), which cannot run inside Drill's container. " +
        "Paste a kubeconfig with a static ServiceAccount token or client certificate instead.",
    );
  if (user?.authProvider)
    throw new Error(
      "This kubeconfig uses an auth-provider plugin, which Drill cannot refresh. " +
        "Paste a kubeconfig with a static ServiceAccount token or client certificate instead.",
    );
  // File references resolve against Drill's filesystem, not the author's laptop.
  const fileRefs = [
    user?.certFile && "client-certificate",
    user?.keyFile && "client-key",
    cluster.caFile && "certificate-authority",
  ].filter(Boolean);
  if (fileRefs.length > 0)
    throw new Error(
      `This kubeconfig points at local files (${fileRefs.join(", ")}). ` +
        "Paste a self-contained kubeconfig that inlines the *-data fields instead.",
    );
  if (!user?.token && !user?.certData && !user?.password)
    throw new Error(
      "The kubeconfig's current user has no usable credentials (expected a token or client certificate)",
    );

  return kc;
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s while ${what} — is the API server reachable from Drill?`,
            ),
          ),
        DISCOVERY_TIMEOUT_MS,
      ),
    ),
  ]);
}

interface WorkloadListItem {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: {
    replicas?: number;
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: { containers?: { image?: string; name?: string }[] };
    };
  };
}

function mapItems(
  items: WorkloadListItem[] | undefined,
  kind: WorkloadKind,
): DiscoveredWorkload[] {
  return (items ?? [])
    .filter((item) => item.metadata?.name && item.metadata?.namespace)
    .map((item) => {
      const containers = item.spec?.template?.spec?.containers ?? [];
      const images = containers
        .map((c) => c.image)
        .filter((image): image is string => Boolean(image));
      // Pod-template labels win: they are the selector labels, so they describe
      // what actually runs, while the workload's own labels are often just
      // packaging metadata from whatever installed it.
      const guess = detectTechnology({
        images,
        labels: { ...item.metadata?.labels, ...item.spec?.template?.metadata?.labels },
        containerNames: containers
          .map((c) => c.name)
          .filter((name): name is string => Boolean(name)),
      });
      return {
        kind,
        namespace: item.metadata!.namespace!,
        name: item.metadata!.name!,
        replicas: item.spec?.replicas ?? null,
        images,
        technology: guess?.technology ?? null,
        technologyReason: guess?.reason ?? null,
      };
    });
}

/**
 * List every Deployment and StatefulSet the kubeconfig's credentials can see.
 * A partial failure is NOT swallowed — half an inventory would silently hide
 * workloads from the picker.
 */
export async function discoverWorkloads(
  kubeconfig: string,
): Promise<DiscoveryResult> {
  const kc = loadKubeconfig(kubeconfig);
  const api = kc.makeApiClient(AppsV1Api);

  const [deployments, statefulSets] = await Promise.all([
    withTimeout(
      api.listDeploymentForAllNamespaces(),
      "listing deployments",
    ).catch((err) => {
      throw describeApiError(err, "deployments");
    }),
    withTimeout(
      api.listStatefulSetForAllNamespaces(),
      "listing statefulsets",
    ).catch((err) => {
      throw describeApiError(err, "statefulsets");
    }),
  ]);

  return {
    workloads: [
      ...mapItems(deployments.items, "deployment"),
      ...mapItems(statefulSets.items, "statefulset"),
    ],
    contextName: kc.getCurrentContext(),
    server: kc.getCurrentCluster()?.server ?? "",
  };
}

/** Turn a k8s client error into something an admin can act on. */
function describeApiError(err: unknown, what: string): Error {
  if (err instanceof Error && err.message.startsWith("Timed out")) return err;
  const status = (err as { code?: number; statusCode?: number })?.code ??
    (err as { statusCode?: number })?.statusCode;
  if (status === 401)
    return new Error(
      "The cluster rejected the kubeconfig credentials (401 Unauthorized)",
    );
  if (status === 403)
    return new Error(
      `The kubeconfig's credentials may not list ${what} cluster-wide (403 Forbidden) — grant read access on apps/deployments and apps/statefulsets`,
    );
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`Could not list ${what}: ${detail}`);
}

/** Cheap credential check for the cluster form — same failure messages. */
export async function validateKubeconfig(
  kubeconfig: string,
): Promise<{ contextName: string; server: string; workloadCount: number }> {
  const result = await discoverWorkloads(kubeconfig);
  return {
    contextName: result.contextName,
    server: result.server,
    workloadCount: result.workloads.length,
  };
}
