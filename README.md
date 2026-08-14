# Agent Homestead

Agent Homestead is a local-first TypeScript, Vite, and Three.js workspace that
turns AI-agent activity into a lightweight pixel homestead.

## Studio features

- Projects and persistent local chat sessions.
- Image, PDF, text, and code attachments with local chat metadata.
- Per-agent Codex thread continuity across messages and restarts.
- A multi-agent workflow with plan, build, test, and delivery stages.
- A 32 x 32 pixel avatar gallery plus custom image upload.
- Agent name, role, personality, skills, plugins, provider, model, and
  persistent-memory settings.
- Live discovery of locally installed Codex skills and plugins.
- Local Codex or OpenAI API providers.
- Three.js agent tokens that move between the cafe, armoury, and work range as
  the workflow progresses.

## Start

Double-click `start-homestead.cmd`, or run:

```powershell
npm.cmd run start
```

Open <http://127.0.0.1:4174>. The server binds only to `127.0.0.1`.

For development, run these in separate terminals:

```powershell
npm.cmd run bridge
npm.cmd run dev
```

Vite proxies `/api` requests to the local bridge.

## Local persistence

Studio state is written to:

```text
.agent-homestead/state.json
```

Message attachments are stored separately under:

```text
.agent-homestead/attachments/<session-id>/
```

This file contains projects, session transcripts, agent settings, workflow
runs, and Codex thread IDs. The directory is ignored by Git.

Raw API keys are never saved. For an OpenAI API agent, enter only the name of
an environment variable such as `OPENAI_API_KEY`, then define that variable in
the environment that starts Agent Homestead.

Each message accepts up to four PNG, JPEG, WebP, PDF, text, or common code
files, limited to 2 MB each and 8 MB total. Image previews stay in the browser;
the server validates and renames uploaded files before saving them. Attachment
content is treated as untrusted user context rather than agent instructions.

## Session access

- **Read only** lets agents inspect a project and prepare plans or reviews.
- **Workspace write** lets build and test stages modify the selected project.

The access chip beside the prompt is a shortcut for the same session setting:
activate **READ-ONLY** to enable **APPROVE FOR ME**, and activate it again to
return to read-only access.

External publishing is never automatic. The delivery stage reports what is
ready and asks for explicit confirmation before an external deployment.

## Workflow

1. A coordinator inspects the request and creates the implementation plan.
2. A builder implements it, or produces a patch proposal in read-only mode.
3. A tester independently checks the work and records evidence.
4. A presenter returns the final delivery report.

Roles fall back to available team members, so the workflow also works with a
small two-agent team.

## Commands

```powershell
npm.cmd run dev
npm.cmd run bridge
npm.cmd run build
npm.cmd run start
```

Requires Node.js 22.12 or newer and an installed, authenticated Codex CLI for
Local Codex agents.

## Docker production build

Docker packages the compiled dashboard and Node server into a Linux container.
Local Homestead sessions persist in the `agent-homestead-data` named volume,
which survives container replacement and image rebuilds.

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f homestead
```

Open <http://127.0.0.1:4174>. Stop the service without deleting its data:

```powershell
docker compose down
```

If port 4174 is already occupied, override only the host-side port:

```powershell
$env:HOMESTEAD_PORT = "4175"
docker compose up --build -d
```

The dashboard is then available at <http://127.0.0.1:4175>, while the server
continues to listen on port 4174 inside its container.

The Linux container cannot execute the Windows Codex desktop runtime, so Local
Codex agents run in Demo mode in this first container milestone. OpenAI API
agents remain available: copy `.env.example` to `.env`, add the key locally,
and recreate the service with `docker compose up -d --force-recreate`. The real
`.env` file is excluded from Git and the Docker build context.
