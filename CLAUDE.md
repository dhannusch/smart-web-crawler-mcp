# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

- **Start development server**: `npm run dev` or `wrangler dev` (runs on port 8788)
- **Deploy to production**: `npm run deploy` or `wrangler deploy`
- **Type checking**: `npm run type-check` or `tsc --noEmit`
- **Generate Cloudflare Worker types**: `npm run cf-typegen` or `wrangler types`

## Project Architecture

This is a **Model Context Protocol (MCP) server** built on Cloudflare Workers that provides OAuth authentication via Cloudflare Access. The architecture combines several key components:

### Core Components

1. **OAuth Provider** (src/index.ts:72-79)
   - Uses `@cloudflare/workers-oauth-provider` as the main OAuth 2.1 server
   - Handles token issuance, validation, and management
   - Routes requests between MCP endpoints and Access authentication

2. **MCP Server** (src/index.ts:10-59)
   - `MyMCP` class extends `McpAgent` from the `agents/mcp` library
   - Defines tools like "add" (basic math) and "generateImage" (AI image generation)
   - Tools can be conditionally enabled based on user permissions via `ALLOWED_EMAILS`

3. **Access Handler** (src/access-handler.ts)
   - Manages the OAuth flow with Cloudflare Access
   - Handles authorization requests, callbacks, and token exchange
   - Validates JWT tokens from Access using JWKS endpoint

4. **OAuth Utilities** (src/workers-oauth-utils.ts)
   - Provides cookie-based client approval system
   - Renders HTML approval dialogs for OAuth authorization
   - Handles upstream OAuth token exchange

### Authentication Flow

1. Client connects to `/sse` or `/mcp` endpoints
2. OAuth provider redirects to `/authorize` for approval
3. User approves via HTML dialog, gets redirected to Access
4. Access redirects back to `/callback` with authorization code
5. Server exchanges code for Access tokens and creates MCP session
6. User identity and permissions are available in `this.props`

### Key Configuration

- **Environment Variables**: Access OAuth credentials, JWKS URL, cookie encryption key
- **KV Storage**: Used for OAuth state management (OAUTH_KV binding)
- **Durable Objects**: MCP server instances with persistent state
- **AI Binding**: Cloudflare AI for image generation (flux-1-schnell model)

### Tool Access Control

Tools are conditionally available based on user email:
- `add` tool: Available to all authenticated users
- `generateImage` tool: Restricted to emails in `ALLOWED_EMAILS` set (src/index.ts:8)

### Development Setup

For local development, create `.dev.vars` file with Access OAuth configuration. The KV namespace ID must be updated in `wrangler.jsonc`.