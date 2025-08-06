import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'
import { renderPage, extractLinks, validateUrl, BrowserError, CloudflareBrowserBinding } from './browser-utils'
import { extractPageContentFromMarkdown } from './content-extractor'
import { analyzeLinksWithAI } from './ai-link-analyzer'
import { GitHubHandler } from './github-handler'
import { Octokit } from 'octokit'
import type { Props } from './utils'

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames of users who should have access to the web crawling tool
  // For example: 'yourusername', 'coworkerusername'
])

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: 'Web Crawler MCP Server',
    version: '1.0.0',
  })

  async init() {
    // Use the upstream access token to facilitate tools
    this.server.tool('userInfoOctokit', 'Get user info from GitHub, via Octokit', {}, async () => {
      const octokit = new Octokit({ auth: this.props.accessToken })
      return {
        content: [
          {
            text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
            type: 'text',
          },
        ],
      }
    })

    // Dynamically add tools based on the user's login. In this case, we limit
    // access to the web crawling tool to specific users
    if (ALLOWED_USERNAMES.has(this.props.login)) {
      this.server.tool(
        'webCrawl',
        'Crawl a web page and extract relevant links based on a search query using AI analysis',
        {
          url: z.string().url().describe('The URL of the web page to crawl'),
          query: z.string().describe('A search query to filter and find relevant links from the crawled page'),
        },
        async ({ url, query }) => {
          return await this.handleWebCrawl(url, query)
        },
      )
    }
  }

  private async handleWebCrawl(url: string, query: string) {
    try {
      // Validate URL first
      const validation = await validateUrl(url)
      if (!validation.valid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Invalid URL - ${validation.reason}`,
            },
          ],
        }
      }

      // Render the page using Cloudflare Browser Rendering API
      try {
        const browserConfig: CloudflareBrowserBinding = {
          accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
          apiToken: this.env.CLOUDFLARE_API_TOKEN,
        }

        const renderResult = await renderPage(browserConfig, {
          url,
          timeout: 15000,
        })

        // Extract links using the new REST API
        const linksResult = await extractLinks(browserConfig, url, false, 15000)

        // Extract content from markdown and combine with extracted links
        const extractedContent = extractPageContentFromMarkdown(renderResult.markdown, renderResult.url, linksResult.links)

        // Use AI to analyze and rank links based on the query
        const analysisResult = await analyzeLinksWithAI(
          this.env.AI,
          extractedContent,
          query,
          25, // Analyze up to 25 links for better performance
        )

        // Format results for MCP response
        const linkCount = extractedContent.links.length
        const internalLinks = extractedContent.links.filter((l) => l.type === 'internal')
        const externalLinks = extractedContent.links.filter((l) => l.type === 'external')

        // Create a summary of found links
        let resultText = `Successfully crawled page: ${extractedContent.title || renderResult.title || 'No title'}\n`
        resultText += `URL: ${renderResult.url}\n`
        resultText += `Status: ${renderResult.status}\n\n`
        resultText += `Found ${linkCount} total links (analyzed ${analysisResult.totalAnalyzed}):\n`
        resultText += `- ${internalLinks.length} internal links\n`
        resultText += `- ${externalLinks.length} external links\n\n`
        resultText += `Query Analysis: ${analysisResult.queryInterpretation}\n\n`

        // Show AI-analyzed relevant links
        if (analysisResult.relevantLinks.length > 0) {
          resultText += `AI-Analyzed Relevant Links (${analysisResult.relevantLinks.length} found):\n\n`

          // Group by relevance score ranges for better presentation
          const relevanceGroups = [
            { name: 'Highly Relevant', links: analysisResult.relevantLinks.filter((l) => l.relevanceScore >= 0.7), limit: 8 },
            {
              name: 'Moderately Relevant',
              links: analysisResult.relevantLinks.filter((l) => l.relevanceScore >= 0.4 && l.relevanceScore < 0.7),
              limit: 5,
            },
            { name: 'Somewhat Relevant', links: analysisResult.relevantLinks.filter((l) => l.relevanceScore < 0.4), limit: 3 },
          ]

          let totalShown = 0
          for (const group of relevanceGroups) {
            if (group.links.length > 0 && (group.name !== 'Somewhat Relevant' || totalShown < 10)) {
              resultText += `${group.name} (${group.links.length}):\n`
              const linksToShow = group.links.slice(0, group.limit)
              for (const link of linksToShow) {
                resultText += `• ${link.text}\n  ${link.url}\n  Score: ${(link.relevanceScore * 100).toFixed(0)}% - ${link.reasoning}\n  Type: ${link.type}\n\n`
              }
              totalShown += linksToShow.length
            }
          }

          // Show count of additional links if truncated
          if (analysisResult.relevantLinks.length > totalShown) {
            resultText += `... and ${analysisResult.relevantLinks.length - totalShown} more relevant links\n\n`
          }
        } else {
          resultText += `No links found matching "${query}" based on AI analysis.\n\n`
          resultText += `Sample of all links found:\n\n`
          for (const link of extractedContent.links.slice(0, 5)) {
            resultText += `• ${link.text}\n  ${link.url}\n  Type: ${link.type}\n\n`
          }
          if (extractedContent.links.length > 5) {
            resultText += `... and ${extractedContent.links.length - 5} more links\n`
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: resultText,
            },
          ],
        }
      } catch (error) {
        if (error instanceof BrowserError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Browser rendering failed: ${error.message} (Code: ${error.code})`,
              },
            ],
          }
        }
        throw error
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error crawling ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      }
    }
  }
}

export default new OAuthProvider({
  apiHandler: MyMCP.mount('/sse') as any,
  apiRoute: '/sse',
  authorizeEndpoint: '/authorize',
  clientRegistrationEndpoint: '/register',
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: '/token',
})
