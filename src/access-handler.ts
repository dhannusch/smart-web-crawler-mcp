import { Buffer } from "node:buffer";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import {
	clientIdAlreadyApproved,
	fetchUpstreamAuthToken,
	getUpstreamAuthorizeUrl,
	type Props,
	parseRedirectApproval,
	renderApprovalDialog,
} from "./workers-oauth-utils";

type EnvWithOauth = Env & { OAUTH_PROVIDER: OAuthHelpers };

export async function handleAccessRequest(
	request: Request,
	env: EnvWithOauth,
	_ctx: ExecutionContext,
) {
	const { pathname, searchParams } = new URL(request.url);

	if (request.method === "GET" && pathname === "/authorize") {
		const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
		const { clientId } = oauthReqInfo;
		if (!clientId) {
			return new Response("Invalid request", { status: 400 });
		}

		if (
			await clientIdAlreadyApproved(request, oauthReqInfo.clientId, env.COOKIE_ENCRYPTION_KEY)
		) {
			return redirectToAccess(request, env, oauthReqInfo);
		}

		return renderApprovalDialog(request, {
			client: await env.OAUTH_PROVIDER.lookupClient(clientId),
			server: {
				description: "This is a demo MCP Remote Server using Access for authentication.",
				logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
				name: "Cloudflare Access MCP Server", // optional
			},
			state: { oauthReqInfo }, // arbitrary data that flows through the form submission below
		});
	}

	if (request.method === "POST" && pathname === "/authorize") {
		// Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
		const { state, headers } = await parseRedirectApproval(request, env.COOKIE_ENCRYPTION_KEY);
		if (!state.oauthReqInfo) {
			return new Response("Invalid request", { status: 400 });
		}

		return redirectToAccess(request, env, state.oauthReqInfo, headers);
	}

	if (request.method === "GET" && pathname === "/callback") {
		// Get the oathReqInfo out of KV
		const oauthReqInfo = JSON.parse(
			Buffer.from(searchParams.get("state") ?? "", "base64url").toString(),
		) as AuthRequest;
		if (!oauthReqInfo.clientId) {
			return new Response("Invalid state", { status: 400 });
		}

		// Exchange the code for an access token
		const [accessToken, idToken, errResponse] = await fetchUpstreamAuthToken({
			client_id: env.ACCESS_CLIENT_ID,
			client_secret: env.ACCESS_CLIENT_SECRET,
			code: searchParams.get("code") ?? undefined,
			redirect_uri: new URL("/callback", request.url).href,
			upstream_url: env.ACCESS_TOKEN_URL,
		});
		if (errResponse) {
			return errResponse;
		}

		const idTokenClaims = await verifyToken(env, idToken);
		const user = {
			email: idTokenClaims.email,
			name: idTokenClaims.name,
			sub: idTokenClaims.sub,
		};

		// Return back to the MCP client a new token
		const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
			metadata: {
				label: user.name,
			},
			// This will be available on this.props inside MyMCP
			props: {
				accessToken,
				email: user.email,
				login: user.sub,
				name: user.name,
			} as Props,
			request: oauthReqInfo,
			scope: oauthReqInfo.scope,
			userId: user.sub,
		});
		return Response.redirect(redirectTo);
	}

	return new Response("Not Found", { status: 404 });
}

async function redirectToAccess(
	request: Request,
	env: Env,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.ACCESS_CLIENT_ID,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "openid email profile",
				state: Buffer.from(JSON.stringify(oauthReqInfo)).toString("base64url"),
				upstream_url: env.ACCESS_AUTHORIZATION_URL,
			}),
		},
		status: 302,
	});
}

/**
 * Helper to get the Access public keys from the certs endpoint
 */
async function fetchAccessPublicKey(env: Env, kid: string) {
	if (!env.ACCESS_JWKS_URL) {
		throw new Error("access jwks url not provided");
	}
	// TODO: cache this
	const resp = await fetch(env.ACCESS_JWKS_URL);
	const keys = (await resp.json()) as {
		keys: (JsonWebKey & { kid: string })[];
	};
	const jwk = keys.keys.filter((key) => key.kid === kid)[0];
	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{
			hash: "SHA-256",
			name: "RSASSA-PKCS1-v1_5",
		},
		false,
		["verify"],
	);
	return key;
}

/**
 * Parse a JWT into its respective pieces. Does not do any validation other than form checking.
 */
function parseJWT(token: string) {
	const tokenParts = token.split(".");

	if (tokenParts.length !== 3) {
		throw new Error("token must have 3 parts");
	}

	return {
		data: `${tokenParts[0]}.${tokenParts[1]}`,
		header: JSON.parse(Buffer.from(tokenParts[0], "base64url").toString()),
		payload: JSON.parse(Buffer.from(tokenParts[1], "base64url").toString()),
		signature: tokenParts[2],
	};
}

/**
 * Validates the provided token using the Access public key set
 */
async function verifyToken(env: Env, token: string) {
	const jwt = parseJWT(token);
	const key = await fetchAccessPublicKey(env, jwt.header.kid);

	const verified = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		Buffer.from(jwt.signature, "base64url"),
		Buffer.from(jwt.data),
	);

	if (!verified) {
		throw new Error("failed to verify token");
	}

	const claims = jwt.payload;
	const now = Math.floor(Date.now() / 1000);
	// Validate expiration
	if (claims.exp < now) {
		throw new Error("expired token");
	}

	return claims;
}
