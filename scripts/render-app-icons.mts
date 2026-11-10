#!/usr/bin/env node
/**
 * Re-renders the app icon artwork from the Phoenix bird.
 *
 * The iOS icon is the Icon Composer bundle `assets/phoenix.icon`; iOS renders
 * it with Liquid Glass and derives its dark, clear, and tinted appearances.
 * Its one layer, `Assets/phoenix-bird.svg`, is the source for every flat
 * fallback this script writes: `icon.png`, the Android adaptive icon images,
 * and `splash-icon.png`.
 *
 *   vp run icons
 *   vp run icons --from-phoenix ~/repos/phoenix   rebuild the bird layer first
 *   vp run icons --preview /tmp/phoenix-icon      export every iOS appearance
 *
 * `--from-phoenix` flattens the bird in Phoenix's nav logo
 * (`js/app/src/components/nav/Logo.tsx`) to one silhouette with the brand
 * gradient; the system adds the highlights the logo bakes in. `--preview` needs
 * Xcode's Icon Composer (`ictool`). Placement on the iOS canvas lives in
 * `assets/phoenix.icon/icon.json`; keep `IconNudge` here in step with it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { Resvg } from '@resvg/resvg-js';

const Root = path.resolve(import.meta.dirname, '..');
const BirdLayer = path.join(Root, 'assets/phoenix.icon/Assets/phoenix-bird.svg');
const Images = path.join(Root, 'assets/images');
const PhoenixLogo = 'js/app/src/components/nav/Logo.tsx';

const Ictool =
  '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool';

const Renditions = ['Default', 'Dark', 'ClearLight', 'ClearDark', 'TintedLight', 'TintedDark'];

/** The bird layer's height on the 1024 pt Icon Composer canvas. */
const IconBirdHeight = 760;

/** `translation-in-points` of the bird group in `icon.json`, as a fraction of the canvas. */
const IconNudge = { x: -12 / 1024, y: 8 / 1024 };

/** Android draws adaptive icons in a 66 dp safe circle of a 108 dp canvas. */
const AdaptiveBirdHeight = 0.58;

const BirdGradient =
  '<linearGradient id="bird" gradientUnits="userSpaceOnUse" x1="20" y1="40" x2="250" y2="340">' +
  '<stop offset="0" stop-color="#2BD1C4"/>' +
  '<stop offset="0.45" stop-color="#00B4F0"/>' +
  '<stop offset="1" stop-color="#0088C8"/>' +
  '</linearGradient>';

/** The light background of `icon.json`, in sRGB for the flat renders. */
const BackgroundGradient =
  '<linearGradient id="background" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#FBFEFF"/>' +
  '<stop offset="1" stop-color="#E0F3FB"/>' +
  '</linearGradient>';

type Bird = { width: number; height: number; paths: string };

type Placement = { canvas: number; height: number; nudge: { x: number; y: number } };

function main() {
  const { values } = parseArgs({
    options: { 'from-phoenix': { type: 'string' }, preview: { type: 'string' } },
  });

  const phoenixRepository = values['from-phoenix'];

  if (phoenixRepository !== undefined) {
    writeBirdLayer(path.resolve(phoenixRepository, PhoenixLogo));
  }

  const bird = readBirdLayer();
  const centered = { x: 0, y: 0 };

  writePng('icon.png', 1024, [
    rect(1024, 0, 'url(#background)'),
    placeBird(bird, { canvas: 1024, height: IconBirdHeight, nudge: IconNudge }, 'url(#bird)'),
  ]);

  writePng('android-icon-foreground.png', 512, [
    placeBird(
      bird,
      { canvas: 512, height: 512 * AdaptiveBirdHeight, nudge: centered },
      'url(#bird)',
    ),
  ]);

  writePng('android-icon-background.png', 512, [rect(512, 0, 'url(#background)')]);

  writePng('android-icon-monochrome.png', 432, [
    placeBird(bird, { canvas: 432, height: 432 * AdaptiveBirdHeight, nudge: centered }, '#FFFFFF'),
  ]);

  // The splash screen draws the bird alone on its dark background.
  writeFileSync(
    path.join(Images, 'splash-icon.png'),
    render(svgDocument(bird.width, bird.height, [colored(bird.paths, 'url(#bird)')]), 229),
  );

  console.log(`Wrote icon.png, the Android adaptive icon, and splash-icon.png.`);

  if (values.preview !== undefined) exportPreviews(path.resolve(values.preview));
}

/** Flatten Phoenix's nav logo to the gradient silhouette the icon layer uses. */
function writeBirdLayer(logoPath: string) {
  // The file also exports the wordmark (`LogoText`); only the `Logo` mark is the bird.
  const file = readFileSync(logoPath, 'utf8');
  const start = file.indexOf('export function Logo(');
  const end = file.indexOf('export function', start + 1);
  const source = file.slice(start, end < 0 ? undefined : end);
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(source);

  if (start < 0 || viewBox === null) throw new Error(`No Logo component in ${logoPath}.`);

  const width = Number(viewBox[1]);
  const height = Number(viewBox[2]);
  const paths: string[] = [];

  for (const [, attributes] of source.matchAll(/<path\b([^>]*?)\/>/gs)) {
    const d = /\bd="([^"]+)"/s.exec(attributes)?.[1];
    const transform = /\btransform="([^"]+)"/.exec(attributes)?.[1];

    if (d === undefined) continue;

    const transformAttribute = transform === undefined ? '' : ` transform="${transform}"`;
    paths.push(`<path d="${d.replaceAll(/\s+/g, ' ')}"${transformAttribute} fill="url(#bird)"/>`);
  }

  if (paths.length === 0) throw new Error(`No paths in ${logoPath}.`);

  const layerWidth = Math.round((IconBirdHeight * width * 100) / height) / 100;

  writeFileSync(
    BirdLayer,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layerWidth}" height="${IconBirdHeight}" ` +
      `viewBox="0 0 ${width} ${height}"><defs>${BirdGradient}</defs>${paths.join('')}</svg>`,
  );

  console.log(`Rebuilt ${path.relative(Root, BirdLayer)} from ${paths.length} paths.`);
}

function readBirdLayer(): Bird {
  const source = readFileSync(BirdLayer, 'utf8');
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(source);
  const paths = /<\/defs>(.*)<\/svg>/s.exec(source)?.[1];

  if (viewBox === null || paths === undefined) {
    throw new Error(`${BirdLayer} is not a bird layer this script wrote.`);
  }

  return { width: Number(viewBox[1]), height: Number(viewBox[2]), paths };
}

/** The bird scaled to `height` and centered on a square canvas, then nudged. */
function placeBird(bird: Bird, placement: Placement, fill: string) {
  const scale = placement.height / bird.height;
  const x = (placement.canvas - bird.width * scale) / 2 + placement.nudge.x * placement.canvas;
  const y = (placement.canvas - placement.height) / 2 + placement.nudge.y * placement.canvas;

  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})">${colored(bird.paths, fill)}</g>`;
}

function colored(paths: string, fill: string) {
  return paths.replaceAll('fill="url(#bird)"', `fill="${fill}"`);
}

function rect(size: number, radius: number, fill: string) {
  return `<rect width="${size}" height="${size}" rx="${radius}" fill="${fill}"/>`;
}

function svgDocument(width: number, height: number, content: string[]) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><defs>${BirdGradient}${BackgroundGradient}</defs>` +
    `${content.join('')}</svg>`
  );
}

function render(svg: string, width: number) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

function writePng(name: string, size: number, content: string[]) {
  writeFileSync(path.join(Images, name), render(svgDocument(size, size, content), size));
}

function exportPreviews(directory: string) {
  mkdirSync(directory, { recursive: true });

  for (const rendition of Renditions) {
    execFileSync(Ictool, [
      path.join(Root, 'assets/phoenix.icon'),
      '--export-image',
      '--output-file',
      path.join(directory, `${rendition}.png`),
      '--platform',
      'iOS',
      '--rendition',
      rendition,
      '--width',
      '1024',
      '--height',
      '1024',
      '--scale',
      '1',
      '--tint-color',
      '0.55',
      '--tint-strength',
      '0.75',
    ]);
  }

  console.log(`Exported ${Renditions.length} iOS appearances to ${directory}.`);
}

main();
