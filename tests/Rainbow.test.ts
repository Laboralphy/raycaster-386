import { describe, expect, it } from 'vitest';
import { parse, rgba } from '../src/core/Rainbow.js';

describe('Rainbow.parse', () => {
    it('parses named colours', () => {
        expect(parse('black')).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        expect(parse('white')).toEqual({ r: 255, g: 255, b: 255, a: 255 });
        expect(parse('RED')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    });

    it('parses 3- and 6-digit hex, with or without #', () => {
        expect(parse('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
        expect(parse('f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
        expect(parse('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 255 });
    });

    it('parses rgb() and rgba()', () => {
        expect(parse('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 255 });
        expect(parse('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 127 });
    });

    it('passes an already-parsed structure through', () => {
        const c = { r: 1, g: 2, b: 3, a: 4 };
        expect(parse(c)).toBe(c);
    });

    it('throws on nonsense', () => {
        expect(() => parse('not-a-colour')).toThrow(/invalid color structure/);
    });

    it('round-trips through rgba()', () => {
        expect(rgba('#804020')).toBe('rgba(128, 64, 32, 1)');
        expect(rgba({ r: 0, g: 0, b: 0, a: 0 })).toBe('rgba(0, 0, 0, 0)');
    });
});
