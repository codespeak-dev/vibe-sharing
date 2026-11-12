# codespeak-vibe-share (retired)

This tool has been retired and no longer uploads anything.

To share your AI coding sessions with CodeSpeak, visit
[app.codespeak.dev](https://app.codespeak.dev).

## Data you shared earlier

Projects you donated with this tool remain stored by CodeSpeak.
You can still ask us to delete them at any time: email
[support@codespeak.dev](mailto:support@codespeak.dev).

Thank you to everyone who shared their projects with us. 💚

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

### Retirement stub

`stub/` contains the final npm release of `codespeak-vibe-share`: it only
prints a notice pointing to [app.codespeak.dev](https://app.codespeak.dev).
The root package is marked `private` so the old CLI can't be published over it.

```bash
cd stub && npm publish
npm deprecate codespeak-vibe-share@"*" "codespeak-vibe-share is retired. To share your AI coding sessions with CodeSpeak, visit https://app.codespeak.dev"
```
