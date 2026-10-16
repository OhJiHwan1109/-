import { defineConfig } from 'vite';

function protectPrivateProjectFiles() {
  return {
    name: 'protect-private-project-files',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url || '/', 'http://localhost').pathname;
        if (/^\/(data|scripts)(\/|$)/.test(path) || path === '/server.js') {
          response.statusCode = 404;
          response.end('Not Found');
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [protectPrivateProjectFiles()],
  server: { host: '0.0.0.0', port: 5173, strictPort: true }
});
