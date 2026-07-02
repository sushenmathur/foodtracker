import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the build works both locally and on GitHub Pages
  // (which serves the app from /foodtracker/ rather than the domain root)
  base: "./",
  plugins: [react()],
});
