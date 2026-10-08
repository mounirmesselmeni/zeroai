# Run with Docker Compose

Docker Compose runs the backend and frontend without installing Python, Node, or Yarn on your
laptop. You need Docker with the Compose plugin. Source files are bind-mounted for live reload;
Python and Node dependencies stay in Docker named volumes. The first start downloads those
dependencies into the volumes. The browser tests are available as an optional service.

## Start the app

From the repository root:

```bash
docker compose up --build
```

Open <http://localhost:5173>. The API is available at <http://localhost:8000> and its interactive
documentation at <http://localhost:8000/docs>. The project guide site is at <http://localhost:8010>.
The frontend starts after the backend health check passes.

The SQLite database is kept in the `zeroai_data` named volume, so settings and usage remain after
containers stop. To stop the services, press `Ctrl+C` and run:

```bash
docker compose down
```

To remove the saved database and dependency volumes, run `docker compose down --volumes`.

## Choose a model

The default configuration seeds Ollama at `http://host.docker.internal:11434/v1`. To use Ollama on
the host, it must accept connections from Docker; configure its listen address as needed for your
operating system. Alternatively, open **Settings** in ZeroAI and configure an OpenAI API key or a
different model endpoint. The Compose setup allows the host Ollama origin, OpenAI, and Ollama Cloud
by default.

The model values seed the database only on its first start. If you change the environment variables
after that, update the model in **Settings** or remove the `zeroai_data` volume to seed a fresh
configuration.

## Run Playwright

The optional Playwright service runs the browser suite in Chromium:

```bash
docker compose --profile e2e run --build --rm playwright
```

Playwright starts its own Vite server with `VITE_USE_MSW=true`; Orval-generated MSW handlers provide
the API responses. It does not start or call the backend service. The image includes Chromium and
its system dependencies, and its Playwright version matches the version in `frontend/package.json`.
Playwright's `test-results` and `playwright-report` folders are written beside the mounted frontend
source; installed packages stay in a separate named volume.

## `just` shortcuts

If `just` is installed, these commands wrap Compose:

```bash
just compose-up
just compose-docs
just compose-e2e
just compose-check
just compose-down
```

`just compose-check` runs backend lint, typing and tests; frontend lint, formatting, type/build and
unit checks; a streamed comparison of the backend OpenAPI output with the checked-in Orval input;
Playwright; and the strict docs build. It leaves the checked-in OpenAPI file and Orval-generated
client files in place. Check-only dependencies use separate named volumes so they do not replace the
dependency volumes used by the running app.
