/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages (https://naoya25.github.io/sudocube/) 配信用のサブパス
  base: '/sudocube/',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // three.js 系はアプリ本体より更新頻度が低いので分離してキャッシュを生かす
          groups: [{ name: 'three', test: /node_modules[\\/](three|@react-three)[\\/]/ }],
        },
      },
    },
    // three チャンク単体で ~900kB (gzip ~240kB)。ライブラリ丸ごとの分離チャンクとして許容
    chunkSizeWarningLimit: 1000,
  },
  test: {
    // 生成ロジックのテストは 1 回あたり最大 ~1.5s かかり、複数シードを回すため余裕を持たせる。
    testTimeout: 20000,
  },
})
