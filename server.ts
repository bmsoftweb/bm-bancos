import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { agendarMovimentoApi } from './server/boleto/retorno.js';

/** Entrada para execução local. Na Vercel quem serve as rotas é api/index.ts. */
const PORT = Number(process.env.PORT) || 3000;

async function iniciar() {
  const app = createApp();

  // =========================================================================
  // VITE / SPA
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  // Retorno pela API das contas do canal api, a cada 30 min (só aqui: na Vercel não há processo vivo)
  agendarMovimentoApi();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BMBancos rodando em http://0.0.0.0:${PORT}`);
    console.log(`MySQL: ${process.env.MYSQL_HOST || 'localhost'} / ${process.env.MYSQL_DATABASE || 'bmerp'}`);
  });
}

iniciar().catch((err) => {
  console.error('Falha ao iniciar o BMBancos:', err);
  process.exit(1);
});
