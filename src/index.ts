import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";
import { renderPage, validateUrl, BrowserError } from "./browser-utils";

const ALLOWED_EMAILS = new Set(["<INSERT EMAIL>"]);

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Access OAuth Proxy Demo",
		version: "1.0.0",
	});

	async init() {
		// Hello, world!
		this.server.tool(
			"add",
			"Add two numbers the way only MCP can",
			{ a: z.number(), b: z.number() },
			async ({ a, b }) => ({
				content: [{ text: String(a + b), type: "text" }],
			}),
		);

		// Dynamically add tools based on the user's login. In this case, I want to limit
		// access to my Image Generation tool to just me
		if (ALLOWED_EMAILS.has(this.props.email)) {
			this.server.tool(
				"generateImage",
				"Generate an image using the `flux-1-schnell` model. Works best with 8 steps.",
				{
					prompt: z
						.string()
						.describe("A text description of the image you want to generate."),
					steps: z
						.number()
						.min(4)
						.max(8)
						.default(4)
						.describe(
							"The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.",
						),
				},
				async ({ prompt, steps }) => {
					const response = await this.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
						prompt,
						steps,
					});

					return {
						content: [{ data: response.image!, mimeType: "image/jpeg", type: "image" }],
					};
				},
			);

			this.server.tool(
				"webCrawl",
				"Crawl a web page and extract relevant links based on a search query using AI analysis",
				{
					url: z
						.string()
						.url()
						.describe("The URL of the web page to crawl"),
					query: z
						.string()
						.describe("A search query to filter and find relevant links from the crawled page"),
				},
				async ({ url, query }) => {
					return await this.handleWebCrawl(url, query);
				},
			);
		}
	}

	private async handleWebCrawl(url: string, query: string) {
		try {
			// Validate URL first
			const validation = await validateUrl(url);
			if (!validation.valid) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: Invalid URL - ${validation.reason}`,
						},
					],
				};
			}

			// Test browser rendering
			try {
				const renderResult = await renderPage(this.env.BROWSER, {
					url,
					timeout: 15000,
					waitUntil: 'load'
				});

				// For now, return basic page information
				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully rendered page: ${renderResult.title || 'No title'}\nURL: ${renderResult.url}\nStatus: ${renderResult.status}\nHTML length: ${renderResult.html.length} characters\n\nQuery "${query}" - Full link extraction and AI analysis coming in next implementation phase.`,
						},
					],
				};
			} catch (error) {
				if (error instanceof BrowserError) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Browser rendering failed: ${error.message} (Code: ${error.code})`,
							},
						],
					};
				}
				throw error;
			}
		} catch (error) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error crawling ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
					},
				],
			};
		}
	}
}

async function handleMcpRequest(req: Request, env: Env, ctx: ExecutionContext) {
	const { pathname } = new URL(req.url);
	if (pathname === "/sse" || pathname === "/sse/message") {
		return MyMCP.serveSSE("/sse").fetch(req, env, ctx);
	}
	if (pathname === "/mcp") {
		return MyMCP.serve("/mcp").fetch(req, env, ctx);
	}
	return new Response("Not found", { status: 404 });
}

export default new OAuthProvider({
	apiHandler: { fetch: handleMcpRequest as any },
	apiRoute: ["/sse", "/mcp"],
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: { fetch: handleAccessRequest as any },
	tokenEndpoint: "/token",
});
