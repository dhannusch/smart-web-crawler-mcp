/**
 * Content extraction utilities for web crawling
 * Parses HTML content to extract links and relevant text for AI analysis
 */

export interface ExtractedContent {
	links: ExtractedLink[];
	pageText: string;
	title?: string;
}

export interface ExtractedLink {
	url: string;
	text: string;
	type: 'internal' | 'external';
}

/**
 * Extract links and content from HTML for AI analysis
 */
export function extractPageContent(html: string, baseUrl: string): ExtractedContent {
	// Parse HTML - basic regex-based parsing for Worker environment
	const links = extractLinks(html, baseUrl);
	const pageText = extractText(html);
	const title = extractTitle(html);

	return {
		links,
		pageText,
		title
	};
}

/**
 * Extract all links from HTML content
 */
function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
	const links: ExtractedLink[] = [];
	const baseUrlObj = new URL(baseUrl);
	
	// Match all <a> tags with href attributes
	const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*(?:<[^>]*>[^<]*)*?)<\/a>/gi;
	let match;

	while ((match = linkRegex.exec(html)) !== null) {
		const href = match[1];
		const linkText = match[2]
			.replace(/<[^>]*>/g, '') // Remove HTML tags
			.replace(/\s+/g, ' ') // Normalize whitespace
			.trim();

		// Skip empty links or non-content links
		if (!href || isNonContentLink(href) || !linkText) {
			continue;
		}

		try {
			const absoluteUrl = resolveUrl(href, baseUrl);
			const absoluteUrlObj = new URL(absoluteUrl);
			
			const link: ExtractedLink = {
				url: absoluteUrl,
				text: linkText,
				type: absoluteUrlObj.hostname === baseUrlObj.hostname ? 'internal' : 'external'
			};

			// Avoid duplicates
			if (!links.some(l => l.url === absoluteUrl)) {
				links.push(link);
			}
		} catch (error) {
			// Skip malformed URLs
			continue;
		}
	}

	return links;
}

/**
 * Extract readable text content from HTML
 */
function extractText(html: string): string {
	// Remove script and style elements completely
	let text = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
	
	// Remove HTML tags but keep the text content
	text = text.replace(/<[^>]*>/g, ' ');
	
	// Decode common HTML entities
	text = text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
	
	// Normalize whitespace
	text = text.replace(/\s+/g, ' ').trim();
	
	// Limit text length for AI processing (keep first 3000 chars)
	return text.length > 3000 ? text.substring(0, 3000) + '...' : text;
}

/**
 * Extract page title from HTML
 */
function extractTitle(html: string): string | undefined {
	const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	return titleMatch ? titleMatch[1].trim() : undefined;
}

/**
 * Resolve relative URLs to absolute URLs
 */
function resolveUrl(href: string, baseUrl: string): string {
	// Already absolute URL
	if (href.startsWith('http://') || href.startsWith('https://')) {
		return href;
	}
	
	// Protocol-relative URL
	if (href.startsWith('//')) {
		const baseUrlObj = new URL(baseUrl);
		return baseUrlObj.protocol + href;
	}
	
	// Absolute path
	if (href.startsWith('/')) {
		const baseUrlObj = new URL(baseUrl);
		return `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`;
	}
	
	// Relative path
	const baseUrlObj = new URL(baseUrl);
	const basePath = baseUrlObj.pathname.endsWith('/') 
		? baseUrlObj.pathname 
		: baseUrlObj.pathname.replace(/\/[^\/]*$/, '/');
	
	return `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}${href}`;
}

/**
 * Check if a link should be filtered out (CSS, JS, images, etc.)
 */
function isNonContentLink(href: string): boolean {
	const url = href.toLowerCase();
	
	// File extensions to filter out
	const nonContentExtensions = [
		'.css', '.js', '.json', '.xml', '.rss', '.atom',
		'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico',
		'.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
		'.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
		'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
	];
	
	// Check file extensions
	for (const ext of nonContentExtensions) {
		if (url.endsWith(ext)) {
			return true;
		}
	}
	
	// Filter out common non-content URL patterns
	const nonContentPatterns = [
		'mailto:', 'tel:', 'ftp:', 'file:',
		'javascript:', 'data:',
		'#', // Fragment-only links
		'/feed', '/rss', '/sitemap',
		'/wp-content/', '/wp-includes/',
		'/assets/', '/static/', '/media/',
		'?format=', '&format=',
		'/print/', '/download/'
	];
	
	for (const pattern of nonContentPatterns) {
		if (url.includes(pattern)) {
			return true;
		}
	}
	
	return false;
}