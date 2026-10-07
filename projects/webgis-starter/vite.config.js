import {defineConfig} from 'vite';

export default defineConfig({
  // base: './' 让打包产物可以部署到任意子路径（例如 /gis/ 下）
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    // 进阶：本地 Docker 起了 GeoServer 后，前端用 /geoserver/... 访问即可避免跨域
    proxy: {
      '/geoserver': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
