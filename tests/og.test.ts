import { describe, expect, it } from 'vitest';
import { questionPage } from '../scripts/lib/og.mjs';

const INDEX = `<html><head><title>Pulse</title>
    <!-- og:start -->
    <meta property="og:title" content="Pulse" />
    <!-- og:end -->
  </head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`;

describe('share preview pages', () => {
  const page = questionPage(INDEX, { id: 'seed_5', text: 'Karak or "flat white" <b>?', options: ['Karak', 'Flat white'] }, 'https://x.web.app');
  it('carries the question as the preview title, escaped', () => {
    expect(page).toContain('<meta property="og:title" content="Karak or &quot;flat white&quot; &lt;b&gt;?" />');
    expect(page).not.toContain('content="Pulse" />\n    <!-- og:end');
  });
  it('names both options and the question link', () => {
    expect(page).toContain('Karak or Flat white? Answer anonymously');
    expect(page).toContain('content="https://x.web.app/q/seed_5"');
    expect(page).toContain('content="https://x.web.app/og.png"');
  });
  it('still loads the app', () => expect(page).toContain('<script src="/assets/app.js"></script>'));
  it('refuses an index.html without the markers, so previews cannot silently vanish', () => {
    expect(() => questionPage('<html></html>', { id: 'a', text: 't', options: ['a', 'b'] }, 'https://x')).toThrow();
  });
});
