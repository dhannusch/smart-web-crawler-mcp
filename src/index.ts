import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";
import { renderPage, validateUrl, BrowserError } from "./browser-utils";
import { extractPageContent } from "./content-extractor";
import { analyzeLinksWithAI } from "./ai-link-analyzer";

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

				// Use AI to analyze and rank links based on the query
				const analysisResult = await analyzeLinksWithAI(
					this.env.AI,
					extractedContent,
					query,
					25 // Analyze up to 25 links for better performance
				);

				// Format results for MCP response
				const linkCount = extractedContent.links.length;
				const internalLinks = extractedContent.links.filter(l => l.type === 'internal');
				const externalLinks = extractedContent.links.filter(l => l.type === 'external');

				// Create a summary of found links
				let resultText = `Successfully crawled page: ${extractedContent.title || renderResult.title || 'No title'}\n`;
				resultText += `URL: ${renderResult.url}\n`;
				resultText += `Status: ${renderResult.status}\n\n`;
				resultText += `Found ${linkCount} total links (analyzed ${analysisResult.totalAnalyzed}):\n`;
				resultText += `- ${internalLinks.length} internal links\n`;
				resultText += `- ${externalLinks.length} external links\n\n`;
				resultText += `Query Analysis: ${analysisResult.queryInterpretation}\n\n`;

				// Show AI-analyzed relevant links
				if (analysisResult.relevantLinks.length > 0) {
					resultText += `AI-Analyzed Relevant Links (${analysisResult.relevantLinks.length} found):\n\n`;
					
					// Group by relevance score ranges for better presentation
					const highlyRelevant = analysisResult.relevantLinks.filter(l => l.relevanceScore >= 0.7);
					const moderatelyRelevant = analysisResult.relevantLinks.filter(l => l.relevanceScore >= 0.4 && l.relevanceScore < 0.7);
					const somewhatRelevant = analysisResult.relevantLinks.filter(l => l.relevanceScore < 0.4);

					if (highlyRelevant.length > 0) {
						resultText += `🎯 Highly Relevant (${highlyRelevant.length}):\n`;
						for (const link of highlyRelevant.slice(0, 8)) {
							resultText += `• ${link.text}\n  ${link.url}\n  Score: ${(link.relevanceScore * 100).toFixed(0)}% - ${link.reasoning}\n  Type: ${link.type}\n\n`;
						}
					}

					if (moderatelyRelevant.length > 0) {
						resultText += `🔍 Moderately Relevant (${moderatelyRelevant.length}):\n`;
						for (const link of moderatelyRelevant.slice(0, 5)) {
							resultText += `• ${link.text}\n  ${link.url}\n  Score: ${(link.relevanceScore * 100).toFixed(0)}% - ${link.reasoning}\n  Type: ${link.type}\n\n`;
						}
					}

					if (somewhatRelevant.length > 0 && (highlyRelevant.length + moderatelyRelevant.length) < 10) {
						resultText += `📄 Somewhat Relevant (${somewhatRelevant.length}):\n`;
						for (const link of somewhatRelevant.slice(0, 3)) {
							resultText += `• ${link.text}\n  ${link.url}\n  Score: ${(link.relevanceScore * 100).toFixed(0)}% - ${link.reasoning}\n  Type: ${link.type}\n\n`;
						}
					}

					// Show count of additional links if truncated
					const totalShown = Math.min(8, highlyRelevant.length) + 
									 Math.min(5, moderatelyRelevant.length) + 
									 Math.min(3, somewhatRelevant.length);
					if (analysisResult.relevantLinks.length > totalShown) {
						resultText += `... and ${analysisResult.relevantLinks.length - totalShown} more relevant links\n\n`;
					}
				} else {
					resultText += `No links found matching "${query}" based on AI analysis.\n\n`;
					resultText += `Sample of all links found:\n\n`;
					for (const link of extractedContent.links.slice(0, 5)) {
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
