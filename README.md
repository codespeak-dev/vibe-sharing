# codespeak-vibe-share

One of the things we are working on at [CodeSpeak](https://codespeak.dev) is converting vibe coding sessions into maintainable specs. To make this tool better, we are asking people to donate their vibe coded projects (code, git history, and agent sessions). 

<img width="500" height="1106" alt="Only share your data if you want to help us build better tools, out of the goodness of your heart 💚. By sharing, you give CodeSpeak permission to study your project. CodeSpeak will NOT build commercial software that runs any of your code." src="https://github.com/user-attachments/assets/5f952dc2-7856-4cd6-b21f-8b96a5015701" />

This tool will **not** upload any of your project data without your explicit permission.

To retract or request deletion: [support@codespeak.dev](mailto:support@codespeak.dev)

🫶 Thank you for helping us make programming better. 🫶

## Development

### Components

| Component | Description |
|---|---|
| root (`src/`) | CLI tool and shared library (`codespeak-vibe-share`) |
| `session-viewer/` | Next.js app for browsing uploaded sessions |
| `backend/` | AWS CDK infrastructure |

### Setup & build

```bash
make install   # install deps for all components
make build     # build all components
```

Or per component:

```bash
make install-root     && make build-root
make install-viewer   && make build-viewer
make install-backend  && make build-backend
```

### Running locally

```bash
make dev-cli      # run the CLI in dev mode (tsx, no compile step)
make dev-viewer   # build root lib then start session-viewer on localhost:3000
```

> `dev-viewer` builds the root package first — required because session-viewer depends on `codespeak-vibe-share` via `file:..` and needs `dist/` to exist.

### Tests & lint

```bash
make test         # run all tests
make test-viewer  # session-viewer tests only

make lint         # lint all components
make lint-viewer  # session-viewer only
```

### Deploy

```bash
make deploy-backend   # cdk deploy
```

## Usage

```
npx codespeak-vibe-share
```

The tool will:

1. Discover agent session on your machine
2. Give you a list of project these agents contributed too
2. Let you choose which project to share
3. Give you a preview of what's going to be shared
4. Ask your consent
5. If you agree, upload the project to be shared with CodeSpeak
