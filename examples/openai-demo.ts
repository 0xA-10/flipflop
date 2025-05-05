// @ts-nocheck
import "dotenv/config";

import { Axis, buildTree, traverse, toMermaid } from "../src/index.js";
import fs from "node:fs";
import OpenAI from "openai";

// 1) Initialize OpenAI with your env var
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// 2) Wrap Chat completion in the llm signature
const llm = async (prompt: string): Promise<string> => {
	const res = await openai.chat.completions.create({
		model: "o3",
		messages: [{ role: "user", content: prompt }],
	});
	return res.choices[0].message.content.trim();
};

async function main() {
	// 3) Build your axes & tree
	const axes: Axis[] = [
		{ left: "short", right: "long" },
		{ left: "shallow", right: "deep" },
	];
	const root = buildTree<string>(axes);
	root.payload = "memory formation in the brain";

	// 4) Traverse with the real LLM
	await traverse(root, [], { llm });

	// 5) Write out Mermaid
	const mermaid = `graph TD;\n${toMermaid(root)}`;
	fs.writeFileSync("openai-demo.mmd", mermaid);

	console.log("▶️ Synthesized root:", root.payload);
	console.log("▶️ Diagram in openai-demo.mmd");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
