const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Adds the PXI glyph to the iOS asset catalog as a template image named
 * `PxiGlyph`. Native header items resolve asset-catalog images synchronously,
 * while an image source loads asynchronously and shows the item's title until
 * it arrives, which flashed "PXI" in the bar on every navigation.
 */
module.exports = function withPxiGlyph(config) {
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const { platformProjectRoot, projectName, projectRoot } = modConfig.modRequest;

      const imageset = path.join(
        platformProjectRoot,
        projectName,
        'Images.xcassets',
        'PxiGlyph.imageset',
      );

      fs.mkdirSync(imageset, { recursive: true });

      const scales = [
        ['1x', 'pxi-glyph.png'],
        ['2x', 'pxi-glyph@2x.png'],
        ['3x', 'pxi-glyph@3x.png'],
      ];

      for (const [, file] of scales) {
        fs.copyFileSync(path.join(projectRoot, 'assets/images', file), path.join(imageset, file));
      }

      const contents = {
        images: scales.map(([scale, filename]) => ({ filename, idiom: 'universal', scale })),
        info: { author: 'expo', version: 1 },
        properties: { 'template-rendering-intent': 'template' },
      };

      fs.writeFileSync(
        path.join(imageset, 'Contents.json'),
        `${JSON.stringify(contents, null, 2)}\n`,
      );

      return modConfig;
    },
  ]);
};
