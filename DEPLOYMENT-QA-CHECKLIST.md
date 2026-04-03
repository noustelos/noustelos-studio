# Deployment QA Checklist (Safari/Chrome, iPhone/iPad)

## Scope
This checklist validates the remaining non-image items before final deployment.

Pages:
- /
- /lab/
- /lab/video-experiments.html
- /privacy-policy.html
- /universe/

Devices and browsers:
- iPhone Safari
- iPhone Chrome
- iPad Safari
- iPad Chrome
- macOS Safari
- macOS Chrome

## 1) Visual and Layout
1. Open each page and confirm no horizontal scroll appears.
2. Confirm header, hero, contact section, footer, and cookie banner align correctly.
3. Verify no overlapping text/buttons on narrow screens.
4. Verify typography is readable and controls are not clipped.

Pass criteria:
- No clipping, no overlap, no horizontal scroll, consistent spacing.

## 2) Navigation and Links
1. Validate top navigation links scroll to correct sections on home page.
2. Validate footer links open expected pages (/lab, /universe, /privacy-policy.html).
3. Validate external project links open and are reachable.
4. Validate back links in lab/universe pages work correctly.

Pass criteria:
- No broken navigation, no dead links, expected target behavior.

## 3) Accessibility and Interaction
1. Keyboard test on desktop (Tab/Shift+Tab/Enter/Space) across home page controls.
2. Verify visible focus state exists on interactive controls.
3. Verify language toggle works and updates text correctly.
4. Verify cookie banner appears on first visit and stores decision.
5. Verify contact form requires name + message and ignores bot honeypot silently.

Pass criteria:
- Full keyboard operability on desktop, clear focus ring, no trapped focus.

## 4) Mail and Contact
1. Click primary Email button and verify mail app opens.
2. Click Direct Email link and verify mail app opens.
3. Submit contact form with valid values and verify prefilled mail subject/body opens.
4. Confirm no plain email address is visible in page source.

Pass criteria:
- All contact triggers open mail client with expected recipient/content.

## 5) SEO/Metadata Spot Check
1. Inspect page source and verify:
   - <html lang="...">
   - <title>
   - meta description
   - canonical link
   - favicon link
2. Confirm privacy page is reachable from footer.
3. Confirm sitemap.xml includes home, lab, subpages, universe, privacy page.

Pass criteria:
- Metadata complete and consistent on all audited pages.

## 6) Console and Network Hygiene
1. Open DevTools Console per page and confirm no red errors.
2. Confirm key assets load from minified files (styles.min.css, script.min.js, lab.min.css, lab.min.js, universe.min.css, universe.min.js).
3. Confirm no mixed-content HTTP requests.

Pass criteria:
- No blocking errors, minified assets loaded, HTTPS-only requests.

## 7) Release Gate
Mark deployment ready only if all sections above pass on at least:
- Safari (macOS + iOS)
- Chrome (macOS + iOS)

If any failure occurs, log:
- Device/browser
- Page URL
- Step number
- Screenshot and short repro
