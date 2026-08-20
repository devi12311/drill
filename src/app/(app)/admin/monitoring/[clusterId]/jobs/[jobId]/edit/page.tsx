"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { JobForm, type EditableJob } from "@/components/monitoring/job-form";
import type { CheckOverride } from "@/components/monitoring/rubric-editor";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { useJobFormData } from "@/lib/monitoring/use-job-form-data";

/**
 * The job detail route answers with the job and its rubric deviations separately
 * (runs come along too, and are none of this page's business).
 */
interface JobPayload {
  job: Omit<EditableJob, "overrides">;
  overrides: CheckOverride[];
}

export default function EditJobPage({
  params,
}: {
  params: Promise<{ clusterId: string; jobId: string }>;
}) {
  const { clusterId, jobId } = use(params);
  const form = useJobFormData(clusterId);
  const job = useAdminData<JobPayload>(
    `/api/admin/monitoring/jobs/${jobId}`,
    [jobId],
  );

  const error = form.error ?? job.error;
  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (form.loading || job.loading || !job.data)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`Edit ${job.data.job.name}`}
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
        workloads={form.workloads}
        models={form.models}
        checks={form.checks}
        job={{ ...job.data.job, overrides: job.data.overrides }}
      />
    </div>
  );
}
