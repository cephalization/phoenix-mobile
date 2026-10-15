import type { PrismTheme } from 'prism-react-renderer';

/**
 * Syntax colors mirrored from the Pierre theme (`@pierre/theme`), which the
 * Phoenix web app uses for every code block and diff. Values are the base
 * `pierre-dark.json` / `pierre-light.json` token colors keyed by TextMate scope.
 */
export type CodeColors = {
  comment: string;
  punctuation: string;
  keyword: string;
  string: string;
  regexp: string;
  constant: string;
  number: string;
  escape: string;
  variable: string;
  function: string;
  type: string;
  tag: string;
  attribute: string;
  parameter: string;
};

// Four values are nudged within their hue so every token clears 3.2:1 on the
// app's code surfaces (#1D1D1D / #FFFFFF), which are lighter than Pierre's
// editor black: dark punctuation, light constant, light regexp, light escape.
export const CodeColorsDark: CodeColors = {
  comment: '#737373',
  punctuation: '#6D6D6D',
  keyword: '#FF678D',
  string: '#5ECC71',
  regexp: '#64D1DB',
  constant: '#FFD452',
  number: '#68CDF2',
  escape: '#61D5C0',
  variable: '#FFA359',
  function: '#9D6AFB',
  type: '#D568EA',
  tag: '#FF855E',
  attribute: '#60D199',
  parameter: '#A3A3A3',
};

export const CodeColorsLight: CodeColors = {
  comment: '#737373',
  punctuation: '#636363',
  keyword: '#D32A61',
  string: '#199F43',
  regexp: '#169EA8',
  constant: '#AF8B0D',
  number: '#1CA1C7',
  escape: '#159F8B',
  variable: '#D47628',
  function: '#693ACF',
  type: '#A631BE',
  tag: '#D5512F',
  attribute: '#18A46C',
  parameter: '#636363',
};

export function codeColors(dark: boolean): CodeColors {
  return dark ? CodeColorsDark : CodeColorsLight;
}

/** Prism token types mapped onto the Pierre scopes Phoenix's CodeMirror theme uses. */
export function createPrismTheme(colors: CodeColors, foreground: string): PrismTheme {
  return {
    plain: { color: foreground },
    styles: [
      { types: ['comment', 'prolog', 'cdata', 'doctype'], style: { color: colors.comment } },
      { types: ['punctuation'], style: { color: colors.punctuation } },
      { types: ['operator', 'entity'], style: { color: colors.punctuation } },
      { types: ['keyword', 'atrule', 'important'], style: { color: colors.keyword } },
      {
        types: ['string', 'char', 'attr-value', 'template-string', 'inserted'],
        style: { color: colors.string },
      },
      { types: ['regex'], style: { color: colors.regexp } },
      { types: ['number', 'boolean'], style: { color: colors.number } },
      { types: ['constant', 'symbol'], style: { color: colors.constant } },
      { types: ['variable'], style: { color: colors.variable } },
      {
        types: ['function', 'function-variable', 'builtin', 'decorator', 'annotation'],
        style: { color: colors.function },
      },
      { types: ['class-name', 'maybe-class-name', 'namespace'], style: { color: colors.type } },
      { types: ['tag', 'selector', 'deleted'], style: { color: colors.tag } },
      { types: ['attr-name', 'property'], style: { color: colors.attribute } },
      { types: ['parameter'], style: { color: colors.parameter } },
      { types: ['url'], style: { color: colors.keyword, textDecorationLine: 'underline' } },
      { types: ['deleted'], style: { textDecorationLine: 'line-through' } },
      { types: ['inserted'], style: { textDecorationLine: 'underline' } },
      { types: ['italic'], style: { fontStyle: 'italic' } },
      { types: ['bold', 'important'], style: { fontWeight: 'bold' } },
    ],
  };
}
