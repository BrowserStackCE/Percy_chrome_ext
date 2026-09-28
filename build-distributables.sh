#!/bin/bash

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

BACKEND_DIR="$ROOT_DIR/go-backend"
EXTENSION_DIR="$ROOT_DIR/percy-local-manager-extension"
DIST_DIR="$ROOT_DIR/Distributables"

echo "=========================================="
echo " Percy Local Manager"
echo " Building Distributables"
echo "=========================================="
echo

# ------------------------------------------------------------
# Check directories
# ------------------------------------------------------------

if [ ! -d "$BACKEND_DIR" ]; then
    echo "❌ go-backend directory not found"
    exit 1
fi

if [ ! -d "$EXTENSION_DIR" ]; then
    echo "❌ percy-local-manager-extension directory not found"
    exit 1
fi

if [ ! -d "$DIST_DIR" ]; then
    echo "❌ Distributables directory not found"
    exit 1
fi

# ------------------------------------------------------------
# Check Go
# ------------------------------------------------------------

if ! command -v go >/dev/null 2>&1; then
    echo "❌ Go is not installed"
    exit 1
fi

echo "Go:"
go version
echo

# ------------------------------------------------------------
# Check Node / npm
# ------------------------------------------------------------

if ! command -v npm >/dev/null 2>&1; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "Node:"
node --version

echo "npm:"
npm --version

echo

# ============================================================
# GO BACKEND
# ============================================================

echo "=========================================="
echo " Building Go Backend"
echo "=========================================="
echo

cd "$BACKEND_DIR"

# ------------------------------------------------------------
# Mac Intel
# ------------------------------------------------------------

echo "🍎 Building macOS x86_64..."

GOOS=darwin GOARCH=amd64 \
go build \
    -o "$DIST_DIR/percy-mac/server" \
    ./cmd/server

echo "✅ Distributables/percy-mac/server"
echo

# ------------------------------------------------------------
# Mac ARM64
# ------------------------------------------------------------

echo "🍎 Building macOS arm64..."

GOOS=darwin GOARCH=arm64 \
go build \
    -o "$DIST_DIR/percy-mac/server-arm64" \
    ./cmd/server

echo "✅ Distributables/percy-mac/server-arm64"
echo

# ------------------------------------------------------------
# Linux
# ------------------------------------------------------------

echo "🐧 Building Linux amd64..."

GOOS=linux GOARCH=amd64 \
go build \
    -o "$DIST_DIR/percy-linux/server" \
    ./cmd/server

echo "✅ Distributables/percy-linux/server"
echo

# ------------------------------------------------------------
# Windows
# ------------------------------------------------------------

echo "🪟 Building Windows amd64..."

GOOS=windows GOARCH=amd64 \
go build \
    -o "$DIST_DIR/percy-windows/server.exe" \
    ./cmd/server

echo "✅ Distributables/percy-windows/server.exe"
echo

# ------------------------------------------------------------
# Permissions
# ------------------------------------------------------------

chmod +x "$DIST_DIR/percy-mac/server"
chmod +x "$DIST_DIR/percy-mac/server-arm64"
chmod +x "$DIST_DIR/percy-linux/server"

chmod +x "$DIST_DIR/percy-mac/server.sh"
chmod +x "$DIST_DIR/percy-linux/server.sh"

echo "✅ Backend builds complete"
echo


# ============================================================
# CHROME EXTENSION
# ============================================================

echo "=========================================="
echo " Building Chrome Extension"
echo "=========================================="
echo

cd "$EXTENSION_DIR"

echo "📦 Installing extension dependencies..."

npm install --legacy-peer-deps

echo
echo "🔨 Building extension..."

npm run build

echo
echo "✅ Extension build complete"
echo


# ------------------------------------------------------------
# Verify extension dist
# ------------------------------------------------------------

if [ ! -d "$EXTENSION_DIR/dist" ]; then
    echo "❌ Extension dist directory was not generated"
    exit 1
fi

echo "📁 Extension dist:"
ls -la "$EXTENSION_DIR/dist"

echo


# ------------------------------------------------------------
# Copy extension dist to Distributables
# ------------------------------------------------------------

EXTENSION_DIST="$DIST_DIR/percy-local-manager-extension"

echo "📦 Copying extension to:"
echo "   $EXTENSION_DIST"

rm -rf "$EXTENSION_DIST"

mkdir -p "$EXTENSION_DIST"

cp -R "$EXTENSION_DIR/dist/." "$EXTENSION_DIST/"

echo
echo "✅ Extension copied"
echo


# ============================================================
# FINAL RESULT
# ============================================================

echo "=========================================="
echo " ✅ BUILD COMPLETE"
echo "=========================================="
echo

echo "Generated distributables:"
echo

tree "$DIST_DIR" 2>/dev/null || \
find "$DIST_DIR" -maxdepth 3 -type f | sort

echo
echo "=========================================="
echo " Everything is ready!"
echo "=========================================="