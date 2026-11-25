// Only stable releases are offered; pre-releases and malformed values are ignored.
function newerVersion(candidate, current) {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!pattern.test(candidate) || !pattern.test(current)) return false;
  const a = candidate.split('.').map(BigInt);
  const b = current.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
module.exports = { newerVersion };
