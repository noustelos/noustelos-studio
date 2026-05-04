const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const siteOrigin = 'https://noustelos.gr';

const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const walkFiles = (directory, predicate) => {
  const results = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
    } else if (!predicate || predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
};

const relative = (fullPath) => path.relative(rootDir, fullPath).split(path.sep).join('/');

const stripUrlDecorations = (url) => url.split('#')[0].split('?')[0].trim();

const isExternalOrVirtualUrl = (url) => {
  const trimmed = url.trim();

  return (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(trimmed)
  );
};

const resolveLocalUrl = (fromFile, url) => {
  const cleanUrl = decodeURIComponent(stripUrlDecorations(url));

  if (cleanUrl === '/') {
    return rootDir;
  }

  if (cleanUrl.startsWith('/')) {
    return path.join(rootDir, cleanUrl.slice(1));
  }

  return path.resolve(path.dirname(fromFile), cleanUrl);
};

const assertLocalTargetExists = (fromFile, url) => {
  if (isExternalOrVirtualUrl(url)) {
    return;
  }

  const target = resolveLocalUrl(fromFile, url);
  const exists =
    fs.existsSync(target) ||
    fs.existsSync(`${target}.html`) ||
    fs.existsSync(path.join(target, 'index.html'));

  assert.ok(exists, `${relative(fromFile)} references missing local target: ${url}`);
};

const getHtmlAttributeValues = (html, attributeName) => {
  const attributeRegex = new RegExp(`\\b${attributeName}=["']([^"']+)["']`, 'gi');
  return [...html.matchAll(attributeRegex)].map((match) => match[1]);
};

const getMetaContent = (html, name) => {
  const metaRegex = new RegExp(
    `<meta\\b(?=[^>]*\\bname=["']${name}["'])(?=[^>]*\\bcontent=["']([^"']+)["'])[^>]*>`,
    'i'
  );
  return html.match(metaRegex)?.[1] || null;
};

const getCanonical = (html) => {
  return html.match(/<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/i)?.[1] || null;
};

const getSitemapLocations = () => {
  const sitemap = read('sitemap.xml');
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
};

const siteUrlToFile = (siteUrl) => {
  const url = new URL(siteUrl);
  assert.equal(url.origin, siteOrigin, `${siteUrl} must stay on ${siteOrigin}`);

  if (url.pathname === '/') {
    return 'index.html';
  }

  if (url.pathname.endsWith('/')) {
    return `${url.pathname.slice(1)}index.html`;
  }

  return url.pathname.slice(1);
};

const fileToSiteUrl = (relativePath) => {
  if (relativePath === 'index.html') {
    return `${siteOrigin}/`;
  }

  if (relativePath.endsWith('/index.html')) {
    return `${siteOrigin}/${relativePath.replace(/index\.html$/, '')}`;
  }

  return `${siteOrigin}/${relativePath}`;
};

const extractBalancedObject = (source, declaration) => {
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, `Missing declaration: ${declaration}`);

  const objectStart = source.indexOf('{', declarationIndex);
  assert.notEqual(objectStart, -1, `Missing object for: ${declaration}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && nextChar === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error(`Unclosed object for: ${declaration}`);
};

const loadTranslations = () => {
  const objectSource = extractBalancedObject(read('script.js'), 'const translations =');
  const sandbox = {};
  vm.runInNewContext(`result = (${objectSource});`, sandbox);
  return sandbox.result;
};

const getNestedValue = (object, keyPath) => {
  return keyPath.split('.').reduce((value, key) => (value && value[key] !== undefined ? value[key] : undefined), object);
};

test('HTML and CSS local references point to existing files or routes', () => {
  const htmlFiles = walkFiles(rootDir, (filePath) => filePath.endsWith('.html'));
  const cssFiles = walkFiles(rootDir, (filePath) => filePath.endsWith('.css'));

  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const referencedUrls = [...getHtmlAttributeValues(html, 'href'), ...getHtmlAttributeValues(html, 'src')];

    for (const url of referencedUrls) {
      assertLocalTargetExists(htmlFile, url);
    }
  }

  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(cssFile, 'utf8');
    const referencedUrls = [...css.matchAll(/url\((?:["']?)([^"')]+)(?:["']?)\)/g)].map((match) => match[1]);

    for (const url of referencedUrls) {
      assertLocalTargetExists(cssFile, url);
    }
  }
});

test('sitemap lists real indexable pages and excludes noindex pages', () => {
  const sitemapLocations = getSitemapLocations();
  assert.ok(sitemapLocations.length > 0, 'sitemap.xml should include at least one URL');

  const sitemapFiles = new Set();

  for (const location of sitemapLocations) {
    const relativePath = siteUrlToFile(location);
    const html = read(relativePath);
    const canonical = getCanonical(html);
    const robots = getMetaContent(html, 'robots') || '';

    sitemapFiles.add(relativePath);
    assert.equal(canonical, location, `${relativePath} canonical should match sitemap URL`);
    assert.ok(!/noindex/i.test(robots), `${relativePath} is noindex and should not be in sitemap.xml`);
    assert.ok(getMetaContent(html, 'description'), `${relativePath} should include a meta description`);
    assert.match(html, /<title\b[^>]*>[^<]+<\/title>/i, `${relativePath} should include a title`);
  }

  const htmlFiles = walkFiles(rootDir, (filePath) => filePath.endsWith('.html'));

  for (const htmlFile of htmlFiles) {
    const relativePath = relative(htmlFile);
    const html = fs.readFileSync(htmlFile, 'utf8');
    const robots = getMetaContent(html, 'robots') || '';

    if (/noindex/i.test(robots)) {
      assert.ok(!sitemapFiles.has(relativePath), `${relativePath} is noindex but appears in sitemap.xml`);
    }
  }
});

test('robots.txt points crawlers to the production sitemap', () => {
  const robots = read('robots.txt');

  assert.match(robots, /User-agent:\s*\*/i);
  assert.match(robots, /Allow:\s*\//i);
  assert.match(robots, new RegExp(`Sitemap:\\s*${siteOrigin.replaceAll('.', '\\.')}/sitemap\\.xml`, 'i'));
});

test('home page SEO and share metadata stay aligned', () => {
  const html = read('index.html');
  const canonical = getCanonical(html);

  assert.equal(canonical, `${siteOrigin}/`);
  assert.equal(getMetaContent(html, 'robots'), 'index, follow, max-image-preview:large');
  assert.match(getMetaContent(html, 'description'), /Santorini/);
  assert.match(html, /<meta\b[^>]*property=["']og:url["'][^>]*content=["']https:\/\/noustelos\.gr\/["'][^>]*>/i);
  assert.match(html, /<meta\b[^>]*name=["']twitter:url["'][^>]*content=["']https:\/\/noustelos\.gr\/["'][^>]*>/i);
  assert.match(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.min\.css["'][^>]*>/i);
  assert.match(html, /<script\b[^>]*src=["']script\.min\.js["'][^>]*><\/script>/i);
});

test('home page i18n keys have English and Greek translations', () => {
  const html = read('index.html');
  const translations = loadTranslations();
  const directKeys = [...html.matchAll(/data-i18n=["']([^"']+)["']/g)].map((match) => match[1]);
  const attributeKeys = [...html.matchAll(/data-i18n-attr=["']([^"']+)["']/g)].flatMap((match) => {
    return match[1]
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split(':')[1]?.trim())
      .filter(Boolean);
  });
  const keys = [...new Set([...directKeys, ...attributeKeys])];

  assert.ok(keys.length > 0, 'index.html should declare i18n keys');

  for (const language of ['en', 'gr']) {
    for (const key of keys) {
      assert.equal(typeof getNestedValue(translations[language], key), 'string', `${language}.${key} is missing`);
    }
  }
});

test('contact email stays obfuscated in HTML and form target remains configured', () => {
  const html = read('index.html');
  const contactTags = [...html.matchAll(/<a\b[^>]*class=["'][^"']*js-contact-mail[^"']*["'][^>]*>/gi)].map((match) => match[0]);

  assert.doesNotMatch(html, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'index.html should not contain a plain email address');
  assert.ok(contactTags.length >= 2, 'home page should include obfuscated contact links');

  for (const tag of contactTags) {
    assert.match(tag, /href=["']#["']/i, 'obfuscated contact links should not expose mailto in HTML');
    assert.match(tag, /data-mail-user=["'][^"']+["']/i);
    assert.match(tag, /data-mail-domain=["'][^"']+["']/i);
  }

  assert.match(html, /<form\b[^>]*id=["']contact-form["'][^>]*novalidate[^>]*>/i);
  assert.match(read('script.js'), /mailto:info@noustelos\.gr\?subject=/);
});

test('footer private routes intentionally stay out of the sitemap when noindex', () => {
  const sitemapLocations = new Set(getSitemapLocations());
  const privateRoutes = ['universe/index.html', 'lab/gravity-simulation.html', 'lab/nebula-ui.html'];

  for (const route of privateRoutes) {
    if (!fs.existsSync(path.join(rootDir, route))) {
      continue;
    }

    const html = read(route);
    const robots = getMetaContent(html, 'robots') || '';

    if (/noindex/i.test(robots)) {
      assert.ok(!sitemapLocations.has(fileToSiteUrl(route)), `${route} is noindex and should not be listed`);
    }
  }
});
