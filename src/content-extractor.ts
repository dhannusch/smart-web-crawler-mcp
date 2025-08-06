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
 * Extract content from markdown with pre-extracted links
 */
export function extractPageContentFromMarkdown(
	markdown: string, 
	baseUrl: string, 
	extractedLinks: string[]
): ExtractedContent {
	const links = processExtractedLinks(extractedLinks, baseUrl);
	const pageText = extractTextFromMarkdown(markdown);
	const title = extractTitleFromMarkdown(markdown);
	
	return {
		links,
		pageText,
		title
	};
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

/**
 * Process pre-extracted links from Cloudflare Browser API
 */
function processExtractedLinks(extractedLinks: string[], baseUrl: string): ExtractedLink[] {
	const links: ExtractedLink[] = [];
	const baseUrlObj = new URL(baseUrl);
	
	for (const url of extractedLinks) {
		// Skip non-content links
		if (isNonContentLink(url)) {
			continue;
		}
		
		try {
			const absoluteUrl = resolveUrl(url, baseUrl);
			const absoluteUrlObj = new URL(absoluteUrl);
			
			// Generate a basic text representation from URL
			const linkText = generateLinkText(absoluteUrl);
			
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
 * Generate link text from URL when actual link text is not available
 */
function generateLinkText(url: string): string {
	try {
		const urlObj = new URL(url);
		
		// Use the last part of the pathname if available
		if (urlObj.pathname && urlObj.pathname !== '/') {
			const pathParts = urlObj.pathname.split('/').filter(Boolean);
			if (pathParts.length > 0) {
				const lastPart = pathParts[pathParts.length - 1];
				// Clean up common file extensions and make readable
				return lastPart
					.replace(/\.[^.]*$/, '') // Remove file extension
					.replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
					.replace(/\b\w/g, l => l.toUpperCase()); // Title case
			}
		}
		
		// Fallback to hostname
		return urlObj.hostname.replace(/^www\./, '');
	} catch (error) {
		// Fallback to the URL itself if parsing fails
		return url.length > 50 ? url.substring(0, 50) + '...' : url;
	}
}

/**
 * Extract readable text content from markdown
 */
function extractTextFromMarkdown(markdown: string): string {
	// Remove markdown syntax but keep the text content
	let text = markdown
		// Remove code blocks
		.replace(/```[\s\S]*?```/g, '')
		// Remove inline code
		.replace(/`[^`]*`/g, '')
		// Remove headers markdown but keep text
		.replace(/^#{1,6}\s+(.*)$/gm, '$1')
		// Remove bold/italic markdown
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		// Remove links but keep text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		// Remove images
		.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
		// Remove horizontal rules
		.replace(/^---+$/gm, '')
		// Remove blockquote markers
		.replace(/^>\s+/gm, '');
	
	// Normalize whitespace
	text = text.replace(/\s+/g, ' ').trim();
	
	// Limit text length for AI processing (keep first 3000 chars)
	return text.length > 3000 ? text.substring(0, 3000) + '...' : text;
}

/**
 * Extract page title from markdown (first # heading)
 */
function extractTitleFromMarkdown(markdown: string): string | undefined {
	const titleMatch = markdown.match(/^#\s+(.+)$/m);
	return titleMatch ? titleMatch[1].trim() : undefined;
}