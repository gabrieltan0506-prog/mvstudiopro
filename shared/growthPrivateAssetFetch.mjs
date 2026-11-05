/** Private release downloads using existing server-side credentials only.
 * Never attach credentials to github.com or release-storage redirect hosts.
 * Metadata deliberately is not cached: mutable pointer assets get new IDs.
 */
export function createGrowthPrivateAssetFetch({ repository, token, fetchImpl = fetch }) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || repository.split("/").some(part => part === "." || part === ".."))
    throw new Error("growth_private_repository_invalid");
  const [owner, repo] = repository.split("/");
  const apiPrefix = `/repos/${owner}/${repo}/releases/`;
  const redirects = new Set([301, 302, 303, 307, 308]);
  const cleanHeaders = headers => {
    const result = new Headers(headers);
    for (const name of ["authorization", "proxy-authorization", "cookie"]) result.delete(name);
    return result;
  };
  async function apiFetch(url, init, accept) {
    let current = new URL(url);
    for (let redirectsFollowed = 0; redirectsFollowed <= 5; redirectsFollowed++) {
      if (current.protocol !== "https:" || current.username || current.password)
        throw new Error("growth_private_redirect_unsafe");
      const headers = cleanHeaders(init.headers);
      headers.set("Accept", accept);
      // Auth is confined to this exact repository's release API. Even a GitHub
      // response redirect cannot carry it to storage/CDN hosts or other repos.
      if (current.origin === "https://api.github.com" && current.pathname.startsWith(apiPrefix)) {
        headers.set("Authorization", `Bearer ${token}`);
        headers.set("X-GitHub-Api-Version", "2022-11-28");
      }
      const response = await fetchImpl(current.href, { ...init, headers, redirect: "manual", credentials: "omit" });
      if (!redirects.has(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) throw new Error("growth_private_redirect_missing_location");
      await response.body?.cancel();
      current = new URL(location, current);
    }
    throw new Error("growth_private_redirect_limit");
  }
  return async function privateAssetFetch(input, init = {}) {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const inputUrl = request ? request.url : String(input);
    let url;
    try { url = new URL(inputUrl); } catch { /* normal fetch reports invalid/relative URL */ }
    const headers = cleanHeaders(init.headers ?? request?.headers);
    const segments = url?.pathname.split("/") || [];
    const privateDownload = url?.origin === "https://github.com" && !url.username && !url.password
      && segments.length === 7 && segments[1] === owner && segments[2] === repo
      && segments[3] === "releases" && segments[4] === "download";
    if (!privateDownload) {
      return fetchImpl(input, { ...init, headers, credentials: "omit" });
    }
    if (typeof token !== "string" || !token.trim()) throw new Error("growth_private_asset_token_missing");
    if (/[\r\n]/.test(token)) throw new Error("growth_private_asset_token_invalid");
    const method = String(init.method ?? request?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new Error("growth_private_asset_method_invalid");
    let tag, assetName;
    try { tag = decodeURIComponent(segments[5]); assetName = decodeURIComponent(segments[6]); }
    catch { throw new Error("growth_private_asset_path_invalid"); }
    if (!tag || !assetName || /[\x00-\x1f\x7f]/.test(tag + assetName)
      || /[\\/]/.test(assetName) || assetName === "." || assetName === "..")
      throw new Error("growth_private_asset_path_invalid");
    const apiInit = { ...init, method: "GET", body: undefined, headers, signal: init.signal ?? request?.signal };
    const metadataResponse = await apiFetch(`https://api.github.com${apiPrefix}tags/${encodeURIComponent(tag)}`, apiInit, "application/vnd.github+json");
    if (!metadataResponse.ok) return metadataResponse;
    let release;
    try { release = await metadataResponse.json(); } catch { throw new Error("growth_private_release_metadata_invalid"); }
    if (!Array.isArray(release?.assets)) throw new Error("growth_private_release_metadata_invalid");
    let asset = release.assets.find(value => value?.name === assetName);
    // The release response may not contain every asset. Enumerate only this
    // release's authenticated asset list if the requested name is absent.
    if (!asset && Number.isSafeInteger(release.id) && release.id > 0) {
      for (let page = 1; page <= 100; page++) {
        const response = await apiFetch(`https://api.github.com${apiPrefix}${release.id}/assets?per_page=100&page=${page}`, apiInit, "application/vnd.github+json");
        if (!response.ok) return response;
        const values = await response.json();
        if (!Array.isArray(values)) throw new Error("growth_private_release_assets_invalid");
        asset = values.find(value => value?.name === assetName);
        if (asset || values.length < 100) break;
        if (page === 100) throw new Error("growth_private_release_assets_limit");
      }
    }
    if (!asset || asset.state !== "uploaded") return new Response(null, { status: 404 });
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0) throw new Error("growth_private_release_asset_invalid");
    return apiFetch(`https://api.github.com${apiPrefix}assets/${asset.id}`, { ...apiInit, method }, "application/octet-stream");
  };
}
