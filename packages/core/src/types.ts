export interface Heading {
  depth: number;
  id: string;
  text: string;
}

export interface NavNode {
  type: "file" | "dir";
  title: string;
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
}

export interface RenderResult {
  html: string;
  title: string | undefined;
  headings: Heading[];
  data: Record<string, unknown>;
}
