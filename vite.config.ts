import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 自定义域名 spire.erapi0neer.xyz 启用后，base 固定为 "/"，
// 不再依赖 GITHUB_REPOSITORY 注入 /spire-rogue/ 前缀。
export default defineConfig({
  base: "/",
  plugins: [react()],
});
