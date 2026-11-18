// Helper gambar: baca ukuran asli (buat create room), kompres upload
// di browser, dan upload ke Worker (M4).

import { getWorkerOrigin } from "./party";

// Batas upload: file asli maks 10 MB, hasil kompres target < 500 KB,
// sisi terpanjang maks 1600px.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const TARGET_COMPRESSED_BYTES = 500 * 1024;
export const MAX_SIDE = 1600;

export function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Gambar tidak bisa dimuat: " + url));
    img.src = url;
  });
}

// Validasi file sebelum kompres. Kembalikan pesan error atau null
// kalau file boleh dipakai.
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "File harus berupa gambar (JPG, PNG, atau WebP).";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "Ukuran file maksimal 10 MB.";
  }
  return null;
}

// Kompres gambar di browser: resize sisi terpanjang ke maks 1600px,
// encode JPEG dengan kualitas menurun sampai di bawah 500 KB (atau
// kualitas minimum 0,4). Orientasi EXIF (foto HP) dihormati.
export async function compressImage(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(
    1,
    MAX_SIDE / Math.max(bitmap.width, bitmap.height),
  );
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Gambar tidak bisa dikompres.");
  }
  // Latar putih: PNG transparan jadi JPEG berlatar hitam kalau tidak diisi.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", q),
    );
    if (!blob) throw new Error("Gambar tidak bisa dikompres.");
    if (blob.size <= TARGET_COMPRESSED_BYTES || q === 0.4) {
      return { blob, width: w, height: h };
    }
  }
  throw new Error("Gambar tidak bisa dikompres.");
}

// Upload blob hasil kompres ke Worker, kembalikan URL absolut gambar.
export async function uploadImage(blob: Blob): Promise<string> {
  const res = await fetch(`${getWorkerOrigin()}/upload`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg" },
    body: blob,
  });
  if (!res.ok) {
    let msg = "Upload gagal, coba lagi.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      // Badan error bukan JSON: pakai pesan default.
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { url?: string };
  if (!data?.url) throw new Error("Upload gagal, coba lagi.");
  return data.url;
}
