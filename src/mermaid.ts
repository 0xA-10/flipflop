import { AlignmentNode } from "./node.js";

/** Serialize tree to Mermaid graph TD syntax. */
export function toMermaid(node: AlignmentNode, id = "0"): string {
	const safe = (s: string) => s.replace(/["|]/g, "");
	if (!node.children) return "";
	const [l, r] = node.children;
	return [
		// @ts-ignore
		`${id}["${safe(node.axis.left)}"] --> ${id}L["${safe(l.payload ?? "")}"]`,
		// @ts-ignore
		`${id}["${safe(node.axis.right)}"] --> $G{id}R["${safe(r.payload ?? "")}"]`,
		toMermaid(l, id + "L"),
		toMermaid(r, id + "R"),
	].join("\n");
}
