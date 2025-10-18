import { JSDOM } from "jsdom";

const testChangelog = `
<p><strong>V5.1 (HotFix):</strong></p>
<ul>
  <li>Now properly sorts alphabetically based on their name in the lang file (Only for Vanilla items)
    <ul>
      <li>If there is no item name in the lang file it will fall back to using their item id.</li>
      <li>Sort importance: Item Named in anvil &gt; Item Name in Lang file &gt; Item ID</li>
    </ul>
  </li>
</ul>

<p><strong>V5.2 (HotFix):</strong></p>
<ul>
  <li>Now properly sorts alphabetically based on their name in the lang file (Only for Vanilla items)
    <ul>
      <li>If there is no item name in the lang file it will fall back to using their item id.</li>
      <li>Sort importance: Item Named in anvil &gt; Item Name in Lang file &gt; Item ID</li>
    </ul>
  </li>
</ul>
`;

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

function formatChangelogV4(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  let out = '';

  const sections = doc.querySelectorAll('p');

  sections.forEach(pEl => {
    // Format header
    let header = pEl.innerHTML.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
    header = header.replace(/<\/?[^>]+>/g, '');
    header = stripAndCollapse(header);
    if (header) out += header + '\n';

    // Find the <ul> immediately after this <p>
    let ul = pEl.nextElementSibling;
    if (ul && ul.tagName.toLowerCase() === 'ul') {
      const firstLi = ul.querySelector('li');
      if (firstLi) {
        // main text
        const clone = firstLi.cloneNode(true);
        const nested = clone.querySelector('ul');
        if (nested) nested.remove();
        const mainText = stripAndCollapse(clone.textContent || '');
        if (mainText) out += '- ' + mainText + '\n';

        // nested list
        const nestedOriginal = firstLi.querySelector('ul');
        if (nestedOriginal) {
          nestedOriginal.querySelectorAll('li').forEach(li => {
            const txt = stripAndCollapse(li.textContent || '');
            if (txt) out += '  ➤ ' + txt + '\n';
          });
        }
      }
    }
  });

  return out.trim() + (out.trim() ? '\n' : '');
}

console.log(formatChangelogV4(testChangelog));