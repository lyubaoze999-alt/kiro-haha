const HTML_EXT = /\.(html?|xhtml)$/i

function normalizePathForPolicy(filePath: string): string {
  return filePath
    .split(/[?#]/, 1)[0]!
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
}

export function isHtmlFilePath(filePath: string): boolean {
  return HTML_EXT.test(normalizePathForPolicy(filePath))
}

export function shouldOfferStaticHtmlPreview(filePath: string): boolean {
  const normalized = normalizePathForPolicy(filePath)
  if (!HTML_EXT.test(normalized)) return false
  // All HTML files are eligible for browser preview — users expect
  // clicking a generated HTML result to open the preview directly,
  // not the code view.  The server can serve any HTML file under the
  // session work dir via /preview-fs, so there's no technical reason
  // to restrict this to known static-output directories.
  return true
}
