import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ArtifactChip } from "@/components/resolutions/artifact-chip";
import { ARTIFACT_MARKER } from "@/lib/artifacts/types";
import { mapPlaceholders } from "@/lib/templates";
import { CodeBlock } from "./code-block";
import { MermaidBlock } from "./mermaid-block";

const ARTIFACT_HREF_PREFIX = "#drill-artifact-";
const PLACEHOLDER_HREF_PREFIX = "#drill-placeholder-";
/** Only names a skill input could have; anything else stays literal text. */
const CHIP_NAME = /^[a-z][a-z0-9_]*$/;

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(hastText).join("");
}

/**
 * A fenced block's language and text, read from the `pre > code` hast node —
 * the `code` element alone cannot tell a fence without a language from inline
 * code, its `pre` parent can.
 */
function fencedBlock(pre: HastNode | undefined): { code: string; lang: string | null } {
  const code = pre?.children?.find((c) => c.tagName === "code");
  const classes = code?.properties?.className;
  const lang = Array.isArray(classes)
    ? classes.map(String).find((c) => c.startsWith("language-"))?.slice("language-".length)
    : undefined;
  return { code: code ? hastText(code).replace(/\n$/, "") : "", lang: lang ?? null };
}

/**
 * Apply `rewrite` to the prose only: fenced blocks and inline code are left
 * untouched, so a marker quoted in code renders literally.
 */
function rewriteOutsideCode(source: string, rewrite: (prose: string) => string): string {
  return source
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((segment, i) => (i % 2 === 1 ? segment : rewrite(segment)))
    .join("");
}

/**
 * `[[artifact:<uuid>]]` citations become links our `a` renderer turns into
 * ArtifactChips; with `placeholders`, `{{key}}` becomes a chip the same way.
 */
function rewriteMarkers(source: string, placeholders: boolean): string {
  return rewriteOutsideCode(source, (prose) => {
    const cited = prose.replace(
      ARTIFACT_MARKER,
      (_m, id) => `[resolution](${ARTIFACT_HREF_PREFIX}${id})`,
    );
    return placeholders
      ? mapPlaceholders(cited, (name) =>
          CHIP_NAME.test(name) ? `[${name}](${PLACEHOLDER_HREF_PREFIX}${name})` : `{{${name}}}`,
        )
      : cited;
  });
}

/**
 * Markdown renderer for Holmes `analysis` content.
 * Code lives in terminal-styled panels (DESIGN.md: Terminal Product Mockup);
 * gold/cobalt accents appear only here, never in UI chrome.
 */
export function Markdown({
  children,
  className,
  placeholders = false,
}: {
  children: string;
  className?: string;
  /** Show `{{key}}` as an input chip — for a skill's procedure. */
  placeholders?: boolean;
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
            if (p.href?.startsWith(PLACEHOLDER_HREF_PREFIX)) {
              return (
                <span className="rounded-sm border border-border bg-smoke-charcoal px-1.5 py-0.5 font-mono text-[0.85em] text-pale-stone">
                  {`{{${p.href.slice(PLACEHOLDER_HREF_PREFIX.length)}}}`}
                </span>
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
          // Inline only: `pre` renders fenced blocks itself, from the hast node.
          code: (p) => (
            <code className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 font-mono text-[0.85em] text-gold-leaf">
              {p.children}
            </code>
          ),
          pre: (p) => {
            const { code, lang } = fencedBlock(p.node as HastNode | undefined);
            return lang === "mermaid" ? (
              <MermaidBlock source={code} />
            ) : (
              <CodeBlock code={code} lang={lang} />
            );
          },
          hr: () => <hr className="border-border" />,
        }}
      >
        {rewriteMarkers(children, placeholders)}
      </ReactMarkdown>
    </div>
  );
}
