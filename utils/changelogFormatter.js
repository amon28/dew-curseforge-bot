import { JSDOM } from "jsdom";

function decodeEntities(str) {
  return str
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function stripAndCollapse(s) {
  return decodeEntities(s.replace(/\s+/g, ' ').trim());
}

export function formatChangelog(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  let out = '';

  const sections = doc.querySelectorAll('p');

  sections.forEach(pEl => {
    // Format header
    let header = pEl.innerHTML.replace(
      /<strong[^>]*>([\s\S]*?)<\/strong>/gi,
      '**$1**'
    );
    header = header.replace(/<\/?[^>]+>/g, '');
    header = stripAndCollapse(header);

    if (header) out += header + '\n';

    // Find the <ul> immediately after this <p>
    let ul = pEl.nextElementSibling;
    if (!ul || ul.tagName.toLowerCase() !== 'ul') return;

    // ✅ FIX: handle multiple top-level <li>
    const liItems = ul.querySelectorAll(':scope > li');

    liItems.forEach(li => {
      // Main text (without nested lists)
      const clone = li.cloneNode(true);
      const nested = clone.querySelector('ul');
      if (nested) nested.remove();

      const mainText = stripAndCollapse(clone.textContent || '');
      if (mainText) out += '- ' + mainText + '\n';

      // Nested list (one level deep)
      const nestedOriginal = li.querySelector('ul');
      if (nestedOriginal) {
        nestedOriginal
          .querySelectorAll(':scope > li')
          .forEach(nestedLi => {
            const txt = stripAndCollapse(nestedLi.textContent || '');
            if (txt) out += '  ➤ ' + txt + '\n';
          });
      }
    });
  });

  return out.trim() + (out.trim() ? '\n' : '');
}