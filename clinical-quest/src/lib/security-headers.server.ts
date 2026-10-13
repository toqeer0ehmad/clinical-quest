export function applySecurityHeaders(response: Response): Response {
 if (response.status === 101) return response;
 const headers = new Headers(response.headers);
 headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' wss:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
 headers.set("Strict-Transport-Security","max-age=63072000; includeSubDomains");
 headers.set("X-Content-Type-Options","nosniff");
 headers.set("Referrer-Policy","strict-origin-when-cross-origin");
 headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
