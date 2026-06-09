# Grindshell Frontend

## build

> Build for production

```sh
echo "must choose either 'desktop' or 'web'"
exit 1
```

### desktop

> Build a single binary

```sh
echo "building for desktop"
pnpm tauri build
```

### web

> Build into multiple html files

```sh
set -eux

echo "building for web"
pnpm vite build
```

## run

> Run the app

```sh
echo "running for desktop by default"
mask run desktop
```

### desktop

> Run a desktop build

```sh
echo "running for desktop"
pnpm tauri dev
```

### web

> Run a web build

```sh
echo "running for web"
pnpm dev
```
