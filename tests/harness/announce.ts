import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGACY_ROOT, hasLegacy } from './legacy.js';

/**
 * Says out loud what this run is not testing.
 *
 * Vitest reports a skipped suite as a number and exits 0, so a checkout
 * missing the original engine prints a green summary that looks the same as a
 * full one. It is not: the differential suites are what prove this port still
 * matches the engine it replaces, and they are exactly what disappears.
 *
 * That mattered on 2026-09-11, when the sprite-culling fix deliberately made
 * the port diverge from the original. It was only safe to ship because those
 * suites ran. On a checkout without them the same change looks equally green.
 *
 * A `globalSetup` rather than a test, so it prints once, before anything runs,
 * whatever reporter is in use.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const FIDELITY = resolve(ROOT, 'demos/dark-village/assets/levels/level-1.json');

/** Test files gated on a fixture that a fresh clone does not have. */
function gatedFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                walk(path);
            } else if (entry.name.endsWith('.test.ts')) {
                const src = readFileSync(path, 'utf8');
                if (/skipIf\(!has(Legacy|Mansion)\)/.test(src)) {
                    found.push(path.slice(ROOT.length + 1));
                }
            }
        }
    };
    walk(resolve(ROOT, 'tests'));
    return found.sort();
}

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

    if (!hasLegacy) {
        const gated = gatedFiles();
        problems.push([
            'THE ORIGINAL ENGINE IS NOT PRESENT — COVERAGE IS REDUCED',
            '',
            `Looked in: ${LEGACY_ROOT}`,
            '',
            `${gated.length} test file(s) will not run in full:`,
            ...gated.map(f => `  ${f}`),
            '',
            'These are the differential suites: they bundle the original',
            'JavaScript and compare it against this port bit for bit. Without',
            'them a green run does NOT mean the port still matches the engine',
            'it replaces — it means nobody checked.',
            '',
            'Restore with: copy libs/, apps/ and games/ into _OLD_PROJECT_/,',
            'or set LEGACY_ENGINE=/path/to/o876-raycaster-engine',
        ]);
    }

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
