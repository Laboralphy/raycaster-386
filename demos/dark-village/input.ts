/** What the player is asking for this tick. */
export interface Input {
    forward: number;
    strafe: number;
    turn: number;
    /** Set for one tick when the open-door key is pressed. */
    use: boolean;
}

/** Mouse sensitivity, radians per pixel of movement. */
const MOUSE_SENSITIVITY = 0.0025;

/**
 * A tick with nothing asked for.
 *
 * Free-standing as well as a method on {@link InputManager}, because a
 * headless test drives `World.update` directly and has no DOM to plug an
 * InputManager into.
 */
export function emptyInput(): Input {
    return { forward: 0, strafe: 0, turn: 0, use: false };
}

export class InputManager {
    public held = new Set<string>();
    public mouseTurn: number = 0;
    public usePressed: boolean = false;

    emptyInput(): Input {
        return emptyInput();
    }

    readInput(): Input {
        const input = this.emptyInput();
        if (this.held.has('w') || this.held.has('z') || this.held.has('arrowup')) {
            input.forward += 1;
        }
        if (this.held.has('s') || this.held.has('arrowdown')) {
            input.forward -= 1;
        }
        if (this.held.has('a') || this.held.has('q')) {
            input.strafe -= 1;
        }
        if (this.held.has('d')) {
            input.strafe += 1;
        }
        if (this.held.has('arrowleft')) {
            input.turn -= 1;
        }
        if (this.held.has('arrowright')) {
            input.turn += 1;
        }
        // Mouse look is applied as a one-off rotation, not a rate.
        input.turn += this.mouseTurn / 0.045;
        this.mouseTurn = 0;
        input.use = this.usePressed;
        this.usePressed = false;
        return input;
    }

    plugListeners(canvas: HTMLCanvasElement) {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            this.held.add(key);
            if (key === 'e' || key === ' ') {
                this.usePressed = true;
                e.preventDefault();
            }
            if (key.startsWith('arrow')) {
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', (e) => this.held.delete(e.key.toLowerCase()));
        window.addEventListener('blur', () => this.held.clear());

        canvas.addEventListener('click', () => {
            if (document.pointerLockElement !== canvas) {
                void canvas.requestPointerLock();
            } else {
                this.usePressed = true;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                this.mouseTurn += e.movementX * MOUSE_SENSITIVITY;
            }
        });
    }
}
