import { Axis } from "./axis.js";
import { AlignmentNode } from "./node.js";
import { similarity } from "./utils.js";

/** Build a full binary alignment tree from ordered axes. */
export function buildTree<T>(axes: Axis[], depth = 0): AlignmentNode<T> {
  if (!axes[depth]) return { axis: { left: '', right: '' } };
  return {
    axis: axes[depth],
    children: [
      buildTree(axes, depth + 1),
      buildTree(axes, depth + 1),
    ],
  };
}

export interface TraverseOptions {
  llm: (prompt: string) => Promise<string>;
  bridgePrompt?: (leftResp: string, rightResp: string, left: string, right: string) => string;
  validate?: (a: string, b: string) => number;
}

const defaultBridge = (l: string, r: string, left: string, right: string) => 
  `Given\n${left}: ${l}\n${right}: ${r}\nWhat concept unifies them?`;

export async function traverse(
  node: AlignmentNode<string>,
  ctx: string[],
  { llm, bridgePrompt = defaultBridge, validate = similarity }: TraverseOptions,
  depth = 0
): Promise<void> {
  const { left, right } = node.axis;
  if (!left || !right || !node.children) return;

  const [respL, respR] = await Promise.all([
    llm(`${ctx.join(" -> ")} -> ${left}: Explain ${node.payload}`),
    llm(`${ctx.join(" -> ")} -> ${right}: Explain ${node.payload}`)
  ]);

  const bridge = await llm(bridgePrompt(respL, respR, left, right));

  node.children[0].payload = respL;
  node.children[1].payload = respR;

  ctx.push(left);
  await traverse(node.children[0], ctx, { llm, bridgePrompt, validate }, depth + 1);
  ctx.pop();

  ctx.push(right);
  await traverse(node.children[1], ctx, { llm, bridgePrompt, validate }, depth + 1);
  ctx.pop();

  const sim = validate(respL, respR);
  if (sim < 0.15) {
    console.warn(`Low similarity at depth ${depth}: ${left}/${right} (sim=${sim.toFixed(2)})`);
  }

  node.payload = bridge;
}
