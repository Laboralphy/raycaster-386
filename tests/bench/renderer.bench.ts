import { describe, it } from 'vitest';
import { SCENES } from '../harness/scenes.js';
import { buildLegacyRenderer } from '../harness/legacyRenderer.js';
import { buildPortRenderer } from '../harness/portRenderer.js';
import { hasLegacy } from '../harness/legacy.js';
import { compare, report } from './harness.js';

/**
 * Port against the original, per scene and in total.
 *
 * The `storey` scene is reported but excluded from the total: the original
 * shades its upper floor against the wrong layer count and draws less than it
 * should, so the two are not doing the same work.
 */
describe.skipIf(!hasLegacy)('renderer', () => {
    it('port vs original', async () => {
        let totalLegacy = 0;
        let totalPort = 0;
        const rows: string[] = [];

        for (const spec of SCENES) {
            const cam = spec.cameras[0];
            const legacy = await buildLegacyRenderer(spec);
            const port = buildPortRenderer(spec);
            legacy.render(cam.x, cam.y, cam.angle, cam.height);
            port.render(cam.x, cam.y, cam.angle, cam.height);

            const r = compare([
                { name: 'original', run: () => legacy.render(cam.x, cam.y, cam.angle, cam.height) },
                { name: 'port', run: () => port.render(cam.x, cam.y, cam.angle, cam.height) }
            ]);
            const a = r.get('original')!;
            const b = r.get('port')!;
            const pct = ((a - b) / a) * 100;
            const excluded = spec.name === 'storey';
            if (!excluded) {
                totalLegacy += a;
                totalPort += b;
            }
            rows.push(
                `  ${spec.name.padEnd(9)} original ${a.toFixed(3)}  port ${b.toFixed(3)}  ` +
                `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%${excluded ? '   (excluded: not comparable)' : ''}`
            );
        }
        const pct = ((totalLegacy - totalPort) / totalLegacy) * 100;
        console.log('\nrender(), per scene');
        rows.forEach(r => console.log(r));
        console.log(
            `  ${'TOTAL'.padEnd(9)} original ${totalLegacy.toFixed(3)}  port ${totalPort.toFixed(3)}  ` +
            `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
        );
    });

    it('phase breakdown on the port', async () => {
        const spec = SCENES[0];
        const cam = spec.cameras[0];
        const legacy = await buildLegacyRenderer(spec);
        const port = buildPortRenderer(spec);
        legacy.render(cam.x, cam.y, cam.angle, cam.height);
        port.render(cam.x, cam.y, cam.angle, cam.height);

        const full = compare([
            { name: 'original render', run: () => legacy.render(cam.x, cam.y, cam.angle, cam.height) },
            { name: 'port render', run: () => port.render(cam.x, cam.y, cam.angle, cam.height) }
        ]);
        const scene = compare([
            { name: 'original computeScene', run: () => legacy.computeScene(cam.x, cam.y, cam.angle, cam.height) },
            { name: 'port computeScene', run: () => port.computeScene(cam.x, cam.y, cam.angle, cam.height) }
        ]);
        report('phases (room / centre-east)', new Map([
            ...full,
            ...scene,
            ['original raster', full.get('original render')! - scene.get('original computeScene')!],
            ['port raster', full.get('port render')! - scene.get('port computeScene')!]
        ]), 'original render');
    });
});
