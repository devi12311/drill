import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ArtifactChip } from "@/components/resolutions/artifact-chip";

const ARTIFACT_HREF_PREFIX = "#drill-artifact-";
const ARTIFACT_MARKER =
  /\[\[artifact:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

/**
 * Rewrite `[[artifact:<uuid>]]` citations into links our `a` renderer turns
 * into ArtifactChips. Fenced code segments are left untouched so a marker
 * quoted in code renders literally.
 */
function rewriteArtifactMarkers(source: string): string {
  return source
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment.replace(
            ARTIFACT_MARKER,
            (_m, id) => `[resolution](${ARTIFACT_HREF_PREFIX}${id})`,
          ),
    )
    .join("");
}

/**
 * Markdown renderer for Holmes `analysis` content.
 * Code lives in terminal-styled panels (DESIGN.md: Terminal Product Mockup);
 * gold/cobalt accents appear only here, never in UI chrome.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3 text-body text-warm-off-white [overflow-wrap:anywhere]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => (
            <h1 className="text-heading-sm pt-2 font-medium">{p.children}</h1>
          ),
          h2: (p) => (
            <h2 className="text-subheading pt-2 font-medium">{p.children}</h2>
          ),
          h3: (p) => (
            <h3 className="text-body pt-1 font-medium">{p.children}</h3>
          ),
          p: (p) => <p className="leading-[1.38]">{p.children}</p>,
          a: (p) => {
            if (p.href?.startsWith(ARTIFACT_HREF_PREFIX)) {
              return (
                <ArtifactChip id={p.href.slice(ARTIFACT_HREF_PREFIX.length)} />
              );
            }
            return (
              <a
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="text-muted-cobalt underline underline-offset-4 hover:text-warm-off-white"
              >
                {p.children}
              </a>
            );
          },
          ul: (p) => (
            <ul className="list-disc space-y-1 pl-5 marker:text-bone-gray">
              {p.children}
            </ul>
          ),
          ol: (p) => (
            <ol className="list-decimal space-y-1 pl-5 marker:text-bone-gray">
              {p.children}
            </ol>
          ),
          blockquote: (p) => (
            <blockquote className="border-l-2 border-iron-veil pl-4 text-pale-stone">
              {p.children}
            </blockquote>
          ),
          table: (p) => (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-body-sm">{p.children}</table>
            </div>
          ),
          th: (p) => (
            <th className="border-b border-border bg-smoked-onyx px-3 py-2 text-left font-medium text-pale-stone">
              {p.children}
            </th>
          ),
          td: (p) => (
            <td className="border-b border-border/50 px-3 py-2 align-top">
              {p.children}
            </td>
          ),
          code: (props) => {
            const { children, className: codeClass } = props;
            const isBlock = codeClass?.includes("language-");
            if (!isBlock) {
              return (
                <code className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 font-mono text-[0.85em] text-gold-leaf">
                  {children}
                </code>
              );
            }
            return <code className="font-mono">{children}</code>;
          },
          pre: (p) => (
            <pre className="overflow-x-auto rounded-lg bg-smoke-charcoal p-4 font-mono text-[13px] leading-relaxed text-warm-off-white">
              {p.children}
            </pre>
          ),
          hr: () => <hr className="border-border" />,
        }}
      >
        {rewriteArtifactMarkers(children)}
      </ReactMarkdown>
    </div>
  );
}
