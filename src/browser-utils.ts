/**
 * Browser utilities for web crawling using Cloudflare Browser Rendering API
 */

export interface BrowserRenderOptions {
	url: string;
	timeout?: number;
	waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface BrowserRenderResult {
	html: string;
	url: string;
	title?: string;
	status: number;
}

export class BrowserError extends Error {
	constructor(message: string, public code: string, public status?: number) {
		super(message);
		this.name = 'BrowserError';
	}
}

/**
 * Render a web page using Cloudflare Browser Rendering API
 */
export async function renderPage(
	browser: Fetcher,
	options: BrowserRenderOptions
): Promise<BrowserRenderResult> {
	const { url, timeout = 30000, waitUntil = 'load' } = options;

	try {
		// Validate URL
		new URL(url);
	} catch (error) {
		throw new BrowserError(`Invalid URL: ${url}`, 'INVALID_URL');
	}

	try {
		const response = await browser.fetch(`http://localhost:9222/json/runtime/evaluate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				expression: `
					(async () => {
						try {
							await page.goto('${url}', { 
								waitUntil: '${waitUntil}',
								timeout: ${timeout}
							});
							
							const title = await page.title();
							const html = await page.content();
							const finalUrl = page.url();
							
							return {
								html,
								url: finalUrl,
								title,
								status: 200
							};
						} catch (error) {
							return {
								error: error.message,
								status: error.name === 'TimeoutError' ? 408 : 500
							};
						}
					})()
				`
			})
		});

		if (!response.ok) {
			throw new BrowserError(
				`Browser request failed: ${response.status} ${response.statusText}`,
				'BROWSER_REQUEST_FAILED',
				response.status
			);
		}

		const result = await response.json() as any;
		
		if (result.error) {
			throw new BrowserError(
				`Browser rendering failed: ${result.error}`,
				result.status === 408 ? 'TIMEOUT' : 'RENDER_FAILED',
				result.status
			);
		}

		if (result.result?.value) {
			const { html, url: finalUrl, title, status } = result.result.value;
			return {
				html,
				url: finalUrl,
				title,
				status
			};
		} else {
			throw new BrowserError(
				'Unexpected browser response format',
				'INVALID_RESPONSE'
			);
		}

	} catch (error) {
		if (error instanceof BrowserError) {
			throw error;
		}
		
		// Handle network and other errors
		throw new BrowserError(
			`Browser operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
			'BROWSER_OPERATION_FAILED'
		);
	}
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
		const hostname = parsedUrl.hostname.toLowerCase();
		if (hostname === 'localhost' || 
			hostname === '127.0.0.1' || 
			hostname.startsWith('192.168.') ||
			hostname.startsWith('10.') ||
			hostname.startsWith('172.16.') ||
			hostname.startsWith('172.17.') ||
			hostname.startsWith('172.18.') ||
			hostname.startsWith('172.19.') ||
			hostname.startsWith('172.2') ||
			hostname.startsWith('172.30.') ||
			hostname.startsWith('172.31.')) {
			return { valid: false, reason: 'Private/local addresses are not allowed' };
		}
		
		return { valid: true };
	} catch (error) {
		return { valid: false, reason: 'Invalid URL format' };
	}
}

/**
 * Extract basic page information without full rendering (for quick checks)
 */
export async function getPageInfo(url: string): Promise<{ title?: string; status: number }> {
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			headers: {
				'User-Agent': 'Cloudflare-Workers-Web-Crawler/1.0'
			}
		});
		
		return {
			status: response.status
		};
	} catch (error) {
		return {
			status: 0 // Network error
		};
	}
}