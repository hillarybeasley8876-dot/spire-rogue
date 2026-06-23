import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署：Vercel（spire.erapi0neer.xyz）。root path，base 固定 "/"。
export default defineConfig({
  base: "/",
  plugins: [react()],
});
