"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAdminMutation } from "@/lib/admin/use-admin-mutation";
import { SELECT_CLASS } from "@/lib/monitoring/ui";
import { ACCOUNT_LABEL, GIT_PROVIDERS, PROVIDER_LABEL, type GitProvider } from "@/lib/git/types";

/** Where each provider's token is made, and what it needs — the question every admin asks first. */
const TOKEN_HELP: Record<GitProvider, React.ReactNode> = {
  github: (
    <>
      A fine-grained personal access token for this owner with <em>Contents: read</em> and{" "}
      <em>Metadata: read</em> on the repositories to sync (GitHub → Settings → Developer settings).
    </>
  ),
  bitbucket: (
    <>
      A workspace access token with <em>repository:read</em> — or an Atlassian API token with
      read:repository:bitbucket, together with its account email below.
    </>
  ),
};

export interface ConnectionFormValues {
  id: string;
  provider: GitProvider;
  name: string;
  account: string;
  username: string | null;
  repoCount: number;
}

/**
 * Connect an account, or (with `existing`) edit one. The token is write-only: an
 * edit leaves it empty and keeps the stored one unless a new one is typed. The
 * API proves the credentials against the provider before saving.
 */
export function ConnectionForm({ existing }: { existing?: ConnectionFormValues }) {
  const { mutate, busy, error, errorField } = useAdminMutation();
  const [provider, setProvider] = useState<GitProvider>(existing?.provider ?? "bitbucket");
  const [name, setName] = useState(existing?.name ?? "");
  const [account, setAccount] = useState(existing?.account ?? "");
  const [username, setUsername] = useState(existing?.username ?? "");
  const [token, setToken] = useState("");
  // Changing the account would orphan the repositories synced from it (the API refuses too).
  const accountLocked = !!existing && existing.repoCount > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = { provider, name, account, username: provider === "bitbucket" ? username : null, ...(token ? { token } : {}) };
    const saved = await mutate<{ id: string }>(
      existing ? `/api/admin/git/connections/${existing.id}` : "/api/admin/git/connections",
      { method: existing ? "PATCH" : "POST", body },
      // A new connection lands on its page with the repository picker open.
      existing ? null : (created) => `/admin/git/connections/${created.id}?add=1`,
    );
    if (saved) setToken("");
  }

  const errorFor = (field: string) => (errorField === field ? error : null);
  const shownOnField = ["name", "account", "username", "token"].includes(errorField ?? "");

  return (
    <form onSubmit={submit} className="space-y-4">
      {!existing && (
        <Field id="git-provider" label="Provider">
          {(props) => (
            <select
              {...props}
              value={provider}
              onChange={(e) => setProvider(e.target.value as GitProvider)}
              className={SELECT_CLASS}
            >
              {GIT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field id="git-name" label="Name" description="How this connection appears in the sidebar." error={errorFor("name")}>
        {(props) => (
          <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bitbucket — paperclicks" autoComplete="off" required />
        )}
      </Field>

      <Field
        id="git-account"
        label={ACCOUNT_LABEL[provider]}
        description={
          accountLocked
            ? "Fixed while repositories sync from it."
            : "The slug in the repository URLs, e.g. bitbucket.org/paperclicks → paperclicks."
        }
        error={errorFor("account")}
      >
        {(props) => (
          <Input
            {...props}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="font-mono text-[13px]"
            autoComplete="off"
            disabled={accountLocked}
            required
          />
        )}
      </Field>

      {provider === "bitbucket" && (
        <Field
          id="git-username"
          label="Atlassian account email"
          optional
          description="Only for an Atlassian API token. Leave empty for a workspace or repository access token."
          error={errorFor("username")}
        >
          {(props) => (
            <Input {...props} type="email" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          )}
        </Field>
      )}

      <Field
        id="git-token"
        label="Token"
        optional={!!existing}
        description={existing ? "Leave empty to keep the stored token. A new one is verified before it replaces it." : TOKEN_HELP[provider]}
        error={errorFor("token")}
      >
        {(props) => (
          <Input
            {...props}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-[13px]"
            autoComplete="new-password"
            required={!existing}
          />
        )}
      </Field>

      {error && !shownOnField && <p className="text-body-sm text-traffic-red">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : existing ? "Save changes" : "Connect"}
      </Button>
    </form>
  );
}
