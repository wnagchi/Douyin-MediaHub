/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./web/index.html', './web/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  corePlugins: {
    // 现有项目大量依赖自定义 CSS，为避免 Tailwind preflight 影响现有样式，先关闭
    preflight: false,
  },
  plugins: [],
};

