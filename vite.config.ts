import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 部署策略：
// - 默认走 GitHub Pages 项目子路径：/spire-rogue/
// - 自定义域名 spire.erapi0neer.xyz 启用后，CI 设置 SPIRE_CUSTOM_DOMAIN=1 时 base 改成 "/"
declare const process: { env: { SPIRE_CUSTOM_DOMAIN?: string; GITHUB_REPOSITORY?: string } };

const useCustomDomain = process.env.SPIRE_CUSTOM_DOMAIN === "1";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  base: useCustomDomain ? "/" : repoName ? `/${repoName}/` : "/spire-rogue/",
  plugins: [react()],
});
