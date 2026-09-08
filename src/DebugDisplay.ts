/**
 * A small overlay of text lines drawn on top of the rendered frame.
 */
export class DebugDisplay {
    private _lines: string[] = [];

    clear(): void {
        this._lines.length = 0;
    }

    print(...args: unknown[]): void {
        this._lines.push(args.join(' '));
    }

    display(context: CanvasRenderingContext2D, x: number, y: number): void {
        const lines = this._lines;
        if (lines.length === 0) {
            return;
        }
        context.fillStyle = 'white';
        context.strokeStyle = 'black';
        context.textBaseline = 'top';
        context.font = '10px monospace';
        for (let i = 0, l = lines.length; i < l; ++i) {
            context.strokeText(lines[i], x, y + i * 12);
            context.fillText(lines[i], x, y + i * 12);
        }
    }
}
