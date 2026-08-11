import avatarWalkAtlasUrl from "./assets/agent-avatar-walk-atlas-v1.png";
import {
	avatarPresets,
	avatarPresetRows,
	avatarRowPosition,
	avatarTopTrim,
} from "./avatar-atlas";

type SessionMode = "chat" | "workflow";
type SessionPermission = "read-only" | "workspace-write";
type ProviderType = "local-codex" | "openai-api";

interface Project {
	id: string;
	name: string;
	path: string;
}

interface AgentProfile {
	id: string;
	name: string;
	avatar: string;
	role: string;
	personality: string;
	skills: string[];
	plugins: string[];
	provider: ProviderType;
	model: string;
	apiKeyEnv: string;
	memories: string;
}

interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	agentId: string | null;
	text: string;
	kind: string;
	stage: string;
	createdAt: string;
}

interface SessionSummary {
	id: string;
	projectId: string;
	title: string;
	mode: SessionMode;
	permission: SessionPermission;
	leadAgentId: string;
	agentIds: string[];
	messageCount: number;
	lastMessage: string;
	updatedAt: string;
}

interface SessionDetail extends SessionSummary {
	messages: ChatMessage[];
	workflowRuns: Array<{
		id: string;
		status: string;
		stage: string;
	}>;
}

interface CatalogItem {
	name: string;
	description: string;
	id?: string;
}

interface BootstrapPayload {
	projects: Project[];
	agents: AgentProfile[];
	sessions: SessionSummary[];
	settings: {
		activeProjectId: string | null;
		activeSessionId: string | null;
	};
	catalog: {
		skills: CatalogItem[];
		plugins: CatalogItem[];
		catalogErrors: string[];
	};
}

type ApprovalDecision =
	| "accept"
	| "acceptForSession"
	| "decline"
	| "cancel";

interface ApprovalRequest {
	type: "approval-request";
	requestId: string;
	method: string;
	kind: "command" | "file-change" | "permissions";
	threadId: string | null;
	turnId: string | null;
	itemId: string | null;
	reason: string;
	command: string;
	cwd: string;
	grantRoot: string;
	permissions: Record<string, unknown> | null;
	availableDecisions: string[] | null;
}

interface StudioContext {
	taskForm: HTMLFormElement;
	taskPrompt: HTMLTextAreaElement;
	runTaskButton: HTMLButtonElement;
	taskHint: HTMLParagraphElement;
	resultText: HTMLParagraphElement;
	addActivity: (message: string, kind?: string) => void;
}

function setAvatarAtlasPosition(
	element: HTMLElement,
	row: number,
): void {
	element.style.setProperty("--avatar-row", String(row));
	element.style.setProperty(
		"--avatar-row-position",
		avatarRowPosition(row),
	);
	element.style.setProperty(
		"--avatar-top-trim",
		avatarTopTrim(row),
	);
}

function requireElement<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Studio could not find ${selector}`);
	}
	return element;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: "application/json",
			...(options?.body ? { "Content-Type": "application/json" } : {}),
			...options?.headers,
		},
		...options,
	});
	const payload = (await response.json()) as T & { error?: string };
	if (!response.ok) {
		throw new Error(payload.error ?? `Request failed (${response.status})`);
	}
	return payload;
}

function avatarClass(avatar: string): string {
	const preset = avatar.startsWith("preset:") ? avatar.slice(7) : "uploaded";
	return `pixel-avatar avatar-${preset}`;
}

function initials(name: string): string {
	return (
		name
			.split(/\s+/)
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase() || "AI"
	);
}

function createAvatar(agent: Pick<AgentProfile, "avatar" | "name">): HTMLElement {
	if (agent.avatar.startsWith("data:image/")) {
		const image = document.createElement("img");
		image.className = "pixel-avatar";
		image.src = agent.avatar;
		image.alt = "";
		return image;
	}

	const preset = agent.avatar.startsWith("preset:")
		? agent.avatar.slice(7)
		: "";
	const atlasRow = avatarPresetRows.get(preset);
	if (atlasRow !== undefined) {
		const avatar = document.createElement("span");
		avatar.className = `${avatarClass(agent.avatar)} avatar-walk-sprite`;
		avatar.style.backgroundImage = `url("${avatarWalkAtlasUrl}")`;
		setAvatarAtlasPosition(avatar, atlasRow);
		avatar.setAttribute("aria-hidden", "true");
		return avatar;
	}

	const avatar = document.createElement("span");
	avatar.className = avatarClass(agent.avatar);
	avatar.textContent = initials(agent.name);
	avatar.setAttribute("aria-hidden", "true");
	return avatar;
}

function formatTime(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function selectedValues(select: HTMLSelectElement): string[] {
	return Array.from(select.selectedOptions, (option) => option.value);
}

function setSelectedValues(select: HTMLSelectElement, values: string[]): void {
	const selected = new Set(values);
	for (const option of select.options) {
		option.selected = selected.has(option.value);
	}
}

async function resizeAvatar(file: File): Promise<string> {
	if (!file.type.startsWith("image/")) {
		throw new Error("Avatar upload must be an image");
	}
	if (file.size > 4 * 1024 * 1024) {
		throw new Error("Avatar upload must be smaller than 4 MB");
	}

	const bitmap = await createImageBitmap(file);
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 32;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not prepare the avatar");
	}
	context.imageSmoothingEnabled = false;
	context.clearRect(0, 0, 32, 32);

	const scale = Math.max(32 / bitmap.width, 32 / bitmap.height);
	const width = bitmap.width * scale;
	const height = bitmap.height * scale;
	context.drawImage(bitmap, (32 - width) / 2, (32 - height) / 2, width, height);
	bitmap.close();
	return canvas.toDataURL("image/png");
}

export async function initStudio(context: StudioContext): Promise<void> {
	context.taskForm.dataset.studioReady = "true";
	const appShell = requireElement<HTMLElement>(document, ".app-shell");
	const controlPanel = requireElement<HTMLElement>(document, ".control-panel");
	const footer = requireElement<HTMLElement>(appShell, ".footer");

	const studioShell = document.createElement("div");
	studioShell.className = "studio-shell";
	appShell.before(studioShell);

	const sidebar = document.createElement("aside");
	sidebar.className = "studio-sidebar panel";
	sidebar.innerHTML = `
		<div class="studio-sidebar-heading">
			<div>
				<p class="eyebrow">PROJECT</p>
				<select id="project-select" aria-label="Active project"></select>
			</div>
			<button id="new-project" class="square-button" type="button" aria-label="Add project">+</button>
		</div>
		<div class="session-actions">
			<button id="new-chat" class="secondary-button" type="button">+ Chat</button>
			<button id="new-workflow" class="secondary-button" type="button">+ Workflow</button>
		</div>
		<nav aria-label="Chat sessions">
			<ol id="session-list" class="session-list"></ol>
		</nav>
		<div class="studio-team-summary">
			<div class="section-title-row">
				<h3>Homestead Team</h3>
				<button id="manage-agents" class="text-button" type="button">Manage</button>
			</div>
			<div id="team-roster" class="team-roster"></div>
		</div>
	`;
	studioShell.append(sidebar, appShell);

	const sessionToolbar = document.createElement("section");
	sessionToolbar.className = "session-toolbar";
	sessionToolbar.innerHTML = `
		<div class="session-identity">
			<p class="eyebrow">ACTIVE SESSION</p>
			<strong id="active-session-title">Loading…</strong>
		</div>
		<label>
			<span>Mode</span>
			<select id="session-mode">
				<option value="chat">Chat</option>
				<option value="workflow">Workflow</option>
			</select>
		</label>
		<label>
			<span>Lead</span>
			<select id="lead-agent"></select>
		</label>
		<label class="session-team-field">
			<span>Team</span>
			<select id="session-team" multiple size="2" aria-label="Agents assigned to this session"></select>
		</label>
		<label>
			<span>Access</span>
			<select id="session-permission" title="Approve for me keeps Codex sandboxed and automatically reviews requests that need more access.">
				<option value="read-only">Read only</option>
				<option value="workspace-write">Approve for me</option>
			</select>
		</label>
	`;
	controlPanel.insertBefore(sessionToolbar, context.taskForm);

	const conversation = document.createElement("section");
	conversation.className = "conversation-card panel";
	conversation.setAttribute("aria-labelledby", "conversation-title");
	conversation.innerHTML = `
		<div class="conversation-heading">
			<div>
				<p class="eyebrow">SESSION LOG</p>
				<h2 id="conversation-title">Local conversation</h2>
			</div>
			<div class="conversation-tools">
				<span id="conversation-count">0 messages</span>
				<button id="conversation-latest" class="secondary-button conversation-latest-button" type="button" hidden>
					↓ Latest
				</button>
			</div>
		</div>
		<ol
			id="conversation-list"
			class="conversation-list"
			aria-live="polite"
			aria-relevant="additions text"
			tabindex="0"
		></ol>
	`;
	appShell.insertBefore(conversation, footer);

	const projectDialog = document.createElement("dialog");
	projectDialog.className = "studio-dialog project-dialog";
	projectDialog.innerHTML = `
		<form id="project-form" method="dialog">
			<div class="dialog-heading">
				<div>
					<p class="eyebrow">LOCAL WORKSPACE</p>
					<h2>Add project</h2>
				</div>
				<button class="square-button" value="cancel" aria-label="Close">×</button>
			</div>
			<label>Project name<input id="project-name" maxlength="80" required /></label>
			<label>Absolute folder path<input id="project-path" placeholder="D:\\Projects\\my-app" required /></label>
			<p class="task-hint">The folder must already exist. Agent Homestead never uploads the path.</p>
			<button id="save-project" class="primary-button" value="default" type="submit">Add project</button>
		</form>
	`;

	const agentDialog = document.createElement("dialog");
	agentDialog.className = "studio-dialog agent-dialog";
	agentDialog.innerHTML = `
		<div class="dialog-heading">
			<div>
				<p class="eyebrow">AGENT WORKSHOP</p>
				<h2>Configure agents</h2>
			</div>
			<button id="close-agent-dialog" class="square-button" type="button" aria-label="Close">×</button>
		</div>
		<div class="agent-workshop">
			<div>
				<button id="new-agent" class="secondary-button full-button" type="button">+ New agent</button>
				<ol id="agent-editor-list" class="agent-editor-list"></ol>
			</div>
			<form id="agent-form" class="agent-form">
				<input id="agent-id" type="hidden" />
				<label>Name<input id="agent-name" maxlength="60" required /></label>
				<label>Role
					<select id="agent-role">
						<option value="coordinator">Coordinator / Planner</option>
						<option value="builder">Builder</option>
						<option value="tester">Tester</option>
						<option value="presenter">Presenter</option>
						<option value="general">General specialist</option>
					</select>
				</label>
				<fieldset>
					<legend>32 × 32 pixel avatar</legend>
					<div id="avatar-gallery" class="avatar-gallery"></div>
					<label class="upload-label">Upload your own<input id="avatar-upload" type="file" accept="image/*" /></label>
					<input id="agent-avatar" type="hidden" value="preset:scout" />
				</fieldset>
				<label>Personality<textarea id="agent-personality" rows="4" maxlength="4000"></textarea></label>
				<label>Skills
					<select id="agent-skills" multiple size="6"></select>
				</label>
				<label>Plugins
					<select id="agent-plugins" multiple size="5"></select>
				</label>
				<label>Provider
					<select id="agent-provider">
						<option value="local-codex">Local Codex</option>
						<option value="openai-api">OpenAI API</option>
					</select>
				</label>
				<div class="agent-provider-grid">
					<label>Model<input id="agent-model" placeholder="gpt-5.6-terra" /></label>
					<label>API key environment variable<input id="agent-api-env" value="OPENAI_API_KEY" /></label>
				</div>
				<p class="task-hint">Keys are read from the server environment and are never saved in this dashboard.</p>
				<label>Persistent memories<textarea id="agent-memories" rows="5" maxlength="12000" placeholder="Durable facts, preferences, boundaries, and project context to prepend for this agent."></textarea></label>
				<div class="dialog-actions">
					<button id="delete-agent" class="danger-button" type="button">Delete</button>
					<button class="primary-button" type="submit">Save agent</button>
				</div>
			</form>
		</div>
	`;

	const approvalDialog = document.createElement("dialog");
	approvalDialog.className = "studio-dialog approval-dialog";
	approvalDialog.setAttribute("aria-labelledby", "approval-title");
	approvalDialog.setAttribute("aria-describedby", "approval-description");
	approvalDialog.innerHTML = `
		<div class="dialog-heading">
			<div>
				<p class="eyebrow">CODEX APPROVAL</p>
				<h2 id="approval-title">Review requested access</h2>
			</div>
			<button id="approval-cancel" class="square-button" type="button" aria-label="Cancel request">&times;</button>
		</div>
		<p id="approval-description" class="approval-description">
			Automatic review paused this action so that you can make the final decision.
		</p>
		<dl class="approval-details">
			<div><dt>Request</dt><dd id="approval-kind"></dd></div>
			<div id="approval-reason-row"><dt>Reason</dt><dd id="approval-reason"></dd></div>
			<div id="approval-location-row"><dt>Location</dt><dd id="approval-location"></dd></div>
		</dl>
		<div id="approval-command-panel" class="approval-command-panel" hidden>
			<p>Exact command</p>
			<pre id="approval-command"></pre>
		</div>
		<div id="approval-permissions-panel" class="approval-command-panel" hidden>
			<p>Requested permissions</p>
			<pre id="approval-permissions"></pre>
		</div>
		<p id="approval-status" class="task-hint" role="status" aria-live="polite"></p>
		<div class="dialog-actions approval-actions">
			<button id="approval-decline" class="danger-button" type="button">Decline</button>
			<div>
				<button id="approval-once" class="secondary-button" type="button">Approve once</button>
				<button id="approval-session" class="primary-button" type="button">Approve for session</button>
			</div>
		</div>
	`;
	document.body.append(projectDialog, agentDialog, approvalDialog);

	const projectSelect = requireElement<HTMLSelectElement>(
		sidebar,
		"#project-select",
	);
	const sessionList = requireElement<HTMLOListElement>(sidebar, "#session-list");
	const teamRoster = requireElement<HTMLDivElement>(sidebar, "#team-roster");
	const activeSessionTitle = requireElement<HTMLElement>(
		sessionToolbar,
		"#active-session-title",
	);
	const sessionMode = requireElement<HTMLSelectElement>(
		sessionToolbar,
		"#session-mode",
	);
	const sessionPermission = requireElement<HTMLSelectElement>(
		sessionToolbar,
		"#session-permission",
	);
	const leadAgentSelect = requireElement<HTMLSelectElement>(
		sessionToolbar,
		"#lead-agent",
	);
	const sessionTeam = requireElement<HTMLSelectElement>(
		sessionToolbar,
		"#session-team",
	);
	const conversationList = requireElement<HTMLOListElement>(
		conversation,
		"#conversation-list",
	);
	const conversationCount = requireElement<HTMLElement>(
		conversation,
		"#conversation-count",
	);
	const conversationLatestButton = requireElement<HTMLButtonElement>(
		conversation,
		"#conversation-latest",
	);
	const projectForm = requireElement<HTMLFormElement>(
		projectDialog,
		"#project-form",
	);
	const agentForm = requireElement<HTMLFormElement>(agentDialog, "#agent-form");
	const agentEditorList = requireElement<HTMLOListElement>(
		agentDialog,
		"#agent-editor-list",
	);
	const avatarGallery = requireElement<HTMLDivElement>(
		agentDialog,
		"#avatar-gallery",
	);
	const agentSkills = requireElement<HTMLSelectElement>(
		agentDialog,
		"#agent-skills",
	);
	const agentPlugins = requireElement<HTMLSelectElement>(
		agentDialog,
		"#agent-plugins",
	);
	const approvalKind = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-kind",
	);
	const approvalReasonRow = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-reason-row",
	);
	const approvalReason = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-reason",
	);
	const approvalLocationRow = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-location-row",
	);
	const approvalLocation = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-location",
	);
	const approvalCommandPanel = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-command-panel",
	);
	const approvalCommand = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-command",
	);
	const approvalPermissionsPanel = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-permissions-panel",
	);
	const approvalPermissions = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-permissions",
	);
	const approvalStatus = requireElement<HTMLElement>(
		approvalDialog,
		"#approval-status",
	);
	const approvalButtons = [
		requireElement<HTMLButtonElement>(approvalDialog, "#approval-cancel"),
		requireElement<HTMLButtonElement>(approvalDialog, "#approval-decline"),
		requireElement<HTMLButtonElement>(approvalDialog, "#approval-once"),
		requireElement<HTMLButtonElement>(approvalDialog, "#approval-session"),
	];
	const approvalSessionButton = approvalButtons[3];

	const queuedBridgeEvents: Array<Record<string, unknown>> = [];
	const queueBridgeEvent = (rawEvent: Event): void => {
		queuedBridgeEvents.push(
			(rawEvent as CustomEvent<Record<string, unknown>>).detail,
		);
	};
	window.addEventListener("homestead:bridge", queueBridgeEvent);
	let bootstrap = await api<BootstrapPayload>("/api/bootstrap").catch(
		(error: unknown) => {
			window.removeEventListener("homestead:bridge", queueBridgeEvent);
			throw error;
		},
	);
	let activeProjectId =
		bootstrap.settings.activeProjectId ?? bootstrap.projects[0]?.id ?? null;
	let activeSessionId =
		bootstrap.settings.activeSessionId ??
		bootstrap.sessions.find((session) => session.projectId === activeProjectId)
			?.id ??
		null;
	let activeSession: SessionDetail | null = null;
	let editingAgent: AgentProfile | null = null;
	let busy = false;
	let conversationFollowsLatest = true;
	let approvalBusy = false;
	const approvalQueue: ApprovalRequest[] = [];

	function approvalLabel(kind: ApprovalRequest["kind"]): string {
		if (kind === "command") {
			return "Run a command outside the current automatic boundary";
		}
		if (kind === "file-change") {
			return "Write outside the current workspace boundary";
		}
		return "Use additional filesystem or network permissions";
	}

	function renderApproval(): void {
		const approval = approvalQueue[0];
		if (!approval) {
			if (approvalDialog.open) {
				approvalDialog.close();
			}
			return;
		}

		approvalKind.textContent = approvalLabel(approval.kind);
		approvalReasonRow.hidden = !approval.reason;
		approvalReason.textContent = approval.reason;
		const location = approval.cwd || approval.grantRoot;
		approvalLocationRow.hidden = !location;
		approvalLocation.textContent = location;
		approvalCommandPanel.hidden = !approval.command;
		approvalCommand.textContent = approval.command;
		approvalPermissionsPanel.hidden = !approval.permissions;
		approvalPermissions.textContent = approval.permissions
			? JSON.stringify(approval.permissions, null, 2)
			: "";
		approvalStatus.textContent = "Review the exact scope before approving.";
		approvalSessionButton.hidden = Boolean(
			approval.availableDecisions &&
				!approval.availableDecisions.includes("acceptForSession"),
		);
		for (const button of approvalButtons) {
			button.disabled = approvalBusy;
		}
		if (!approvalDialog.open) {
			approvalDialog.showModal();
		}
	}

	function enqueueApproval(event: Record<string, unknown>): void {
		const requestId = String(event.requestId ?? "");
		if (
			!requestId ||
			approvalQueue.some((approval) => approval.requestId === requestId)
		) {
			return;
		}

		approvalQueue.push({
			type: "approval-request",
			requestId,
			method: String(event.method ?? ""),
			kind:
				event.kind === "command" || event.kind === "file-change"
					? event.kind
					: "permissions",
			threadId: typeof event.threadId === "string" ? event.threadId : null,
			turnId: typeof event.turnId === "string" ? event.turnId : null,
			itemId: typeof event.itemId === "string" ? event.itemId : null,
			reason: String(event.reason ?? ""),
			command: String(event.command ?? ""),
			cwd: String(event.cwd ?? ""),
			grantRoot: String(event.grantRoot ?? ""),
			permissions:
				event.permissions && typeof event.permissions === "object"
					? (event.permissions as Record<string, unknown>)
					: null,
			availableDecisions: Array.isArray(event.availableDecisions)
				? event.availableDecisions.map(String)
				: null,
		});
		renderApproval();
	}

	async function answerApproval(decision: ApprovalDecision): Promise<void> {
		const approval = approvalQueue[0];
		if (!approval || approvalBusy) {
			return;
		}

		approvalBusy = true;
		approvalStatus.textContent = "Sending your decision to Codex...";
		renderApproval();
		try {
			await api(`/api/approvals/${encodeURIComponent(approval.requestId)}`, {
				method: "POST",
				body: JSON.stringify({ decision }),
			});
			const index = approvalQueue.findIndex(
				(item) => item.requestId === approval.requestId,
			);
			if (index >= 0) {
				approvalQueue.splice(index, 1);
			}
		} catch (error) {
			approvalStatus.textContent =
				error instanceof Error ? error.message : "Could not send approval";
		} finally {
			approvalBusy = false;
			renderApproval();
		}
	}

	function agentById(agentId: string | null): AgentProfile | undefined {
		return bootstrap.agents.find((agent) => agent.id === agentId);
	}

	function populateCatalogSelect(
		select: HTMLSelectElement,
		items: CatalogItem[],
		valueKey: "name" | "id",
	): void {
		select.replaceChildren();
		for (const item of items) {
			const option = document.createElement("option");
			option.value =
				valueKey === "id" ? (item.id ?? item.name) : item.name;
			option.textContent = item.name;
			option.title = item.description;
			select.append(option);
		}
	}

	function renderProjects(): void {
		projectSelect.replaceChildren();
		for (const project of bootstrap.projects) {
			const option = document.createElement("option");
			option.value = project.id;
			option.textContent = project.name;
			option.title = project.path;
			option.selected = project.id === activeProjectId;
			projectSelect.append(option);
		}
	}

	function renderSessions(): void {
		sessionList.replaceChildren();
		const sessions = bootstrap.sessions.filter(
			(session) => session.projectId === activeProjectId,
		);

		for (const session of sessions) {
			const item = document.createElement("li");
			const button = document.createElement("button");
			button.type = "button";
			button.className = "session-item";
			button.dataset.active = String(session.id === activeSessionId);
			button.dataset.sessionId = session.id;

			const mode = document.createElement("span");
			mode.className = "session-mode-icon";
			mode.textContent = session.mode === "workflow" ? "WF" : "CH";
			const copy = document.createElement("span");
			const title = document.createElement("strong");
			title.textContent = session.title;
			const preview = document.createElement("small");
			preview.textContent =
				session.lastMessage || `${session.messageCount} saved messages`;
			copy.append(title, preview);
			button.append(mode, copy);
			item.append(button);
			sessionList.append(item);
		}
	}

	function renderTeam(): void {
		teamRoster.replaceChildren();
		if (!activeSession) {
			return;
		}
		const team = activeSession.agentIds
			.map((id) => agentById(id))
			.filter((agent): agent is AgentProfile => Boolean(agent));

		for (const agent of team) {
			const chip = document.createElement("span");
			chip.className = "team-chip";
			chip.title = `${agent.name} · ${agent.role}`;
			chip.append(createAvatar(agent));
			const name = document.createElement("span");
			name.textContent = agent.name;
			chip.append(name);
			teamRoster.append(chip);
		}

		window.dispatchEvent(
			new CustomEvent("homestead:team", {
				detail: {
					agents: team,
					leadAgentId: activeSession.leadAgentId,
				},
			}),
		);
	}

	function conversationIsNearLatest(): boolean {
		const distanceFromBottom =
			conversationList.scrollHeight -
			conversationList.scrollTop -
			conversationList.clientHeight;
		return distanceFromBottom < 72;
	}

	function updateConversationLatestButton(): void {
		conversationLatestButton.hidden = conversationFollowsLatest;
	}

	function scrollConversationToLatest(
		behavior: ScrollBehavior = "smooth",
	): void {
		conversationFollowsLatest = true;
		conversationList.scrollTo({
			top: conversationList.scrollHeight,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: behavior,
		});
		updateConversationLatestButton();
	}

	function renderConversation(forceLatest = false): void {
		const previousScrollTop = conversationList.scrollTop;
		if (forceLatest) {
			conversationFollowsLatest = true;
		}

		conversationList.replaceChildren();
		const messages = activeSession?.messages ?? [];
		const visibleMessages = messages.slice(-200);
		conversationCount.textContent =
			messages.length > visibleMessages.length
				? `Latest ${visibleMessages.length} of ${messages.length}`
				: `${messages.length} ${messages.length === 1 ? "message" : "messages"}`;

		if (messages.length === 0) {
			const empty = document.createElement("li");
			empty.className = "conversation-empty";
			empty.textContent =
				activeSession?.mode === "workflow"
					? "Give the team a brief to begin plan → build → test → deliver."
					: "This local conversation has no messages yet.";
			conversationList.append(empty);
			updateConversationLatestButton();
			return;
		}

		for (const message of visibleMessages) {
			const item = document.createElement("li");
			item.className = `chat-message is-${message.role}`;
			item.dataset.kind = message.kind;

			const header = document.createElement("div");
			const author = document.createElement("span");
			const agent = agentById(message.agentId);
			if (agent) {
				author.append(createAvatar(agent));
			}
			const name = document.createElement("strong");
			name.textContent =
				message.role === "user" ? "You" : (agent?.name ?? "Agent");
			author.append(name);
			const meta = document.createElement("small");
			meta.textContent = `${message.stage || message.kind} · ${formatTime(message.createdAt)}`;
			header.append(author, meta);

			const text = document.createElement("p");
			text.textContent = message.text;
			item.append(header, text);
			conversationList.append(item);
		}
		requestAnimationFrame(() => {
			if (conversationFollowsLatest) {
				scrollConversationToLatest(forceLatest ? "auto" : "smooth");
			} else {
				conversationList.scrollTop = previousScrollTop;
				updateConversationLatestButton();
			}
		});
		context.resultText.textContent =
			messages
				.filter((message) => message.role === "assistant")
				.at(-1)?.text ?? "No completed agent result yet.";
	}

	conversationList.addEventListener("scroll", () => {
		conversationFollowsLatest = conversationIsNearLatest();
		updateConversationLatestButton();
	});

	conversationLatestButton.addEventListener("click", () =>
		scrollConversationToLatest(),
	);

	function renderSessionSettings(): void {
		if (!activeSession) {
			return;
		}
		activeSessionTitle.textContent = activeSession.title;
		sessionMode.value = activeSession.mode;
		sessionPermission.value = activeSession.permission;
		leadAgentSelect.replaceChildren();
		sessionTeam.replaceChildren();
		for (const agent of bootstrap.agents) {
			const option = document.createElement("option");
			option.value = agent.id;
			option.textContent = agent.name;
			option.selected = activeSession.agentIds.includes(agent.id);
			sessionTeam.append(option);
		}
		for (const agentId of activeSession.agentIds) {
			const agent = agentById(agentId);
			if (!agent) {
				continue;
			}
			const option = document.createElement("option");
			option.value = agent.id;
			option.textContent = `${agent.name} · ${agent.role}`;
			option.selected = agent.id === activeSession.leadAgentId;
			leadAgentSelect.append(option);
		}
		context.runTaskButton.textContent =
			activeSession.mode === "workflow"
				? "Run agent workflow"
				: "Send message";
		context.taskPrompt.placeholder =
			activeSession.mode === "workflow"
				? "Describe what the team should plan, build, test, and deliver."
				: "Continue this local session with your lead agent.";
		context.taskHint.textContent =
			activeSession.permission === "workspace-write"
				? "Approve for me is enabled. Codex stays sandboxed, and external deployment still requires separate confirmation."
				: "Read-only session. Chats and memories persist locally.";
	}

	async function loadSession(
		sessionId: string,
		scrollToLatest = false,
	): Promise<void> {
		const sessionChanged = sessionId !== activeSessionId;
		activeSessionId = sessionId;
		activeSession = await api<SessionDetail>(`/api/sessions/${sessionId}`);
		activeProjectId = activeSession.projectId;
		renderProjects();
		renderSessions();
		renderSessionSettings();
		renderConversation(scrollToLatest || sessionChanged);
		renderTeam();
	}

	async function reloadBootstrap(): Promise<void> {
		bootstrap = await api<BootstrapPayload>("/api/bootstrap");
		renderProjects();
		renderSessions();
		populateCatalogSelect(agentSkills, bootstrap.catalog.skills, "name");
		populateCatalogSelect(agentPlugins, bootstrap.catalog.plugins, "id");
		if (activeSessionId) {
			await loadSession(activeSessionId);
		}
	}

	function renderAgentEditorList(): void {
		agentEditorList.replaceChildren();
		for (const agent of bootstrap.agents) {
			const item = document.createElement("li");
			const button = document.createElement("button");
			button.type = "button";
			button.className = "agent-editor-item";
			button.dataset.agentId = agent.id;
			button.dataset.active = String(editingAgent?.id === agent.id);
			button.append(createAvatar(agent));
			const copy = document.createElement("span");
			const name = document.createElement("strong");
			name.textContent = agent.name;
			const role = document.createElement("small");
			role.textContent = agent.role;
			copy.append(name, role);
			button.append(copy);
			item.append(button);
			agentEditorList.append(item);
		}
	}

	function selectAvatar(value: string): void {
		requireElement<HTMLInputElement>(agentForm, "#agent-avatar").value = value;
		for (const button of avatarGallery.querySelectorAll<HTMLButtonElement>(
			"[data-avatar]",
		)) {
			button.dataset.selected = String(button.dataset.avatar === value);
		}
	}

	function editAgent(agent: AgentProfile | null): void {
		editingAgent = agent;
		requireElement<HTMLInputElement>(agentForm, "#agent-id").value =
			agent?.id ?? "";
		requireElement<HTMLInputElement>(agentForm, "#agent-name").value =
			agent?.name ?? "New Agent";
		requireElement<HTMLSelectElement>(agentForm, "#agent-role").value =
			agent?.role ?? "general";
		requireElement<HTMLTextAreaElement>(
			agentForm,
			"#agent-personality",
		).value = agent?.personality ?? "";
		requireElement<HTMLSelectElement>(agentForm, "#agent-provider").value =
			agent?.provider ?? "local-codex";
		requireElement<HTMLInputElement>(agentForm, "#agent-model").value =
			agent?.model ?? "";
		requireElement<HTMLInputElement>(agentForm, "#agent-api-env").value =
			agent?.apiKeyEnv ?? "OPENAI_API_KEY";
		requireElement<HTMLTextAreaElement>(agentForm, "#agent-memories").value =
			agent?.memories ?? "";
		setSelectedValues(agentSkills, agent?.skills ?? []);
		setSelectedValues(agentPlugins, agent?.plugins ?? []);
		selectAvatar(agent?.avatar ?? "preset:scout");
		requireElement<HTMLButtonElement>(
			agentForm,
			"#delete-agent",
		).disabled = !agent;
		renderAgentEditorList();
	}

	for (const [row, preset] of avatarPresets.entries()) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "avatar-preview-button";
		button.dataset.avatar = `preset:${preset}`;
		button.title = `${preset} walking model`;
		button.setAttribute("aria-label", `Choose ${preset} walking model`);

		const preview = document.createElement("span");
		preview.className = `${avatarClass(
			`preset:${preset}`,
		)} avatar-walk-sprite is-animated`;
		preview.style.backgroundImage = `url("${avatarWalkAtlasUrl}")`;
		setAvatarAtlasPosition(preview, row);
		preview.setAttribute("aria-hidden", "true");

		const label = document.createElement("span");
		label.className = "avatar-preview-label";
		label.textContent = preset;
		button.append(preview, label);
		button.addEventListener("click", () =>
			selectAvatar(`preset:${preset}`),
		);
		avatarGallery.append(button);
	}

	projectSelect.addEventListener("change", async () => {
		activeProjectId = projectSelect.value;
		const session = bootstrap.sessions.find(
			(item) => item.projectId === activeProjectId,
		);
		if (session) {
			await loadSession(session.id, true);
		} else {
			renderSessions();
		}
	});

	sessionList.addEventListener("click", (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>(
			"[data-session-id]",
		);
		if (button?.dataset.sessionId) {
			void loadSession(button.dataset.sessionId, true);
		}
	});

	requireElement<HTMLButtonElement>(sidebar, "#new-project").addEventListener(
		"click",
		() => projectDialog.showModal(),
	);

	projectForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const name = requireElement<HTMLInputElement>(
			projectForm,
			"#project-name",
		).value;
		const path = requireElement<HTMLInputElement>(
			projectForm,
			"#project-path",
		).value;
		try {
			const payload = await api<{ project: Project; session: SessionDetail }>(
				"/api/projects",
				{
					method: "POST",
					body: JSON.stringify({ name, path }),
				},
			);
			projectDialog.close();
			await reloadBootstrap();
			await loadSession(payload.session.id, true);
		} catch (error) {
			context.addActivity(
				error instanceof Error ? error.message : "Could not add project",
				"error",
			);
		}
	});

	async function createSession(mode: SessionMode): Promise<void> {
		if (!activeProjectId) {
			return;
		}
		const title =
			mode === "workflow" ? "New Agent Workflow" : "New Homestead Chat";
		const session = await api<SessionDetail>("/api/sessions", {
			method: "POST",
			body: JSON.stringify({
				projectId: activeProjectId,
				title,
				mode,
				agentIds: bootstrap.agents.slice(0, 2).map((agent) => agent.id),
			}),
		});
		await reloadBootstrap();
		await loadSession(session.id, true);
		context.taskPrompt.focus();
	}

	requireElement<HTMLButtonElement>(sidebar, "#new-chat").addEventListener(
		"click",
		() => void createSession("chat"),
	);
	requireElement<HTMLButtonElement>(sidebar, "#new-workflow").addEventListener(
		"click",
		() => void createSession("workflow"),
	);

	async function patchActiveSession(
		patch: Partial<SessionDetail>,
	): Promise<void> {
		if (!activeSessionId) {
			return;
		}
		activeSession = await api<SessionDetail>(
			`/api/sessions/${activeSessionId}`,
			{
				method: "PATCH",
				body: JSON.stringify(patch),
			},
		);
		const summary = bootstrap.sessions.find(
			(session) => session.id === activeSessionId,
		);
		if (summary) {
			Object.assign(summary, activeSession);
		}
		renderSessionSettings();
		renderSessions();
		renderTeam();
	}

	sessionMode.addEventListener("change", () =>
		void patchActiveSession({ mode: sessionMode.value as SessionMode }),
	);
	sessionPermission.addEventListener("change", () =>
		void patchActiveSession({
			permission: sessionPermission.value as SessionPermission,
		}),
	);
	leadAgentSelect.addEventListener("change", () =>
		void patchActiveSession({ leadAgentId: leadAgentSelect.value }),
	);
	sessionTeam.addEventListener("change", () => {
		const agentIds = selectedValues(sessionTeam);
		if (agentIds.length > 0) {
			void patchActiveSession({ agentIds });
		}
	});

	function openAgents(): void {
		populateCatalogSelect(agentSkills, bootstrap.catalog.skills, "name");
		populateCatalogSelect(agentPlugins, bootstrap.catalog.plugins, "id");
		editAgent(bootstrap.agents[0] ?? null);
		agentDialog.showModal();
	}

	requireElement<HTMLButtonElement>(sidebar, "#manage-agents").addEventListener(
		"click",
		openAgents,
	);
	requireElement<HTMLButtonElement>(
		agentDialog,
		"#close-agent-dialog",
	).addEventListener("click", () => agentDialog.close());
	requireElement<HTMLButtonElement>(agentDialog, "#new-agent").addEventListener(
		"click",
		() => editAgent(null),
	);
	approvalButtons[0].addEventListener("click", () =>
		void answerApproval("cancel"),
	);
	approvalButtons[1].addEventListener("click", () =>
		void answerApproval("decline"),
	);
	approvalButtons[2].addEventListener("click", () =>
		void answerApproval("accept"),
	);
	approvalButtons[3].addEventListener("click", () =>
		void answerApproval("acceptForSession"),
	);
	approvalDialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		void answerApproval("cancel");
	});

	agentEditorList.addEventListener("click", (event) => {
		const button = (event.target as Element).closest<HTMLButtonElement>(
			"[data-agent-id]",
		);
		if (button?.dataset.agentId) {
			editAgent(agentById(button.dataset.agentId) ?? null);
		}
	});

	requireElement<HTMLInputElement>(
		agentDialog,
		"#avatar-upload",
	).addEventListener("change", async (event) => {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) {
			return;
		}
		try {
			selectAvatar(await resizeAvatar(file));
		} catch (error) {
			context.addActivity(
				error instanceof Error ? error.message : "Could not load avatar",
				"error",
			);
		}
	});

	agentForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const id = requireElement<HTMLInputElement>(agentForm, "#agent-id").value;
		const payload = {
			name: requireElement<HTMLInputElement>(agentForm, "#agent-name").value,
			avatar: requireElement<HTMLInputElement>(
				agentForm,
				"#agent-avatar",
			).value,
			role: requireElement<HTMLSelectElement>(agentForm, "#agent-role").value,
			personality: requireElement<HTMLTextAreaElement>(
				agentForm,
				"#agent-personality",
			).value,
			skills: selectedValues(agentSkills),
			plugins: selectedValues(agentPlugins),
			provider: requireElement<HTMLSelectElement>(
				agentForm,
				"#agent-provider",
			).value,
			model: requireElement<HTMLInputElement>(agentForm, "#agent-model").value,
			apiKeyEnv: requireElement<HTMLInputElement>(
				agentForm,
				"#agent-api-env",
			).value,
			memories: requireElement<HTMLTextAreaElement>(
				agentForm,
				"#agent-memories",
			).value,
		};
		try {
			const saved = await api<AgentProfile>(
				id ? `/api/agents/${id}` : "/api/agents",
				{
					method: id ? "PATCH" : "POST",
					body: JSON.stringify(payload),
				},
			);
			await reloadBootstrap();
			editAgent(agentById(saved.id) ?? saved);
			context.addActivity(`${saved.name} joined the homestead team.`, "success");
		} catch (error) {
			context.addActivity(
				error instanceof Error ? error.message : "Could not save agent",
				"error",
			);
		}
	});

	requireElement<HTMLButtonElement>(
		agentForm,
		"#delete-agent",
	).addEventListener("click", async () => {
		if (!editingAgent) {
			return;
		}
		if (!window.confirm(`Remove ${editingAgent.name} from Agent Homestead?`)) {
			return;
		}
		try {
			await api(`/api/agents/${editingAgent.id}`, { method: "DELETE" });
			await reloadBootstrap();
			editAgent(bootstrap.agents[0] ?? null);
		} catch (error) {
			context.addActivity(
				error instanceof Error ? error.message : "Could not remove agent",
				"error",
			);
		}
	});

	context.taskForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const prompt = context.taskPrompt.value.trim();
		if (!activeSession || !activeSessionId || prompt.length < 3 || busy) {
			if (prompt.length < 3) {
				context.taskHint.textContent = "Enter a short brief before dispatching.";
			}
			return;
		}

		busy = true;
		context.runTaskButton.disabled = true;
		scrollConversationToLatest();
		const endpoint =
			activeSession.mode === "workflow"
				? `/api/sessions/${activeSessionId}/workflow`
				: `/api/sessions/${activeSessionId}/messages`;
		context.addActivity(
			activeSession.mode === "workflow"
				? "Dispatching the agent workflow…"
				: "Sending the message to the lead agent…",
			"task",
		);

		try {
			await api(endpoint, {
				method: "POST",
				body: JSON.stringify({
					prompt,
					agentId: activeSession.leadAgentId,
					permission: activeSession.permission,
					leadAgentId: activeSession.leadAgentId,
					agentIds: activeSession.agentIds,
				}),
			});
			context.taskPrompt.value = "";
			await loadSession(activeSessionId, true);
		} catch (error) {
			busy = false;
			context.runTaskButton.disabled = false;
			context.addActivity(
				error instanceof Error ? error.message : "Could not dispatch task",
				"error",
			);
		}
	});

	context.taskPrompt.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			context.taskForm.requestSubmit();
		}
	});

	function handleStudioBridgeEvent(event: Record<string, unknown>): void {
		if (event.type === "approval-request") {
			enqueueApproval(event);
		}
		if (event.type === "approval-resolved") {
			const requestId = String(event.requestId ?? "");
			const index = approvalQueue.findIndex(
				(approval) => approval.requestId === requestId,
			);
			if (index >= 0) {
				approvalQueue.splice(index, 1);
			}
			renderApproval();
		}
		if (
			(event.type === "session-message" ||
				event.type === "agents-changed") &&
			(event.sessionId === activeSessionId || event.type === "agents-changed")
		) {
			void reloadBootstrap();
		}
		if (event.type === "workflow") {
			const action = String(event.action ?? "");
			if (action === "completed" || action === "failed") {
				busy = false;
				context.runTaskButton.disabled = false;
				void reloadBootstrap();
			}
		}
		if (event.type === "activity" && event.status === "idle") {
			busy = false;
			context.runTaskButton.disabled = false;
		}
	}

	window.addEventListener("homestead:bridge", (rawEvent) =>
		handleStudioBridgeEvent(
			(rawEvent as CustomEvent<Record<string, unknown>>).detail,
		),
	);
	window.removeEventListener("homestead:bridge", queueBridgeEvent);
	for (const event of queuedBridgeEvents) {
		handleStudioBridgeEvent(event);
	}

	renderProjects();
	renderSessions();
	populateCatalogSelect(agentSkills, bootstrap.catalog.skills, "name");
	populateCatalogSelect(agentPlugins, bootstrap.catalog.plugins, "id");
	if (activeSessionId) {
		await loadSession(activeSessionId, true);
	}
}
