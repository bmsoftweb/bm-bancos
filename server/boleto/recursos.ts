/**
 * Localiza a pasta `recursos` (logos dos bancos).
 *
 * Rodando local o diretório de trabalho é a raiz do projeto; na Vercel a função
 * roda em /var/task e os arquivos chegam lá pelo `includeFiles` do vercel.json.
 * Por isso a busca tenta o diretório de trabalho e, em seguida, sobe a partir do
 * próprio módulo — que é o único ponto de referência garantido.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function candidatos(): string[] {
  const lista = [
    path.join(process.cwd(), 'recursos'),
    path.join(process.cwd(), '..', 'recursos'),
  ];

  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    // server/boleto -> server -> raiz -> ... (algumas subidas bastam em qualquer layout)
    for (let i = 0; i < 6; i++) {
      lista.push(path.join(dir, 'recursos'));
      const acima = path.dirname(dir);
      if (acima === dir) break;
      dir = acima;
    }
  } catch {
    // Em bundle CommonJS não há import.meta; o diretório de trabalho resolve
  }

  return lista;
}

let cache: string | null = null;

/** Caminho da pasta `recursos`, ou null quando ela não foi empacotada */
export function pastaRecursos(): string | null {
  if (cache) return cache;
  cache = candidatos().find((c) => fs.existsSync(c)) ?? null;
  return cache;
}

/** Caminho de um arquivo dentro de `recursos`, ou null quando não existe */
export function arquivoRecurso(...partes: string[]): string | null {
  const base = pastaRecursos();
  if (!base) return null;
  const completo = path.join(base, ...partes);
  return fs.existsSync(completo) ? completo : null;
}
