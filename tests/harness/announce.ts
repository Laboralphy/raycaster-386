import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Says out loud what this run is not testing.
 *
 * Vitest reports a skipped suite as a number and exits 0, so a run missing a
 * fixture prints a green summary indistinguishable from a full one.
 *
 * A `globalSetup` rather than a test, so it prints once, before anything runs,
 * whatever reporter is in use.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const FIDELITY = resolve(ROOT, 'demos/dark-village/assets/levels/level-1.json');

function banner(lines: string[]): void {
    const width = Math.max(...lines.map(l => l.length));
    const rule = '─'.repeat(width + 2);
    process.stderr.write(`\n┌${rule}┐\n`);
    for (const line of lines) {
        process.stderr.write(`│ ${line.padEnd(width)} │\n`);
    }
    process.stderr.write(`└${rule}┘\n\n`);
}

export function setup(): void {
    const problems: string[][] = [];

    if (!existsSync(FIDELITY)) {
        problems.push([
            'THE MAPEDIT FIDELITY FIXTURE IS NOT PRESENT',
            '',
            `Looked for: ${FIDELITY.slice(ROOT.length + 1)}`,
            '',
            'tests/mapedit/fidelity.test.ts will not run. It is the only test',
            'that proves src/mapedit reproduces the original converter, rather',
            'than merely producing something that loads.',
        ]);
    }

    for (const lines of problems) {
        banner(lines);
    }

    // Opt-in hard failure, for a checkout that is meant to be complete.
    if (problems.length > 0 && process.env.RAYCASTER_REQUIRE_FIXTURES === '1') {
        throw new Error(
            'RAYCASTER_REQUIRE_FIXTURES=1 and fixtures are missing; see the banners above'
        );
    }
}
