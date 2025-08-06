# Web Crawler MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that provides intelligent web crawling capabilities. Built on Cloudflare Workers with browser rendering and AI-powered link extraction, this server enables clients to crawl web pages and extract relevant links based on natural language queries.

## Features

- **Intelligent Web Crawling**: Uses Cloudflare's headless browser to render JavaScript-heavy pages
- **AI-Powered Link Analysis**: Leverages Workers AI to analyze and rank links based on relevance to your query
- **OAuth Authentication**: Secure access control via GitHub OAuth through Cloudflare Access
- **Remote MCP Support**: Connect from MCP clients like Claude Desktop, Inspector, or Cursor

## Core Functionality

The server provides a `webCrawl` tool that takes:
- **URL**: The webpage to crawl
- **Query**: Natural language description of what links you're looking for

Example queries:
- "Get all the blog post links from this website"
- "Find all product pages in the electronics category"
- "Get links to all API reference documentation"
- "Find all GitHub repository links on this page"

## Getting Started

Clone the repo & install dependencies: `npm install`

### For Production

Create a new GitHub OAuth App in your GitHub account:
- Go to Settings → Developer settings → OAuth Apps → New OAuth App
- Set Authorization callback URL to: `https://web-crawler-mcp.<your-subdomain>.workers.dev/callback`
- Note your Client ID and generate a Client Secret

Set secrets via Wrangler:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put COOKIE_ENCRYPTION_KEY # Generate with: openssl rand -hex 32
```

#### Set up a KV namespace

- Create the KV namespace:
  `wrangler kv:namespace create "OAUTH_KV"`
- Update the KV namespace ID in `wrangler.jsonc`

#### Deploy & Test

Deploy the MCP server:
```bash
wrangler deploy
```

Test the remote server using [Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter `https://web-crawler-mcp.<your-subdomain>.workers.dev/sse` and connect. After GitHub authentication, you'll see the `webCrawl` tool available:

<img width="640" alt="image" src="https://github.com/user-attachments/assets/7973f392-0a9d-4712-b679-6dd23f824287" />

You now have a remote MCP server deployed!

### Access Control

This MCP server uses GitHub OAuth for authentication. All authenticated users can access the `userInfoOctokit` tool to get their GitHub profile information.

The `webCrawl` tool is restricted to specific GitHub users listed in the `ALLOWED_USERNAMES` configuration in `src/index.ts`:

```typescript
// Add GitHub usernames who should have access to web crawling
const ALLOWED_USERNAMES = new Set<string>([
  'your-github-username',
  // Add more GitHub usernames here
  // 'teammate-username',
  // 'coworker-username'
])
```

### Access the remote MCP server from Claude Desktop

Open Claude Desktop and navigate to Settings -> Developer -> Edit Config. This opens the configuration file that controls which MCP servers Claude can access.

Replace the content with the following configuration. Once you restart Claude Desktop, a browser window will open showing your OAuth login page. Complete the authentication flow to grant Claude access to your MCP server. After you grant access, the tools will become available for you to use.

```json
{
  "mcpServers": {
    "web-crawler": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://web-crawler-mcp.<your-subdomain>.workers.dev/sse"
      ]
    }
  }
}
```

Once the Tools (under 🔨) show up in the interface, you can ask Claude to use them. For example: "Could you crawl https://news.ycombinator.com and find all links related to AI or machine learning?"

### For Local Development

For local development and testing:

- Update your GitHub OAuth App callback URL to include: `http://localhost:8788/callback`
- Create a `.dev.vars` file in your project root with:

```
GITHUB_CLIENT_ID=<your github oauth client id>
GITHUB_CLIENT_SECRET=<your github oauth client secret>
COOKIE_ENCRYPTION_KEY=<random 32-byte hex string>
```

#### Develop & Test

Run the server locally to make it available at `http://localhost:8788`
`wrangler dev`

To test the local server, enter `http://localhost:8788/sse` into Inspector and hit connect. Once you follow the prompts, you'll be able to "List Tools".

#### Using Claude and other MCP Clients

When using Claude to connect to your remote MCP server, you may see some error messages. This is because Claude Desktop doesn't yet support remote MCP servers, so it sometimes gets confused. To verify whether the MCP server is connected, hover over the 🔨 icon in the bottom right corner of Claude's interface. You should see your tools available there.

#### Using Cursor and other MCP Clients

To connect Cursor with your MCP server, choose `Type`: "Command" and in the `Command` field, combine the command and args fields into one (e.g. `npx mcp-remote https://<your-worker-name>.<your-subdomain>.workers.dev/sse`).

Note that while Cursor supports HTTP+SSE servers, it doesn't support authentication, so you still need to use `mcp-remote` (and to use a STDIO server, not an HTTP one).

You can connect your MCP server to other MCP clients like Windsurf by opening the client's configuration file, adding the same JSON that was used for the Claude setup, and restarting the MCP client.

## How does it work?

### Architecture Overview

This web crawler MCP server combines several technologies to provide intelligent web crawling:

#### Browser Rendering
- Uses Cloudflare's headless browser API to render JavaScript-heavy websites
- Ensures all dynamic content is loaded before analysis
- Handles modern web applications that rely on client-side rendering

#### AI-Powered Analysis
- Leverages Cloudflare Workers AI to analyze extracted page content
- Interprets natural language queries to understand what links users are looking for
- Ranks and filters links based on relevance scores
- Provides reasoning for why each link is considered relevant

#### OAuth Authentication
- Integrates with GitHub OAuth for secure user authentication
- Uses Cloudflare's OAuth provider for token management
- Supports role-based access control for different tools

#### MCP Protocol
- Implements the Model Context Protocol for seamless integration with AI assistants
- Provides Server-Sent Events (SSE) endpoint for real-time communication
- Supports tool discovery and invocation from various MCP clients

### Web Crawling Workflow

1. **Authentication**: User authenticates via GitHub OAuth
2. **Tool Invocation**: Client calls `webCrawl` tool with URL and query
3. **Page Rendering**: Cloudflare browser renders the target webpage
4. **Content Extraction**: HTML is parsed to extract all links and metadata
5. **AI Analysis**: Workers AI analyzes links against the user's query
6. **Results**: Relevant links are ranked and returned with explanations
