import { describe, expect, it, vi } from 'vitest';
import { floodFill, quoteSplit } from '../../src/index.js';
import { Scheduler, TagGrid, TagTriggers } from '../../src/simulation/index.js';
import type { ActorFrame } from '../../src/index.js';

const frame = (
    moved: ActorFrame['moved'] = [], removed: ActorFrame['removed'] = []
): ActorFrame => ({ moved, removed });

const at = (id: number, x: number, y: number) => ({ id, x, y, z: 0, angle: 0 });

describe('quoteSplit', () => {
    it('keeps quoted runs together', () => {
        expect(quoteSplit('abc def "ghi jkl" mno')).toEqual(['abc', 'def', 'ghi jkl', 'mno']);
        expect(quoteSplit('teleport 3 4')).toEqual(['teleport', '3', '4']);
    });

    it('returns an empty array for an empty tag, not the string', () => {
        // The original returned its input here, so a caller doing .shift() on
        // the result took a character off a string instead of a word.
        expect(quoteSplit('')).toEqual([]);
        expect(quoteSplit('   ')).toEqual([]);
    });
});

describe('floodFill', () => {
    /** A 5x5 plus-shaped region, with an island that must not be reached. */
    const inRegion = (x: number, y: number) =>
        (x === 2 && y >= 0 && y <= 4) || (y === 2 && x >= 0 && x <= 4) || (x === 4 && y === 4);

    it('visits a connected region once each, and stops at its edge', () => {
        const cells = floodFill(2, 2, inRegion);
        const keys = cells.map(c => `${c.x},${c.y}`);
        expect(new Set(keys).size, 'a cell was reported twice').toBe(keys.length);
        expect(keys.length).toBe(9);
        expect(keys).not.toContain('4,4');
    });

    it('reports the starting cell exactly once', () => {
        // The original pushed the start twice outright, so every result had at
        // least one duplicate.
        const cells = floodFill(2, 2, inRegion);
        expect(cells.filter(c => c.x === 2 && c.y === 2).length).toBe(1);
    });

    it('returns nothing when the start fails the test', () => {
        expect(floodFill(0, 0, inRegion)).toEqual([]);
    });
});

describe('TagGrid', () => {
    const grid = () => {
        const g = new TagGrid();
        g.setSize(8, 8);
        return g;
    };

    it('gives the same id to the same tag text', () => {
        const g = grid();
        const a = g.addTag(1, 1, 'teleport 3 4');
        const b = g.addTag(5, 5, 'teleport 3 4');
        expect(b).toBe(a);
        expect(g.addTag(1, 1, 'other')).not.toBe(a);
    });

    it('splits a tag into a command and its arguments', () => {
        const g = grid();
        const id = g.addTag(1, 1, 'sound "door open" 3');
        expect(g.tagOf(id)).toBe('sound "door open" 3');
        expect(g.commandOf(id)).toEqual(['sound', 'door open', '3']);
    });

    it('reports what changed between two cells', () => {
        const g = grid();
        const shared = g.addTag(1, 1, 'shared');
        g.addTag(2, 1, 'shared');
        const only1 = g.addTag(1, 1, 'only-here');
        const only2 = g.addTag(2, 1, 'only-there');

        const v = g.visit(1, 1, 2, 1);
        expect(v.left).toEqual([only1]);
        expect(v.entered).toEqual([only2]);
        // The tag on both cells is neither entered nor left.
        expect(v.entered).not.toContain(shared);
        expect(v.left).not.toContain(shared);
    });

    it('reports nothing when the cell has not changed', () => {
        const g = grid();
        g.addTag(1, 1, 'a');
        expect(g.visit(1, 1, 1, 1)).toEqual({ entered: [], left: [] });
    });

    it('treats off-map as a cell with no tags, rather than throwing', () => {
        const g = grid();
        const id = g.addTag(0, 0, 'start');
        // An actor's previous cell begins at (-1, -1).
        expect(g.visit(-1, -1, 0, 0).entered).toEqual([id]);
        expect(g.idsAt(-5, -5)).toEqual([]);
        expect(g.removeTag(-5, -5, id)).toBe(false);
    });

    it('clears a tag from a whole connected region', () => {
        const g = grid();
        let id = 0;
        for (let x = 1; x <= 3; ++x) {
            for (let y = 1; y <= 3; ++y) {
                id = g.addTag(x, y, 'room');
            }
        }
        // An unconnected cell with the same tag must survive.
        g.addTag(6, 6, 'room');

        expect(g.removeTagRegion(2, 2, id)).toBe(9);
        expect(g.idsAt(1, 1)).toEqual([]);
        expect(g.idsAt(6, 6), 'an unconnected cell was cleared too').toEqual([id]);
    });

    it('round-trips through its serialised state, ids included', () => {
        const g = grid();
        const a = g.addTag(1, 1, 'alpha');
        const b = g.addTag(4, 2, 'beta');
        const saved = JSON.parse(JSON.stringify(g.state)) as typeof g.state;

        const restored = new TagGrid();
        restored.state = saved;
        expect(restored.idsAt(1, 1)).toEqual([a]);
        expect(restored.idsAt(4, 2)).toEqual([b]);
        expect(restored.tagOf(a)).toBe('alpha');
        // A new tag must not reuse an id that survived.
        expect(restored.addTag(0, 0, 'gamma')).not.toBe(b);
    });
});

describe('TagTriggers', () => {
    const triggers = () => {
        const t = new TagTriggers();
        t.setMapSize(8, 64);
        return t;
    };

    it('fires enter for the cell an actor first appears in', () => {
        const t = triggers();
        t.grid.addTag(1, 1, 'welcome mat');
        const seen: string[] = [];
        t.events.on('enter', e => seen.push(`${e.command}:${e.actor}`));

        t.process(frame([at(7, 64 + 10, 64 + 10)]));
        expect(seen).toEqual(['welcome:7']);
    });

    it('fires leave then enter when an actor crosses a boundary', () => {
        const t = triggers();
        t.grid.addTag(1, 1, 'inside');
        t.grid.addTag(2, 1, 'outside');
        const order: string[] = [];
        t.events.on('enter', e => order.push(`enter ${e.command}`));
        t.events.on('leave', e => order.push(`leave ${e.command}`));

        t.process(frame([at(1, 70, 70)]));
        order.length = 0;
        t.process(frame([at(1, 140, 70)]));
        expect(order).toEqual(['leave inside', 'enter outside']);
    });

    it('says nothing while an actor stays in the same cell', () => {
        const t = triggers();
        t.grid.addTag(1, 1, 'here');
        const fired = vi.fn();
        t.events.on('enter', fired);
        t.events.on('leave', fired);

        t.process(frame([at(1, 70, 70)]));
        expect(fired).toHaveBeenCalledTimes(1);
        t.process(frame([at(1, 80, 80)]));
        expect(fired, 'moving within a cell should be silent').toHaveBeenCalledTimes(1);
    });

    it('passes the arguments of the tag', () => {
        const t = triggers();
        t.grid.addTag(1, 1, 'teleport 3 4 "east wing"');
        let got: { command: string; parameters: string[] } | null = null;
        t.events.on('enter', e => { got = { command: e.command, parameters: e.parameters }; });

        t.process(frame([at(1, 70, 70)]));
        expect(got).toEqual({ command: 'teleport', parameters: ['3', '4', 'east wing'] });
    });

    it('lets an event retire its own tag across the region', () => {
        const t = triggers();
        for (let x = 1; x <= 3; ++x) {
            t.grid.addTag(x, 1, 'once');
        }
        t.events.on('enter', e => e.remove());

        t.process(frame([at(1, 70, 70)]));
        expect(t.grid.idsAt(1, 1)).toEqual([]);
        expect(t.grid.idsAt(3, 1), 'the rest of the region should go too').toEqual([]);
    });

    it('fires push for a cell an actor pushed against', () => {
        const t = triggers();
        t.grid.addTag(4, 4, 'locked "you need a key"');
        const seen: string[] = [];
        t.events.on('push', e => seen.push(e.parameters[0]));
        t.push(9, 4, 4);
        expect(seen).toEqual(['you need a key']);
    });

    it('forgets a removed actor, so a reused id starts fresh', () => {
        const t = triggers();
        t.grid.addTag(1, 1, 'here');
        const fired = vi.fn();
        t.events.on('enter', fired);

        t.process(frame([at(1, 70, 70)]));
        expect(fired).toHaveBeenCalledTimes(1);
        t.process(frame([], [1]));
        t.process(frame([at(1, 70, 70)]));
        expect(fired, 'the id should count as a new arrival').toHaveBeenCalledTimes(2);
    });
});

describe('Scheduler', () => {
    it('runs a delayed command once, on the tick it falls due', () => {
        const s = new Scheduler();
        const ran = vi.fn();
        s.delay(ran, 10);

        s.schedule(9);
        expect(ran).not.toHaveBeenCalled();
        s.schedule(10);
        expect(ran).toHaveBeenCalledTimes(1);
        s.schedule(50);
        expect(ran, 'a one-shot must not repeat').toHaveBeenCalledTimes(1);
        expect(s.pending).toBe(0);
    });

    it('runs commands in due order, whatever order they were added', () => {
        const s = new Scheduler();
        const order: string[] = [];
        s.delay(() => order.push('late'), 20);
        s.delay(() => order.push('early'), 5);
        s.delay(() => order.push('middle'), 10);
        s.schedule(100);
        expect(order).toEqual(['early', 'middle', 'late']);
    });

    it('repeats a looped command, catching up on skipped intervals', () => {
        const s = new Scheduler();
        const ran = vi.fn();
        s.loop(ran, 10);
        s.schedule(35);
        expect(ran, 'three intervals elapsed').toHaveBeenCalledTimes(3);
        s.schedule(45);
        expect(ran).toHaveBeenCalledTimes(4);
    });

    it('refuses a loop that would never advance', () => {
        // The original looped `while (due <= now) due += duration`, which never
        // terminates at zero.
        const s = new Scheduler();
        expect(() => s.loop(() => undefined, 0)).toThrow(/must be positive/);
        expect(() => s.loop(() => undefined, -5)).toThrow(/must be positive/);
    });

    it('cancels a command by id', () => {
        const s = new Scheduler();
        const ran = vi.fn();
        const id = s.delay(ran, 10);
        expect(s.cancel(id)).toBe(true);
        expect(s.cancel(id), 'cancelling twice').toBe(false);
        s.schedule(100);
        expect(ran).not.toHaveBeenCalled();
    });

    it('does not run a command scheduled by another within the same tick', () => {
        const s = new Scheduler();
        const order: string[] = [];
        s.delay(() => {
            order.push('first');
            s.delay(() => order.push('second'), 0);
        }, 5);

        s.schedule(5);
        expect(order, 'the nested command ran too early').toEqual(['first']);
        s.schedule(6);
        expect(order).toEqual(['first', 'second']);
    });
});
