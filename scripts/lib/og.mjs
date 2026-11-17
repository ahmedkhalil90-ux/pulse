/**
 * Share previews. WhatsApp, Telegram, X and iMessage read Open Graph tags from
 * the raw HTML and never run the app, so a shared question link needs its own
 * static page: a copy of index.html whose tags carry that question.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function ogTags({ title, description, url, image }) {
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Pulse" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="description" content="${esc(description)}" />`,
  ].join('\n    ');
}

/** index.html with the tags between the og markers replaced by this question's. */
export function questionPage(indexHtml, q, origin) {
  const [a, b] = q.options ?? [];
  const tags = ogTags({
    title: q.text,
    description: `${a} or ${b}? Answer anonymously and see what everyone picked.`,
    url: `${origin}/q/${encodeURIComponent(q.id)}`,
    image: `${origin}/og.png`,
  });
  const re = /<!-- og:start -->[\s\S]*?<!-- og:end -->/;
  if (!re.test(indexHtml)) throw new Error('index.html has no og markers');
  return indexHtml.replace(re, `<!-- og:start -->\n    ${tags}\n    <!-- og:end -->`).replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(q.text)} · Pulse</title>`);
}
