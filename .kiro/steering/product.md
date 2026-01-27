# Product Overview

**Douyin Media Gallery** is a local/LAN media browsing tool for internal use. It scans resource directories and presents media (videos and images) in a browser-based interface with automatic grouping by publish date, author, and topic.

## Core Features

- **Media Scanning**: Server-side directory scanning with SQLite indexing for fast queries
- **Grouping & Filtering**: Automatic grouping by date/author/topic with filtering by type, directory, tags, and search
- **Preview & Download**: In-browser video/image preview with download capabilities
- **Multiple View Modes**: 
  - Masonry (tile view for all items)
  - Album (card-based group view)
  - Publisher (grouped by author)
- **Thumbnail Generation**: Automatic thumbnail generation for images (Sharp) and videos (FFmpeg)
- **Batch Operations**: Multi-select for batch download and deletion
- **LAN Access**: Designed for multi-device access on local network
- **PWA Support**: Progressive Web App with offline capabilities

## Target Users

Internal team members who need to browse, preview, and manage media resources stored on local or network drives.

## Key Workflows

1. Configure media directories (absolute paths)
2. Server scans and indexes media files
3. Browse media in various view modes with filtering
4. Preview media in modal or immersive feed mode
5. Download or delete media items as needed
