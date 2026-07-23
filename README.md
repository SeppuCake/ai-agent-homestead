# Agent Homestead

Agent Homestead is a local-first TypeScript, Vite, and Three.js workspace that
turns AI-agent activity into a lightweight pixel homestead.

## Studio features

- Projects and persistent local chat sessions.
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

Open <http://127.0.0.1:4174>. The server binds only to `127.0.0.1` or `localhost`.

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

This file contains projects, session transcripts, agent settings, workflow
runs, and Codex thread IDs. The directory is ignored by Git.

For an OpenAI API agent, enter only the name of an environment variable such as `OPENAI_API_KEY`, then define that variable in the environment that starts Agent Homestead.

## Session access

- **Read only** lets agents inspect a project and prepare plans or reviews.
- **Workspace write** lets build and test stages modify the selected project.

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

Requires Node.js 20 or newer and an installed, authenticated Codex CLI for
Local Codex agents.
