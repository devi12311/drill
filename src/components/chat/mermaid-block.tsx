"use client";

import { useEffect, useId, useState } from "react";
import { CodeBlock } from "./code-block";

/**
 * Mermaid's palette, from DESIGN.md tokens: warm neutral boxes on the card
 * surface, off-white text, pale-stone edges. No accent — a diagram is chrome,
 * not code.
 */
const THEME_VARIABLES = {
  darkMode: true,
  background: "#2f2f2f",
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  primaryColor: "#383838",
  primaryTextColor: "#faf9f6",
  primaryBorderColor: "#868684",
  secondaryColor: "#1e1e1d",
  tertiaryColor: "#2f2f2f",
  lineColor: "#b4b4b2",
  textColor: "#faf9f6",
  clusterBkg: "#1e1e1d",
  clusterBorder: "#40403f",
  edgeLabelBackground: "#2f2f2f",
};

type Rendered = { svg: string } | { failed: true } | null;

/**
 * A ```mermaid block drawn as a diagram. The library (~1MB) loads only when an
 * answer contains one; a diagram it cannot parse falls back to its source.
 */
export function MermaidBlock({ source }: { source: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [result, setResult] = useState<{ source: string; rendered: Rendered }>({
    source,
    rendered: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: mermaid } = await import("mermaid");
      // strict: no click handlers or raw HTML labels — the source is model output.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: THEME_VARIABLES,
      });
      // parse first: a failed render() leaves an error graphic in <body>.
      const rendered: Rendered = (await mermaid.parse(source, { suppressErrors: true }))
        ? await mermaid.render(id, source).then(
            ({ svg }) => ({ svg }),
            () => ({ failed: true as const }),
          )
        : { failed: true };
      if (!cancelled) setResult({ source, rendered });
    })().catch(() => {
      if (!cancelled) setResult({ source, rendered: { failed: true } });
    });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  const rendered = result.source === source ? result.rendered : null;
  if (rendered && "failed" in rendered) return <CodeBlock code={source} lang="mermaid" />;
  return (
    <figure className="overflow-x-auto rounded-lg border border-border bg-smoke-charcoal p-4">
      {rendered ? (
        <div
          className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
          // Mermaid's own output, sanitised by it under securityLevel "strict".
          dangerouslySetInnerHTML={{ __html: rendered.svg }}
        />
      ) : (
        <div className="py-6 text-center text-body-sm text-bone-gray">Drawing diagram…</div>
      )}
    </figure>
  );
}
