/**
 * AI-powered link analysis for web crawling
 * Uses Cloudflare Workers AI to analyze and rank links based on user queries
 */

import type { ExtractedLink, ExtractedContent } from './content-extractor'

export interface AnalyzedLink extends ExtractedLink {
  relevanceScore: number
  reasoning: string
}

export interface LinkAnalysisResult {
  relevantLinks: AnalyzedLink[]
  totalAnalyzed: number
  queryInterpretation: string
}

/**
 * Analyze links using AI to determine relevance to user query
 */
export async function analyzeLinksWithAI(
  ai: Ai,
  extractedContent: ExtractedContent,
  userQuery: string,
  maxLinks: number = 20,
): Promise<LinkAnalysisResult> {
  // Validate inputs
  if (!userQuery || userQuery.trim().length === 0) {
    return {
      relevantLinks: [],
      totalAnalyzed: 0,
      queryInterpretation: 'Empty query provided',
    }
  }

  // Limit the number of links to analyze for performance and cost reasons
  const linksToAnalyze = extractedContent.links.slice(0, maxLinks)

  if (linksToAnalyze.length === 0) {
    return {
      relevantLinks: [],
      totalAnalyzed: 0,
      queryInterpretation: 'No links found on the page to analyze',
    }
  }

  // For very short queries, be more permissive with fallback analysis
  const isShortQuery = userQuery.trim().split(/\s+/).length <= 2

  // Create the AI prompt for link analysis
  const prompt = createLinkAnalysisPrompt(extractedContent, linksToAnalyze, userQuery)

  try {
    // Use a text generation model for analysis
    const response = await ai.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'You are a web crawling assistant that analyzes links for relevance to user queries. Respond only with valid JSON as specified.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 2048,
      temperature: 0.1, // Low temperature for consistent analysis
    })

    // Parse the AI response
    const aiResponseText = typeof response.response === 'string' ? response.response : JSON.stringify(response.response)
    const analysisResult = parseAIResponse(aiResponseText, linksToAnalyze)

    // If AI found no relevant links but we have a short query, try fallback with lower threshold
    if (analysisResult.relevantLinks.length === 0 && isShortQuery) {
      const fallbackResult = fallbackTextAnalysis(linksToAnalyze, userQuery, 0.05) // Lower threshold
      if (fallbackResult.relevantLinks.length > 0) {
        return {
          ...fallbackResult,
          queryInterpretation: `${analysisResult.queryInterpretation} (enhanced with text matching)`,
        }
      }
    }

    return {
      relevantLinks: analysisResult.relevantLinks,
      totalAnalyzed: linksToAnalyze.length,
      queryInterpretation: analysisResult.queryInterpretation,
    }
  } catch (error) {
    // Fallback to simple text matching if AI fails
    console.error('AI analysis failed, falling back to text matching:', error)
    return fallbackTextAnalysis(linksToAnalyze, userQuery, isShortQuery ? 0.05 : 0.1)
  }
}

/**
 * Create a structured prompt for AI link analysis
 */
function createLinkAnalysisPrompt(content: ExtractedContent, links: ExtractedLink[], query: string): string {
  // Create a concise summary of the page context
  const pageContext = `
Page Title: ${content.title || 'Unknown'}
Page Content Summary: ${content.pageText.substring(0, 500)}...
Total Links Found: ${links.length}
	`.trim()

  // Format links for analysis
  const linksList = links.map((link, index) => `${index + 1}. "${link.text}" -> ${link.url} (${link.type})`).join('\n')

  return `
Analyze the following links from a web page to determine their relevance to the user's query.

USER QUERY: "${query}"

PAGE CONTEXT:
${pageContext}

LINKS TO ANALYZE:
${linksList}

TASK: Analyze each link and determine its relevance to the user query. Consider:
1. How well the link text matches the query intent
2. How the URL path/structure relates to the query
3. Whether the link type (internal/external) is appropriate for the query
4. The context of the page where these links appear
5. Semantic similarity even if exact words don't match

SCORING GUIDELINES:
- 0.9-1.0: Perfect match - link directly addresses the query
- 0.7-0.8: High relevance - strong connection to query intent
- 0.5-0.6: Moderate relevance - related but not primary focus
- 0.3-0.4: Low relevance - tangentially related
- 0.0-0.2: Not relevant - no clear connection

Respond with ONLY a valid JSON object in this exact format:
{
  "queryInterpretation": "Brief explanation of how you interpreted the user's query and what type of links would be most relevant",
  "links": [
    {
      "index": 1,
      "relevanceScore": 0.95,
      "reasoning": "Brief explanation of why this link is relevant"
    }
  ]
}

IMPORTANT RULES:
- relevanceScore: Must be between 0.0 and 1.0
- Only include links with relevanceScore >= 0.3 (unless very few links match, then include >= 0.2)
- Maximum 15 links in response
- Sort by relevanceScore descending
- Keep reasoning under 50 words per link
- Be generous with interpretation - consider synonyms and related concepts
- Respond with valid JSON only, no other text`.trim()
}

/**
 * Parse AI response and create analyzed links
 */
function parseAIResponse(
  aiResponse: string,
  originalLinks: ExtractedLink[],
): {
  relevantLinks: AnalyzedLink[]
  queryInterpretation: string
} {
  try {
    // Clean up the response - remove any markdown formatting or extra text
    let cleanResponse = aiResponse.trim()

    // Look for JSON object - try multiple patterns
    let jsonMatch = cleanResponse.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      // Try to find JSON within code blocks
      const codeBlockMatch = cleanResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]]
      }
    }

    if (!jsonMatch) {
      throw new Error('No JSON found in AI response')
    }

    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      // Try to fix common JSON issues
      let fixedJson = jsonMatch[0]
        .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // Add quotes to keys
        .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*([,}])/g, ':"$1"$2') // Add quotes to string values

      parsed = JSON.parse(fixedJson)
    }

    const relevantLinks: AnalyzedLink[] = []

    // Ensure parsed.links is an array
    const links = Array.isArray(parsed.links) ? parsed.links : []

    // Process each analyzed link
    for (const linkAnalysis of links) {
      // Validate required fields
      if (typeof linkAnalysis.index !== 'number' || typeof linkAnalysis.relevanceScore !== 'number') {
        continue
      }

      const linkIndex = linkAnalysis.index - 1 // Convert to 0-based index

      if (linkIndex >= 0 && linkIndex < originalLinks.length) {
        const originalLink = originalLinks[linkIndex]

        // Validate and clamp relevance score
        let score = linkAnalysis.relevanceScore
        if (isNaN(score)) score = 0
        score = Math.max(0, Math.min(1, score))

        const analyzedLink: AnalyzedLink = {
          ...originalLink,
          relevanceScore: score,
          reasoning:
            typeof linkAnalysis.reasoning === 'string' && linkAnalysis.reasoning.trim()
              ? linkAnalysis.reasoning.trim()
              : 'No reasoning provided',
        }

        // Only include links with meaningful scores
        if (score >= 0.2) {
          relevantLinks.push(analyzedLink)
        }
      }
    }

    // Sort by relevance score descending
    relevantLinks.sort((a, b) => b.relevanceScore - a.relevanceScore)

    // Ensure we have a query interpretation
    let queryInterpretation = 'Query analysis not provided'
    if (typeof parsed.queryInterpretation === 'string' && parsed.queryInterpretation.trim()) {
      queryInterpretation = parsed.queryInterpretation.trim()
    }

    return {
      relevantLinks,
      queryInterpretation,
    }
  } catch (error) {
    console.error('Failed to parse AI response:', error, 'Response:', aiResponse)
    throw new Error(`Invalid AI response format: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fallback text-based analysis when AI fails
 */
function fallbackTextAnalysis(links: ExtractedLink[], query: string, minThreshold: number = 0.1): LinkAnalysisResult {
  const queryLower = query.toLowerCase()
  const queryWords = queryLower.split(/\s+/).filter((word) => word.length > 2)

  const analyzedLinks: AnalyzedLink[] = links
    .map((link) => {
      const textLower = link.text.toLowerCase()
      const urlLower = link.url.toLowerCase()

      // Simple scoring based on word matches
      let score = 0
      for (const word of queryWords) {
        if (textLower.includes(word)) score += 0.4
        if (urlLower.includes(word)) score += 0.3
      }

      // Bonus for exact phrase match
      if (textLower.includes(queryLower)) score += 0.3
      if (urlLower.includes(queryLower)) score += 0.2

      // Cap the score at 1.0
      score = Math.min(1.0, score)

      return {
        ...link,
        relevanceScore: score,
        reasoning: score > 0 ? 'Text matching fallback analysis' : 'No text match found',
      }
    })
    .filter((link) => link.relevanceScore > minThreshold)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)

  return {
    relevantLinks: analyzedLinks,
    totalAnalyzed: links.length,
    queryInterpretation: `Fallback text analysis for: "${query}"`,
  }
}
