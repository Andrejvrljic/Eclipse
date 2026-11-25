// Baut aus eclipse-platform.html eine eigenständige Seite: public/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'eclipse-platform.html'), 'utf8');
const cut = src.indexOf('</style>') + '</style>'.length;
if (cut < 8) throw new Error('</style> nicht gefunden');
const head = src.slice(0, cut);
const body = src.slice(cut);
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#050507">
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Cdefs%3E%3Cmask id='m'%3E%3Crect width='40' height='40' fill='%23fff'/%3E%3Ccircle cx='25.5' cy='15' r='12'/%3E%3C/mask%3E%3C/defs%3E%3Ccircle cx='19' cy='21' r='14' fill='%23A78BFA' mask='url(%23m)'/%3E%3C/svg%3E">
${head}
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'index.html'), html);
console.log('public/index.html', html.length, 'Bytes');
