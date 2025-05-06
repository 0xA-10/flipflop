// @ts-nocheck
import "dotenv/config";

/**
 * openai‑nested-demo.ts  ‑‑  One‑session Responses API with
 * ▸ adaptive **rate‑limit retries** and
 * ▸ automatic **context roll‑up** to stay < 30 000 tokens/request.
 *
 * Strategy
 * ────────
 * 1. Track an *approximation* of tokens (chars÷4) added to the session.
 * 2. When the prospective request would push us past a soft cutoff
 *    (`SOFT_LIMIT` ≈ 28 000), we *summarise* the running history into a
 *    single message (≤ 1 000 tokens) and start a **fresh session** whose
 *    system prompt embeds that summary.  This guarantees every request
 *    is well under 30 k.
 * 3. Robust retry/back‑off for rate‑limits (429), including parse‑delay
 *    and exponential fallback.
 *
 * Install deps
 * ────────────
 *   npm i openai tiktoken
 *
 * NOTE: If you prefer not to pull in `tiktoken`, set
 *       USE_APPROX = true below to use a quick char‑based heuristic.
 */
import OpenAI from "openai";
import { Axis, AlignmentNode, buildTree, traverse, toMermaid } from "flipflop";
import { encoding_for_model } from "tiktoken";
import fs from "node:fs";

/*************************************************
 * 0️⃣  Config
 *************************************************/
const MODEL = "o3"; // or "gpt-4o", etc.
const SYSTEM_PROMPT_BASE =
	"You are a world‑class quantum‑computing tutor. When given an axis in <LEFT vs RIGHT> form, analyse both poles, compare them, and then write a concise synthesis.";

const HARD_LIMIT = 30000; // per OpenAI docs
const SOFT_LIMIT = 28000; // threshold where we summarise
const SUMMARY_TOKENS_TARGET = 800; // target size for summaries

const MAX_RETRIES = 6;
const USE_APPROX = false; // flip to true if you don’t install tiktoken

/*************************************************
 * 1️⃣  Token helpers
 *************************************************/
let enc: ReturnType<typeof encoding_for_model> | undefined;
if (!USE_APPROX) {
	enc = encoding_for_model(MODEL);
}
const approxTokens = (text: string): number => (USE_APPROX ? Math.ceil(text.length / 4) : enc!.encode(text).length);

/*************************************************
 * 2️⃣  Build FlipFlop tree (same as before)
 *************************************************/
const theoryAxes: Axis[] = [
	{ left: "algorithms", right: "information" },
	{ left: "complexity", right: "physics" },
];
const engineeringAxes: Axis[] = [
	{ left: "hardware", right: "error‑correction" },
	{ left: "cryogenic", right: "photonic" },
];

const root: AlignmentNode = {
	axis: { left: "theory", right: "engineering" },
	children: [buildTree(theoryAxes), buildTree(engineeringAxes)],
	payload: "quantum computing",
};

/*************************************************
 * 3️⃣  OpenAI client & conversation state
 *************************************************/
const openai = new OpenAI();

interface Msg {
	role: "user" | "assistant";
	content: string;
}
let history: Msg[] = [];
let summary: string | null = null; // compacted history
let previous: string | undefined; // Responses API thread id since last reset

/*************************************************
 * 4️⃣  Helpers: sleep + parse delay + summariser
 *************************************************/
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRetryDelay(err: any): number | undefined {
	const hdr = err.headers?.["x-ratelimit-reset-tokens"] as string | undefined;
	if (hdr) {
		const m = /([\d.]+)s/.exec(hdr);
		if (m) return Math.ceil(parseFloat(m[1]) * 1000);
	}
	const txt: string = err.message ?? "";
	const m = /try again in (\d+)ms/i.exec(txt);
	if (m) return parseInt(m[1], 10);
	return undefined;
}

/**
 * Summarise the current `history` into ≤ SUMMARY_TOKENS_TARGET tokens and
 * reset the Responses‑API thread.  We *do not* include earlier summaries
 * because they are already condensed.
 */
async function rollUpHistory(): Promise<void> {
	if (history.length === 0) return; // nothing to summarise

	const summarisePrompt =
		"Summarise the following conversation in under " +
		SUMMARY_TOKENS_TARGET +
		" tokens. Focus on key insights and decisions.\n\n" +
		history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

	const resp = await openai.chat.completions.create({
		model: "gpt-4o-mini", // cheaper summariser
		messages: [
			{ role: "system", content: "You are a helpful summariser." },
			{ role: "user", content: summarisePrompt },
		],
		max_tokens: SUMMARY_TOKENS_TARGET + 50, // wiggle room
	});

	summary = resp.choices[0].message.content ?? "";
	// Clear state: start fresh thread next time
	history = [];
	previous = undefined;
	console.info("📝 Rolled up history into", approxTokens(summary), "tokens");
}

/*************************************************
 * 5️⃣  LLM wrapper with token‑budget + retries
 *************************************************/
async function callOpenAI(prompt: string): Promise<string> {
	// Pre‑flight: will this prompt push us over the limit?
	let prospectiveTokens = approxTokens(prompt) + approxTokens(SYSTEM_PROMPT_BASE);
	if (summary) prospectiveTokens += approxTokens(summary);
	for (const { content } of history) prospectiveTokens += approxTokens(content);

	// Always leave ~1 500 tokens for the model’s output.
	const TOTAL_BUDGET = SOFT_LIMIT - 1500;
	if (prospectiveTokens > TOTAL_BUDGET) {
		await rollUpHistory();
	}

	let attempt = 0;
	while (true) {
		try {
			const args: any = {
				model: MODEL,
				input: prompt,
			};
			if (!previous) {
				args.instructions = SYSTEM_PROMPT_BASE + (summary ? "\n\nSummary so far: " + summary : "");
			} else {
				args.previous_response_id = previous;
			}

			const resp = await openai.responses.create(args);
			previous = resp.id;

			const assistantReply = resp.output_text ?? "";

			// Update local history for future roll‑ups
			history.push({ role: "user", content: prompt });
			history.push({ role: "assistant", content: assistantReply });

			return assistantReply;
		} catch (err: any) {
			const tooLarge = err.status === 429 && /Request too large/i.test(err.message);
			if (tooLarge) {
				console.warn("⚠️  Request exceeded token limit – rolling up and retrying…");
				await rollUpHistory();
				continue; // retry immediately after roll‑up
			}

			if (err.status === 429 && attempt < MAX_RETRIES) {
				attempt += 1;
				const delay = parseRetryDelay(err) ?? Math.min(2 ** attempt * 500, 15000);
				console.warn(`⏳ Rate‑limited (attempt ${attempt}/${MAX_RETRIES}) – waiting ${delay} ms…`);
				await sleep(delay);
				continue;
			}
			throw err;
		}
	}
}

/*************************************************
 * 6️⃣  Kick off FlipFlop traversal
 *************************************************/
await traverse(root, [], { llm: callOpenAI });

const mermaid = `graph TD;\n${toMermaid(root)}`;
fs.writeFileSync("openai-nested-demo.mmd", mermaid);

console.log("▶️ Synthesized root:", root.payload);
console.log("▶️ Diagram in openai-nested-demo.mmd");
