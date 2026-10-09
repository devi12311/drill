"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { KeyCombo } from "@/components/ui/kbd";
import { useSession } from "@/components/session/session-provider";
import { showsModeSwitch } from "@/components/shell/mode-switch";
import { useCharacterKeys, useShortcut } from "@/components/shell/shortcuts";
import { visibleAdminNav } from "@/lib/admin/nav";
import { isAdminPath } from "@/lib/routes";
import {
  LOCAL_SHORTCUTS,
  SHORTCUTS,
  isCharacterShortcut,
  navChord,
  type NavJump,
  type ShortcutDef,
} from "@/lib/shortcuts";
import { WORKSPACE_JUMPS } from "@/lib/workspace/nav";
import { cn } from "@/lib/utils";

interface Row {
  label: string;
  /** Alternatives, shown "or"-separated. */
  keys: string[];
  /** Goes quiet when single-key shortcuts are switched off. */
  character: boolean;
}

/** A binding of the app-wide dispatcher (`SHORTCUTS`, the nav chords). */
const row = (def: ShortcutDef, ...more: ShortcutDef[]): Row => {
  const keys = [def.keys, ...more.map((d) => d.keys)];
  return { label: def.label, keys, character: keys.every(isCharacterShortcut) };
};

/** A key a focused component handles itself (`LOCAL_SHORTCUTS`). */
const localRow = (def: ShortcutDef): Row => ({ label: def.label, keys: [def.keys], character: false });

const jumpRows = (jumps: NavJump[]): Row[] =>
  jumps.flatMap((j) => (j.shortcut ? [row({ label: j.label, keys: navChord(j.shortcut) })] : []));

/**
 * The shortcut sheet (`?` or Ctrl+/), showing what works in the current mode —
 * built from `SHORTCUTS` and the nav configs, never a hand-kept list. It also
 * holds the switch for single-key shortcuts (WCAG 2.1.4).
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useSession();
  const [characterKeys, setCharacterKeys] = useCharacterKeys();
  useShortcut([SHORTCUTS.help.keys, SHORTCUTS.helpAlt.keys], () => setOpen(true));

  const admin = isAdminPath(pathname);
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: "General",
      rows: [
        row(SHORTCUTS.help, SHORTCUTS.helpAlt),
        ...(showsModeSwitch(user) ? [row(SHORTCUTS.modeSwitch)] : []),
        row(SHORTCUTS.close),
        admin ? { ...row(SHORTCUTS.focusInput), label: "Focus the page's filter" } : null,
      ].filter((r): r is Row => r !== null),
    },
    ...(admin
      ? []
      : [
          {
            title: "Investigations",
            rows: [
              row(SHORTCUTS.newInvestigation),
              row(SHORTCUTS.focusInput),
              localRow(LOCAL_SHORTCUTS.send),
              localRow(LOCAL_SHORTCUTS.newline),
              row(SHORTCUTS.stop),
              row(SHORTCUTS.pickFollowUp),
              row(SHORTCUTS.prevConversation),
              row(SHORTCUTS.nextConversation),
              localRow(LOCAL_SHORTCUTS.walkCalls),
              localRow(LOCAL_SHORTCUTS.save),
            ],
          },
        ]),
    {
      title: "Go to",
      rows: admin
        ? jumpRows(visibleAdminNav(user.actorIsAdmin).flatMap((g) => g.items))
        : jumpRows(WORKSPACE_JUMPS),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {admin ? "Admin mode." : "Chat mode."} Single-key shortcuts never fire while you type
            in a field.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1.5 text-caption-tracked uppercase text-bone-gray">
                {section.title}
              </h3>
              <dl>
                {section.rows.map((r) => {
                  // A switched-off single-key shortcut stays listed, dimmed.
                  const off = !characterKeys && r.character;
                  return (
                    <div
                      key={r.label + r.keys.join()}
                      className={cn(
                        "flex items-center justify-between gap-4 border-b border-border/50 py-2 last:border-b-0",
                        off && "opacity-40",
                      )}
                    >
                      <dt className="text-body-sm text-pale-stone">{r.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1.5">
                        {r.keys.map((k, i) => (
                          <span key={k} className="inline-flex items-center gap-1.5">
                            {i > 0 && <span className="text-[11px] text-bone-gray">or</span>}
                            <KeyCombo keys={k} />
                          </span>
                        ))}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </DialogBody>
        <label className="flex items-start gap-3 border-t border-border pt-4 text-body-sm text-pale-stone">
          <Checkbox
            checked={characterKeys}
            onCheckedChange={(v) => setCharacterKeys(v === true)}
            className="mt-0.5"
          />
          <span>
            Single-key shortcuts
            <span className="block text-[12px] text-bone-gray">
              ?, /, 1–9 and the G chords. Turn off if you use speech input; shortcuts with Ctrl
              or Alt keep working.
            </span>
          </span>
        </label>
      </DialogContent>
    </Dialog>
  );
}
