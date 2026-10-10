import { describe, expect, it } from 'vitest';
import { Renderer } from '../src/Renderer.js';
import { installDom } from './harness/dom.js';

describe('render canvas', () => {
    it('asks for a context meant for frequent reads, since every frame reads it back', () => {
        installDom();
        const doc = globalThis.document as { createElement: (tag: string) => HTMLCanvasElement };
        const create = doc.createElement;
        const settings = new Map<HTMLCanvasElement, unknown>();
        doc.createElement = (tag: string) => {
            const canvas = create(tag);
            const getContext = canvas.getContext.bind(canvas);
            canvas.getContext = ((id: string, s?: unknown) => {
                if (!settings.has(canvas)) {
                    settings.set(canvas, s);
                }
                return getContext(id as '2d', s as CanvasRenderingContext2DSettings);
            }) as typeof canvas.getContext;
            return canvas;
        };
        try {
            const rc = new Renderer();
            rc.setScreen({ width: 320, height: 200 });
            rc.setMapSize(4);
            rc.computeScene(96, 96, 0, 1);
            expect(rc.renderCanvas).not.toBeNull();
            // the first getContext call is the one that fixes the settings
            expect(settings.get(rc.renderCanvas!)).toEqual({ willReadFrequently: true });
        } finally {
            doc.createElement = create;
        }
    });
});
