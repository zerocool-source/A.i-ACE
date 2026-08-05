// Resolves an asset path against Vite's base URL so the game works both at
// the dev-server root and hosted under a subpath (e.g. GitHub Pages /A.i-ACE/).
export const asset = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');
