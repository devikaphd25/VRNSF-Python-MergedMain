/** Validate a new launch origin and preserve Android identity across updates. */
function launchOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('Provide only the HTTPS origin, such as https://example.trycloudflare.com');
  }
  return url.origin;
}
function nextVersion(previous, packageId) {
  if (previous && previous.packageId !== packageId) throw Error('Package ID differs from the existing app.');
  const previousCode = previous?.appVersionCode ?? 0;
  if (!Number.isSafeInteger(previousCode) || previousCode < 0 || previousCode >= 2100000000) {
    throw Error('Invalid existing Android version code.');
  }
  const code = previousCode + 1;
  return { code, name: `1.0.${code}` };
}
module.exports = { launchOrigin, nextVersion };
