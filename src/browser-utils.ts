/**
 * Browser utilities for web crawling using Cloudflare Browser Rendering API
 */

import puppeteer from '@cloudflare/puppeteer'

export interface BrowserRenderOptions {
	url: string;
	timeout?: number;
	waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
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

	let browserInstance;
	let page;

	try {
		// Launch browser using Cloudflare's Puppeteer
		browserInstance = await puppeteer.launch(browser);
		page = await browserInstance.newPage();

		// Set timeout for navigation
		page.setDefaultTimeout(timeout);

		// Navigate to the URL
		const response = await page.goto(url, { 
			waitUntil: waitUntil as any,
			timeout: timeout
		});

		// Get page content and metadata
		const title = await page.title();
		const html = await page.content();
		const finalUrl = page.url();
		const status = response?.status() || 200;

		return {
			html,
			url: finalUrl,
			title,
			status
		};

	} catch (error) {
		if (error instanceof Error) {
			if (error.name === 'TimeoutError') {
				throw new BrowserError(
					`Page load timeout: ${url}`,
					'TIMEOUT',
					408
				);
			}
			throw new BrowserError(
				`Browser rendering failed: ${error.message}`,
				'RENDER_FAILED'
			);
		}
		
		throw new BrowserError(
			`Browser operation failed: Unknown error`,
			'BROWSER_OPERATION_FAILED'
		);
	} finally {
		// Clean up resources
		try {
			if (page) await page.close();
			if (browserInstance) await browserInstance.close();
		} catch (cleanupError) {
			console.warn('Browser cleanup warning:', cleanupError);
		}
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