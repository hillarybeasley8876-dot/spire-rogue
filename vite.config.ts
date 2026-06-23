import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 自定义域名 spire.erapi0neer.xyz 已生效，base 固定 "/"。
export default defineConfig({
  base: "/",
  plugins: [react()],
});
