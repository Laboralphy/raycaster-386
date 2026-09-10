/**
 * Colour parsing, reduced to what the shading pipeline needs: turning a CSS
 * colour (name, #rgb, #rrggbb, rgb(), rgba()) into an {r,g,b,a} structure and
 * back into a CSS string.
 *
 * Kept dependency-free so shading can be computed and tested under Node,
 * without a DOM to resolve colour names.
 */

export interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** CSS named colours. */
const COLORS: Readonly<Record<string, string>> = {
    aliceblue: '#F0F8FF',
    antiquewhite: '#FAEBD7',
    aqua: '#00FFFF',
    aquamarine: '#7FFFD4',
    azure: '#F0FFFF',
    beige: '#F5F5DC',
    bisque: '#FFE4C4',
    black: '#000000',
    blanchedalmond: '#FFEBCD',
    blue: '#0000FF',
    blueviolet: '#8A2BE2',
    brown: '#A52A2A',
    burlywood: '#DEB887',
    cadetblue: '#5F9EA0',
    chartreuse: '#7FFF00',
    chocolate: '#D2691E',
    coral: '#FF7F50',
    cornflowerblue: '#6495ED',
    cornsilk: '#FFF8DC',
    crimson: '#DC143C',
    cyan: '#00FFFF',
    darkblue: '#00008B',
    darkcyan: '#008B8B',
    darkgoldenrod: '#B8860B',
    darkgray: '#A9A9A9',
    darkgrey: '#A9A9A9',
    darkgreen: '#006400',
    darkkhaki: '#BDB76B',
    darkmagenta: '#8B008B',
    darkolivegreen: '#556B2F',
    darkorange: '#FF8C00',
    darkorchid: '#9932CC',
    darkred: '#8B0000',
    darksalmon: '#E9967A',
    darkseagreen: '#8FBC8F',
    darkslateblue: '#483D8B',
    darkslategray: '#2F4F4F',
    darkslategrey: '#2F4F4F',
    darkturquoise: '#00CED1',
    darkviolet: '#9400D3',
    deeppink: '#FF1493',
    deepskyblue: '#00BFFF',
    dimgray: '#696969',
    dimgrey: '#696969',
    dodgerblue: '#1E90FF',
    firebrick: '#B22222',
    floralwhite: '#FFFAF0',
    forestgreen: '#228B22',
    fuchsia: '#FF00FF',
    gainsboro: '#DCDCDC',
    ghostwhite: '#F8F8FF',
    gold: '#FFD700',
    goldenrod: '#DAA520',
    gray: '#808080',
    grey: '#808080',
    green: '#008000',
    greenyellow: '#ADFF2F',
    honeydew: '#F0FFF0',
    hotpink: '#FF69B4',
    indianred: '#CD5C5C',
    indigo: '#4B0082',
    ivory: '#FFFFF0',
    khaki: '#F0E68C',
    lavender: '#E6E6FA',
    lavenderblush: '#FFF0F5',
    lawngreen: '#7CFC00',
    lemonchiffon: '#FFFACD',
    lightblue: '#ADD8E6',
    lightcoral: '#F08080',
    lightcyan: '#E0FFFF',
    lightgoldenrodyellow: '#FAFAD2',
    lightgray: '#D3D3D3',
    lightgrey: '#D3D3D3',
    lightgreen: '#90EE90',
    lightpink: '#FFB6C1',
    lightsalmon: '#FFA07A',
    lightseagreen: '#20B2AA',
    lightskyblue: '#87CEFA',
    lightslategray: '#778899',
    lightslategrey: '#778899',
    lightsteelblue: '#B0C4DE',
    lightyellow: '#FFFFE0',
    lime: '#00FF00',
    limegreen: '#32CD32',
    linen: '#FAF0E6',
    magenta: '#FF00FF',
    maroon: '#800000',
    mediumaquamarine: '#66CDAA',
    mediumblue: '#0000CD',
    mediumorchid: '#BA55D3',
    mediumpurple: '#9370DB',
    mediumseagreen: '#3CB371',
    mediumslateblue: '#7B68EE',
    mediumspringgreen: '#00FA9A',
    mediumturquoise: '#48D1CC',
    mediumvioletred: '#C71585',
    midnightblue: '#191970',
    mintcream: '#F5FFFA',
    mistyrose: '#FFE4E1',
    moccasin: '#FFE4B5',
    navajowhite: '#FFDEAD',
    navy: '#000080',
    oldlace: '#FDF5E6',
    olive: '#808000',
    olivedrab: '#6B8E23',
    orange: '#FFA500',
    orangered: '#FF4500',
    orchid: '#DA70D6',
    palegoldenrod: '#EEE8AA',
    palegreen: '#98FB98',
    paleturquoise: '#AFEEEE',
    palevioletred: '#DB7093',
    papayawhip: '#FFEFD5',
    peachpuff: '#FFDAB9',
    peru: '#CD853F',
    pink: '#FFC0CB',
    plum: '#DDA0DD',
    powderblue: '#B0E0E6',
    purple: '#800080',
    rebeccapurple: '#663399',
    red: '#FF0000',
    rosybrown: '#BC8F8F',
    royalblue: '#4169E1',
    saddlebrown: '#8B4513',
    salmon: '#FA8072',
    sandybrown: '#F4A460',
    seagreen: '#2E8B57',
    seashell: '#FFF5EE',
    sienna: '#A0522D',
    silver: '#C0C0C0',
    skyblue: '#87CEEB',
    slateblue: '#6A5ACD',
    slategray: '#708090',
    slategrey: '#708090',
    snow: '#FFFAFA',
    springgreen: '#00FF7F',
    steelblue: '#4682B4',
    tan: '#D2B48C',
    teal: '#008080',
    thistle: '#D8BFD8',
    tomato: '#FF6347',
    turquoise: '#40E0D0',
    violet: '#EE82EE',
    wheat: '#F5DEB3',
    white: '#FFFFFF',
    whitesmoke: '#F5F5F5',
    yellow: '#FFFF00',
    yellowgreen: '#9ACD32',
};

/** Concatenates 4-bit values into a single int. */
function nibbles(...n: number[]): number {
    let r = 0;
    for (let i = 0, l = n.length; i < l; ++i) {
        r = (r << 4) | n[i];
    }
    return r;
}

const RE_RGB = /^rgb\( *(\d{1,3}) *, *(\d{1,3}) *, *(\d{1,3}) *\)$/;
const RE_RGBA = /^rgba\( *(\d{1,3}) *, *(\d{1,3}) *, *(\d{1,3}) *, *([.\d]+) *\)$/;

/**
 * Parses a CSS colour into 8-bit channels. An already-parsed RGBA passes
 * through unchanged.
 *
 * @throws if the string is not a colour this parser understands.
 */
export function parse(color: string | RGBA): RGBA {
    if (typeof color === 'object') {
        return color;
    }
    let s = color.toLowerCase();
    if (s in COLORS) {
        s = COLORS[s];
    }
    if (s.startsWith('#')) {
        s = s.substring(1);
    }
    switch (s.length) {
        case 3: {
            const n = parseInt(s, 16);
            const nr = (n >> 8) & 0xf;
            const ng = (n >> 4) & 0xf;
            const nb = n & 0xf;
            return {
                r: nibbles(nr, nr),
                g: nibbles(ng, ng),
                b: nibbles(nb, nb),
                a: 255,
            };
        }

        case 6: {
            const n = parseInt(s, 16);
            return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 255 };
        }

        default: {
            const rgb = s.match(RE_RGB);
            if (rgb) {
                return {
                    r: parseInt(rgb[1], 10),
                    g: parseInt(rgb[2], 10),
                    b: parseInt(rgb[3], 10),
                    a: 255,
                };
            }
            const rgba = s.match(RE_RGBA);
            if (rgba) {
                return {
                    r: parseInt(rgba[1], 10),
                    g: parseInt(rgba[2], 10),
                    b: parseInt(rgba[3], 10),
                    a: (255 * parseFloat(rgba[4])) | 0,
                };
            }
            throw new Error(`Rainbow.parse: invalid color structure "${color}"`);
        }
    }
}

/**
 * Renders an {r,g,b,a} structure as a CSS `rgba()` string.
 */
export function rgba(color: string | RGBA): string {
    const c = parse(color);
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a / 255})`;
}
