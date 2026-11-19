// Toggle dark/light mode (app-wide). Pilihan disimpan di localStorage,
// diterapkan sebagai class .dark di <html> (Tailwind v4 custom variant
// + override variabel warna di main.css). Default light; tidak ikut
// prefers-color-scheme supaya perilaku konsisten dan tidak mengejutkan.
import { ref } from "vue";

const STORAGE_KEY = "minigame:theme";

const darkMode = ref(false);

function apply(dark: boolean) {
  darkMode.value = dark;
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // localStorage tidak tersedia: tema hanya di sesi ini.
  }
}

// Dipanggil sekali di main.ts sebelum mount (supaya tidak ada kilat
// tema terang saat user menyimpan dark).
export function initTheme() {
  let dark = false;
  try {
    dark = localStorage.getItem(STORAGE_KEY) === "dark";
  } catch {
    // Abaikan.
  }
  document.documentElement.classList.toggle("dark", dark);
  darkMode.value = dark;
}

export function toggleDarkMode() {
  apply(!darkMode.value);
}

export function useTheme() {
  return { darkMode, toggleDarkMode };
}
