import { createApp } from '../server/app.js';

// A Vercel aceita um app Express como handler: ele já é uma função (req, res).
// O vercel.json roteia todo /api/* para cá, preservando o caminho original.
export default createApp();
