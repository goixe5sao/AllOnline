import { Children, isValidElement, type ReactNode, type ReactElement } from "react";
import { DataList } from "@/components/ui";

type Node = ReactElement<{ children?: ReactNode }>;
const elements = (children: ReactNode) => Children.toArray(children).filter((c): c is Node => isValidElement(c));

/** Adapt the existing cells without changing their inputs or action handlers. */
export function AdminDataList({ children, labels, caption = "Danh sách" }: { children: ReactNode; labels?: string[]; caption?: string }) {
  const sections = elements(children);
  const head = sections.find(s => s.type === "thead");
  const body = sections.find(s => s.type === "tbody");
  const headers = head ? elements(elements(head.props.children)[0]?.props.children) : [];
  const rows = elements(body?.props.children).map((row, index) => ({ id: String(row.key ?? index), cells: elements(row.props.children) }));
  const count = headers.length || labels?.length || rows[0]?.cells.length || 0;
  return <DataList caption={caption} rows={rows} rowKey={row => row.id} columns={Array.from({ length: count }, (_, i) => ({ key: String(i), label: labels?.[i] ?? (typeof headers[i]?.props.children === "string" ? headers[i].props.children as string : "Thao tác"), render: (row: { id: string; cells: Node[] }) => row.cells[i]?.props.children }))} />;
}
