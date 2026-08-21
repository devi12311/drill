import { ChecksBrowser } from "@/components/monitoring/checks-browser";
import { checkListItems } from "@/lib/monitoring/checks";

/**
 * The live rubric. Built-in checks are seeded from the code definitions on first
 * read and can be retuned or disabled here without a deploy; custom checks are
 * added alongside them. A check's ID never changes, because concerns reference
 * it by value.
 *
 * The page is a shelf, not a document. A hundred and eighty checks each printing
 * their question, their scope and three action buttons would be dozens of screens
 * of prose — so a tile carries only what you scan by (severity, name, ID, whether
 * it still runs) and everything the check SAYS waits in the modal.
 *
 * Server-rendered: the catalogue is the page's whole content, so fetching it from
 * the browser on mount only bought a round-trip of "Loading…".
 */
export default async function ChecksPage() {
  return <ChecksBrowser checks={await checkListItems()} />;
}
