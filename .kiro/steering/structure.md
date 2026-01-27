# Project Structure

## Root Directory

```
├── app.js                    # Entry point (thin wrapper for src/server.js)
├── package.json              # Dependencies and scripts
├── config.json               # Runtime config (media directories)
├── config.example.json       # Config template
├── vite.config.ts            # Vite build configuration
├── tailwind.config.cjs       # Tailwind CSS configuration
├── postcss.config.cjs        # PostCSS configuration
├── data/                     # Runtime data
│   ├── index.sqlite          # SQLite media index
│   ├── thumbs/               # Image thumbnails (webp)
│   └── vthumbs/              # Video thumbnails (webp)
├── dist/                     # Frontend build output (served in production)
├── src/                      # Backend source code
└── web/                      # Frontend source code
```

## Backend Structure (`src/`)

```
src/
├── server.js                 # HTTP server setup and startup
├── handler.js                # Request routing and API handlers
├── indexer.js                # SQLite indexing and query logic
├── thumbs.js                 # Image thumbnail generation
├── videoThumbs.js            # Video thumbnail generation
├── tags.js                   # Tag extraction and management
├── cache/
│   └── thumbCache.js         # Thumbnail cache management
├── config/
│   └── mediaDirs.js          # Media directory configuration
├── http/
│   ├── cache.js              # HTTP caching (ETag, Cache-Control)
│   ├── respond.js            # Response helpers (JSON, text)
│   └── static.js             # Static file serving with range support
├── media/
│   └── index.js              # Media scanning and grouping logic
└── utils/
    └── fs.js                 # File system utilities
```

### Backend Module Responsibilities

- **server.js**: Creates HTTP server, initializes stores/indexer, handles startup
- **handler.js**: Routes all requests, implements API endpoints
- **indexer.js**: Manages SQLite database for media metadata and queries
- **thumbs.js / videoThumbs.js**: Generate and cache thumbnails on-demand
- **media/index.js**: Scans directories, extracts metadata, groups media
- **http/**: HTTP utilities (caching, static files, responses)
- **config/**: Configuration management (media directories)
- **cache/**: Cache management (thumbnail cleanup, stats)

## Frontend Structure (`web/`)

```
web/
├── index.html                # HTML entry point
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── main.tsx              # React app entry point
│   ├── RouterApp.tsx         # Router setup
│   ├── App.tsx               # Main app component (list view)
│   ├── app.css               # Global styles
│   ├── api.ts                # API client functions
│   ├── components/           # React components
│   │   ├── Topbar.tsx        # Top navigation and filters
│   │   ├── MediaGrid.tsx     # Album/card view
│   │   ├── MediaTiles.tsx    # Masonry/tile view
│   │   ├── MediaCard.tsx     # Single media card
│   │   ├── PreviewModal.tsx  # Media preview modal
│   │   ├── PublisherView.tsx # Publisher-grouped view
│   │   ├── SetupCard.tsx     # Initial setup UI
│   │   ├── BaseImage.tsx     # Image component with loading
│   │   ├── BaseVideo.tsx     # Video component
│   │   └── LazyImage.tsx     # Lazy-loaded image
│   ├── pages/
│   │   └── FeedPage.tsx      # Immersive feed view (route: /feed)
│   ├── hooks/                # Custom React hooks
│   │   ├── useMediaPagination.ts
│   │   ├── useMediaQueryState.ts
│   │   └── useModalNavigation.ts
│   ├── utils/                # Utility functions
│   │   ├── cache.ts          # Client-side caching
│   │   └── media.ts          # Media helpers
│   └── types/                # TypeScript type definitions
│       └── video-react.d.ts
└── public/                   # Static assets (PWA icons, etc.)
```

### Frontend Component Hierarchy

```
RouterApp
├── App (main list view at /)
│   ├── Topbar (filters, search, view mode)
│   ├── SetupCard (if no media dirs configured)
│   ├── MediaGrid (album view)
│   ├── MediaTiles (masonry view)
│   ├── PublisherView (publisher-grouped view)
│   └── PreviewModal (media preview overlay)
└── FeedPage (immersive feed at /feed)
```

## API Endpoints

- `GET /api/resources` - List media groups (paginated, filterable)
- `GET /api/authors` - List authors with counts
- `GET /api/tags` - List tags with counts
- `GET /api/config` - Get media directory configuration
- `POST /api/config` - Update media directory configuration
- `POST /api/reindex` - Trigger incremental/full rescan
- `GET /api/inspect` - Inspect MP4 metadata
- `POST /api/delete` - Batch delete media items
- `GET /api/cache/stats` - Get cache statistics
- `POST /api/cache/clear/thumbs` - Clear all thumbnails
- `POST /api/cache/cleanup` - Clean old thumbnails
- `GET /media/:dirId/:filename` - Serve media file
- `GET /thumb/:dirId/:filename` - Serve image thumbnail
- `GET /vthumb/:dirId/:filename` - Serve video thumbnail

## Data Flow

1. **Startup**: Server scans media directories → SQLite index
2. **Request**: Client requests `/api/resources` with filters
3. **Query**: Server queries SQLite → returns paginated groups
4. **Render**: Client renders media grid/tiles with thumbnails
5. **Preview**: Click opens modal → loads full media file
6. **Update**: POST `/api/reindex` → incremental scan → refresh UI

## Configuration Files

- `config.json`: Runtime media directory configuration (created by UI)
- `config.example.json`: Template for manual configuration
- `.kiro/steering/`: AI assistant steering documents (this directory)
