/**
 * Browser utilities for web crawling using Cloudflare Browser Rendering REST API
 */

export interface BrowserRenderOptions {
	url: string;
	timeout?: number;
	rejectRequestPattern?: string[];
}

export interface BrowserRenderResult {
	html: string;
	markdown: string;
	url: string;
	title?: string;
	status: number;
}

export interface LinksResult {
	links: string[];
	url: string;
	status: number;
}

export interface CloudflareBrowserBinding {
	accountId: string;
	apiToken: string;
}

interface CloudflareApiResponse<T> {
	success: boolean;
	result: T;
	errors?: Array<{ code: number; message: string }>;
}

export class BrowserError extends Error {
	constructor(message: string, public code: string, public status?: number) {
		super(message);
		this.name = 'BrowserError';
	}
}

/**
 * Render a web page using Cloudflare Browser Rendering REST API
 */
export async function renderPage(
	browserConfig: CloudflareBrowserBinding,
	options: BrowserRenderOptions
): Promise<BrowserRenderResult> {
	const { url, timeout = 30000, rejectRequestPattern } = options;

	// Validate URL
	await validateUrlOrThrow(url);

	try {
		// Prepare request body
		const requestBody: any = { url };
		if (rejectRequestPattern) {
			requestBody.rejectRequestPattern = rejectRequestPattern;
		}

		// Call Cloudflare Browser Rendering API
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${browserConfig.accountId}/browser-rendering/markdown`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${browserConfig.apiToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(requestBody),
				signal: AbortSignal.timeout(timeout)
			}
		);

		if (!response.ok) {
			throw new BrowserError(
				`API request failed: ${response.status} ${response.statusText}`,
				'API_ERROR',
				response.status
			);
		}

		const data = await response.json() as CloudflareApiResponse<string>;

		if (!data.success) {
			throw new BrowserError(
				`Browser rendering failed: ${JSON.stringify(data.errors || 'Unknown error')}`,
				'RENDER_FAILED'
			);
		}

		// Extract title from markdown content (first # heading)
		const markdown = data.result;
		const titleMatch = markdown.match(/^# (.+)$/m);
		const title = titleMatch ? titleMatch[1] : undefined;

		return {
			html: '', // HTML not available from markdown endpoint
			markdown,
			url,
			title,
			status: response.status
		};

	} catch (error) {
		throw handleBrowserError(error, url, 'Browser rendering failed');
	}
}

/**
 * Extract links from a web page using Cloudflare Browser Rendering REST API
 */
export async function extractLinks(
	browserConfig: CloudflareBrowserBinding,
	url: string,
	visibleLinksOnly: boolean = false,
	timeout: number = 30000
): Promise<LinksResult> {
	// Validate URL
	await validateUrlOrThrow(url);

	try {
		// Call Cloudflare Browser Rendering API
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${browserConfig.accountId}/browser-rendering/links`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${browserConfig.apiToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ url, visibleLinksOnly }),
				signal: AbortSignal.timeout(timeout)
			}
		);

		if (!response.ok) {
			throw new BrowserError(
				`API request failed: ${response.status} ${response.statusText}`,
				'API_ERROR',
				response.status
			);
		}

		const data = await response.json() as CloudflareApiResponse<string[]>;

		if (!data.success) {
			throw new BrowserError(
				`Link extraction failed: ${JSON.stringify(data.errors || 'Unknown error')}`,
				'EXTRACTION_FAILED'
			);
		}

		return {
			links: data.result,
			url,
			status: response.status
		};

	} catch (error) {
		throw handleBrowserError(error, url, 'Link extraction failed');
	}
}

/**
 * Validate URL and throw error if invalid
 */
async function validateUrlOrThrow(url: string): Promise<void> {
	const validation = await validateUrl(url);
	if (!validation.valid) {
		throw new BrowserError(`Invalid URL: ${validation.reason}`, 'INVALID_URL');
	}
}

/**
 * Handle browser operation errors consistently
 */
function handleBrowserError(error: unknown, url: string, operation: string): BrowserError {
	if (error instanceof BrowserError) {
		return error;
	}
	
	if (error instanceof Error) {
		if (error.name === 'TimeoutError' || error.name === 'AbortError') {
			return new BrowserError(
				`Request timeout: ${url}`,
				'TIMEOUT',
				408
			);
		}
		return new BrowserError(
			`${operation}: ${error.message}`,
			'OPERATION_FAILED'
		);
	}
	
	return new BrowserError(
		`${operation}: Unknown error`,
		'OPERATION_FAILED'
	);
}

/**
 * Check if hostname is a private or local address
 */
function isPrivateOrLocalAddress(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	
	// Localhost variations
	if (lower === 'localhost' || lower === '127.0.0.1') {
		return true;
	}
	
	// Private IP ranges (RFC 1918)
	const privatePatterns = [
		'192.168.',  // Class C private (192.168.0.0 - 192.168.255.255)
		'10.',       // Class A private (10.0.0.0 - 10.255.255.255)
		'172.16.', '172.17.', '172.18.', '172.19.', // Class B private range start
		'172.20.', '172.21.', '172.22.', '172.23.',
		'172.24.', '172.25.', '172.26.', '172.27.',
		'172.28.', '172.29.', '172.30.', '172.31.'  // Class B private range end
	];
	
	return privatePatterns.some(pattern => lower.startsWith(pattern));
}

/**
 * Check if a URL is accessible and safe to crawl
 */
export async function validateUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
	try {
		const parsedUrl = new URL(url);
		
		// Basic security checks
		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			return { valid: false, reason: 'Only HTTP and HTTPS protocols are supported' };
		}
		
		// Prevent localhost/private IP access
		if (isPrivateOrLocalAddress(parsedUrl.hostname)) {
			return { valid: false, reason: 'Private/local addresses are not allowed' };
		}
		
		return { valid: true };
	} catch (error) {
		return { valid: false, reason: 'Invalid URL format' };
	}
}

