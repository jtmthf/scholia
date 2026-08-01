export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface NavNode {
  type: "file" | "dir";
  title: string;
  /** Set only when a sibling shares this node's title, so Nav can tell them apart. */
  subtitle?: string;
  urlPath: string;
  fsPath: string;
  order: number;
  children?: NavNode[];
}

export interface DocRecord {
  urlPath: string;
  fsPath: string;
  title: string;
  body: string;
  headings: Heading[];
  /** Positional order within its directory in Nav order (0 = first). */
  order?: number;
}

export interface RenderResult {
  html: string;
  title: string | undefined;
  headings: Heading[];
  data: Record<string, unknown>;
}
