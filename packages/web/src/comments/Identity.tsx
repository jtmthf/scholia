import type { Identity as IdentityDTO } from "../api";

interface IdentityProps {
  identity: IdentityDTO;
}

export function IdentityDisplay({ identity }: IdentityProps) {
  return (
    <span class="comment-header">
      <span class="identity-name">{identity.name}</span>
      {identity.kind === "agent" && (
        <span class="identity-badge--agent" title="AI agent">
          agent
        </span>
      )}
      {identity.tier === "owner" && (
        <span class="identity-tier--owner" title="Owner">
          owner
        </span>
      )}
    </span>
  );
}
