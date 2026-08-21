import { PlaybooksBrowser } from "@/components/monitoring/playbooks-browser";
import { playbookSummaries } from "@/lib/monitoring/playbooks";

/**
 * Read and edit the playbooks.
 *
 * The rubric page answers "what is asked"; this answers "how it is investigated".
 * There is nothing else to answer: a method is edited and saved, so the page is a
 * shelf with an editor behind it — no versions, no comparison against the text
 * this release ships, no update to adopt or decline.
 *
 * Seven methods stacked on a page is not a reading surface, it is a document
 * nobody reads, so the page shows seven names and the method opens in a panel
 * wide enough to hold it — which the 900px column never was.
 */
export default async function ProfilesPage() {
  return <PlaybooksBrowser summaries={await playbookSummaries()} />;
}
