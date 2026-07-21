/** Strip Domain= from upstream Set-Cookie so cookies bind to the web app host. */
export function sanitizeProxiedSetCookie(setCookie: string): string {
  return setCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^domain=/i.test(part))
    .join("; ");
}

export function appendProxiedSetCookies(response: Headers, upstream: Headers) {
  const setCookies =
    typeof upstream.getSetCookie === "function" ? upstream.getSetCookie() : [];

  if (setCookies.length > 0) {
    for (const setCookie of setCookies) {
      response.append("set-cookie", sanitizeProxiedSetCookie(setCookie));
    }
    return;
  }

  const single = upstream.get("set-cookie");
  if (single) response.set("set-cookie", sanitizeProxiedSetCookie(single));
}
