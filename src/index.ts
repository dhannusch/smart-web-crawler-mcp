import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";
import { renderPage, validateUrl, BrowserError } from "./browser-utils";
import { extractPageContent } from "./content-extractor";

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

			// Render the page using browser
			try {
				const renderResult = await renderPage(this.env.BROWSER, {
					url,
					timeout: 15000,
					waitUntil: 'load'
				});

				// Extract links and content from the rendered HTML
				const extractedContent = extractPageContent(renderResult.html, renderResult.url);

				// Format results for MCP response
				const linkCount = extractedContent.links.length;
				const internalLinks = extractedContent.links.filter(l => l.type === 'internal');
				const externalLinks = extractedContent.links.filter(l => l.type === 'external');

				// Create a summary of found links
				let resultText = `Successfully crawled page: ${extractedContent.title || renderResult.title || 'No title'}\n`;
				resultText += `URL: ${renderResult.url}\n`;
				resultText += `Status: ${renderResult.status}\n\n`;
				resultText += `Found ${linkCount} total links:\n`;
				resultText += `- ${internalLinks.length} internal links\n`;
				resultText += `- ${externalLinks.length} external links\n\n`;

				// Show relevant links based on query (basic text matching for now)
				const queryLower = query.toLowerCase();
				const relevantLinks = extractedContent.links.filter(link => 
					link.text.toLowerCase().includes(queryLower) || 
					link.url.toLowerCase().includes(queryLower)
				);

				if (relevantLinks.length > 0) {
					resultText += `Links matching "${query}":\n\n`;
					for (const link of relevantLinks.slice(0, 10)) { // Limit to first 10 matches
						resultText += `• ${link.text}\n  ${link.url}\n  Type: ${link.type}\n\n`;
					}
					if (relevantLinks.length > 10) {
						resultText += `... and ${relevantLinks.length - 10} more matching links\n`;
					}
				} else {
					resultText += `No links found matching "${query}"\n\n`;
					resultText += `Sample of all links found:\n\n`;
					for (const link of extractedContent.links.slice(0, 5)) { // Show first 5 links
						resultText += `• ${link.text}\n  ${link.url}\n  Type: ${link.type}\n\n`;
					}
					if (extractedContent.links.length > 5) {
						resultText += `... and ${extractedContent.links.length - 5} more links\n`;
					}
				}

				return {
					content: [
						{
							type: "text" as const,
							text: resultText,
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
