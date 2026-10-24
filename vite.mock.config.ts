import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: '/home/user/cash-split-app', plugins: [react(), { name: 'mock', enforce: 'pre', resolveId(s, imp) { if (s === './lib/store' && imp?.includes('/src/')) return '/tmp/claude-0/-home-user-cash-split-app/69756be6-f589-5015-b6bf-f8be6939273c/scratchpad/mockstore.ts'; } }] });
