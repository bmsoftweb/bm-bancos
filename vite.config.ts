import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Versão do package.json na tela (rodapé do login)
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Porta de HMR própria, para conviver com os demais projetos rodando juntos
      hmr: process.env.DISABLE_HMR === 'true' ? false : { port: 24682 },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
