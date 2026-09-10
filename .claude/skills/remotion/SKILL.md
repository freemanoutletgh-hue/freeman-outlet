# Remotion Skill

description: Create and render videos programmatically with React using Remotion — compositions, sequences, frame-based animation, audio/video layering, data-driven templates, and CLI rendering to MP4/WebM.

---

## What Remotion Is

Remotion lets you build videos as React components. Every frame is a render of your component at a given `frame` value — there's no timeline UI, just code, props, and math. Good fit for: programmatic product/promo videos, data-driven templates (e.g. render one video per product), captioned clips, animated social assets.

```bash
npx create-video@latest my-video
cd my-video
npm run dev      # opens the Remotion Studio preview
npm run build    # renders out/ video via CLI
```

Packages: `remotion`, `@remotion/cli`, `@remotion/player`, `@remotion/media-utils`, `@remotion/captions`, `@remotion/transitions`.

---

## The Core Mental Model: Frame, Not Time

Everything is driven by `useCurrentFrame()`. There is no `setTimeout`, no CSS animation, no `requestAnimationFrame` — the renderer asks your component "what do you look like at frame N?" and you answer with pure, deterministic output.

```tsx
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

export const FadeInTitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return <h1 style={{ opacity }}>{text}</h1>;
};
```

**Rules:**
- Components must be **pure functions of `frame` and `props`** — same frame in, same pixels out, every time. No `Math.random()`, no `Date.now()`, no mutable state that isn't seeded by frame.
- Never use CSS `transition` or `animation` — they're wall-clock based and won't sync with the renderer. Compute every value from `frame` via `interpolate` or `spring`.

---

## Compositions — Registering a Video

```tsx
import { Composition } from 'remotion';
import { ProductShowcase } from './ProductShowcase';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ProductShowcase"
      component={ProductShowcase}
      durationInFrames={150}      // 5s at 30fps
      fps={30}
      width={1080}
      height={1920}               // vertical for Reels/TikTok/Stories
      defaultProps={{ productName: 'Bubble Bag', price: '₵450', imageUrl: '/bag.jpg' }}
    />
  );
};
```

- `durationInFrames = seconds * fps` — always derive it, never hardcode a mismatch.
- Use `calculateMetadata` on `<Composition>` when duration/dimensions depend on async data (e.g. fetching a product list to size the video to its content).

---

## Interpolation & Easing

`interpolate(frame, inputRange, outputRange, options)` maps frame ranges to value ranges — the animation primitive you'll use constantly.

```tsx
import { interpolate, Easing } from 'remotion';

const y = interpolate(frame, [0, 30], [100, 0], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});
```

- **Always set `extrapolateLeft`/`extrapolateRight: 'clamp'`** unless you intentionally want values to keep extrapolating past the input range — unclamped output is the #1 source of "my element flies off-screen" bugs.
- `inputRange` must be strictly increasing — `[0, 30, 60]`, never `[0, 60, 30]`.

### Springs — Physical, Organic Motion
```tsx
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

const frame = useCurrentFrame();
const { fps } = useVideoConfig();

const scale = spring({
  frame,
  fps,
  config: { damping: 12, stiffness: 100, mass: 0.8 },
});
```
Use `spring()` for entrances/emphasis (cards popping in, buttons bouncing); use `interpolate` for linear/eased value mapping (fades, progress bars, counters).

---

## Sequencing — `<Sequence>`, `<Series>`, `<TransitionSeries>`

`<Sequence>` shifts a child's local frame `0` to start at `from`, and optionally clips its visible duration:

```tsx
import { Sequence } from 'remotion';

<Sequence from={0} durationInFrames={60}><Intro /></Sequence>
<Sequence from={60} durationInFrames={90}><ProductReveal /></Sequence>
<Sequence from={150}><CallToAction /></Sequence>
```

For sequential clips without manually tracking offsets, use `<Series>`:
```tsx
import { Series } from 'remotion';

<Series>
  <Series.Sequence durationInFrames={60}><Intro /></Series.Sequence>
  <Series.Sequence durationInFrames={90}><ProductReveal /></Series.Sequence>
  <Series.Sequence durationInFrames={60}><CallToAction /></Series.Sequence>
</Series>
```

For crossfades/wipes/slides between scenes, use `@remotion/transitions`:
```tsx
import { TransitionSeries, springTiming, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}><Intro /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={springTiming({ config: { damping: 200 } })} />
  <TransitionSeries.Sequence durationInFrames={90}><ProductReveal /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={slide()} timing={linearTiming({ durationInFrames: 20 })} />
  <TransitionSeries.Sequence durationInFrames={60}><CallToAction /></TransitionSeries.Sequence>
</TransitionSeries>
```
**Note:** transition durations are *subtracted* from total — two 60-frame scenes with a 20-frame transition produce a 100-frame result, not 120.

---

## Media — Images, Video, Audio

```tsx
import { Img, Video, Audio, OffthreadVideo, staticFile } from 'remotion';

<Img src={staticFile('logo.png')} style={{ width: 200 }} />
<OffthreadVideo src={staticFile('clip.mp4')} startFrom={30} endAt={120} />
<Audio src={staticFile('voiceover.mp3')} volume={(f) => interpolate(f, [0, 30], [0, 1], { extrapolateLeft: 'clamp' })} />
```

- Prefer **`<OffthreadVideo>`** over `<Video>` for rendering — it extracts frames server-side via FFmpeg rather than relying on the browser's video decoder, which is more reliable and faster at render time.
- Files referenced with `staticFile()` must live in the `public/` directory of the Remotion project.
- Remote URLs work too (`<Img src="https://images.unsplash.com/photo-...">`) but **always preload them** with `@remotion/preload` or the render will show blank frames while assets fetch.
- `volume` accepts a function of frame for fades — same `interpolate` pattern as visual props.

---

## Data-Driven Videos (the killer use case for an e-commerce store)

Render one video per item by mapping data to compositions in `RemotionRoot`:

```tsx
import { getInputProps } from 'remotion';
import productsJson from '../data/products.json';

export const RemotionRoot: React.FC = () => (
  <>
    {productsJson.map((p) => (
      <Composition
        key={p.id}
        id={`Product-${p.id}`}
        component={ProductShowcase}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ name: p.name, price: p.price, imageUrl: p.image, accentColor: '#e8621a' }}
      />
    ))}
  </>
);
```

Then render a batch from the CLI or `@remotion/renderer` Node API — useful for generating a fresh promo clip per product launch, or per sale/discount event, without touching design tools.

---

## Fonts & Brand Consistency

Load fonts the same deterministic way you'd load any asset — `@remotion/google-fonts` bundles them so rendering doesn't depend on network availability:

```tsx
import { loadFont } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadBodyFont } from '@remotion/google-fonts/Jost';

const { fontFamily: headingFont } = loadFont();
const { fontFamily: bodyFont } = loadBodyFont();
```

Match this project's brand: **Cormorant Garamond** for headings, **Jost** for body, **`#e8621a`** (`var(--accent)`) for highlight/CTA elements — keep generated videos visually consistent with the storefront.

---

## Rendering — CLI & Programmatic

```bash
# Render a single composition to MP4
npx remotion render ProductShowcase out/product-showcase.mp4

# Render with overridden props (data-driven runs)
npx remotion render ProductShowcase out/bubble-bag.mp4 --props='{"name":"Bubble Bag","price":"₵450"}'

# Still images (thumbnails, OG images) — pick a frame
npx remotion still ProductShowcase out/thumb.png --frame=45

# Lower resolution / faster preview render while iterating
npx remotion render ProductShowcase out/preview.mp4 --scale=0.5 --concurrency=4
```

- Use `--codec=h264` (default) for broad compatibility/social platforms; `vp8`/`vp9` for WebM where smaller file size matters more than compatibility (relevant given the project's Render bandwidth constraints — smaller rendered output = less to serve).
- `--concurrency` controls parallel frame rendering — tune to available CPU cores; too high thrashes, too low wastes time.
- For server-side/automated rendering (e.g. a "generate promo video" admin action), use `@remotion/renderer`'s `renderMedia()` Node API instead of shelling out to the CLI.

---

## Performance & Correctness Checklist

- **Determinism first** — no `Math.random()`, `Date.now()`, or non-seeded async state inside components. If you need "randomness," seed it from `frame` or a prop (`random(seed)` from `remotion`).
- **Always clamp `interpolate` ranges** — unclamped extrapolation is the most common cause of elements appearing in the wrong place at the start/end of a scene.
- **Prefer `transform`/`opacity`** for animated values here too — same compositing-vs-layout cost model as [[animation]] applies; Remotion just renders it frame-by-frame instead of via the browser's animation engine.
- **Preload remote media** (`@remotion/preload`) — render-time blank frames are almost always an unloaded asset, not a code bug.
- **Keep compositions short and composable** — build small, reusable scene components (`<Intro>`, `<ProductReveal>`, `<Cta>`) and assemble them with `<Series>`/`<TransitionSeries>`, the same way [[ui-components]] favors composable pieces over monoliths.
- **Test at low `--scale`** while iterating, render at full resolution only for final output — full 1080p+ renders are slow and expensive to iterate on.
