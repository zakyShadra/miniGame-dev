// Helper gambar: baca ukuran asli (buat create room), nanti M4
// tambah kompres upload di sini.

export function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Gambar tidak bisa dimuat: " + url));
    img.src = url;
  });
}
