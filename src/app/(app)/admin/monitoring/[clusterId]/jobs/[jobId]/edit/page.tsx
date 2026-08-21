import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/monitoring/types";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { JobForm } from "@/components/monitoring/job-form";
import {
  getJob,
  listJobOverrides,
  listWorkloads,
} from "@/lib/db/monitoring-queries";
import { checkRubricItems } from "@/lib/monitoring/checks";

/** Retune a job. Server-rendered for the reasons given on the create page. */
export default async function EditJobPage({
  params,
}: {
  params: Promise<{ clusterId: string; jobId: string }>;
}) {
  const { clusterId, jobId } = await params;
  if (!isUuid(clusterId) || !isUuid(jobId)) notFound();
  const [job, overrides, workloads, checks] = await Promise.all([
    getJob(jobId),
    listJobOverrides(jobId),
    listWorkloads(clusterId),
    checkRubricItems(),
  ]);
  if (!job) notFound();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`Edit ${job.name}`}
        description="Changing what this job assesses does not rewrite its past: concerns already recorded keep their history, and the next run reconciles them against the new rubric."
      >
        <Button variant="outline" asChild>
          <Link href={`/admin/monitoring/${clusterId}/jobs/${jobId}`}>
            <ArrowLeft className="size-3.5" />
            Back to job
          </Link>
        </Button>
      </AdminPageHeader>
      <JobForm
        clusterId={clusterId}
        workloads={workloads.map((w) => ({
          kind: w.kind,
          namespace: w.namespace,
          name: w.name,
          replicas: w.replicas,
          technology: w.technology,
          profiled: w.profiled,
        }))}
        checks={checks}
        job={{
          id: job.id,
          name: job.name,
          type: job.type,
          depth: job.depth,
          model: job.model,
          schedule: job.schedule,
          enabled: job.enabled,
          targets: job.targets,
          overrides,
        }}
      />
    </div>
  );
}
