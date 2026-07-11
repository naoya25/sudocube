/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 生成ロジックのテストは 1 回あたり最大 ~1.5s かかり、複数シードを回すため余裕を持たせる。
    testTimeout: 20000,
  },
})
