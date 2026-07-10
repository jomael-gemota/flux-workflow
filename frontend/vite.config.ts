import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Split the app into smaller vendor chunks. A single multi-MB bundle can
    // fail to stream over HTTP/2 behind some proxies/CDNs
    // (net::ERR_HTTP2_PROTOCOL_ERROR), so we break heavy dependencies out into
    // their own cacheable chunks.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@xyflow') || id.includes('d3-') || id.includes('/dagre')) return 'reactflow';
          if (
            id.includes('@codemirror') ||
            id.includes('@lezer') ||
            id.includes('@uiw/react-codemirror') ||
            id.includes('/style-mod') ||
            id.includes('/w3c-keyname') ||
            id.includes('/crelt')
          ) {
            return 'codemirror';
          }
          // Markdown + syntax highlighting share a large low-level tree
          // (hast/unist/micromark/refractor). Keep them together so no shared
          // module bridges two chunks (which would create circular chunks).
          if (
            id.includes('react-markdown') ||
            id.includes('react-syntax-highlighter') ||
            id.includes('remark') ||
            id.includes('rehype') ||
            id.includes('/refractor') ||
            id.includes('/highlight.js') ||
            id.includes('/prismjs') ||
            id.includes('/micromark') ||
            id.includes('/mdast') ||
            id.includes('/hast') ||
            id.includes('/unist') ||
            id.includes('/unified') ||
            id.includes('/vfile') ||
            id.includes('/property-information') ||
            id.includes('character-entities') ||
            id.includes('-separated-tokens') ||
            id.includes('decode-named-character-reference') ||
            id.includes('/devlop') ||
            id.includes('/trough') ||
            id.includes('/bail') ||
            id.includes('/zwitch') ||
            id.includes('/ccount') ||
            id.includes('/escape-string-regexp') ||
            id.includes('/markdown-table') ||
            id.includes('/estree') ||
            id.includes('/fault') ||
            id.includes('/xtend') ||
            id.includes('/web-namespaces') ||
            id.includes('/html-void-elements')
          ) {
            return 'markdown';
          }
          if (id.includes('@tanstack')) return 'react-query';
          if (id.includes('react-router') || id.includes('/@remix-run/')) return 'router';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          // Everything else stays with the entry chunk (no catch-all vendor,
          // which would bridge shared modules and create circular chunks).
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Allow large payloads (e.g. workflows with base64 file attachments)
        proxyTimeout: 60_000,
        timeout: 60_000,
      },
      '/webhooks': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
