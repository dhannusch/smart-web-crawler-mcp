# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

- **Start development server**: `npm run dev` or `wrangler dev` (runs on port 8788)
- **Deploy to production**: `npm run deploy` or `wrangler deploy`
- **Type checking**: `npm run type-check` or `tsc --noEmit`
- **Generate Cloudflare Worker types**: `npm run cf-typegen` or `wrangler types`

## Project Architecture

This is a **Web Crawler MCP Server** built on Cloudflare Workers that provides intelligent web crawling capabilities through the Model Context Protocol. The server uses GitHub OAuth for authentication and combines browser rendering with AI-powered content analysis.

### Core Components

1. **OAuth Provider** (src/index.ts:203-210)
   - Uses `@cloudflare/workers-oauth-provider` as the main OAuth 2.1 server
   - Handles token issuance, validation, and management
   - Routes requests between MCP endpoints and GitHub OAuth authentication

2. **MCP Server** (src/index.ts:26-190)
   - `MyMCP` class extends `McpAgent` from the `agents/mcp` library
   - Defines tools like `userInfoOctokit` (GitHub profile info) and `webCrawl` (intelligent web crawling)
   - Tools can be conditionally enabled based on user permissions via `ALLOWED_USERNAMES`

3. **GitHub Handler** (src/github-handler.ts)
   - Manages the OAuth flow with GitHub
   - Handles authorization requests, callbacks, and token exchange
   - Validates GitHub OAuth tokens and extracts user information

4. **Browser Utilities** (src/browser-utils.ts)
   - Provides page rendering using Cloudflare's headless browser
   - Handles URL validation and browser error management
   - Renders JavaScript-heavy pages for comprehensive link extraction

5. **Content Extractor** (src/content-extractor.ts)
   - Parses rendered HTML to extract links and metadata
   - Categorizes links as internal/external
   - Extracts page titles and structured content

6. **AI Link Analyzer** (src/ai-link-analyzer.ts)
   - Uses Cloudflare Workers AI to analyze extracted links
   - Interprets natural language queries to find relevant links
   - Provides relevance scoring and reasoning for each link

### Authentication Flow

1. Client connects to `/sse` or `/mcp` endpoints
2. OAuth provider redirects to `/authorize` for approval
3. User approves via HTML dialog, gets redirected to GitHub OAuth
4. GitHub redirects back to `/callback` with authorization code
5. Server exchanges code for GitHub access tokens and creates MCP session
6. User identity (login, name, email) and GitHub access token are available in `this.props`

### Key Configuration

- **Environment Variables**: GitHub OAuth credentials (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), cookie encryption key
- **KV Storage**: Used for OAuth state management (OAUTH_KV binding)
- **Durable Objects**: MCP server instances with persistent state
- **Browser Binding**: Cloudflare Browser Rendering API for page rendering
- **AI Binding**: Cloudflare Workers AI for link analysis and content understanding

### Tool Access Control

Tools are conditionally available based on GitHub username:
- `userInfoOctokit` tool: Available to all authenticated users
- `webCrawl` tool: Restricted to usernames in `ALLOWED_USERNAMES` set (src/index.ts:20-24)

### Development Setup

For local development, create `.dev.vars` file with GitHub OAuth configuration:
```
GITHUB_CLIENT_ID=<your github oauth client id>
GITHUB_CLIENT_SECRET=<your github oauth client secret>
COOKIE_ENCRYPTION_KEY=<random 32-byte hex string>
```

The KV namespace ID must be updated in `wrangler.jsonc` after creating the OAUTH_KV namespace.

### Web Crawling Workflow

1. **Tool Invocation**: Client calls `webCrawl` with URL and natural language query
2. **URL Validation**: Server validates the target URL for accessibility
3. **Page Rendering**: Cloudflare browser renders the webpage (including JavaScript)
4. **Content Extraction**: HTML is parsed to extract all links and metadata  
5. **AI Analysis**: Workers AI analyzes links against the user's query
6. **Results**: Relevant links are ranked by relevance score and returned with explanations