// Drag-to-orbit kamera: klik kiri cepat = tembak, geser = orbit.
// Dipakai solo (game.ts) + remote (remote.ts) supaya perilakunya sama
// di semua mode. Klik kanan langsung orbit (tanpa ambang).

/** Ambang geser (px) yang membedakan klik-tembak dari drag-orbit. */
const DRAG_THRESHOLD = 8;

export class DragOrbit {
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  /** Tombol yang sedang mengorbit (0 = kiri, 2 = kanan), null bila tidak. */
  private orbitButton: number | null = null;
  /** Klik kiri tertunda: tembak saat dilepas bila belum jadi drag. */
  private pendingFire = false;

  constructor(
    private fire: () => void,
    private orbit: (dx: number) => void,
  ) {}

  onDown(e: MouseEvent): void {
    if (e.button === 0) {
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.pendingFire = true;
    } else if (e.button === 2) {
      this.orbitButton = 2;
      this.lastX = e.clientX;
    }
  }

  onMove(e: MouseEvent): void {
    if (this.pendingFire) {
      const dx = e.clientX - this.startX;
      const dy = e.clientY - this.startY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        // Jadi drag: batalkan tembak, mulai orbit dari posisi ini.
        this.pendingFire = false;
        this.orbitButton = 0;
        this.lastX = e.clientX;
      }
    }
    if (this.orbitButton !== null) {
      this.orbit(e.clientX - this.lastX);
      this.lastX = e.clientX;
    }
  }

  onUp(e: MouseEvent): void {
    if (e.button === 0 && this.pendingFire) {
      this.pendingFire = false;
      this.fire();
    }
    if (e.button === this.orbitButton) this.orbitButton = null;
  }
}
