/** Keyboard + pointer-lock mouse input with edge-triggered key presses. */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** Accumulated wheel notches this frame (positive = scroll down). */
  wheel = 0;
  /** Touch joystick axes, -1..1 (forward / right). Added to the keyboard axes. */
  axisF = 0;
  axisR = 0;
  enabled = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    // Keep browser shortcuts (Ctrl+S/D etc.) from firing while crouching during play.
    if (e.ctrlKey && ['KeyS', 'KeyD', 'KeyA', 'KeyF', 'KeyE'].includes(e.code)) e.preventDefault();
    if (['Space', 'ControlLeft', 'ControlRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.held.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || !document.pointerLockElement) return;
    // Ignore the occasional huge spike some browsers emit right after locking.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    // Only count clicks while the mouse is captured, so menu clicks never fire the weapon.
    if (!this.enabled || !document.pointerLockElement) return;
    this.pressed.add(`Mouse${e.button}`);
    this.held.add(`Mouse${e.button}`);
  };
  private onMouseUp = (e: MouseEvent) => {
    this.held.delete(`Mouse${e.button}`);
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled || !document.pointerLockElement) return;
    this.wheel += Math.sign(e.deltaY);
  };
  private onBlur = () => this.reset();

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.held.has(c));
  }

  wasPressed(...codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Touch: add a look delta in "mouse pixels". */
  addLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Touch: press a virtual key for one frame (edge-triggered). */
  tap(code: string) {
    this.pressed.add(code);
  }

  /** Touch: hold or release a virtual key. */
  setHeld(code: string, down: boolean) {
    if (down) { this.pressed.add(code); this.held.add(code); }
    else this.held.delete(code);
  }

  /** Test hook: simulate a key. */
  simulate(code: string, down: boolean) {
    if (down) { this.pressed.add(code); this.held.add(code); }
    else this.held.delete(code);
  }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  reset() {
    this.axisF = 0;
    this.axisR = 0;
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
