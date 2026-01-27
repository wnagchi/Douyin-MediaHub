# Technology Stack

## Backend

- **Runtime**: Node.js 18+ (pure Node.js HTTP server, no Express)
- **Database**: SQLite3 for media indexing and caching
- **Image Processing**: Sharp for thumbnail generation
- **Video Processing**: FFmpeg (via ffmpeg-static) for video thumbnails
- **Module System**: CommonJS (`.js` files with `require()`)

## Frontend

- **Build Tool**: Vite 5.x
- **Framework**: React 18 with TypeScript
- **UI Library**: Ant Design 6.x
- **Styling**: Tailwind CSS 4.x (with preflight disabled to avoid conflicts)
- **Routing**: React Router DOM 6.x
- **Layout**: Masonic (masonry grid), Swiper (carousels)
- **Video Player**: video-react
- **PWA**: vite-plugin-pwa

## Development Tools

- **TypeScript**: Strict mode enabled
- **Concurrently**: Run dev server and client simultaneously
- **PostCSS**: With Tailwind and Autoprefixer

## Common Commands

### Development
```bash
npm install              # Install dependencies
npm run dev              # Start both backend (port 3001) and frontend (port 5173)
npm run dev:server       # Start backend only
npm run dev:client       # Start frontend only
```

### Production
```bash
npm run build            # Build frontend to dist/
npm run start            # Start production server (serves dist/ on port 3000)
```

### Utilities
```bash
npm run scan             # Scan media directories and output JSON summary
node app.js --scan       # Same as above
node app.js --port 3001  # Start server on custom port
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `MEDIA_DIR`: Single media directory path
- `MEDIA_DIRS`: Multiple directories separated by `;`
- `INDEX_DB_PATH`: SQLite database path (default: `data/index.sqlite`)
- `LAN_IP` / `LAN_HOST`: Override LAN IP for startup logs
- `HOOK_TOKEN`: Optional token for `/api/reindex` endpoint authentication

## Build Output

- Frontend builds to `dist/` directory
- Backend serves `dist/` in production mode
- Vite dev server proxies `/api`, `/media`, `/thumb`, `/vthumb` to backend

## Key Dependencies

**Backend:**
- `sharp`: Image processing
- `ffmpeg-static`: Video thumbnail extraction

**Frontend:**
- `react`, `react-dom`: UI framework
- `antd`: Component library
- `masonic`: Masonry grid layout
- `swiper`: Touch slider
- `video-react`: Video player
- `react-router-dom`: Client-side routing
