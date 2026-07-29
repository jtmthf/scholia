import type { ComponentChildren } from "preact";

export function Centered({ children }: { children: ComponentChildren }) {
  return <div class="centered">{children}</div>;
}

export function LoadingView() {
  return <Centered>Loading…</Centered>;
}

/** No Site at this link — also what a non-viewer URL resolves to. */
export function NotFoundView() {
  return (
    <Centered>
      <h1>Not found</h1>
      <p>There's no Site at this link, or it has been removed.</p>
    </Centered>
  );
}

export function ErrorView({ message }: { message: string }) {
  return (
    <Centered>
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </Centered>
  );
}
