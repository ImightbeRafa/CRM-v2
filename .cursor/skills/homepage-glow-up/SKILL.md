---
name: homepage-glow-up
description: >
  Redesign and elevate the visual quality of a homepage or landing page route to world-class,
  award-winning SaaS standards — without changing any content, copy, or functionality.
  Use this skill whenever the user mentions improving, polishing, redesigning, or "glow-up"
  of their homepage, landing page, /home route, or any public-facing marketing page.
  Also trigger when the user says things like "make it look premium", "make it not look
  AI-generated", "make it look like Stripe/Linear/Vercel", "I want it to look expensive",
  "design overhaul", "visual refresh", "make it beautiful", "it looks too generic",
  "vibecoded but shouldn't look like it", or any variation of wanting a page to stop looking
  like a template and start looking like something a design team spent months on.
  This skill runs best in plan mode — it produces a phased enhancement plan the agent
  then executes file by file.
---

# Homepage Glow-Up

You are a senior design engineer tasked with transforming a homepage from "functional"
to "someone clearly hired a great design team." The page already works. The copy is final.
Your job is purely visual and experiential — make people *feel* something when they land.

## Philosophy

The difference between a $500 template site and a $50,000 agency site is never the content.
It's the craft. It's the 40px of breathing room that makes a headline feel important. It's
the 200ms staggered fade that makes a feature grid feel alive instead of dumped on screen.
It's the single accent color used with surgical precision instead of splashed everywhere.

Generic vibecoded sites share these tells:
- Everything fades in identically at the same time
- Spacing is uniform and mechanical (same padding everywhere)
- Colors are safe and forgettable (blue-600 on white, gray text)
- Typography uses one weight and one size scale with no drama
- Hover states are either missing or just opacity changes
- Sections feel like stacked cards with no visual connective tissue
- No texture, no grain, no depth — flat and lifeless
- The whole page could be any product for any company

Your job is to eliminate every one of these tells.

## Before You Touch Code

Read the entire `/home` route source. Map out:

1. **Section inventory** — List every section (hero, features, testimonials, CTA, footer, etc.)
2. **Component tree** — Which components render each section? What props do they take?
3. **Current styling approach** — Tailwind classes? CSS modules? Inline styles? shadcn/ui usage?
4. **Existing animations** — Any Framer Motion already present? What's animated?
5. **Color tokens** — What's in tailwind.config? Any CSS variables? Current palette?
6. **Typography** — What fonts are loaded? Weights available? Size scale?
7. **Assets** — Any images, SVGs, icons already in use?

Write this inventory as a comment block or plan document. You need the full picture before
making a single change.

## The Enhancement Plan

Work in this exact order. Each phase builds on the last.

### Phase 1: Typography & Color Foundation

Typography is 80% of design. Fix this first.

**Font Strategy:**
- Pick a distinctive display/heading font. Not Inter, not Roboto, not system-ui.
  Good choices for warm + premium: Outfit, Satoshi, General Sans, Plus Jakarta Sans,
  Cabinet Grotesk, Switzer, Clash Display, Zodiak. Import from Google Fonts or Fontsource.
- Keep body text highly readable (the display font at 400 weight, or a clean geometric sans).
- Establish a type scale with *contrast*. Hero headlines should be dramatically larger than
  body text — think 4rem-6rem hero vs 1rem-1.125rem body. Use clamp() for fluid sizing.
- Use font-weight as a design tool: 300 for elegance, 600-700 for impact, 800-900 for drama.
  Mix weights within a section to create hierarchy.

**Color Strategy:**
- Establish a palette with personality. Start from the existing brand color but refine it.
- Build a palette with: 1 dominant brand hue, 1 accent/pop color, a warm neutral scale
  (not pure gray — tint it slightly warm: stone, zinc with warmth, or custom).
- Define these as CSS variables or Tailwind config extensions:
  ```
  --color-surface: warm off-white or rich dark (never pure #fff or #000)
  --color-surface-elevated: slightly different from surface (creates depth)
  --color-text-primary: high contrast but not harsh
  --color-text-secondary: noticeably lighter, for supporting copy
  --color-accent: the money color — used sparingly for CTAs and highlights
  --color-accent-subtle: 10% opacity version for backgrounds/badges
  ```
- Add a subtle background treatment to the page body itself — a very faint gradient,
  a noise texture, or a warm tint. Never pure white.

**Implementation:**
- Update tailwind.config.ts with the new palette and font families
- Add @font-face or Google Fonts import in layout.tsx or globals.css
- Do a find-and-replace pass on all text-gray-* classes → the new neutral scale
- Update all heading elements to use the display font

### Phase 2: Spatial Composition & Layout Rhythm

This is where "designed" separates from "built."

**Vertical Rhythm:**
- Vary section padding intentionally. Hero gets the most breathing room (py-24 to py-32).
  Dense info sections get less. CTA sections get generous space again.
- Use an asymmetric pattern: not every section needs the same padding top and bottom.
  A section with a dark background might have more top padding to create a "stage."
- Add intentional max-width constraints. Not everything should be max-w-7xl.
  Headlines can be narrower (max-w-3xl). Feature grids wider. Testimonials narrower.
  This variation creates visual interest.

**Grid & Composition:**
- Break the single-column monotony. Consider:
  - A hero with asymmetric text/visual split (60/40, not 50/50)
  - Feature sections with alternating layout (image left/right)
  - A testimonial that breaks out of the container (full-bleed background)
  - Stats or metrics in an unexpected layout (not just a 3-column grid)
- Use CSS grid with named areas for complex sections. Overlap elements intentionally.
- Add a visual "break" between major sections — a decorative divider, a color shift,
  a change in background treatment. Don't just stack white section on white section.

**Container Strategy:**
- Use multiple container widths within the same page. Full-bleed backgrounds with
  contained content. Narrow text blocks for readability. Wide grids for features.

### Phase 3: Visual Depth & Texture

This is what makes a page feel *rich* instead of flat.

**Background Treatments:**
- Add a subtle grain/noise texture overlay to at least one section. Use CSS:
  ```css
  .grain::after {
    content: '';
    position: absolute;
    inset: 0;
    opacity: 0.03;
    background-image: url("data:image/svg+xml,..."); /* noise SVG */
    pointer-events: none;
  }
  ```
  Or use a tiny noise PNG as a repeating background.
- Use gradient meshes or radial gradients as section backgrounds. Not the cliché
  top-left-to-bottom-right linear gradient — use positioned radial gradients that
  create a subtle light source effect.
- Consider a very subtle dot grid or line pattern for one section's background.

**Elevation & Shadows:**
- Replace generic shadow-md/shadow-lg with custom, realistic shadows:
  ```css
  /* Layered shadow for realism */
  box-shadow:
    0 1px 2px rgba(0,0,0,0.04),
    0 4px 8px rgba(0,0,0,0.04),
    0 16px 32px rgba(0,0,0,0.04);
  ```
- Add hover shadows that expand subtly (scale + shadow increase together).
- Use backdrop-blur on overlapping elements for a glass-morphism effect where appropriate.

**Border & Divider Treatments:**
- Replace solid borders with subtle gradient borders:
  ```css
  border-image: linear-gradient(to right, transparent, var(--color-accent), transparent) 1;
  ```
- Use very thin (1px) borders with low opacity instead of thick dividers.
- Consider a subtle inner glow (inset box-shadow) on cards.

**Decorative Elements:**
- Add 1-2 abstract decorative SVGs or shapes as positioned background elements.
  These should be large, semi-transparent, and positioned to peek out from behind content.
  Think: a blurred gradient orb behind the hero, a geometric pattern accent near a CTA.
- Use CSS clip-path or border-radius creatively on at least one section edge.

### Phase 4: Animation & Micro-Interactions

Animation is what makes a page feel alive. But restraint is everything.

**Page Load Choreography:**
- The hero section should have a staggered entrance:
  1. Background/decorative elements fade in first (opacity, 400ms)
  2. Headline slides up + fades (translateY 20px → 0, 500ms, 100ms delay)
  3. Subheading follows (300ms delay)
  4. CTA button follows (400ms delay)
  5. Any hero image/visual follows (500ms delay, maybe with a slight scale 0.95 → 1)
- Use Framer Motion's `staggerChildren` and `delayChildren` in a parent variants object.
  **Keep durations under 600ms and delays under 800ms total.** Slow animations feel broken.

**Scroll Animations:**
- Use Framer Motion's `whileInView` with `viewport={{ once: true, amount: 0.3 }}`.
- NOT every element needs to animate in. Animate *sections* or *groups*, not individual
  paragraphs or icons. One animation per section is enough.
- Good scroll animations: fade + slight translateY (20-30px), scale from 0.97 → 1,
  opacity with a clip-path reveal.
- BAD scroll animations: spinning, bouncing, sliding from 200px away, anything that
  makes the user wait to read content.

**Hover & Interaction States:**
- CTA buttons: background color shift + subtle translateY(-1px) + shadow expansion.
  Add a transition on all properties, 200ms ease-out.
- Cards/features: gentle lift (translateY -4px) + shadow expansion + border color shift.
- Links: custom underline animation (width 0 → 100% on hover using ::after).
- Icons: subtle color shift or scale on parent hover.

**Advanced (use sparingly):**
- A gradient that subtly shifts position on mouse movement (parallax-lite).
- Text that reveals with a clip-path or mask animation.
- A number/stat that counts up when scrolled into view.
- Smooth scroll-linked opacity changes on the hero (fade out as user scrolls down).

### Phase 5: Component-Level Polish

Go section by section and apply finishing touches.

**Hero Section:**
- This is your billboard. It gets the most attention. Ensure:
  - Headline has dramatic size and weight contrast
  - There's a visual anchor (product screenshot, illustration, abstract shape)
  - CTA button is unmissable — consider adding a subtle glow or gradient border
  - Sufficient vertical space — the hero should feel expansive, not cramped
  - If there's a product screenshot, add a realistic browser frame or device mockup,
    a subtle reflection, or a layered shadow

**Feature/Benefits Sections:**
- Icons should be styled, not default Lucide at default size. Consider:
  - Icons in colored circles/squares with the accent-subtle background
  - Larger icon size (24-32px) with consistent stroke width
  - A subtle background shape behind each icon
- Feature cards: add a subtle top-border accent (2-3px, accent color)
  or a left-border accent for a different feel
- If there's a grid, ensure gap is generous (gap-6 to gap-8, not gap-4)

**Social Proof / Testimonials:**
- Testimonial cards deserve special treatment. Consider:
  - A larger quote mark as a decorative element (text-6xl, accent color, low opacity)
  - Author info with a small avatar circle (even if it's just initials)
  - A different background color or treatment from the surrounding sections
- Logo bars: ensure logos are desaturated/grayed by default, with subtle hover color

**CTA / Closing Section:**
- This is your second most important section after hero.
- Consider a contrasting background (dark section on a light page, or vice versa)
- Generous padding, centered text, one clear button
- A decorative element or pattern to make it feel like a destination, not an afterthought

**Footer:**
- Often neglected. Polish it:
  - Proper column layout with clear hierarchy
  - Subtle top border or color shift from the page background
  - Links with smooth hover transitions
  - Consider a slightly different background tone

## Implementation Rules

These are non-negotiable:

1. **NEVER change text content, copy, headings, descriptions, or labels.** You are styling only.
2. **NEVER remove functionality.** Every button, link, form, and interaction must still work.
3. **NEVER restructure the component hierarchy.** Don't rename components, change props interfaces,
   or split/merge components. You can add wrapper divs for styling and add new CSS classes.
4. **NEVER add new npm dependencies without noting them in the plan.** Prefer CSS-only solutions.
   Framer Motion is already available — use it. If you need a font, use Google Fonts CDN or
   next/font. Avoid adding animation libraries beyond what exists.
5. **Preserve all responsive behavior.** Every change must work on mobile. Test mentally at
   375px, 768px, and 1280px breakpoints. Use Tailwind's responsive prefixes.
6. **Work in phases.** Complete Phase 1 fully before moving to Phase 2. Each phase should
   leave the site in a working, improved state. Never break the page between phases.
7. **Use the existing styling system.** If the project uses Tailwind, stay in Tailwind.
   Extend the config rather than writing raw CSS. If there are CSS variables, use and
   extend them rather than hardcoding values.
8. **Commit-friendly changes.** Each phase should be a logical unit of work that could be
   committed independently with a clear message.

## Quality Checklist

Before marking any phase complete, verify:

- [ ] No text content was changed
- [ ] All links and buttons still function
- [ ] Page looks correct at mobile (375px), tablet (768px), and desktop (1280px+)
- [ ] No Tailwind classes conflict (check for contradictory utilities)
- [ ] No layout shift or content jump on page load
- [ ] Animations are smooth (no jank — prefer transform and opacity, avoid animating layout properties)
- [ ] Color contrast meets WCAG AA (4.5:1 for body text, 3:1 for large text)
- [ ] New fonts are loading (check network tab mentally — ensure font-display: swap)
- [ ] No orphaned or unused styles were left behind
- [ ] The page feels *cohesive* — changes work together, not as isolated patches

## Output Format

When running in plan mode, produce:

```
## Homepage Glow-Up Plan

### Site Audit
[Your section inventory and current state analysis]

### Phase 1: Typography & Color Foundation
**Files to modify:** [list]
**Changes:**
- [specific change with before/after Tailwind classes or CSS]
- [specific change...]

**New dependencies:** [any fonts to add]

### Phase 2: Spatial Composition & Layout Rhythm
[same structure]

### Phase 3: Visual Depth & Texture
[same structure]

### Phase 4: Animation & Micro-Interactions
[same structure]

### Phase 5: Component-Level Polish
[same structure]

### Final QA Notes
[responsive checks, accessibility notes, performance considerations]
```

Each change should be specific enough to execute without ambiguity. Reference exact file paths,
exact Tailwind classes to add/remove, exact CSS to write. The plan is the blueprint —
a junior dev should be able to follow it mechanically.

## Reference: Sites to Study

For calibration, these represent the quality bar you're aiming for. Don't copy them —
understand what makes them feel premium and apply those principles to the page at hand:

Read `references/INSPIRATION.md` for detailed breakdowns of what makes world-class SaaS
sites feel expensive. Use it as a checklist of techniques, not a style guide to copy.